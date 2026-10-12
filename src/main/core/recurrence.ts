import { daysInMonth, isValidLocalDate, parseLocalDate } from './datetime'
import {
  addDays,
  compareLocalDates,
  daysBetween,
  isoWeekday
} from './date-arith'
import type { RruleFreq } from './task'

/**
 * The recurrence engine (ADR-004).
 *
 * Pure, and it stays that way: no database, no Electron, no `Date` object anywhere in the
 * interface. Series are described by numbers and local `YYYY-MM-DD` strings, and every question
 * is answered by arithmetic over those. Plan §16 names recurrence the highest-probability
 * correctness failure in the project, and the reason is that calendar arithmetic has edges the
 * author of the feature does not think about — month lengths, leap days, week boundaries that
 * straddle a month, and a series whose `until` has already passed.
 *
 * The engine answers one question: *does this series fall on this day?* It never decides what
 * an occurrence looks like. That belongs to the materialiser, which has the row to copy, and
 * keeping the two apart is what makes this file testable without a database.
 */

/** A recurrence rule, as stored on a task. */
export interface RecurrenceRule {
  /** Frequency of the series. `none` means the task does not repeat. */
  rruleFreq: RruleFreq
  /** How many periods elapse between occurrences. Always ≥ 1 for a repeating series. */
  rruleInterval: number
  /** ISO weekdays (1 = Monday … 7 = Sunday) for weekly rules, or `null`. */
  rruleDays: number[] | null
  /** Inclusive last day of the series, or `null` when open-ended. */
  rruleUntil: string | null
  /** Origin day of the series, or `null` for a one-off. */
  rruleFrom: string | null
}

/**
 * Whether a series falls on a given day.
 *
 * Total on hostile input. A malformed date, a missing origin or a corrupt interval answers
 * `false` instead of throwing, because this runs while the user is opening a day: an exception
 * here would blank the Day view rather than skip one task.
 *
 * @param rule The series to test.
 * @param date The day to test, `YYYY-MM-DD`.
 * @returns True when an occurrence is due.
 */
export function occursOn(rule: RecurrenceRule, date: string): boolean {
  if (!isValidLocalDate(date)) {
    return false
  }

  if (rule.rruleFreq === 'none' || rule.rruleFrom === null) {
    return false
  }

  // `normalizeRecurrence` rejects an inverted series, and an interval below 1, but the
  // database is the boundary this engine trusts. An interval of 0 would make every modulo
  // below an identity — one corrupt row silently becoming an infinite series.
  if (!Number.isInteger(rule.rruleInterval) || rule.rruleInterval < 1) {
    return false
  }

  if (!isValidLocalDate(rule.rruleFrom)) {
    return false
  }

  // An `until` before the origin describes a series that never ran. Ordering the two dates as
  // strings is correct because `YYYY-MM-DD` sorts lexicographically.
  if (rule.rruleUntil !== null && !isValidLocalDate(rule.rruleUntil)) {
    return false
  }

  if (rule.rruleUntil !== null && compareLocalDates(rule.rruleUntil, rule.rruleFrom) < 0) {
    return false
  }

  // `until` is inclusive: the schema says so, and an exclusive reading silently drops the
  // user's last day, which is the day they most likely told the app they wanted.
  if (rule.rruleUntil !== null && compareLocalDates(date, rule.rruleUntil) > 0) {
    return false
  }

  if (compareLocalDates(date, rule.rruleFrom) < 0) {
    return false
  }

  const elapsed = daysBetween(rule.rruleFrom, date)

  switch (rule.rruleFreq) {
    case 'daily':
      return elapsed % rule.rruleInterval === 0

    case 'weekly':
      return occursWeekly(rule, date)

    case 'weekdays': {
      const weekday = isoWeekday(date)

      return weekday <= 5 && elapsed % rule.rruleInterval === 0
    }

    case 'monthly':
      return occursMonthly(rule, date)

    default:
      // Unreachable while `RruleFreq` is the closed union, and the right answer if it ever
      // grows: a frequency this engine has not been taught is not one it may guess at.
      return false
  }
}

/**
 * The weekly branch: named days, or the origin's own weekday.
 *
 * @param rule The series being tested.
 * @param date The day being tested.
 * @returns True when the day is due.
 */
function occursWeekly(rule: RecurrenceRule, date: string): boolean {
  const weekday = isoWeekday(date)

  // `null` and `[]` are not the same thing, and the difference is the whole point of this
  // branch. `null` means "no days were named", which reads as "repeat on the origin's
  // weekday". An explicit empty list means the series named no days at all, and falling back
  // to the origin's weekday would invent a series nobody asked for.
  if (rule.rruleDays === null) {
    return weekday === isoWeekday(rule.rruleFrom as string) && isWeekOfSeries(rule, date)
  }

  if (rule.rruleDays.length === 0) {
    return false
  }

  // Named days win over the origin's weekday. Out-of-range entries are ignored rather than
  // treated as a match, so one bad number cannot disable a whole series; the ones that remain
  // are compared against the ISO weekday, which is always in range.
  if (!rule.rruleDays.includes(weekday)) {
    return false
  }

  return isWeekOfSeries(rule, date)
}

/**
 * Whether a date falls in a week the series reaches.
 *
 * "Week zero" is the week containing the origin, so `interval: 2` fires on the origin's week
 * and every second week after. Counting weeks and then testing the remainder is what keeps a
 * weekly series aligned to the calendar instead of drifting one weekday per interval.
 *
 * @param rule The series being tested.
 * @param date The day being tested.
 * @returns True when the week is one the series reaches.
 */
function isWeekOfSeries(rule: RecurrenceRule, date: string): boolean {
  // The origin's Monday is the series' week boundary. Days are compared as integers so the
  // week index is exact rather than a floating-point division.
  const originMonday = addDays(rule.rruleFrom as string, -(isoWeekday(rule.rruleFrom as string) - 1))
  const dateMonday = addDays(date, -(isoWeekday(date) - 1))
  const weekIndex = Math.floor(daysBetween(originMonday, dateMonday) / 7)

  return weekIndex >= 0 && weekIndex % rule.rruleInterval === 0
}

/**
 * The monthly branch: the same day-of-month, clamped to shorter months.
 *
 * @param rule The series being tested.
 * @param date The day being tested.
 * @returns True when the day is due.
 */
function occursMonthly(rule: RecurrenceRule, date: string): boolean {
  const origin = parseLocalDate(rule.rruleFrom as string)
  const target = parseLocalDate(date)

  const monthsApart =
    (target.year - origin.year) * 12 + (target.month - origin.month)

  if (monthsApart < 0 || monthsApart % rule.rruleInterval !== 0) {
    return false
  }

  // Clamping is what keeps the 31st from skipping November: the 31st does not exist there, so
  // the occurrence is the 30th. Rolling into December 1st instead would invent a day the user
  // never asked for, and skipping the month would silently lose one.
  const dueDay = Math.min(origin.day, daysInMonth(target.year, target.month))

  return target.day === dueDay
}

/**
 * Every day an occurrence is due inside an inclusive range.
 *
 * Walks the range one day at a time and asks {@link occursOn}. Inefficient per call, and
 * deliberately so: the number of days a view ever needs is bounded by the range it asked for
 * (the heatmap's 182), and an incremental generator would need the very calendar arithmetic
 * this file exists to get right, in a second place, with its own bugs.
 *
 * @param rule The series to expand.
 * @param fromDate First day of the range.
 * @param toDate Last day of the range, inclusive.
 * @returns The days an occurrence is due, ascending and without duplicates.
 */
export function occurrencesBetween(
  rule: RecurrenceRule,
  fromDate: string,
  toDate: string
): string[] {
  if (!isValidLocalDate(fromDate) || !isValidLocalDate(toDate)) {
    return []
  }

  if (compareLocalDates(fromDate, toDate) > 0) {
    return []
  }

  const days: string[] = []
  const seen = new Set<string>()

  for (let day = fromDate; compareLocalDates(day, toDate) <= 0; day = addDays(day, 1)) {
    if (!seen.has(day) && occursOn(rule, day)) {
      seen.add(day)
      days.push(day)
    }
  }

  return days
}
