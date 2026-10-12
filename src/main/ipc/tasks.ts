import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { AppError } from '../core/errors'
import { guard, parseOrThrow, type FailureDto } from './guard'
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
import type { NewTaskInput, TaskSearchFilter, UpdateTaskInput } from '../db/repositories/tasks-repo'
import { type TagsRepository } from '../db/repositories/tags-repo'
import { isValidTagName } from '../../shared/tags'
import { complianceRatio, currentStreak, longestStreak } from '../core/stats'
import { addDays } from '../core/date-arith'
import {
  createTaskRequestSchema,
  localDateSchema,
  deleteTaskRequestSchema,
  listTaskRangeRequestSchema,
  summarizeRangeRequestSchema,
  listTasksRequestSchema,
  setTaskStatusRequestSchema,
  updateTaskRequestSchema,
  searchTasksRequestSchema,
  IPC_CHANNELS,
  type DeleteTaskRequest,
  type DeleteTaskResultDto,
  type ListTaskRangeRequest,
  type TaskDto,
  type TaskListResultDto,
  type SearchTasksResultDto,
  type TagListResultDto,
  type DaySummaryDto,
  type StatsSummaryResultDto,
  type SummarizeRangeResultDto,
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
/** Success half of a search. */
type SearchTasksOk = Extract<SearchTasksResultDto, { ok: true }>
/** Success half of a tag listing. */
type TagListOk = Extract<TagListResultDto, { ok: true }>
/** Success half of a per-day aggregation. */
type SummarizeRangeOk = Extract<SummarizeRangeResultDto, { ok: true }>
/** Success half of a statistics summary. */
type StatsSummaryOk = Extract<StatsSummaryResultDto, { ok: true }>

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
    tags: normalizeTags(request.tags),
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
  if (request.tags !== undefined) input.tags = normalizeTags(request.tags)

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
 * Normalises a list of tags, rejecting unusable names.
 *
 * Throwing rather than dropping: silently discarding a tag the user typed means the task
 * is saved without it and the user never finds out why it is missing.
 *
 * @param names Tag names as typed, or `undefined`.
 * @returns The normalised, de-duplicated names.
 * @throws AppError `VALIDATION_FAILED` when a name is not a usable tag.
 */
function normalizeTags(names: string[] | undefined): string[] {
  if (names === undefined) {
    return []
  }

  const normalized: string[] = []

  for (const name of names) {
    if (!isValidTagName(name)) {
      throw new AppError(
        'VALIDATION_FAILED',
        `La etiqueta «${name}» no es válida: entre 2 y 40 caracteres, sin espacios.`,
        { field: 'tags' }
      )
    }

    if (!normalized.includes(name.trim().toLowerCase())) {
      normalized.push(name)
    }
  }

  return normalized
}

/**
 * Registers every task and tag channel.
 *
 * Called once at startup. Handlers close over the repositories rather than reaching for a
 * module-level singleton, which keeps this function callable twice in tests.
 *
 * @param repository Repository bound to the open database.
 * @param tags Tag repository, shared with the one the task repository uses so the two can
 *   never disagree about what a tag is.
 */
export function registerTaskIpcHandlers(repository: TasksRepository, tags: TagsRepository): void {
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
    IPC_CHANNELS.statsSummary,
    (_event: IpcMainInvokeEvent, payload: unknown): StatsSummaryResultDto | FailureDto =>
      guard((): StatsSummaryOk | FailureDto => {
        const taskDate = assertLocalDate(
          parseOrThrow(z.object({ taskDate: localDateSchema }), payload).taskDate
        )

        const totals = repository.stats(taskDate)
        const completed = new Set(totals.completedDays)
        const weekFrom = totals.weekFrom
        const byDay = new Map(repository.summarizeRange(weekFrom, taskDate).map((d) => [d.date, d]))

        // Seven entries, always. `summarizeRange` omits days with no work, which is right for
        // the aggregate and wrong for a chart: a weekly bar that only draws the days with
        // data changes width as the week fills, so the reader cannot tell a quiet Monday from
        // a missing one. Empty days are explicit zeros here.
        const week: DaySummaryDto[] = []

        // The whole week, not the elapsed part: a chart that grows a column a day changes
        // width under the reader, so yesterday's four bars are never where today's are. The
        // future days are explicit zeros.
        const weekEnd = addDays(weekFrom, 6)

        for (let day = weekFrom; day <= weekEnd; day = addDays(day, 1)) {
          week.push(
            byDay.get(day) ?? {
              date: day,
              total: 0,
              done: 0,
              inProgress: 0,
              pending: 0,
              cancelled: 0,
              estimateMin: 0,
              realMin: 0,
              unmeasuredDone: 0
            }
          )
        }
        const estimateMin = week.reduce((sum, day) => sum + day.estimateMin, 0)
        const realMin = week.reduce((sum, day) => sum + day.realMin, 0)

        return {
          ok: true,
          stats: {
            today: taskDate,
            totalDone: totals.totalDone,
            totalInProgress: totals.totalInProgress,
            estimateMin: totals.estimateMin,
            realMin: totals.realMin,
            unmeasuredDone: totals.unmeasuredDone,
            // Counted backwards from today, so an unfinished today does not read as a broken
            // streak. See `core/stats.ts` for why that decision is the whole design.
            currentStreak: currentStreak(completed, taskDate),
            longestStreak: longestStreak(completed),
            weekDone: totals.weekDone,
            weekDaysElapsed: totals.weekDaysElapsed,
            complianceRatio: complianceRatio(estimateMin, realMin),
            week
          }
        }
      })
  )

  ipcMain.handle(
    IPC_CHANNELS.taskSummaryRange,
    (_event: IpcMainInvokeEvent, payload: unknown): SummarizeRangeResultDto | FailureDto =>
      guard((): SummarizeRangeOk | FailureDto => {
        const request = parseOrThrow(summarizeRangeRequestSchema, payload)

        // No mapping and no per-task work: the repository already collapsed each day to one
        // grouped row. Whatever comes back is already the shape `daySummarySchema` describes.
        return {
          ok: true,
          days: repository.summarizeRange(
            assertLocalDate(request.fromDate),
            assertLocalDate(request.toDate)
          )
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

  ipcMain.handle(
    IPC_CHANNELS.taskSearch,
    (_event: IpcMainInvokeEvent, payload: unknown): SearchTasksResultDto | FailureDto =>
      guard((): SearchTasksOk | FailureDto => {
        const request = parseOrThrow(searchTasksRequestSchema, payload)

        const filter: TaskSearchFilter = {
          ...(request.query === undefined ? {} : { query: request.query }),
          ...(request.statuses === undefined ? {} : { statuses: request.statuses }),
          ...(request.tagIds === undefined ? {} : { tagIds: request.tagIds }),
          ...(request.limit === undefined ? {} : { limit: request.limit })
        }

        const result = repository.search(filter)

        return {
          ok: true,
          tasks: result.tasks.map(toTaskDto),
          total: result.total,
          truncated: result.truncated
        }
      })
  )

  ipcMain.handle(IPC_CHANNELS.tagList, (): TagListResultDto | FailureDto =>
    guard((): TagListOk | FailureDto => ({ ok: true, tags: tags.listAll() }))
  )
}
