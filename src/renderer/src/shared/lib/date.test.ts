import { describe, expect, it } from 'vitest'
import {
  addDays,
  daysBetween,
  elapsedSeconds,
  formatClock,
  formatDayHeading,
  formatDuration,
  isoWeekday,
  isValidLocalDate,
  normalizeDateParam,
  parseClock,
  today
} from './date'

/**
 * Date helpers for the renderer.
 *
 * The renderer and the main process must agree on what day a string names, or a task
 * saved on Tuesday appears on Wednesday. Everything here therefore works on
 * `YYYY-MM-DD` strings and never constructs a `Date` from one.
 */

describe('isValidLocalDate', () => {
  it('accepts a real calendar day', () => {
    expect(isValidLocalDate('2026-10-10')).toBe(true)
    expect(isValidLocalDate('2024-02-29')).toBe(true)
  })

  it('rejects a day that does not exist', () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false)
    expect(isValidLocalDate('2026-13-01')).toBe(false)
    expect(isValidLocalDate('2026-00-10')).toBe(false)
  })

  it('rejects anything that is not zero-padded YYYY-MM-DD', () => {
    expect(isValidLocalDate('2026-1-1')).toBe(false)
    expect(isValidLocalDate('2026/10/10')).toBe(false)
    expect(isValidLocalDate('hoy')).toBe(false)
    expect(isValidLocalDate('')).toBe(false)
  })
})

describe('addDays', () => {
  it('moves within a month', () => {
    expect(addDays('2026-10-10', 1)).toBe('2026-10-11')
    expect(addDays('2026-10-10', -1)).toBe('2026-10-09')
  })

  it('rolls over month boundaries in both directions', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('crosses a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
    // 2026 is not a leap year, so 29 February does not exist and the day rolls to March.
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('round-trips: adding then subtracting is identity', () => {
    for (const day of ['2026-01-31', '2026-02-28', '2024-02-29', '2026-12-31']) {
      expect(addDays(addDays(day, 17), -17)).toBe(day)
    }
  })

  it('is stable across a year of daily steps', () => {
    let day = '2026-01-01'

    for (let index = 0; index < 365; index += 1) {
      day = addDays(day, 1)
    }

    expect(day).toBe('2027-01-01')
  })
})

describe('daysBetween', () => {
  it('counts whole days', () => {
    expect(daysBetween('2026-10-10', '2026-10-11')).toBe(1)
    expect(daysBetween('2026-10-10', '2026-10-10')).toBe(0)
    expect(daysBetween('2026-10-11', '2026-10-10')).toBe(-1)
  })

  it('is not affected by daylight saving, because it counts calendar days', () => {
    // Late March is when most European zones shift. A duration-based implementation
    // would report 0.958 days here instead of 1.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2)
  })

  it('agrees with addDays across a leap year', () => {
    expect(daysBetween('2024-02-28', addDays('2024-02-28', 4))).toBe(4)
  })
})

describe('isoWeekday', () => {
  it('numbers Monday 1 through Sunday 7', () => {
    expect(isoWeekday('2026-10-05')).toBe(1) // Monday
    expect(isoWeekday('2026-10-09')).toBe(5) // Friday
    expect(isoWeekday('2026-10-10')).toBe(6) // Saturday
    expect(isoWeekday('2026-10-11')).toBe(7) // Sunday
    expect(isoWeekday('2026-10-04')).toBe(7) // Sunday
    expect(isoWeekday('2026-10-06')).toBe(2) // Tuesday
  })
})

describe('formatDayHeading', () => {
  it('renders the weekday and month in Spanish', () => {
    expect(formatDayHeading('2026-10-10')).toBe('sábado, 10 de octubre de 2026')
    expect(formatDayHeading('2026-01-01')).toBe('jueves, 1 de enero de 2026')
  })
})

describe('formatClock / parseClock', () => {
  it('round-trips every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      expect(parseClock(formatClock(minute))).toBe(minute)
    }
  })

  it('renders an unset time as a dash', () => {
    expect(formatClock(null)).toBe('—')
  })

  it('rejects malformed and out-of-range times', () => {
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('08:60')).toBeNull()
    expect(parseClock('8:50')).toBeNull()
    expect(parseClock('')).toBeNull()
    expect(parseClock(null)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('shows seconds, because a stopwatch that hides them looks frozen', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(7)).toBe('0:07')
    expect(formatDuration(247)).toBe('4:07')
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3847)).toBe('1:04:07')
  })

  it('never goes negative', () => {
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('elapsedSeconds', () => {
  it('measures from an ISO instant', () => {
    const start = new Date('2026-10-10T08:00:00.000Z')

    expect(elapsedSeconds('2026-10-10T08:00:00.000Z', start)).toBe(0)
    expect(elapsedSeconds('2026-10-10T07:59:30.000Z', start)).toBe(30)
  })

  it('clamps to zero when the end precedes the start', () => {
    const start = new Date('2026-10-10T08:00:00.000Z')

    expect(elapsedSeconds('2026-10-10T09:00:00.000Z', start)).toBe(0)
  })

  it('returns zero rather than NaN for an unparseable instant', () => {
    expect(elapsedSeconds('no-es-una-fecha')).toBe(0)
  })
})

describe('normalizeDateParam', () => {
  it('keeps a valid day', () => {
    expect(normalizeDateParam('2026-10-10')).toBe('2026-10-10')
  })

  it('repairs anything else to today rather than dead-ending', () => {
    expect(normalizeDateParam('ayer')).toBe(today())
    expect(normalizeDateParam('2026-02-30')).toBe(today())
    expect(normalizeDateParam(undefined)).toBe(today())
  })
})

describe('today', () => {
  it('reads the local clock, not UTC', () => {
    // 23:30 local on the 10th. West of UTC, `toISOString()` would already say the 11th.
    expect(today(new Date(2026, 9, 10, 23, 30))).toBe('2026-10-10')
    expect(today(new Date(2026, 9, 11, 0, 15))).toBe('2026-10-11')
  })
})
