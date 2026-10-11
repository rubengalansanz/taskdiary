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

/**
 * Monday of the week a day belongs to.
 *
 * ISO weeks, which start on Monday: `isoWeekday` already returns 1 for Monday and 7 for
 * Sunday, so Sunday steps back six days rather than zero. Treating Sunday as the first day
 * would place it in the *next* week and shift every grid built on this by one column.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns The Monday of that week, as `YYYY-MM-DD`.
 */
export function startOfWeek(value: string): string {
  return addDays(value, -(isoWeekday(value) - 1))
}

/**
 * The seven days of a week, Monday first.
 *
 * @param value Any day of the week; the result does not depend on which one.
 * @returns Seven consecutive `YYYY-MM-DD` strings.
 */
export function weekDates(value: string): string[] {
  const monday = startOfWeek(value)

  return Array.from({ length: 7 }, (_unused, index) => addDays(monday, index))
}

/**
 * First day of the month a day belongs to.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns For example `2026-10-01`.
 */
export function startOfMonth(value: string): string {
  const { year, month } = parts(value)

  return `${year}-${String(month).padStart(2, '0')}-01`
}

/**
 * Adds months to a day, clamping to the last day of the target month.
 *
 * The clamp is what keeps the result a real day. October 31st plus one month has no
 * counterpart, and rolling over to November 1st would skip a day of the calendar and land the
 * user on the wrong week; November 30th is what "a month later" actually means there.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @param delta Months to add; negative moves backwards.
 * @returns The same day-of-month in the shifted month, or that month's last day.
 */
export function addMonths(value: string, delta: number): string {
  const { year, month, day } = parts(value)
  const absolute = year * 12 + (month - 1) + delta
  const nextYear = Math.floor(absolute / 12)
  // JavaScript's `%` keeps the sign of the dividend, so a month before January lands on -1.
  // Normalising first is what makes the clamp below see a real 1–12 month number.
  const nextMonth = (((absolute % 12) + 12) % 12) + 1
  const clampedDay = Math.min(day, daysInMonth(nextYear, nextMonth))

  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

/** One cell of a month grid: the day, and whether it belongs to the month being shown. */
export interface MonthCell {
  /** The day itself, always `YYYY-MM-DD`. */
  date: string
  /** False for the leading and trailing days borrowed from the neighbouring months. */
  inMonth: boolean
}

/**
 * Calendar grid for a month: whole weeks, Monday first.
 *
 * Starts on the Monday of the week containing the first of the month and ends on the Sunday of
 * the week containing the last, so every row has seven cells. A ragged grid whose last row has
 * three days would make the month change height when you navigate between months.
 *
 * @param value Any day of the month to draw.
 * @returns Between 28 and 42 cells, in reading order.
 */
export function monthGrid(value: string): MonthCell[] {
  const month = value.slice(0, 7)
  const { year, month: monthNumber } = parts(value)
  const first = `${month}-01`
  const last = `${month}-${String(daysInMonth(year, monthNumber)).padStart(2, '0')}`
  const start = startOfWeek(first)
  const end = addDays(startOfWeek(last), 6)
  const cells: MonthCell[] = []

  for (let day = start; day <= end; day = addDays(day, 1)) {
    cells.push({ date: day, inMonth: day.slice(0, 7) === month })
  }

  return cells
}

/**
 * The days drawn by the activity heatmap: `weeks` whole weeks ending with the anchor's.
 *
 * The grid is anchored on the anchor's own week rather than on a rolling 182-day window, so
 * every column lines up with the weekday headers and the last row shows the week in progress
 * instead of a stub that grows by one column a day.
 *
 * @param anchor Any day of the last week to show.
 * @param weeks How many weeks to draw. Defaults to the 26 of §10.2.
 * @returns `weeks * 7` consecutive days, oldest first, ending on that week's Sunday.
 */
export function heatmapRange(anchor: string, weeks = 26): string[] {
  const end = addDays(startOfWeek(anchor), 6)
  const start = addDays(end, -(weeks * 7 - 1))
  const days: string[] = []

  for (let day = start; day <= end; day = addDays(day, 1)) {
    days.push(day)
  }

  return days
}

/**
 * Formats a duration in minutes as `H h MM min`, keeping its sign.
 *
 * Deliberately not {@link formatDuration}: that one is a stopwatch, so it renders seconds that
 * change every tick and clamps its input at zero. Neither suits a day's balance. Seconds are
 * noise once you are talking about hours, and the difference between estimate and real is the
 * whole point of the number — a day that finished 30 minutes early has to be able to say
 * `-30 min`, and a clamp would print that overrun as `0 min`.
 *
 * @param minutes Signed duration in minutes.
 * @returns For example `1 h 30 min`, `45 min` or `-30 min`.
 */
export function formatMinutesSigned(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const absolute = Math.abs(Math.round(minutes))
  const hours = Math.floor(absolute / 60)
  const rest = absolute % 60

  return hours === 0 ? `${sign}${rest} min` : `${sign}${hours} h ${String(rest).padStart(2, '0')} min`
}

/** Full month names, for headings. Spanish (ADR-015). */
const MONTH_LONG = [
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
] as const

/**
 * Formats the month a day belongs to, as a title.
 *
 * @param value A valid `YYYY-MM-DD` string.
 * @returns For example `octubre de 2026`.
 */
export function formatMonthHeading(value: string): string {
  const { year, month } = parts(value)

  return `${MONTH_LONG[month - 1] ?? ''} de ${year}`
}
