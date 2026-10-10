/**
 * Business rules that a shape validator cannot express.
 *
 * Zod guards the *shape* of an IPC payload: types, ranges, required fields. This module
 * guards the *rules*: the ones that need to compare two fields of the same payload, or
 * that depend on what is already in the database (plan §13, "Validación en dos capas").
 *
 * Everything here is a pure function. No database, no Electron.
 */

import { AppError, APP_ERROR_MESSAGES } from './errors'
import { isValidLocalDate, isValidMinuteOfDay, LOCAL_DATE_PATTERN } from './datetime'
import { canTransitionTaskStatus, isRecurring, type Task, type TaskStatus } from './task'

/** Maximum length accepted for a task title, matching the plan's `CreateTaskSchema`. */
export const MAX_TITLE_LENGTH = 200

/** Maximum length accepted for task notes. */
export const MAX_NOTES_LENGTH = 20_000

/** Minutes in a day; an estimate cannot exceed a full day. */
export const MAX_ESTIMATE_MIN = 1440

/**
 * Normalises a title: trimmed, with internal runs of whitespace collapsed.
 *
 * @param value Raw title from the payload.
 * @returns The cleaned title.
 * @throws AppError `TASK_TITLE_REQUIRED` when nothing is left, `VALIDATION_FAILED`
 *   when the title exceeds {@link MAX_TITLE_LENGTH}.
 */
export function normalizeTitle(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, ' ')

  if (trimmed.length === 0) {
    throw new AppError('TASK_TITLE_REQUIRED', APP_ERROR_MESSAGES.taskTitleRequired(), {
      field: 'title'
    })
  }

  if (trimmed.length > MAX_TITLE_LENGTH) {
    throw new AppError(
      'VALIDATION_FAILED',
      `El título no puede superar los ${MAX_TITLE_LENGTH} caracteres.`,
      {
        field: 'title'
      }
    )
  }

  return trimmed
}

/**
 * Normalises notes, mapping an empty or whitespace-only string to `null`.
 *
 * @param value Raw notes from the payload.
 * @returns The trimmed notes, or `null` when effectively empty.
 * @throws AppError `VALIDATION_FAILED` when the notes exceed {@link MAX_NOTES_LENGTH}.
 */
export function normalizeNotes(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null
  }

  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return null
  }

  if (trimmed.length > MAX_NOTES_LENGTH) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Las notas no pueden superar los ${MAX_NOTES_LENGTH} caracteres.`,
      { field: 'notes' }
    )
  }

  return trimmed
}

/**
 * Validates a local calendar day.
 *
 * @param value Candidate `YYYY-MM-DD` string.
 * @returns The same value, narrowed to a well-formed and real calendar day.
 * @throws AppError `VALIDATION_FAILED` when the value is not a real date.
 */
export function assertLocalDate(value: string): string {
  if (!LOCAL_DATE_PATTERN.test(value) || !isValidLocalDate(value)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `Fecha inválida: «${value}». Se espera el formato AAAA-MM-DD.`,
      {
        field: 'taskDate'
      }
    )
  }

  return value
}

/**
 * Validates a minute-of-day value.
 *
 * @param value Candidate minutes, or `null` when the field is unset.
 * @returns The same value when valid.
 * @throws AppError `VALIDATION_FAILED` when the value is not an integer in `0…1439`.
 */
export function assertMinuteOfDay(value: number | null, field: string): number | null {
  if (value === null) {
    return null
  }

  if (!isValidMinuteOfDay(value)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `«${field}» debe ser un número entero entre 0 y 1439 (minutos desde medianoche).`,
      { field }
    )
  }

  return value
}

/**
 * Validates an estimated duration.
 *
 * @param value Candidate minutes, or `null` when the task is not estimated.
 * @returns The same value when valid.
 * @throws AppError `VALIDATION_FAILED` when the value is not a positive integer within
 *   {@link MAX_ESTIMATE_MIN}.
 */
export function assertEstimateMinutes(value: number | null): number | null {
  if (value === null) {
    return null
  }

  if (!Number.isInteger(value) || value <= 0 || value > MAX_ESTIMATE_MIN) {
    throw new AppError(
      'VALIDATION_FAILED',
      `La duración estimada debe ser un entero entre 1 y ${MAX_ESTIMATE_MIN} minutos.`,
      { field: 'estimateMin' }
    )
  }

  return value
}

/**
 * Validates that `endMin` is strictly after `startMin`.
 *
 * Only checked when both ends are present: a task with no start has no interval to
 * compare against.
 *
 * @param startMin Minutes since midnight at which the task starts, or `null`.
 * @param endMin Minutes since midnight at which the task ends, or `null`.
 * @throws AppError `TASK_INVALID_TIME_RANGE` when `endMin <= startMin`.
 */
export function assertTimeRange(startMin: number | null, endMin: number | null): void {
  if (startMin === null || endMin === null) {
    return
  }

  if (endMin <= startMin) {
    throw new AppError(
      'TASK_INVALID_TIME_RANGE',
      APP_ERROR_MESSAGES.taskInvalidTimeRange({ field: 'endMin' }),
      { field: 'endMin' }
    )
  }
}

/**
 * Validates a status transition against the state machine.
 *
 * @param task The task being changed.
 * @param nextStatus Requested status.
 * @throws AppError `TASK_INVALID_TRANSITION` when the transition is not allowed.
 */
export function assertStatusTransition(task: Task, nextStatus: TaskStatus): void {
  if (!canTransitionTaskStatus(task.status, nextStatus)) {
    throw new AppError(
      'TASK_INVALID_TRANSITION',
      APP_ERROR_MESSAGES.taskInvalidTransition({
        currentStatus: task.status,
        requestedStatus: nextStatus
      }),
      {
        currentStatus: task.status,
        requestedStatus: nextStatus
      }
    )
  }
}

/**
 * Enforces the focus rule: at most one `in_progress` task per calendar day.
 *
 * The plan calls for exactly one task "en curso" at a time (RF-03, §2.1). This is a rule
 * about *other rows in the database*, which is why it lives here and not in Zod.
 *
 * The caller passes the task already holding the focus, if any, so this function stays
 * pure; the query that finds it belongs to the repository.
 *
 * @param task Task being changed.
 * @param holderOnSameDay The existing `in_progress` task on that day, or `null`.
 * @throws AppError `FOCUS_ALREADY_SET` when someone else already holds the focus.
 */
export function assertFocusAvailable(
  task: Pick<Task, 'id' | 'taskDate'>,
  holderOnSameDay: Pick<Task, 'id' | 'title'> | null
): void {
  if (holderOnSameDay !== null && holderOnSameDay.id !== task.id) {
    throw new AppError(
      'FOCUS_ALREADY_SET',
      APP_ERROR_MESSAGES.focusAlreadySet({
        conflictingTaskTitle: holderOnSameDay.title
      }),
      {
        conflictingTaskTitle: holderOnSameDay.title
      }
    )
  }
}

/** The recurrence fields of a task, as they travel between layers. */
export interface RecurrenceInput {
  rruleFreq: Task['rruleFreq']
  rruleInterval: number
  rruleDays: number[] | null
  rruleUntil: string | null
  rruleFrom: string | null
}

/**
 * Fills in the recurrence defaults of a task being created.
 *
 * A task with `rruleFreq: 'none'` must not carry series metadata: a `rrule_from` on a
 * non-recurring row would make it collide in the `idx_tasks_occurrence` unique index for
 * no reason.
 *
 * @param input Recurrence fields from the payload.
 * @returns The normalised recurrence fields.
 * @throws AppError `VALIDATION_FAILED` when the series metadata is inconsistent.
 */
export function normalizeRecurrence(input: RecurrenceInput): RecurrenceInput {
  if (input.rruleFreq === 'none') {
    return {
      rruleFreq: 'none',
      rruleInterval: 1,
      rruleDays: null,
      rruleUntil: null,
      rruleFrom: null
    }
  }

  if (
    !Number.isInteger(input.rruleInterval) ||
    input.rruleInterval < 1 ||
    input.rruleInterval > 52
  ) {
    throw new AppError(
      'VALIDATION_FAILED',
      'El intervalo de repetición debe ser un entero entre 1 y 52.',
      {
        field: 'rruleInterval'
      }
    )
  }

  if (input.rruleDays !== null) {
    if (input.rruleDays.length === 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Una tarea recurrente semanal necesita al menos un día.',
        {
          field: 'rruleDays'
        }
      )
    }

    for (const day of input.rruleDays) {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Los días de la semana van de 1 (lunes) a 7 (domingo).',
          {
            field: 'rruleDays'
          }
        )
      }
    }
  }

  if (input.rruleUntil !== null) {
    assertLocalDate(input.rruleUntil)
  }

  if (input.rruleFrom !== null) {
    assertLocalDate(input.rruleFrom)
  }

  return input
}

/**
 * Reports whether a task carries a coherent recurrence configuration.
 *
 * @param task Task to inspect.
 * @returns True when the recurrence fields are mutually consistent.
 */
export function isRecurrenceCoherent(task: Task): boolean {
  if (!isRecurring(task)) {
    return task.rruleFrom === null && task.rruleDays === null && task.rruleUntil === null
  }

  return task.rruleFrom !== null
}
