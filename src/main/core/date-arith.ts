import {
  daysInMonth,
  formatLocalDate,
  isValidLocalDate,
  parseLocalDate
} from './datetime'

/**
 * Arithmetic *between* calendar days.
 *
 * `datetime.ts` already knows how to parse, format and validate a local day; this module
 * knows how to count from one day to another. Keeping the split there is deliberate — a second
 * parser and a second `isLeapYear` in the same directory would mean two definitions of "is
 * this a real calendar day", and they would drift.
 *
 * The renderer cannot lend a hand either: `shared/lib/date.ts` lives in the renderer's
 * bundle, and plan rule §2.10 keeps the main process testable in plain Node. Crossing that
 * boundary to borrow a helper is how the boundary quietly stops existing.
 *
 * Nothing here builds a `Date`. `new Date('2026-03-29')` is UTC midnight, and behind any
 * negative offset that string names the previous day (ADR-003) — which is why the whole
 * codebase moves between dates as integers.
 */

/**
 * Parses a day without throwing.
 *
 * `datetime.parseLocalDate` raises a `RangeError` on a bad string, which is the right answer
 * for a caller that is validating. The recurrence engine asks a different question — does this
 * day fall on the series? — and a malformed date has to answer "no" rather than abort the
 * Day view the user is opening.
 *
 * @param value Candidate `YYYY-MM-DD`.
 * @returns Year, month and day, or `null` when the string is not a real day.
 */
function tryParseLocalDate(
  value: string
): { year: number; month: number; day: number } | null {
  return isValidLocalDate(value) ? parseLocalDate(value) : null
}

/**
 * Days since a fixed proleptic-Gregorian origin, as a plain integer.
 *
 * A day count is the only arithmetic that makes recurrence correct across month lengths and
 * leap years. Comparing `year` and `month` separately, or subtracting the two date strings,
 * drifts by one every time a month is shorter than the interval.
 *
 * March is month 1 here so the leap day lands at the end of the year and never interrupts the
 * month lengths that precede it — the standard trick, and the reason `mp` below is offset by
 * 9 for January and February.
 *
 * @param value A valid `YYYY-MM-DD`.
 * @returns Whole days since the origin.
 */
function toDayNumber(value: string): number {
  const { year, month, day } = tryParseLocalDate(value) ?? { year: 1970, month: 1, day: 1 }
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
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36524) -
      Math.floor(dayOfEra / 146096)) /
      365
  )
  const year = yearOfEra + era * 400
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100))
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153)
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1
  const month = monthPrime + (monthPrime < 10 ? 3 : -9)

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
  // Day 0 is 1970-01-01, a Thursday, which is ISO weekday 4. Adding 3 then taking the
  // remainder puts Thursday at index 3, so +1 lands on 4. The double modulo keeps pre-epoch
  // dates positive instead of returning a negative weekday.
  return ((((toDayNumber(value) + 3) % 7) + 7) % 7) + 1
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
  const { year, month, day } = tryParseLocalDate(value) ?? { year: 1970, month: 1, day: 1 }
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
