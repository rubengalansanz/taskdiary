import { describe, expect, it } from 'vitest'
import { occursOn, occurrencesBetween } from './recurrence'
import { addDays } from './date-arith'

/**
 * The recurrence engine.
 *
 * Plan §16 risk 3 names this the highest-probability correctness failure in the whole project,
 * and the reason is specific: a recurring series is arithmetic over calendar dates, and the
 * cases where that arithmetic goes wrong are the ones nobody thinks to write down.
 *
 * Everything here is pure. No database, no Electron, no `Date` in the interface — dates are
 * local `YYYY-MM-DD` strings and the engine never leaves them, because `new Date('2026-03-29')`
 * is UTC midnight and in a timezone behind it that string is the *previous* day (ADR-003).
 */

// 2026-10-05 is a Monday, which makes the weekly cases readable at a glance.
const MONDAY = '2026-10-05'
const TUESDAY = '2026-10-06'
const WEDNESDAY = '2026-10-07'
const SUNDAY = '2026-10-11'
const NEXT_MONDAY = '2026-10-12'

/** A series, overridable per test. */
function series(overrides: Partial<Parameters<typeof occursOn>[0]> = {}) {
  return {
    rruleFreq: 'daily' as const,
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: MONDAY,
    ...overrides
  }
}

describe('occursOn — a task that does not repeat', () => {
  it('never occurs', () => {
    const task = series({ rruleFreq: 'none', rruleFrom: null })

    expect(occursOn(task, MONDAY)).toBe(false)
    expect(occursOn(task, NEXT_MONDAY)).toBe(false)
  })
})

describe('occursOn — daily', () => {
  it('occurs every day from its origin', () => {
    const task = series()

    expect(occursOn(task, MONDAY)).toBe(true)
    expect(occursOn(task, WEDNESDAY)).toBe(true)
    expect(occursOn(task, NEXT_MONDAY)).toBe(true)
  })

  it('never occurs before its origin', () => {
    expect(occursOn(series(), addDays(MONDAY, -1))).toBe(false)
    expect(occursOn(series(), addDays(MONDAY, -400))).toBe(false)
  })

  it('honours the interval', () => {
    const task = series({ rruleInterval: 3 })

    expect(occursOn(task, MONDAY)).toBe(true)
    expect(occursOn(task, addDays(MONDAY, 1))).toBe(false)
    expect(occursOn(task, addDays(MONDAY, 2))).toBe(false)
    expect(occursOn(task, addDays(MONDAY, 3))).toBe(true)
  })

  it('honours an interval across a month boundary', () => {
    // Every 7 days from 2026-10-28: the 4th is 2026-11-04, not 2026-11-03. Comparing month and
    // day separately would drift by one every time the month is shorter than the interval.
    const task = series({ rruleInterval: 7, rruleFrom: '2026-10-28' })

    expect(occursOn(task, '2026-11-04')).toBe(true)
    expect(occursOn(task, '2026-11-03')).toBe(false)
  })

  it('crosses a leap day without drifting', () => {
    const task = series({ rruleInterval: 1, rruleFrom: '2028-02-28' })

    expect(occursOn(task, '2028-02-29')).toBe(true)
    expect(occursOn(task, '2028-03-01')).toBe(true)
  })
})

describe('occursOn — weekly', () => {
  it('occurs on the origin day when no days are named', () => {
    const task = series({ rruleFreq: 'weekly', rruleDays: null })

    expect(occursOn(task, MONDAY)).toBe(true)
    expect(occursOn(task, WEDNESDAY)).toBe(false)
    expect(occursOn(task, addDays(MONDAY, 7))).toBe(true)
  })

  it('occurs on each named weekday, ignoring the origin weekday', () => {
    // Named days win over the origin. A series born on a Tuesday that says "Mondays and
    // Fridays" must fire on the following Monday, not wait for the next Tuesday — and must
    // not fire on the Monday that came before the series existed.
    const task = series({ rruleFreq: 'weekly', rruleDays: [1, 5], rruleFrom: TUESDAY })

    expect(occursOn(task, TUESDAY)).toBe(false)
    expect(occursOn(task, MONDAY)).toBe(false)
    expect(occursOn(task, NEXT_MONDAY)).toBe(true)
    expect(occursOn(task, addDays(NEXT_MONDAY, 4))).toBe(true)
  })

  it('occurs exactly once per day when several rules could match', () => {
    // Sunday can be reached by both "the day after Saturday" and "the last day of the week".
    // The engine answers a boolean, so the caller cannot insert twice even if it wanted to.
    const task = series({ rruleFreq: 'weekly', rruleDays: [6, 7], rruleInterval: 1 })

    expect(occursOn(task, SUNDAY)).toBe(true)
  })

  it('honours the interval counted in weeks', () => {
    const task = series({ rruleFreq: 'weekly', rruleDays: [1], rruleInterval: 2 })

    expect(occursOn(task, MONDAY)).toBe(true)
    expect(occursOn(task, NEXT_MONDAY)).toBe(false)
    expect(occursOn(task, addDays(MONDAY, 14))).toBe(true)
  })
})

describe('occursOn — weekdays', () => {
  it('occurs Monday to Friday', () => {
    const task = series({ rruleFreq: 'weekdays' })

    expect(occursOn(task, MONDAY)).toBe(true)
    expect(occursOn(task, addDays(MONDAY, 4))).toBe(true)
  })

  it('never occurs at the weekend', () => {
    const task = series({ rruleFreq: 'weekdays' })

    expect(occursOn(task, addDays(MONDAY, 5))).toBe(false)
    expect(occursOn(task, SUNDAY)).toBe(false)
  })

  it('never occurs before its origin even if that origin is a weekend', () => {
    // A series born on Sunday does not back-fill the Friday before it.
    const task = series({ rruleFreq: 'weekdays', rruleFrom: SUNDAY })

    expect(occursOn(task, addDays(SUNDAY, -2))).toBe(false)
    expect(occursOn(task, addDays(SUNDAY, 1))).toBe(true)
  })
})

describe('occursOn — monthly', () => {
  it('occurs on the same day of the month', () => {
    const task = series({ rruleFreq: 'monthly', rruleFrom: '2026-10-05' })

    expect(occursOn(task, '2026-10-05')).toBe(true)
    expect(occursOn(task, '2026-11-05')).toBe(true)
    expect(occursOn(task, '2026-12-05')).toBe(true)
  })

  it('clamps to the last day of a shorter month rather than skipping it', () => {
    // The 31st exists in October and not in November. Two wrong answers are available here:
    // skip November entirely, or roll into December 1st. Both invent a day the user never
    // asked for. The 30th is the day November actually has.
    const task = series({ rruleFreq: 'monthly', rruleFrom: '2026-10-31' })

    expect(occursOn(task, '2026-11-30')).toBe(true)
    expect(occursOn(task, '2026-12-01')).toBe(false)
  })

  it('finds the 29th of February in a leap year', () => {
    const task = series({ rruleFreq: 'monthly', rruleFrom: '2028-01-29' })

    expect(occursOn(task, '2028-02-29')).toBe(true)
  })

  it('clamps February in a non-leap year', () => {
    const task = series({ rruleFreq: 'monthly', rruleFrom: '2028-01-29' })

    expect(occursOn(task, '2029-02-28')).toBe(true)
    expect(occursOn(task, '2029-02-29')).toBe(false)
  })
})

describe('occursOn — until', () => {
  it('includes the until day itself', () => {
    // `until` is inclusive in the schema's own words. An exclusive reading silently drops the
    // user's last day, which is the day they most likely told the app they wanted.
    const task = series({ rruleUntil: WEDNESDAY })

    expect(occursOn(task, WEDNESDAY)).toBe(true)
    expect(occursOn(task, addDays(WEDNESDAY, 1))).toBe(false)
  })

  it('generates no future occurrence when until is in the past', () => {
    const task = series({ rruleFrom: '2026-01-01', rruleUntil: '2026-01-31' })

    expect(occursOn(task, '2026-01-31')).toBe(true)
    expect(occursOn(task, '2026-02-01')).toBe(false)
    expect(occursOn(task, '2026-10-05')).toBe(false)
  })

  it('combines with the interval without resurrecting the series', () => {
    const task = series({ rruleInterval: 2, rruleUntil: '2026-10-11' })

    expect(occursOn(task, '2026-10-11')).toBe(true)
    expect(occursOn(task, '2026-10-13')).toBe(false)
  })

  it('is ignored when until precedes the origin, which normalises to no occurrences', () => {
    // Defence in depth: normalizeRecurrence rejects this shape, and the engine must not
    // produce a series that started after it ended.
    const task = series({ rruleFrom: '2026-10-05', rruleUntil: '2026-09-01' })

    expect(occursOn(task, '2026-10-05')).toBe(false)
  })
})

describe('occursOn — hostile input', () => {
  it('treats a malformed date as no occurrence rather than throwing', () => {
    expect(occursOn(series(), 'not-a-date')).toBe(false)
    expect(occursOn(series(), '')).toBe(false)
  })

  it('treats a missing origin as no occurrence', () => {
    expect(occursOn(series({ rruleFrom: null }), MONDAY)).toBe(false)
  })

  it('treats a zero or negative interval as no occurrence, not as every day', () => {
    // A divide by zero here would be Infinity, and `x % Infinity === x` is true for every x:
    // one corrupt row would silently turn a weekly task into an infinite series.
    expect(occursOn(series({ rruleInterval: 0 }), MONDAY)).toBe(false)
    expect(occursOn(series({ rruleInterval: -3 }), MONDAY)).toBe(false)
  })

  it('ignores out-of-range weekdays rather than matching nothing silently forever', () => {
    const task = series({ rruleFreq: 'weekly', rruleDays: [1, 9] })

    // 9 is not a weekday. Monday still fires: one bad entry must not disable the series.
    expect(occursOn(task, MONDAY)).toBe(true)
  })

  it('returns false for an empty weekday list', () => {
    expect(occursOn(series({ rruleFreq: 'weekly', rruleDays: [] }), MONDAY)).toBe(false)
  })
})

describe('occurrencesBetween', () => {
  it('returns the origin for a one-day daily range', () => {
    expect(occurrencesBetween(series(), MONDAY, MONDAY)).toEqual([MONDAY])
  })

  it('returns every day of the range', () => {
    expect(occurrencesBetween(series(), MONDAY, addDays(MONDAY, 3))).toEqual([
      MONDAY,
      TUESDAY,
      WEDNESDAY,
      addDays(MONDAY, 3)
    ])
  })

  it('clamps the range to the series bounds', () => {
    expect(occurrencesBetween(series(), addDays(MONDAY, -5), addDays(MONDAY, -3))).toEqual([])
    expect(occurrencesBetween(series({ rruleUntil: TUESDAY }), MONDAY, SUNDAY)).toEqual([
      MONDAY,
      TUESDAY
    ])
  })

  it('returns nothing for an inverted range instead of looping forever', () => {
    expect(occurrencesBetween(series(), MONDAY, addDays(MONDAY, -3))).toEqual([])
  })

  it('never returns a duplicate, whatever the rule', () => {
    const days = occurrencesBetween(
      series({ rruleFreq: 'weekly', rruleDays: [1, 1, 2, 2] }),
      MONDAY,
      addDays(MONDAY, 20)
    )

    expect(new Set(days).size).toBe(days.length)
  })
})
