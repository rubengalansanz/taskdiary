/**
 * Calendar arithmetic over local `YYYY-MM-DD` strings.
 *
 * The renderer has `shared/lib/date.ts`, but the main process must not import from the
 * renderer's bundle — plan rule §2.10 keeps the main testable in plain Node, and reaching
 * across that boundary to borrow a date helper is how that boundary quietly stops existing.
 *
 * The duplication is deliberate and small. Every function here parses a string into numbers and
 * never constructs a `Date`, which is the rule that matters: `new Date('2026-03-29')` is UTC
 * midnight, and in any timezone behind it that string names the previous day (ADR-003).
 */

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** Days in each month of a non-leap year. */
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * Whether a year has a 29th of February.
 *
 * @param year Full year.
 * @returns True for leap years under the proleptic Gregorian rule.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * How many days a month has.
 *
 * @param year Full year, needed because February's length is not fixed.
 * @param month Month number, 1–12.
 * @returns The month's length, or 0 when the month is out of range.
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28
  }

  return DAYS_PER_MONTH[month - 1] ?? 0
}

/**
 * Splits a day into numbers, or returns `null` when it is not a real calendar day.
 *
 * Validates the length of the month as well as its shape, so `2026-02-30` is rejected rather
 * than rolling silently into March — a caller that accepted it would be comparing strings that
 * name a day which does not exist.
 *
 * @param value Candidate `YYYY-MM-DD`.
 * @returns Year, month and day, or `null`.
 */
export function parseLocalDate(value: string): { year: number; month: number; day: number } | null {
  const match = LOCAL_DATE_PATTERN.exec(value)

  if (match === null) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null
  }

  return { year, month, day }
}

/**
 * Whether a string names a real calendar day.
 *
 * @param value Candidate `YYYY-MM-DD`.
 * @returns True when it is a valid local date.
 */
export function isValidLocalDate(value: string): boolean {
  return parseLocalDate(value) !== null
}

/**
 * Pads a number to two digits.
 *
 * @param value Number below 100.
 * @returns Two-character string.
 */
function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * Builds a `YYYY-MM-DD` string from numbers.
 *
 * @param year Full year.
 * @param month Month number, 1–12.
 * @param day Day of month.
 * @returns The formatted date.
 */
function formatLocalDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`
}

/**
 * Days from the epoch origin to a day, as a plain integer count.
 *
 * Days-since-a-fixed-origin is the only arithmetic that makes recurrence correct across month
 * lengths and leap years. Comparing `year` and `month` separately, or subtracting the two
 * strings, drifts by one every time a month is shorter than the interval — which is exactly
 * what the interval-7 test and the monthly clamp tests are there to catch.
 *
 * @param value A valid `YYYY-MM-DD`.
 * @returns Whole days since 0000-03-01, a proleptic-Gregorian constant offset.
 */
function toDayNumber(value: string): number {
  const { year, month, day } = parseLocalDate(value) ?? { year: 0, month: 1, day: 1 }

  // March-first so the leap day lands at the end of the year and never interrupts the
  // month lengths that precede it.
  const shifted = month <= 2 ? year - 1 : year
  const era = Math.floor(shifted / 400)
  const yearOfEra = shifted - era * 400
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear

  return era * 146097 + dayOfEra - 719468
}

/**
 * The inverse of {@link toDayNumber}.
 *
 * @param dayNumber Whole days since the same fixed origin.
 * @returns The `YYYY-MM-DD` it names.
 */
function fromDayNumber(dayNumber: number): string {
  const shifted = dayNumber + 719468
  const era = Math.floor(shifted / 146097)
  const dayOfEra = shifted - era * 146097
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) /
      365
  )
  const year = yearOfEra + era * 400
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const mp = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * mp + 2) / 5) + 1
  const month = mp + (mp < 10 ? 3 : -9)

  return formatLocalDate(month <= 2 ? year + 1 : year, month, day)
}

/**
 * Adds days to a date.
 *
 * @param value A valid `YYYY-MM-DD`.
 * @param delta Days to add; negative moves backwards.
 * @returns The shifted date.
 */
export function addDays(value: string, delta: number): string {
  return fromDayNumber(toDayNumber(value) + delta)
}

/**
 * Whole days between two dates, signed.
 *
 * @param from Start date.
 * @param to End date.
 * @returns Days from `from` to `to`; negative when `to` is earlier.
 */
export function daysBetween(from: string, to: string): number {
  return toDayNumber(to) - toDayNumber(from)
}

/**
 * ISO weekday, Monday = 1 through Sunday = 7.
 *
 * @param value A valid `YYYY-MM-DD`.
 * @returns The ISO weekday number.
 */
export function isoWeekday(value: string): number {
  const dayNumber = toDayNumber(value)

  // Day 0 is 1970-01-01, a Thursday, which is ISO weekday 4. Adding 3 then taking the
  // remainder puts Thursday at index 3, so +1 lands on 4 — and the double modulo keeps
  // pre-epoch dates positive instead of returning a negative weekday.
  return ((((dayNumber + 3) % 7) + 7) % 7) + 1
}

/**
 * Adds months, clamping to the last day of the target month.
 *
 * The clamp is what keeps the result a real day. October 31st plus one month has no
 * counterpart, and rolling over to November 1st would skip a day of the calendar.
 *
 * @param value A valid `YYYY-MM-DD`.
 * @param delta Months to add; negative moves backwards.
 * @returns The same day-of-month in the shifted month, or that month's last day.
 */
export function addMonths(value: string, delta: number): string {
  const { year, month, day } = parseLocalDate(value) ?? { year: 1970, month: 1, day: 1 }
  const absolute = year * 12 + (month - 1) + delta
  const nextYear = Math.floor(absolute / 12)
  // JavaScript's `%` keeps the dividend's sign, so a month before January lands on -1.
  const nextMonth = (((absolute % 12) + 12) % 12) + 1

  return formatLocalDate(nextYear, nextMonth, Math.min(day, daysInMonth(nextYear, nextMonth)))
}

/**
 * Lexicographic comparison of two local dates.
 *
 * `YYYY-MM-DD` sorts correctly as a string, which is why the whole codebase compares dates
 * with `<` instead of converting. This names the intent for readers who would otherwise reach
 * for `new Date()`.
 *
 * @param left First date.
 * @param right Second date.
 * @returns Negative, zero or positive, like a sort comparator.
 */
export function compareLocalDates(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
