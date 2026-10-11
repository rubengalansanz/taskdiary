import { describe, expect, it } from 'vitest'
import { completionRatio, countTasks, estimateDrift } from './day-summary'
import type { DaySummaryDto } from '../../../../shared/ipc'

/**
 * Arithmetic over the Fase 4 aggregates.
 *
 * The views themselves are covered by the CDP smoke, which proves they render. What a smoke
 * cannot see is a number that is merely wrong — so the arithmetic lives here, in plain
 * functions, where a test can pin it without a DOM.
 */

/** A day with sensible defaults, overridable per test. */
function day(overrides: Partial<DaySummaryDto> = {}): DaySummaryDto {
  return {
    date: '2026-10-05',
    total: 4,
    done: 2,
    inProgress: 1,
    pending: 1,
    cancelled: 0,
    estimateMin: 120,
    realMin: 90,
    unmeasuredDone: 0,
    ...overrides
  }
}

describe('countTasks', () => {
  it('adds up the tasks, not the days', () => {
    // The bug this function exists to prevent: seven days holding five tasks each is 35
    // resultados, not 7.
    const days = Array.from({ length: 7 }, () => day({ total: 5 }))

    expect(countTasks(days)).toBe(35)
  })

  it('counts cancelled tasks, which are off the balance but still on screen', () => {
    expect(countTasks([day({ total: 3, cancelled: 2 })])).toBe(5)
  })

  it('is zero for an empty range', () => {
    expect(countTasks([])).toBe(0)
  })

  it('does not count the same day twice', () => {
    // The map is keyed by date, so duplicates cannot occur; the guard is that the sum reads
    // values, not keys, and would stay correct if a caller passed an array twice.
    expect(countTasks([day(), day()])).toBe(8)
  })
})

describe('completionRatio', () => {
  it('reports the share of finished work', () => {
    expect(completionRatio(day({ total: 4, done: 1 }))).toBe(0.25)
  })

  it('is 1 for a day fully completed', () => {
    expect(completionRatio(day({ total: 4, done: 4 }))).toBe(1)
  })

  it('is 0 for an empty day instead of dividing by zero', () => {
    expect(completionRatio(day({ total: 0, done: 0 }))).toBe(0)
    expect(completionRatio(undefined)).toBe(0)
  })

  it('never exceeds 1', () => {
    // `done` cannot exceed `total` in the SQL, but a clamp here means a bad row shows a full
    // ring rather than a conic gradient winding past a full turn.
    expect(completionRatio(day({ total: 2, done: 5 }))).toBe(1)
  })
})

describe('estimateDrift', () => {
  it('is positive when the day ran over its estimate', () => {
    expect(estimateDrift(day({ estimateMin: 60, realMin: 90 }))).toBe(30)
  })

  it('is negative when the day came in under', () => {
    expect(estimateDrift(day({ estimateMin: 60, realMin: 30 }))).toBe(-30)
  })

  it('is zero for an unmeasured day rather than invented', () => {
    // `realMin` is 0 here because the duration was never recorded. Subtracting it from a
    // 45-minute estimate would report a 45-minute overrun that never happened.
    expect(
      estimateDrift(day({ estimateMin: 45, realMin: 0, unmeasuredDone: 1 }))
    ).toBe(0)
  })

  it('is zero for a day that has not loaded', () => {
    expect(estimateDrift(undefined)).toBe(0)
  })
})