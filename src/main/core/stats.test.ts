import { describe, expect, it } from 'vitest'
import { complianceRatio, currentStreak, longestStreak } from './stats'

/**
 * Reading a run of days into streaks and rates.
 *
 * A streak is "consecutive days with at least one completed task", which sounds like a
 * counter and is not: the interesting cases are all in what happens around a day with
 * nothing done on it, and around today.
 *
 * The rule that decides the whole design is that the streak is measured *backwards from
 * today*. A user who has not finished anything yet today has not lost their streak — the
 * day is not over. Measuring from the last completed day instead would show a streak of 0
 * every morning and make the number useless for the one thing people check it for.
 */

/** Days that hold at least one completed task. */
function days(...dates: string[]): Set<string> {
  return new Set(dates)
}

describe('currentStreak', () => {
  it('counts the days completed, ending today', () => {
    expect(currentStreak(days('2026-10-07', '2026-10-06', '2026-10-05'), '2026-10-07')).toBe(3)
  })

  it('counts back through yesterday when today has nothing yet', () => {
    // The case the whole design turns on. At 9am on the 7th the 6th and the 5th are both
    // still real: the 7th is not finished, it simply has not happened yet.
    expect(currentStreak(days('2026-10-06', '2026-10-05'), '2026-10-07')).toBe(2)
  })

  it('is zero when the streak already ended before yesterday', () => {
    expect(currentStreak(days('2026-10-04', '2026-10-03'), '2026-10-07')).toBe(0)
  })

  it('breaks on a single missed day', () => {
    // The 4th is missing, so the 5th and 6th are history however recent they are.
    expect(currentStreak(days('2026-10-06', '2026-10-05', '2026-10-03', '2026-10-02'), '2026-10-07')).toBe(
      2
    )
  })

  it('counts a single day completed today', () => {
    expect(currentStreak(days('2026-10-07'), '2026-10-07')).toBe(1)
  })

  it('is zero with nothing completed at all', () => {
    expect(currentStreak(days(), '2026-10-07')).toBe(0)
  })

  it('is zero when only tomorrow is done', () => {
    expect(currentStreak(days('2026-10-08'), '2026-10-07')).toBe(0)
  })

  it('crosses a month boundary', () => {
    expect(currentStreak(days('2026-10-01', '2026-09-30', '2026-09-29'), '2026-10-01')).toBe(3)
  })

  it('crosses a leap day', () => {
    expect(currentStreak(days('2028-03-01', '2028-02-29', '2028-02-28'), '2028-03-01')).toBe(3)
  })
})

describe('longestStreak', () => {
  it('finds the longest run anywhere in the history', () => {
    const completed = days(
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-10',
      '2026-09-11',
      '2026-10-06'
    )

    expect(longestStreak(completed)).toBe(3)
  })

  it('is zero with no completed days', () => {
    expect(longestStreak(days())).toBe(0)
  })

  it('counts isolated single days as a streak of one', () => {
    expect(longestStreak(days('2026-09-01', '2026-09-05', '2026-09-09'))).toBe(1)
  })

  it('is never shorter than the current streak', () => {
    // A record that forgets the run you are in the middle of is worse than no record.
    const completed = days('2026-10-05', '2026-10-06', '2026-10-07')

    expect(longestStreak(completed)).toBeGreaterThanOrEqual(currentStreak(completed, '2026-10-07'))
  })

  it('ignores the order the days arrive in', () => {
    const forward = days('2026-10-05', '2026-10-06', '2026-10-07')
    const backward = days('2026-10-07', '2026-10-06', '2026-10-05')

    expect(longestStreak(backward)).toBe(longestStreak(forward))
  })
})

describe('complianceRatio', () => {
  it('is the share of estimated time actually spent', () => {
    // 90 minutes spent against 120 estimated is 75%: 90/120.
    expect(complianceRatio(120, 90)).toBeCloseTo(0.75, 5)
  })

  it('is zero when nothing was estimated', () => {
    // A day of tasks nobody estimated has no rate, not a rate of zero. Zero would say
    // "you met every estimate you made", which is a different claim.
    expect(complianceRatio(0, 0)).toBe(0)
    expect(complianceRatio(0, 90)).toBe(0)
  })

  it('exceeds one when the day ran over its estimates', () => {
    expect(complianceRatio(60, 90)).toBeCloseTo(1.5, 5)
  })

  it('is one when the estimates were met exactly', () => {
    expect(complianceRatio(90, 90)).toBe(1)
  })

  it('is zero when nothing was spent', () => {
    expect(complianceRatio(120, 0)).toBe(0)
  })
})
