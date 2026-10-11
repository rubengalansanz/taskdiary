import { describe, expect, it } from 'vitest'
import {
  clockToMinutes,
  daysInMonth,
  formatLocalDate,
  isLeapYear,
  isValidLocalDate,
  isValidMinuteOfDay,
  minutesToClock,
  parseLocalDate,
  toLocalDateString
} from './datetime'
import {
  assertEstimateMinutes,
  assertFocusAvailable,
  assertLocalDate,
  assertMinuteOfDay,
  assertTimeRange,
  isRecurrenceCoherent,
  normalizeNotes,
  normalizeRecurrence,
  normalizeTitle
} from './validation'
import { AppError } from './errors'
import {
  canTransitionTaskStatus,
  diffTaskForUpdate,
  isRecurring,
  isTerminalTaskStatus,
  type Task
} from './task'
import { toAppErrorDto } from './errors'

describe('isValidLocalDate', () => {
  it('accepts a real calendar day', () => {
    expect(isValidLocalDate('2026-10-10')).toBe(true)
    expect(isValidLocalDate('2024-02-29')).toBe(true)
  })

  it('rejects a day that does not exist', () => {
    expect(isValidLocalDate('2026-02-30')).toBe(false)
    expect(isValidLocalDate('2026-13-01')).toBe(false)
    expect(isValidLocalDate('2026-00-10')).toBe(false)
    expect(isValidLocalDate('2026-10-00')).toBe(false)
  })

  it('rejects 29 February in a non-leap year', () => {
    expect(isValidLocalDate('2026-02-29')).toBe(false)
    expect(isValidLocalDate('2024-02-29')).toBe(true)
    expect(isValidLocalDate('1900-02-29')).toBe(false)
    expect(isValidLocalDate('2000-02-29')).toBe(true)
  })

  it('rejects anything that is not zero-padded YYYY-MM-DD', () => {
    expect(isValidLocalDate('2026-1-1')).toBe(false)
    expect(isValidLocalDate('26-10-10')).toBe(false)
    expect(isValidLocalDate('2026/10/10')).toBe(false)
    expect(isValidLocalDate('2026-10-10T00:00:00Z')).toBe(false)
    expect(isValidLocalDate('')).toBe(false)
  })
})

describe('daysInMonth / isLeapYear', () => {
  it('follows the Gregorian rule', () => {
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2023, 2)).toBe(28)
    expect(daysInMonth(2026, 1)).toBe(31)
    expect(daysInMonth(2026, 4)).toBe(30)
    expect(isLeapYear(2000)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)
  })
})

describe('minute-of-day handling', () => {
  it('bounds the value to a real minute of the day', () => {
    expect(isValidMinuteOfDay(0)).toBe(true)
    expect(isValidMinuteOfDay(1439)).toBe(true)
    expect(isValidMinuteOfDay(1440)).toBe(false)
    expect(isValidMinuteOfDay(-1)).toBe(false)
    expect(isValidMinuteOfDay(12.5)).toBe(false)
  })

  it('converts to and from HH:MM without losing the minute', () => {
    expect(minutesToClock(530)).toBe('08:50')
    expect(minutesToClock(0)).toBe('00:00')
    expect(minutesToClock(1439)).toBe('23:59')
    expect(clockToMinutes('08:50')).toBe(530)
    expect(clockToMinutes('08:50:00')).toBe(530)
  })

  it('round-trips every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute += 1) {
      expect(clockToMinutes(minutesToClock(minute))).toBe(minute)
    }
  })

  it('rejects malformed clock values', () => {
    expect(() => clockToMinutes('24:00')).toThrow(RangeError)
    expect(() => clockToMinutes('8:50')).toThrow(RangeError)
    expect(() => clockToMinutes('08:60')).toThrow(RangeError)
    expect(() => clockToMinutes('mañana')).toThrow(RangeError)
  })
})

describe('local date parsing', () => {
  it('splits a day into its parts', () => {
    expect(parseLocalDate('2026-10-10')).toEqual({ year: 2026, month: 10, day: 10 })
  })

  it('refuses to build an impossible day', () => {
    expect(() => formatLocalDate(2026, 2, 30)).toThrow(RangeError)
    expect(() => parseLocalDate('2026-02-30')).toThrow(RangeError)
  })

  it('builds a day from its parts', () => {
    expect(formatLocalDate(2026, 1, 5)).toBe('2026-01-05')
  })

  it('derives the local day from a Date, not the UTC one', () => {
    // 23:30 local on 10 October. In any negative UTC offset, `toISOString()` would
    // already be the 11th; the local day is the 10th in every timezone.
    const late = new Date(2026, 9, 10, 23, 30, 0)

    expect(toLocalDateString(late)).toBe('2026-10-10')
  })
})

describe('normalizeTitle', () => {
  it('trims and collapses inner whitespace', () => {
    expect(normalizeTitle('  Preparar   informe  ')).toBe('Preparar informe')
  })

  it('refuses an empty title with a domain error', () => {
    expect(() => normalizeTitle('   ')).toThrow(AppError)

    try {
      normalizeTitle('')
    } catch (error) {
      expect((error as AppError).code).toBe('TASK_TITLE_REQUIRED')
      expect((error as AppError).message).toContain('título')
    }
  })

  it('refuses a title beyond the documented limit', () => {
    expect(() => normalizeTitle('a'.repeat(201))).toThrow(/200/)
    expect(normalizeTitle('a'.repeat(200))).toHaveLength(200)
  })
})

describe('normalizeNotes', () => {
  it('maps empty input to null rather than an empty string', () => {
    expect(normalizeNotes('')).toBeNull()
    expect(normalizeNotes('   ')).toBeNull()
    expect(normalizeNotes(null)).toBeNull()
    expect(normalizeNotes(undefined)).toBeNull()
  })

  it('keeps real notes', () => {
    expect(normalizeNotes('  con detalle ')).toBe('con detalle')
  })
})

describe('assertLocalDate / assertMinuteOfDay / assertEstimateMinutes', () => {
  it('accepts valid values unchanged', () => {
    expect(assertLocalDate('2026-10-10')).toBe('2026-10-10')
    expect(assertMinuteOfDay(530, 'startMin')).toBe(530)
    expect(assertMinuteOfDay(null, 'startMin')).toBeNull()
    expect(assertEstimateMinutes(60)).toBe(60)
    expect(assertEstimateMinutes(null)).toBeNull()
  })

  it('rejects a well-shaped but non-existent date', () => {
    // The shape passes a Zod regex; only the domain check catches this.
    expect(() => assertLocalDate('2026-02-30')).toThrow(/Fecha inválida/)
    expect(() => assertLocalDate('2026-13-01')).toThrow(/Fecha inválida/)
  })

  it('names the offending field in the error details', () => {
    try {
      assertMinuteOfDay(1500, 'endMin')
    } catch (error) {
      expect((error as AppError).details?.field).toBe('endMin')
    }
  })

  it('rejects a non-positive or over-long estimate', () => {
    expect(() => assertEstimateMinutes(0)).toThrow(AppError)
    expect(() => assertEstimateMinutes(-30)).toThrow(AppError)
    expect(() => assertEstimateMinutes(1441)).toThrow(AppError)
  })
})

describe('assertTimeRange', () => {
  it('accepts an end strictly after the start', () => {
    expect(() => assertTimeRange(540, 600)).not.toThrow()
  })

  it('rejects an end at or before the start', () => {
    expect(() => assertTimeRange(540, 540)).toThrow(/posterior/)
    expect(() => assertTimeRange(600, 540)).toThrow(/posterior/)
  })

  it('does nothing when either end is unset', () => {
    expect(() => assertTimeRange(null, 600)).not.toThrow()
    expect(() => assertTimeRange(540, null)).not.toThrow()
  })
})

describe('task state machine', () => {
  it('allows the documented forward path', () => {
    expect(canTransitionTaskStatus('pending', 'in_progress')).toBe(true)
    expect(canTransitionTaskStatus('in_progress', 'done')).toBe(true)
    expect(canTransitionTaskStatus('pending', 'done')).toBe(true)
  })

  it('treats a self-transition as not a transition', () => {
    expect(canTransitionTaskStatus('pending', 'pending')).toBe(false)
    expect(canTransitionTaskStatus('in_progress', 'in_progress')).toBe(false)
  })

  it('makes done terminal, with no two-step route back', () => {
    expect(canTransitionTaskStatus('done', 'pending')).toBe(false)
    expect(canTransitionTaskStatus('done', 'in_progress')).toBe(false)
    expect(canTransitionTaskStatus('done', 'cancelled')).toBe(false)
    expect(isTerminalTaskStatus('done')).toBe(true)
  })

  it('allows un-cancelling, which records nothing', () => {
    expect(canTransitionTaskStatus('cancelled', 'pending')).toBe(true)
  })
})

describe('assertFocusAvailable', () => {
  it('passes when the day has no focus holder', () => {
    expect(() => assertFocusAvailable({ id: 'a', taskDate: '2026-10-10' }, null)).not.toThrow()
  })

  it('passes when the holder is the task itself', () => {
    expect(() =>
      assertFocusAvailable({ id: 'a', taskDate: '2026-10-10' }, { id: 'a', title: 'La misma' })
    ).not.toThrow()
  })

  it('names the conflicting task when someone else holds it', () => {
    try {
      assertFocusAvailable({ id: 'b', taskDate: '2026-10-10' }, { id: 'a', title: 'Informe' })
      expect.unreachable('the focus rule must refuse this')
    } catch (error) {
      expect((error as AppError).code).toBe('FOCUS_ALREADY_SET')
      expect((error as AppError).message).toContain('Informe')
    }
  })
})

describe('normalizeRecurrence', () => {
  it('wipes series metadata from a non-recurring task', () => {
    expect(
      normalizeRecurrence({
        rruleFreq: 'none',
        rruleInterval: 3,
        rruleDays: [1, 2],
        rruleUntil: '2026-12-31',
        rruleFrom: '2026-10-01'
      })
    ).toEqual({
      rruleFreq: 'none',
      rruleInterval: 1,
      rruleDays: null,
      rruleUntil: null,
      rruleFrom: null
    })
  })

  it('keeps a real series intact', () => {
    const series = {
      rruleFreq: 'weekly' as const,
      rruleInterval: 2,
      rruleDays: [1, 5],
      rruleUntil: null,
      rruleFrom: '2026-10-01'
    }

    expect(normalizeRecurrence(series)).toEqual(series)
  })

  it('rejects an interval outside 1…52', () => {
    expect(() =>
      normalizeRecurrence({
        rruleFreq: 'daily',
        rruleInterval: 0,
        rruleDays: null,
        rruleUntil: null,
        rruleFrom: '2026-10-01'
      })
    ).toThrow(/intervalo/)
  })

  it('rejects weekdays outside ISO 1…7', () => {
    expect(() =>
      normalizeRecurrence({
        rruleFreq: 'weekly',
        rruleInterval: 1,
        rruleDays: [0, 8],
        rruleUntil: null,
        rruleFrom: '2026-10-01'
      })
    ).toThrow(/lunes/)
  })

  it('rejects an empty weekday list for a weekly rule', () => {
    expect(() =>
      normalizeRecurrence({
        rruleFreq: 'weekly',
        rruleInterval: 1,
        rruleDays: [],
        rruleUntil: null,
        rruleFrom: '2026-10-01'
      })
    ).toThrow(/al menos un día/)
  })

  it('rejects a non-existent until date', () => {
    expect(() =>
      normalizeRecurrence({
        rruleFreq: 'daily',
        rruleInterval: 1,
        rruleDays: null,
        rruleUntil: '2026-02-30',
        rruleFrom: '2026-10-01'
      })
    ).toThrow(/Fecha inválida/)
  })
})

describe('isRecurring / isRecurrenceCoherent', () => {
  it('reports whether a task belongs to a series', () => {
    const base = buildTask()
    expect(isRecurring(base)).toBe(false)
    expect(isRecurring({ ...base, rruleFreq: 'daily', rruleFrom: '2026-10-10' })).toBe(true)
  })

  it('calls a one-off task coherent only when it carries no series metadata', () => {
    expect(isRecurrenceCoherent(buildTask())).toBe(true)
    expect(isRecurrenceCoherent({ ...buildTask(), rruleFrom: '2026-10-01' })).toBe(false)
  })
})

describe('diffTaskForUpdate', () => {
  it('returns nothing when the two rows agree', () => {
    const task = buildTask()

    expect(diffTaskForUpdate(task, { ...task })).toEqual({})
  })

  it('lists only the fields that actually differ', () => {
    const task = buildTask()

    expect(diffTaskForUpdate(task, { ...task, title: 'Otro' })).toEqual({ title: 'Otro' })
  })

  it('compares weekday lists by value, not by reference', () => {
    const oneOff = buildTask()
    const series = { ...oneOff, rruleFreq: 'weekly' as const, rruleDays: [1, 5] }

    // Same contents, different array identity: no change.
    expect(diffTaskForUpdate(series, { ...series, rruleDays: [1, 5] })).toEqual({})

    // Dropping the series really is a change to the weekday list.
    expect(diffTaskForUpdate(series, { ...series, rruleDays: null })).toEqual({
      rruleDays: null
    })

    // And adding one, to a task that had none.
    expect(diffTaskForUpdate(oneOff, { ...oneOff, rruleDays: [1, 2] })).toEqual({
      rruleDays: [1, 2]
    })
  })
})

describe('toAppErrorDto', () => {
  it('keeps the code and message of a domain error', () => {
    const dto = toAppErrorDto(new AppError('TASK_NOT_FOUND', 'La tarea no existe.'))

    expect(dto).toEqual({ code: 'TASK_NOT_FOUND', message: 'La tarea no existe.' })
  })

  it('carries structured details when present', () => {
    const dto = toAppErrorDto(
      new AppError('FOCUS_ALREADY_SET', 'Ya hay una tarea en curso.', {
        conflictingTaskTitle: 'Informe'
      })
    )

    expect(dto.details?.conflictingTaskTitle).toBe('Informe')
  })

  it('hides anything that is not a domain error behind a generic message', () => {
    const dto = toAppErrorDto(new Error('C:\\Users\\dev\\taskdiary.db: disk I/O error'))

    expect(dto.code).toBe('DATABASE_ERROR')
    expect(dto.message).not.toContain('C:\\')
    expect(dto.message).not.toContain('disk I/O')
  })

  it('handles a thrown non-Error value', () => {
    expect(toAppErrorDto('boom').code).toBe('DATABASE_ERROR')
  })
})

/** A minimal valid task, used as the base for pure-function assertions. */
function buildTask(): Task {
  return {
    id: 'task-1',
    title: 'Preparar informe',
    notes: null,
    taskDate: '2026-10-10',
    status: 'pending',
    startMin: 540,
    endMin: 600,
    estimateMin: 60,
    color: null,
    tags: [],
    rruleFreq: 'none',
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: null,
    createdAt: '2026-10-10T08:00:00.000Z',
    updatedAt: '2026-10-10T08:00:00.000Z',
    startedAt: null,
    completedAt: null
  }
}
