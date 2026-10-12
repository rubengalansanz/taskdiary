import type { z } from 'zod'
import { AppError, toAppErrorDto } from '../core/errors'
import { APP_ERROR_MESSAGES } from '../core/errors'
import type { TaskResultDto } from '../../shared/ipc'

/**
 * The two things every IPC handler does: check its payload, and turn a throw into a result.
 *
 * Extracted so that a second handler family — the import/export of Fase 5 — uses the same
 * rules as the first instead of a reimplementation that drifts from them. There are two
 * guards rather than one because the database is synchronous and a dialog is not: marking
 * the synchronous one `async` would add a microtask hop to every channel for no reason.
 */

/** Failure half of every result: the discriminator the renderer branches on. */
export type FailureDto = Extract<TaskResultDto, { ok: false }>

/**
 * Turns Zod issues into a per-field message map.
 *
 * @param error The Zod failure.
 * @returns Messages keyed by dotted field path.
 */
export function toFieldMessages(error: z.ZodError): Record<string, string> {
  const messages: Record<string, string> = {}

  for (const issue of error.issues) {
    const field = issue.path.length === 0 ? 'payload' : issue.path.join('.')
    messages[field] ??= issue.message
  }

  return messages
}

/**
 * Parses a payload with its schema, or throws.
 *
 * @param schema The Zod schema guarding the channel.
 * @param payload Raw value received from the renderer.
 * @returns The parsed value.
 * @throws AppError `VALIDATION_FAILED`, carrying per-field messages.
 */
export function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  payload: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(payload)

  if (!result.success) {
    const fieldMessages = toFieldMessages(result.error)

    throw new AppError(
      'VALIDATION_FAILED',
      APP_ERROR_MESSAGES.validationFailed({ fieldMessages }),
      { fieldMessages }
    )
  }

  return result.data
}

/**
 * Runs a synchronous handler body and converts any throw into a failed result.
 *
 * The failure is wrapped as `{ ok: false, error }` — the same discriminator the success half
 * carries. Returning the bare `AppErrorDto` would leave the renderer with no `ok` to branch
 * on, forcing the `code in result` check the discriminated union exists to make unnecessary.
 *
 * @param work The handler body.
 * @returns Whatever `work` returned, or a failure DTO.
 */
export function guard<TResult>(work: () => TResult): TResult | FailureDto {
  try {
    return work()
  } catch (cause) {
    return { ok: false, error: toAppErrorDto(cause) }
  }
}

/**
 * Runs an asynchronous handler body and converts any throw into a failed result.
 *
 * @param work The handler body.
 * @returns Whatever `work` resolved to, or a failure DTO.
 */
export async function guardAsync<TResult>(
  work: () => Promise<TResult>
): Promise<TResult | FailureDto> {
  try {
    return await work()
  } catch (cause) {
    return { ok: false, error: toAppErrorDto(cause) }
  }
}

export { AppError, toAppErrorDto }
