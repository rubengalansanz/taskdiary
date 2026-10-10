import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { APP_ERROR_MESSAGES, AppError, toAppErrorDto } from '../core/errors'
import {
  assertEstimateMinutes,
  assertLocalDate,
  assertMinuteOfDay,
  assertTimeRange,
  normalizeNotes,
  normalizeRecurrence,
  normalizeTitle
} from '../core/validation'
import { type TasksRepository } from '../db/repositories/tasks-repo'
import type { NewTaskInput, UpdateTaskInput } from '../db/repositories/tasks-repo'
import {
  createTaskRequestSchema,
  deleteTaskRequestSchema,
  listTaskRangeRequestSchema,
  listTasksRequestSchema,
  setTaskStatusRequestSchema,
  updateTaskRequestSchema,
  IPC_CHANNELS,
  type DeleteTaskRequest,
  type DeleteTaskResultDto,
  type ListTaskRangeRequest,
  type TaskDto,
  type TaskListResultDto,
  type TaskResultDto,
  type UpdateTaskRequest
} from '../../shared/ipc'
import type { Task } from '../core/task'

/**
 * IPC channel registration and boundary validation.
 *
 * Every handler follows the same three steps, in this order:
 *
 *   1. **Validate the shape with Zod.** A malformed payload never reaches the database.
 *      That is the acceptance criterion of Fase 1, and it holds because Zod runs before
 *      anything else: there is no path from a bad payload to a write.
 *   2. **Validate the rules with `core/validation.ts`.** Title trimming, minute ranges,
 *      `endMin > startMin`, recurrence coherence.
 *   3. **Call the repository.** It assumes valid input and owns only what genuinely needs
 *      the database: the state machine against the stored row, and the focus rule against
 *      its neighbours.
 *
 * Nothing here throws across the bridge. A failure becomes an `AppErrorDto`, so the
 * renderer always receives a discriminated result it can render without a try/catch.
 */

/** Success half of a single-task result. */
type TaskOk = Extract<TaskResultDto, { ok: true }>
/** Success half of a task-list result. */
type TaskListOk = Extract<TaskListResultDto, { ok: true }>
/** Failure half of every result: the discriminator the renderer branches on. */
type FailureDto = Extract<TaskResultDto, { ok: false }>

/**
 * Turns a Zod failure into the `AppErrorDetails.fieldMessages` map.
 *
 * Each issue carries the dotted path of the offending field and a message. Grouping by
 * field gives the renderer something it can place next to the input that failed.
 *
 * @param error The Zod error.
 * @returns Messages keyed by field path.
 */
function toFieldMessages(error: z.ZodError): Record<string, string> {
  const messages: Record<string, string> = {}

  for (const issue of error.issues) {
    const field = issue.path.length === 0 ? 'payload' : issue.path.join('.')
    messages[field] ??= issue.message
  }

  return messages
}

/**
 * Parses `payload` with `schema`, or throws a `VALIDATION_FAILED` `AppError`.
 *
 * @param schema The Zod schema guarding this channel.
 * @param payload Raw value received from the renderer.
 * @returns The parsed value.
 * @throws AppError `VALIDATION_FAILED`, carrying per-field messages.
 */
function parseOrThrow<TSchema extends z.ZodType>(
  schema: TSchema,
  payload: unknown
): z.infer<TSchema> {
  const result = schema.safeParse(payload)

  if (!result.success) {
    const fieldMessages = toFieldMessages(result.error)

    throw new AppError(
      'VALIDATION_FAILED',
      APP_ERROR_MESSAGES.validationFailed({ fieldMessages }),
      {
        fieldMessages
      }
    )
  }

  return result.data
}

/**
 * Runs `work` and converts any throw into a failed result.
 *
 * The failure is wrapped as `{ ok: false, error }` — the same discriminator the success
 * half carries. Returning the bare `AppErrorDto` instead would leave the renderer with
 * no `ok` to branch on, forcing a `code in result` check that the discriminated union in
 * the contract exists to make unnecessary.
 *
 * Not `async`: every step below is synchronous, because `better-sqlite3` is. Marking it
 * async would add a microtask hop to every channel for nothing.
 *
 * @param work The handler body.
 * @returns Whatever `work` returned, or a failure DTO.
 */
function guard<TResult>(work: () => TResult): TResult | FailureDto {
  try {
    return work()
  } catch (cause) {
    return { ok: false, error: toAppErrorDto(cause) }
  }
}

/**
 * Projects the domain model onto the wire shape.
 *
 * A copy rather than the domain object itself: the DTO is the contract, so anything the
 * domain grows later must cross the bridge deliberately, not by accident.
 *
 * @param task Domain task.
 * @returns The DTO.
 */
function toTaskDto(task: Task): TaskDto {
  return { ...task }
}

/**
 * Applies the business rules to a create payload and normalises it for the repository.
 *
 * @param request Validated payload.
 * @returns Repository-ready input.
 * @throws AppError from any rule in `core/validation.ts`.
 */
function toNewTaskInput(request: z.infer<typeof createTaskRequestSchema>): NewTaskInput {
  const startMin = assertMinuteOfDay(request.startMin ?? null, 'startMin')
  const endMin = assertMinuteOfDay(request.endMin ?? null, 'endMin')

  assertTimeRange(startMin, endMin)

  return {
    title: normalizeTitle(request.title),
    notes: normalizeNotes(request.notes),
    taskDate: assertLocalDate(request.taskDate),
    startMin,
    endMin,
    estimateMin: assertEstimateMinutes(request.estimateMin ?? null),
    color: request.color ?? null,
    ...normalizeRecurrence({
      rruleFreq: request.rruleFreq ?? 'none',
      rruleInterval: request.rruleInterval ?? 1,
      rruleDays: request.rruleDays ?? null,
      rruleUntil: request.rruleUntil ?? null,
      rruleFrom: request.rruleFrom ?? null
    })
  }
}

/**
 * Applies the business rules to an update payload, touching only the sent fields.
 *
 * An absent key means "leave as is" and must never reach the repository as `undefined`:
 * SQLite would bind `NULL` and silently erase the column.
 *
 * @param request Validated payload.
 * @returns Repository-ready partial input.
 * @throws AppError from any rule in `core/validation.ts`.
 */
function toUpdateTaskInput(request: z.infer<typeof updateTaskRequestSchema>): UpdateTaskInput {
  const input: UpdateTaskInput = {}

  if (request.title !== undefined) input.title = normalizeTitle(request.title)
  if (request.notes !== undefined) input.notes = normalizeNotes(request.notes)
  if (request.taskDate !== undefined) input.taskDate = assertLocalDate(request.taskDate)
  if (request.startMin !== undefined) {
    input.startMin = assertMinuteOfDay(request.startMin, 'startMin')
  }
  if (request.endMin !== undefined) input.endMin = assertMinuteOfDay(request.endMin, 'endMin')
  if (request.estimateMin !== undefined) {
    input.estimateMin = assertEstimateMinutes(request.estimateMin)
  }
  if (request.color !== undefined) input.color = request.color
  if (request.status !== undefined) input.status = request.status

  // Recurrence is validated as a unit: changing one field of a series changes the rule,
  // so defaults are applied for whichever ones the caller omitted.
  if (request.rruleFreq !== undefined) {
    Object.assign(
      input,
      normalizeRecurrence({
        rruleFreq: request.rruleFreq,
        rruleInterval: request.rruleInterval ?? 1,
        rruleDays: request.rruleDays ?? null,
        rruleUntil: request.rruleUntil ?? null,
        rruleFrom: request.rruleFrom ?? null
      })
    )
  }

  if (request.startMin !== undefined && request.endMin !== undefined) {
    assertTimeRange(request.startMin, request.endMin)
  }

  return input
}

/**
 * Registers every task channel against `repository`.
 *
 * Called once at startup. Handlers close over the repository rather than reaching for a
 * module-level singleton, which keeps this function callable twice in tests.
 *
 * @param repository Repository bound to the open database.
 */
export function registerTaskIpcHandlers(repository: TasksRepository): void {
  ipcMain.handle(
    IPC_CHANNELS.taskList,
    (_event: IpcMainInvokeEvent, payload: unknown): TaskListResultDto | FailureDto =>
      guard((): TaskListOk | FailureDto => {
        const request: z.infer<typeof listTasksRequestSchema> = parseOrThrow(
          listTasksRequestSchema,
          payload
        )

        return {
          ok: true,
          tasks: repository.listByDate(assertLocalDate(request.taskDate)).map(toTaskDto)
        }
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.taskListRange,
    (_event: IpcMainInvokeEvent, payload: unknown): TaskListResultDto | FailureDto =>
      guard((): TaskListOk | FailureDto => {
        const request: ListTaskRangeRequest = parseOrThrow(listTaskRangeRequestSchema, payload)

        return {
          ok: true,
          tasks: repository
            .listByRange(assertLocalDate(request.fromDate), assertLocalDate(request.toDate))
            .map(toTaskDto)
        }
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.taskCreate,
    (_event: IpcMainInvokeEvent, payload: unknown): TaskResultDto | FailureDto =>
      guard((): TaskOk | FailureDto => {
        const request = parseOrThrow(createTaskRequestSchema, payload)

        return { ok: true, task: toTaskDto(repository.create(toNewTaskInput(request))) }
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.taskUpdate,
    (_event: IpcMainInvokeEvent, payload: unknown): TaskResultDto | FailureDto =>
      guard((): TaskOk | FailureDto => {
        const request: UpdateTaskRequest = parseOrThrow(updateTaskRequestSchema, payload)

        return {
          ok: true,
          task: toTaskDto(repository.update(request.id, toUpdateTaskInput(request)))
        }
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.taskDelete,
    (_event: IpcMainInvokeEvent, payload: unknown): DeleteTaskResultDto | FailureDto =>
      guard((): DeleteTaskResultDto | FailureDto => {
        const request: DeleteTaskRequest = parseOrThrow(deleteTaskRequestSchema, payload)

        return { ok: true, removed: repository.delete(request.id) }
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.taskSetStatus,
    (_event: IpcMainInvokeEvent, payload: unknown): TaskResultDto | FailureDto =>
      guard((): TaskOk | FailureDto => {
        const request = parseOrThrow(setTaskStatusRequestSchema, payload)

        return {
          ok: true,
          task: toTaskDto(repository.update(request.id, { status: request.status }))
        }
      })
  )
}
