import { describe, expect, it } from 'vitest'
import { APP_ERROR_MESSAGES, AppError, isAppError, toAppError } from './errors'

/**
 * The error vocabulary (Fase 9, T5).
 *
 * This file had no test of its own until now: `errors.ts` was covered only incidentally, by
 * whichever repository test happened to throw through it. That is not the same as testing it,
 * and the coverage report showed it — 78 % statements, the weakest file in `core/`, which is
 * what kept the directory under the 90 % the plan asks for.
 *
 * What is worth pinning is the wording, because this is the one module whose output reaches
 * the user verbatim. A message that names the wrong field, or says "el estado actual" when the
 * status was known, is a support question rather than a bug nobody notices.
 */

describe('isAppError', () => {
  it('recognises an AppError', () => {
    expect(isAppError(new AppError('TASK_NOT_FOUND', 'La tarea no existe.'))).toBe(true)
  })

  it('rejects an Error with the same message', () => {
    // The shape is what counts. A plain Error that happens to say "La tarea no existe." must
    // not be mistaken for one of ours, or a foreign throw would be reported with our code.
    expect(isAppError(new Error('La tarea no existe.'))).toBe(false)
  })

  it('rejects values that are not errors at all', () => {
    expect(isAppError(null)).toBe(false)
    expect(isAppError('boom')).toBe(false)
    expect(isAppError({ code: 'TASK_NOT_FOUND' })).toBe(false)
  })
})

describe('toAppError', () => {
  it('reads the error off an AppError', () => {
    const error = new AppError('FOCUS_ALREADY_SET', 'Ya hay una tarea en curso ese día.')

    expect(toAppError(error)).toBe(error)
  })

  it('answers null for anything else, so callers have one branch and not two', () => {
    expect(toAppError(new Error('disk I/O error'))).toBeNull()
    expect(toAppError(undefined)).toBeNull()
  })
})

describe('APP_ERROR_MESSAGES.validationFailed', () => {
  it('says only that the data is invalid when there is nothing to point at', () => {
    expect(APP_ERROR_MESSAGES.validationFailed()).toBe('Los datos enviados no son válidos.')
    expect(APP_ERROR_MESSAGES.validationFailed({})).toBe('Los datos enviados no son válidos.')
  })

  it('names every offending field when the details carry them', () => {
    const message = APP_ERROR_MESSAGES.validationFailed({
      fieldMessages: { title: 'El título no puede estar vacío.', endMin: 'Debe ser posterior.' }
    })

    expect(message).toContain('title: El título no puede estar vacío.')
    expect(message).toContain('endMin: Debe ser posterior.')
  })
})

describe('APP_ERROR_MESSAGES.taskInvalidTimeRange', () => {
  it('distinguishes a bad end time from a generic bad range', () => {
    expect(APP_ERROR_MESSAGES.taskInvalidTimeRange({ field: 'endMin' })).toBe(
      'La hora de fin debe ser posterior a la hora de inicio.'
    )
    expect(APP_ERROR_MESSAGES.taskInvalidTimeRange({ field: 'startMin' })).toBe(
      'El rango de horas no es válido.'
    )
    expect(APP_ERROR_MESSAGES.taskInvalidTimeRange()).toBe('El rango de horas no es válido.')
  })
})

describe('APP_ERROR_MESSAGES.taskInvalidTransition', () => {
  it('names both statuses when they are known', () => {
    expect(
      APP_ERROR_MESSAGES.taskInvalidTransition({
        currentStatus: 'done',
        requestedStatus: 'pending'
      })
    ).toBe('No se puede pasar de done a pending.')
  })

  it('falls back to generic wording rather than saying "undefined"', () => {
    expect(APP_ERROR_MESSAGES.taskInvalidTransition()).toBe(
      'No se puede pasar de el estado actual a el nuevo estado.'
    )
  })
})

describe('APP_ERROR_MESSAGES.focusAlreadySet', () => {
  it('names the task that holds the day, which is what the user has to look for', () => {
    expect(APP_ERROR_MESSAGES.focusAlreadySet({ conflictingTaskTitle: 'Preparar informe' })).toBe(
      'Ya hay una tarea en curso ese día: «Preparar informe».'
    )
  })

  it('says the same thing when the holder is unknown', () => {
    expect(APP_ERROR_MESSAGES.focusAlreadySet()).toBe('Ya hay una tarea en curso ese día.')
    expect(APP_ERROR_MESSAGES.focusAlreadySet({})).toBe('Ya hay una tarea en curso ese día.')
  })
})

describe('the codes', () => {
  it('has a message for every message code', () => {
    // A code with no builder is a code that reaches the user as an empty string, which reads
    // as a broken app rather than as a refused action.
    expect(APP_ERROR_MESSAGES.databaseError()).toBe(
      'No se pudo guardar el cambio en la base de datos.'
    )
    expect(APP_ERROR_MESSAGES.taskNotFound()).toBe('La tarea no existe.')
    expect(APP_ERROR_MESSAGES.taskTitleRequired()).toBe(
      'El título de la tarea no puede estar vacío.'
    )
  })
})
