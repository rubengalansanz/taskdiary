/**
 * Domain errors with stable codes.
 *
 * The main process never lets a raw `Error` cross the IPC bridge: stack traces and
 * absolute paths to the user's data directory have no business in the renderer. What
 * crosses instead is an {@link AppErrorDto} — a code the renderer can branch on, a
 * message it can show, and optional structured details.
 *
 * Messages are in Spanish on purpose (see `odd/tasks/fase-1-datos.md`, "Idioma"): they
 * are read by a person at the moment something went wrong, not in a log file.
 */

/** Stable, machine-readable error codes. Never renumber or repurpose these. */
export const APP_ERROR_CODES = [
  /** The payload failed Zod validation at the IPC boundary. */
  'VALIDATION_FAILED',
  /** A task was addressed by id but no row matched. */
  'TASK_NOT_FOUND',
  /** The title was empty or whitespace only after trimming. */
  'TASK_TITLE_REQUIRED',
  /** `endMin` is not strictly after `startMin`. */
  'TASK_INVALID_TIME_RANGE',
  /** The requested status transition is not allowed by the state machine. */
  'TASK_INVALID_TRANSITION',
  /** Another task on the same day is already `in_progress`. */
  'FOCUS_ALREADY_SET',
  /** A write failed at the SQLite level. */
  'DATABASE_ERROR'
] as const

/** Union of every code the application can produce. */
export type AppErrorCode = (typeof APP_ERROR_CODES)[number]

/** Structured context attached to an error. Safe to show; never contains a path. */
export interface AppErrorDetails {
  /** The offending field, when the error is about one. */
  field?: string
  /** Which status was requested vs. which was current. */
  currentStatus?: string
  requestedStatus?: string
  /** Title of the task that already holds the focus on that day. */
  conflictingTaskTitle?: string
  /** Human-readable per-field messages, keyed by field name. */
  fieldMessages?: Record<string, string>
}

/**
 * Error type for every failure the domain can describe.
 *
 * Extends `Error` so `instanceof` works and so stacks stay intact inside the main
 * process; the IPC layer converts it into a plain {@link AppErrorDto} on the way out.
 */
export class AppError extends Error {
  /** Stable code the renderer can branch on. */
  readonly code: AppErrorCode
  /** Optional structured context for the renderer. */
  readonly details: AppErrorDetails | undefined

  constructor(code: AppErrorCode, message: string, details?: AppErrorDetails) {
    super(message)

    this.name = 'AppError'
    this.code = code
    this.details = details

    // Keeps `instanceof AppError` working when the class is down-levelled to ES5 by the
    // main-process build target.
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** Narrows an unknown thrown value to an {@link AppError}. */
export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError
}

/** Reads an {@link AppError} off an unknown value, or `null` when it is something else. */
export function toAppError(value: unknown): AppError | null {
  return isAppError(value) ? value : null
}

/** Message builders, one per code, so wording is never duplicated at throw sites. */
export const APP_ERROR_MESSAGES = {
  /** Message for `VALIDATION_FAILED`. */
  validationFailed: (details?: AppErrorDetails): string => {
    const fields = details?.fieldMessages

    if (fields === undefined) {
      return 'Los datos enviados no son válidos.'
    }

    const summary = Object.entries(fields)
      .map(([field, message]) => `${field}: ${message}`)
      .join('; ')

    return `Los datos enviados no son válidos. ${summary}`
  },
  /** Message for `TASK_NOT_FOUND`. */
  taskNotFound: (): string => 'La tarea no existe.',
  /** Message for `TASK_TITLE_REQUIRED`. */
  taskTitleRequired: (): string => 'El título de la tarea no puede estar vacío.',
  /** Message for `TASK_INVALID_TIME_RANGE`. */
  taskInvalidTimeRange: (details?: AppErrorDetails): string =>
    details?.field === 'endMin'
      ? 'La hora de fin debe ser posterior a la hora de inicio.'
      : 'El rango de horas no es válido.',
  /** Message for `TASK_INVALID_TRANSITION`. */
  taskInvalidTransition: (details?: AppErrorDetails): string => {
    const from = details?.currentStatus ?? 'el estado actual'
    const to = details?.requestedStatus ?? 'el nuevo estado'

    return `No se puede pasar de ${from} a ${to}.`
  },
  /** Message for `FOCUS_ALREADY_SET`. */
  focusAlreadySet: (details?: AppErrorDetails): string => {
    const holder = details?.conflictingTaskTitle

    return holder === undefined
      ? 'Ya hay una tarea en curso ese día.'
      : `Ya hay una tarea en curso ese día: «${holder}».`
  },
  /** Message for `DATABASE_ERROR`. */
  databaseError: (): string => 'No se pudo guardar el cambio en la base de datos.'
} as const

/**
 * Converts any thrown value into a plain, structured-clone-safe DTO.
 *
 * This is the only place where an internal error becomes something the renderer can
 * see. Anything that is not an {@link AppError} is reported as `DATABASE_ERROR` with a
 * generic message: the real cause stays in the main process log, where a developer can
 * read it, instead of leaking a stack trace or a filesystem path into the UI.
 *
 * @param value The caught value.
 * @returns A DTO safe to send through `contextBridge`.
 */
export function toAppErrorDto(value: unknown): {
  code: AppErrorCode
  message: string
  details?: AppErrorDetails
} {
  const error = toAppError(value)

  if (error !== null) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    }
  }

  return { code: 'DATABASE_ERROR', message: APP_ERROR_MESSAGES.databaseError() }
}
