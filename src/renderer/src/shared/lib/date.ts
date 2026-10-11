/**
 * Local-date helpers for the renderer.
 *
 * Every function here works on `YYYY-MM-DD` strings and integer minutes, matching what
 * the main process stores. Nothing constructs a `Date` from a date string: the renderer
 * and the main process would then disagree about the day whenever the user is west of
 * UTC, because `new Date('2026-10-10')` is UTC midnight.
 */

/** Matches a well-formed local calendar day. Shape only. */
export const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/** Days in each month of a non-leap year. */
const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

/** Minutes in a full day. */
const MINUTES_PER_DAY = 1440

/**
 * Reports whether a year is a leap year.
 *
 * @param year Full year.
 * @returns True when February has 29 days.
 */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/**
 * Number of days in a month.
 *
 * @param year Full year.
 * @param month Month number, 1–12.
 * @returns Length of that month.
 */
function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeapYear(year) ? 29 : (DAYS_PER_MONTH[month - 1] ?? 0)
}

/**
 * Reports whether a string is a real local calendar day.
 *
 * @param value Candidate string.
 * @returns True when it is `YYYY-MM-DD` and that day exists.
 */
export function isValidLocalDate(value: string): boolean {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    return false
  }

  const year = Number(value.slice(0, 4))
  const month = Number(value.slice(5, 7))
  const day = Number(value.slice(8, 10))

  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/**
 * Splits a day into its numeric parts.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns Year, month and day numbers.
 */
function parts(value: string): { year: number; month: number; day: number } {
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10))
  }
}

/**
 * Builds a day from its parts, rejecting anything that is not a real date.
 *
 * @param year Full year.
 * @param month Month number, 1–12.
 * @param day Day of month.
 * @returns The day as `YYYY-MM-DD`.
 */
function build(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Shifts a day by whole days.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @param delta Days to add; negative moves into the past.
 * @returns The resulting day as `YYYY-MM-DD`.
 */
export function addDays(value: string, delta: number): string {
  const { year, month, day } = parts(value)
  const shifted = new Date(Date.UTC(year, month - 1, day + delta))

  return build(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate())
}

/**
 * Counts whole days from `from` to `to`.
 *
 * Uses `Date.UTC` so the difference is arithmetic on a calendar, not a duration between
 * two instants: no daylight-saving shift can make "yesterday to today" 23 or 25 hours.
 *
 * @param from Start day as `YYYY-MM-DD`.
 * @param to End day as `YYYY-MM-DD`.
 * @returns Signed number of days between them.
 */
export function daysBetween(from: string, to: string): number {
  const a = parts(from)
  const b = parts(to)
  const start = Date.UTC(a.year, a.month - 1, a.day)
  const end = Date.UTC(b.year, b.month - 1, b.day)

  return Math.round((end - start) / 86_400_000)
}

/**
 * Today as a local calendar day.
 *
 * The only sanctioned way to turn the current time into a day string: it reads the local
 * clock, so 23:30 on the 10th is the 10th for the user whatever their UTC offset is.
 *
 * @param now Instant to read; defaults to the current time.
 * @returns Today's day as `YYYY-MM-DD`.
 */
export function today(now: Date = new Date()): string {
  return build(now.getFullYear(), now.getMonth() + 1, now.getDate())
}

/**
 * ISO weekday of a day, Monday = 1 through Sunday = 7.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns The ISO weekday number.
 */
export function isoWeekday(value: string): number {
  const { year, month, day } = parts(value)
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()

  return weekday === 0 ? 7 : weekday
}

/**
 * Formats a day for the title bar, in Spanish.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns For example `viernes, 10 de octubre`.
 */
export function formatDayHeading(value: string): string {
  const { year, month, day } = parts(value)
  const weekday = isoWeekday(value)
  const weekdayName = [
    '',
    'lunes',
    'martes',
    'miércoles',
    'jueves',
    'viernes',
    'sábado',
    'domingo'
  ][weekday]
  const monthName = [
    '',
    'enero',
    'febrero',
    'marzo',
    'abril',
    'mayo',
    'junio',
    'julio',
    'agosto',
    'septiembre',
    'octubre',
    'noviembre',
    'diciembre'
  ][month]

  return `${weekdayName}, ${day} de ${monthName} de ${year}`
}

/**
 * Formats a minute-of-day as `HH:MM`.
 *
 * @param minutes Minutes since midnight, or `null`.
 * @returns Zero-padded 24-hour time, or an em dash when unset.
 */
export function formatClock(minutes: number | null): string {
  if (minutes === null) {
    return '—'
  }

  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60

  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}

/**
 * Parses `HH:MM` into minutes since midnight.
 *
 * @param clock Time string, or `null`.
 * @returns Minutes since midnight, or `null` when unparseable.
 */
export function parseClock(clock: string | null): number | null {
  if (clock === null) {
    return null
  }

  const match = /^(\d{2}):(\d{2})$/.exec(clock)

  if (match === null) {
    return null
  }

  const hours = Number(match[1])
  const minutes = Number(match[2])

  if (hours > 23 || minutes > 59) {
    return null
  }

  return hours * 60 + minutes
}

/**
 * Formats a duration in minutes as `H:MM:SS` or `MM:SS`.
 *
 * The format a stopwatch needs: seconds change every tick, so hiding them would make a
 * running timer look frozen.
 *
 * @param totalSeconds Elapsed seconds.
 * @returns For example `1:04:07` past an hour, `4:07` below it.
 */
export function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60

  const paddedMinutes = String(minutes).padStart(2, '0')
  const paddedSeconds = String(seconds).padStart(2, '0')

  return hours > 0 ? `${hours}:${paddedMinutes}:${paddedSeconds}` : `${minutes}:${paddedSeconds}`
}

/**
 * Elapsed seconds between two ISO instants.
 *
 * @param from Start instant.
 * @param to End instant.
 * @returns Whole seconds, never negative.
 */
export function elapsedSeconds(from: string, to: Date = new Date()): number {
  const start = Date.parse(from)

  if (Number.isNaN(start)) {
    return 0
  }

  return Math.max(0, Math.floor((to.getTime() - start) / 1000))
}

/**
 * Validates or repairs a date taken from the URL.
 *
 * A hand-typed `/day/ayer` must not reach the database as a "date". Falls back to today
 * rather than showing an error page: navigation is not a place where a typo deserves a
 * dead end.
 *
 * @param candidate Raw path segment.
 * @returns A valid `YYYY-MM-DD` string.
 */
export function normalizeDateParam(candidate: string | undefined): string {
  return candidate !== undefined && isValidLocalDate(candidate) ? candidate : today()
}

/** Minutes in a day, exported for callers that need the bound. */
export { MINUTES_PER_DAY }

/** Short month names, for the compact date a search result shows. */
const MONTH_SHORT = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic'
] as const

/**
 * Formats a day as `10 oct`, for a row whose day is not the one being viewed.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns For example `10 oct`.
 */
export function formatDayShort(value: string): string {
  const { month, day } = parts(value)

  return `${day} ${MONTH_SHORT[month - 1] ?? ''}`
}
