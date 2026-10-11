import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  heatmapRange,
  isoWeekday,
  monthGrid,
  startOfMonth,
  startOfWeek,
  weekDates
} from './date'

/**
 * Week and month arithmetic for Fase 4.
 *
 * These helpers decide which days a view asks the database about, so an off-by-one here does
 * not fail a test in the view — it silently shows the wrong Monday, or a heatmap that is one day
 * out of phase with the calendar. `parts()` already rejects a malformed date, so every helper
 * below can assume a real local day and does not re-validate.
 */

// 2026-10-05 is a Monday. Every expectation below is anchored to it on purpose.
const MONDAY = '2026-10-05'
const SUNDAY = '2026-10-11'

describe('startOfWeek', () => {
  it('returns the same day when it is already Monday', () => {
    expect(startOfWeek(MONDAY)).toBe(MONDAY)
  })

  it('steps back to Monday from the middle of the week', () => {
    expect(startOfWeek('2026-10-07')).toBe(MONDAY)
  })

  it('steps back six days from Sunday, not zero', () => {
    // Sunday is ISO weekday 7, so `weekday - 1` is 6. Treating Sunday as the first day of the
    // week would put it in the *next* one and make the heatmap drift by a day each row.
    expect(startOfWeek(SUNDAY)).toBe(MONDAY)
  })

  it('crosses the month boundary backwards', () => {
    expect(startOfWeek('2026-10-01')).toBe('2026-09-28')
  })

  it('crosses the year boundary backwards', () => {
    expect(startOfWeek('2026-01-01')).toBe('2025-12-29')
  })
})

describe('weekDates', () => {
  it('returns Monday to Sunday for any day of the week', () => {
    expect(weekDates('2026-10-08')).toEqual([
      MONDAY,
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      SUNDAY
    ])
  })

  it('always returns seven days', () => {
    for (const day of ['2026-01-01', '2026-02-28', '2026-03-01', '2026-12-31']) {
      expect(weekDates(day)).toHaveLength(7)
    }
  })
})

describe('startOfMonth', () => {
  it('returns the first of the same month', () => {
    expect(startOfMonth('2026-10-17')).toBe('2026-10-01')
  })

  it('returns January first for a January day', () => {
    expect(startOfMonth('2026-01-31')).toBe('2026-01-01')
  })
})

describe('addMonths', () => {
  it('adds months inside the year', () => {
    expect(addMonths('2026-10-15', 2)).toBe('2026-12-15')
  })

  it('crosses the year forwards', () => {
    expect(addMonths('2026-11-30', 2)).toBe('2027-01-30')
  })

  it('crosses the year backwards', () => {
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15')
  })

  it('clamps to the last day instead of spilling into the next month', () => {
    // 2026-10-31 plus one month has no 31st to land on. Returning 2026-11-31 would not be a
    // date at all; landing on the 30th keeps every value a real `YYYY-MM-DD` day.
    expect(addMonths('2026-10-31', 1)).toBe('2026-11-30')
  })

  it('clamps February in a leap year', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
  })

  it('clamps into a leap February', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
})

describe('monthGrid', () => {
  it('starts on the Monday of the week containing the first of the month', () => {
    // October 2026 opens on a Thursday, so the grid has to open on Monday 28 September.
    expect(monthGrid('2026-10-15')[0].date).toBe('2026-09-28')
  })

  it('covers whole weeks so every row has seven cells', () => {
    const grid = monthGrid('2026-10-15')

    expect(grid.length % 7).toBe(0)
    expect(grid.length).toBeGreaterThanOrEqual(28)
  })

  it('includes the first of the month', () => {
    expect(monthGrid('2026-10-15').map((cell) => cell.date)).toContain('2026-10-01')
  })

  it('includes the last of the month', () => {
    expect(monthGrid('2026-10-15').map((cell) => cell.date)).toContain('2026-10-31')
  })

  it('marks only the days of the requested month as in-month', () => {
    const grid = monthGrid('2026-10-15')

    expect(grid.filter((cell) => cell.inMonth)).toHaveLength(31)
    expect(grid.some((cell) => cell.inMonth && cell.date.startsWith('2026-10-'))).toBe(true)
    expect(grid.some((cell) => cell.inMonth && cell.date.startsWith('2026-11-'))).toBe(false)
  })

  it('is aligned to Mondays for a month that starts on a Monday', () => {
    expect(monthGrid('2026-06-10')[0].date).toBe('2026-06-01')
  })
})

describe('heatmapRange', () => {
  it('returns 26 weeks of days, oldest first', () => {
    const days = heatmapRange('2026-10-07')

    expect(days).toHaveLength(26 * 7)
    expect([...days]).toEqual([...days].sort())
  })

  it('ends on the Sunday of the week containing the anchor', () => {
    const days = heatmapRange('2026-10-07')

    // The anchor is a Wednesday; the row it belongs to finishes on Sunday the 11th.
    expect(days[days.length - 1]).toBe('2026-10-11')
  })

  it('starts on a Monday, 181 days before that Sunday', () => {
    const days = heatmapRange('2026-10-07')

    expect(days[0]).toBe(addDays('2026-10-11', -(26 * 7 - 1)))
    expect(isoWeekday(days[0])).toBe(1)
  })

  it('may include days after the anchor, so the current week is not truncated', () => {
    const days = heatmapRange('2026-10-07')

    // A GitHub-style grid always draws the whole week the anchor belongs to, otherwise the last
    // row would be a ragged stub that shifts width as the week passes. Those trailing days
    // belong to a week still in progress and render empty.
    expect(days[days.length - 1]).toBe('2026-10-11')
    expect(days.filter((day) => day > '2026-10-07')).toHaveLength(4)
  })
})