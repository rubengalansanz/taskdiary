/**
 * Date and time primitives for the domain.
 *
 * Dates are local calendar days (`YYYY-MM-DD`) and times are integer minutes since
 * midnight. Both are plain values: no `Date` object crosses this boundary, and no UTC
 * conversion ever happens (ADR-003, plan rule §2.7).
 *
 * The calendar helpers work by parsing the `YYYY-MM-DD` string into its numeric parts
 * and doing integer arithmetic. `new Date('2026-02-30')` silently rolls over to March
 * 2nd and `new Date('2026-10-10')` parses as UTC midnight, which in negative UTC offsets
 * is the *previous* local day. Both are exactly the class of bug this module exists to
 * avoid.
 */

/** Minutes in one day; the exclusive upper bound for a `startMin`/`endMin` value. */
export const MINUTES_PER_DAY = 1440

/** Matches a well-formed local calendar day. Shape only — use {@link isValidLocalDate} for the date itself. */
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Days elapsed in a non-leap year, used to reject impossible days fast. */
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/**
 * Reports whether a string is a real local calendar day.
 *
 * Rejects `2026-02-30`, `2026-13-01` and `2026-1-1`, none of which are valid dates.
 *
 * @param value Candidate string.
 * @returns True when `value` is a `YYYY-MM-DD` day that exists in the calendar.
 */
export function isValidLocalDate(value: string): boolean {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    return false
  }

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))

  if (month < 1 || month > 12) {
    return false
  }

  return day >= 1 && day <= daysInMonth(year, month)
}

/**
 * Number of days in a given month.
 *
 * @param year Full year, e.g. `2026`.
 * @param month Month number, 1–12.
 * @returns Length of that month, accounting for leap years.
 */
export function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) {
    return 29
  }

  return DAYS_PER_MONTH[month - 1] ?? 0
}

/**
 * Reports whether a year is a leap year in the proleptic Gregorian calendar.
 *
 * @param year Full year.
 * @returns True when February has 29 days that year.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Reports whether an integer is a valid minute-of-day.
 *
 * @param minutes Candidate value.
 * @returns True when `0 <= minutes < 1440`.
 */
export function isValidMinuteOfDay(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= 0 && minutes < MINUTES_PER_DAY
}

/**
 * Converts minutes since midnight to a `HH:MM` string.
 *
 * @param minutes Minutes since midnight, `0`–`1439`.
 * @returns Zero-padded 24-hour time, e.g. `530` → `"08:50"`.
 * @throws RangeError When `minutes` is not a valid minute of the day.
 */
export function minutesToClock(minutes: number): string {
  if (!isValidMinuteOfDay(minutes)) {
    throw new RangeError(`Minutes out of range: ${minutes}`)
  }

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

/**
 * Converts a `HH:MM` string to minutes since midnight.
 *
 * Parses by length and character class rather than by regex: the shape is small and
 * fixed, and `security/detect-unsafe-regex` correctly flags the alternation-plus-
 * quantifier form as backtrackable on hostile input.
 *
 * @param clock Time string, optionally with seconds (`"08:50"` / `"08:50:00"`).
 * @returns Minutes since midnight.
 * @throws RangeError When the string is not a valid 24-hour time.
 */
export function clockToMinutes(clock: string): number {
  const isDigits = (part: string): boolean => {
    for (let index = 0; index < part.length; index += 1) {
      const code = part.charCodeAt(index)

      if (code < 48 || code > 57) {
        return false
      }
    }

    return true
  }

  // "HH:MM" or "HH:MM:SS" — exactly, with no padding tolerance.
  if (clock.length !== 5 && clock.length !== 8) {
    throw new RangeError(`Invalid clock time: ${clock}`)
  }

  if (clock[2] !== ':' || (clock.length === 8 && clock[5] !== ':')) {
    throw new RangeError(`Invalid clock time: ${clock}`)
  }

  const hoursPart = clock.slice(0, 2)
  const minutesPart = clock.slice(3, 5)
  const secondsPart = clock.length === 8 ? clock.slice(6, 8) : '00'

  if (!isDigits(hoursPart) || !isDigits(minutesPart) || !isDigits(secondsPart)) {
    throw new RangeError(`Invalid clock time: ${clock}`)
  }

  const hours = Number(hoursPart)
  const minutes = Number(minutesPart)
  const seconds = Number(secondsPart)

  // Minutes and seconds are bounded on their own, not only through the total: `08:60`
  // sums to 540, a perfectly valid minute-of-day that would otherwise be silently
  // reinterpreted as 09:00.
  if (minutes > 59 || seconds > 59) {
    throw new RangeError(`Invalid clock time: ${clock}`)
  }

  const total = hours * 60 + minutes

  if (!isValidMinuteOfDay(total)) {
    throw new RangeError(`Invalid clock time: ${clock}`)
  }

  return total
}

/** Numeric parts of a local calendar day. */
export interface LocalDateParts {
  /** Full year, e.g. `2026`. */
  year: number
  /** Month number, 1–12. */
  month: number
  /** Day of month, 1–31. */
  day: number
}

/**
 * Splits a local calendar day into its numeric parts.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns The year, month and day numbers.
 * @throws RangeError When `value` is not a valid local calendar day.
 */
export function parseLocalDate(value: string): LocalDateParts {
  if (!isValidLocalDate(value)) {
    throw new RangeError(`Invalid local date: ${value}`)
  }

  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10))
  }
}

/**
 * Builds a local calendar day from its parts, validating the result.
 *
 * @param year Full year.
 * @param month Month number, 1–12.
 * @param day Day of month.
 * @returns The day as `YYYY-MM-DD`.
 * @throws RangeError When the parts do not form a real calendar day.
 */
export function formatLocalDate(year: number, month: number, day: number): string {
  const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

  if (!isValidLocalDate(value)) {
    throw new RangeError(`Invalid local date: ${value}`)
  }

  return value
}

/**
 * Converts a `Date` to the local calendar day it falls on.
 *
 * The one sanctioned entry point for turning a `Date` into a `YYYY-MM-DD` string: it
 * uses the runtime's *local* timezone, never `toISOString()`, which would shift the day
 * for anyone west of UTC after 17:00 local.
 *
 * @param date Instant to convert.
 * @returns The local calendar day as `YYYY-MM-DD`.
 */
export function toLocalDateString(date: Date): string {
  return formatLocalDate(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/**
 * Today as a local calendar day.
 *
 * @param now Instant to read; defaults to the current time.
 * @returns Today's local calendar day as `YYYY-MM-DD`.
 */
export function today(now: Date = new Date()): string {
  return toLocalDateString(now)
}

/**
 * Converts a `Date` to the current ISO-8601 UTC instant.
 *
 * Used only for `created_at`, `updated_at` and `completed_at` — the three audit columns
 * the plan allows as instants (plan rule §2.7).
 *
 * @param date Instant to stamp.
 * @returns ISO-8601 string in UTC.
 */
export function toAuditTimestamp(date: Date = new Date()): string {
  return date.toISOString()
}
