import { z } from 'zod'
import { MAX_TAG_LENGTH, MIN_TAG_LENGTH } from './tags'

/**
 * The closed IPC contract between the main process, the preload bridge and the renderer.
 *
 * This module is the single source of truth for channels and payloads (plan rule §2.4).
 * It is deliberately dependency-free apart from Zod — no Electron, no Node built-ins — so
 * all three build targets can import it.
 *
 * Two kinds of import live here, and the distinction matters:
 *
 * - **Types** the renderer needs at compile time (`TaskDto`, `TaskStatusDto`) are *not*
 *   imported by renderer code. It cannot reach them: the ambient `window.taskDiary`
 *   declaration in `src/preload/index.d.ts` re-publishes them as globals.
 * - **Values** — the Zod schemas — *are* imported at runtime, by the task form and by the
 *   API layer. That is deliberate: running the same schema in the renderer before the
 *   round trip is what makes the two validation layers provably identical instead of two
 *   copies that drift. It stays safe because this module pulls in nothing privileged, so
 *   importing it grants the renderer no capability it did not already have.
 *
 * Adding a channel means adding it here, adding a Zod schema, and registering a handler.
 * Nothing else grants the renderer a capability.
 */

// ---------------------------------------------------------------------------
// Limits
//
// Declared here, not in `core/validation.ts`: both the Zod schema and the domain rules
// need them, and `src/main/core/` is allowed to import this module (it imports nothing
// from Electron) while the reverse would drag the domain into the preload bundle. One
// list, one set of numbers — a payload can never be "valid" for Zod and "too long" for
// the domain.
// ---------------------------------------------------------------------------

/** Maximum length of a task title, in characters. */
export const MAX_TITLE_LENGTH = 200

/** Maximum length of task notes, in characters. */
export const MAX_NOTES_LENGTH = 20_000

/**
 * Maximum number of tags attached to one task.
 *
 * The bound on a tag's *length* is not declared here: it lives in `./tags.ts` as
 * {@link MAX_TAG_LENGTH}, next to the function that enforces it, and `tagNameSchema`
 * below imports it. A second copy of the number in this module would be exactly the drift
 * the note above these constants warns about.
 */
export const MAX_TAGS_PER_TASK = 20

// ---------------------------------------------------------------------------
// Reusable field schemas
// ---------------------------------------------------------------------------

/** A local calendar day, `YYYY-MM-DD`. Shape only; real-date checks live in `core/validation.ts`. */
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'La fecha debe tener el formato AAAA-MM-DD.'
})

/** A task title: bounded by {@link MAX_TITLE_LENGTH}, non-blank once trimmed. */
const titleSchema = z.string().max(MAX_TITLE_LENGTH, {
  message: `El título no puede superar los ${MAX_TITLE_LENGTH} caracteres.`
})

/** Free-form notes: bounded by {@link MAX_NOTES_LENGTH}, optional. */
const notesSchema = z.string().max(MAX_NOTES_LENGTH, {
  message: `Las notas no pueden superar los ${MAX_NOTES_LENGTH} caracteres.`
})

/** Minutes since midnight, `0`–`1439`. `null` when the field is unset. */
const minuteOfDaySchema = z.number().int().min(0).max(1439).nullable()

/** A planned duration in minutes. `null` when the task is not estimated. */
const estimateSchema = z.number().int().min(1).max(1440).nullable()

/** ISO weekdays, 1 (Monday) through 7 (Sunday). */
const weekdaySchema = z.number().int().min(1).max(7)

/** An opaque task identifier. Not forced to be a UUID: Fase 5 materialises ids of its own. */
const taskIdSchema = z.string().min(1).max(64)

/**
 * A tag name as stored: no `#`, folded, bounded by the very constants
 * {@link normalizeTagName} enforces.
 */
export const tagNameSchema = z
  .string()
  .trim()
  .min(MIN_TAG_LENGTH, { message: `Una etiqueta necesita al menos ${MIN_TAG_LENGTH} caracteres.` })
  .max(MAX_TAG_LENGTH, {
    message: `Una etiqueta no puede superar los ${MAX_TAG_LENGTH} caracteres.`
  })

/** The `tags` field of a create or update payload. */
const tagsSchema = z.array(tagNameSchema).max(MAX_TAGS_PER_TASK)

/** Recurrence frequency of a task series. */
export const rruleFreqSchema = z.enum(['none', 'daily', 'weekly', 'monthly', 'weekdays'])

/** Lifecycle state of a task. */
export const taskStatusSchema = z.enum(['pending', 'in_progress', 'done', 'cancelled'])

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/** Request for `task:list` — the tasks of one calendar day. */
export const listTasksRequestSchema = z.object({
  taskDate: localDateSchema
})

/** Request for `task:listRange` — every task between two days, inclusive. */
export const listTaskRangeRequestSchema = z.object({
  fromDate: localDateSchema,
  toDate: localDateSchema
})

/** Request for `task:create`. Every field except `title` and `taskDate` is optional. */
export const createTaskRequestSchema = z.object({
  title: titleSchema,
  notes: notesSchema.nullish(),
  taskDate: localDateSchema,
  tags: tagsSchema.optional(),
  startMin: minuteOfDaySchema.optional(),
  endMin: minuteOfDaySchema.optional(),
  estimateMin: estimateSchema.optional(),
  color: z.string().max(32).nullish(),
  rruleFreq: rruleFreqSchema.optional(),
  rruleInterval: z.number().int().min(1).max(52).optional(),
  rruleDays: z.array(weekdaySchema).max(7).nullish(),
  rruleUntil: localDateSchema.nullish(),
  rruleFrom: localDateSchema.nullish()
})

/** Request for `task:update` — only the fields present are changed. */
export const updateTaskRequestSchema = z.object({
  id: taskIdSchema,
  status: taskStatusSchema.optional(),
  tags: tagsSchema.optional(),
  title: titleSchema.optional(),
  notes: notesSchema.nullish(),
  taskDate: localDateSchema.optional(),
  startMin: minuteOfDaySchema.optional(),
  endMin: minuteOfDaySchema.optional(),
  estimateMin: estimateSchema.optional(),
  color: z.string().max(32).nullish(),
  rruleFreq: rruleFreqSchema.optional(),
  rruleInterval: z.number().int().min(1).max(52).optional(),
  rruleDays: z.array(weekdaySchema).max(7).nullish(),
  rruleUntil: localDateSchema.nullish(),
  rruleFrom: localDateSchema.nullish()
})

/** Request for `task:search`. */
export type SearchTasksRequest = z.infer<typeof searchTasksRequestSchema>
/** A tag with its usage count. */
export type TagDto = z.infer<typeof tagSchema>
/** Result of `task:search`. */
export type SearchTasksResultDto = z.infer<typeof searchTasksResultSchema>
/** Result of `tag:list`. */
export type TagListResultDto = z.infer<typeof tagListResultSchema>

/** Request for `task:delete`. */
export const deleteTaskRequestSchema = z.object({
  id: taskIdSchema
})

/** Request for `task:setStatus` — Fase 2 opens this channel. */
export const setTaskStatusRequestSchema = z.object({
  id: taskIdSchema,
  status: taskStatusSchema
})

/**
 * Upper bound on rows a search may return.
 *
 * The master plan's §14 asks for a bounded search rather than loading the whole history
 * into the renderer. 500 rows is far more than anyone scrolls, and it keeps the payload
 * and the re-ranking pass bounded even with years of history.
 */
export const MAX_SEARCH_RESULTS = 500

/** Request for `task:search`. Every field is optional: an empty query lists everything. */
export const searchTasksRequestSchema = z.object({
  /**
   * Text to look for in the title and the notes. Matched against the folded copy in
   * `search_text`, so case and accents do not matter.
   */
  query: z.string().max(200).optional(),
  /** Restrict to these statuses. Empty or absent means every status. */
  statuses: z.array(taskStatusSchema).max(4).optional(),
  /** Restrict to tasks carrying **any** of these tags. Empty or absent means every task. */
  tagIds: z.array(taskIdSchema).max(50).optional(),
  /** How many rows to return. Capped at {@link MAX_SEARCH_RESULTS}. */
  limit: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional()
})

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** A task as it travels over the bridge. Mirrors the domain model in `core/task.ts`. */
export const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  notes: z.string().nullable(),
  taskDate: localDateSchema,
  status: taskStatusSchema,
  startMin: z.number().int().nullable(),
  endMin: z.number().int().nullable(),
  estimateMin: z.number().int().nullable(),
  color: z.string().nullable(),
  rruleFreq: rruleFreqSchema,
  rruleInterval: z.number().int(),
  rruleDays: z.array(z.number().int()).nullable(),
  rruleUntil: localDateSchema.nullable(),
  rruleFrom: localDateSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  tags: z.array(z.string())
})

/** Error codes that can cross the bridge. Mirrors `AppErrorCode` in `core/errors.ts`. */
export const appErrorCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'TASK_NOT_FOUND',
  'TASK_TITLE_REQUIRED',
  'TASK_INVALID_TIME_RANGE',
  'TASK_INVALID_TRANSITION',
  'FOCUS_ALREADY_SET',
  'DATABASE_ERROR'
])

/**
 * A failed operation.
 *
 * The main process never lets a raw `Error` through: no stack traces, no absolute paths.
 * The renderer gets a code to branch on and a message to show.
 */
export const appErrorSchema = z.object({
  code: appErrorCodeSchema,
  message: z.string(),
  details: z
    .object({
      field: z.string().optional(),
      currentStatus: z.string().optional(),
      requestedStatus: z.string().optional(),
      conflictingTaskTitle: z.string().optional(),
      fieldMessages: z.record(z.string(), z.string()).optional()
    })
    .optional()
})

/** A result that either succeeded or failed. Discriminated by `ok`. */
export const taskResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), task: taskSchema }),
  z.object({ ok: z.literal(false), error: appErrorSchema })
])

/** A list result that either succeeded or failed. */
export const taskListResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), tasks: z.array(taskSchema) }),
  z.object({ ok: z.literal(false), error: appErrorSchema })
])

/** A deletion result. `removed` is false when the id did not exist. */
export const deleteTaskResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), removed: z.boolean() }),
  z.object({ ok: z.literal(false), error: appErrorSchema })
])

/** A tag as it travels over the bridge, with how many tasks carry it. */
export const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
  /** How many tasks carry this tag across the whole history. */
  taskCount: z.number().int().min(0)
})

/**
 * Result of `task:search`.
 *
 * `total` is counted separately from the returned rows, so the sidebar can say
 * "412 resultados" while showing the first 500. Reporting only what came back would make
 * the counter silently wrong the moment the history grew past the limit.
 */
export const searchTasksResultSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    tasks: z.array(taskSchema),
    total: z.number().int().min(0),
    /** True when `total` exceeds the returned rows. */
    truncated: z.boolean()
  }),
  z.object({ ok: z.literal(false), error: appErrorSchema })
])

/** Result of `tag:list`. */
export const tagListResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), tags: z.array(tagSchema) }),
  z.object({ ok: z.literal(false), error: appErrorSchema })
])

/** Result of the Phase 0 database probe. */
export const dbProbeResultSchema = z.object({
  ok: z.boolean(),
  sqliteVersion: z.string().optional(),
  path: z.string(),
  error: z.string().optional(),
  /** Schema version recorded in `PRAGMA user_version`. Fase 1. */
  schemaVersion: z.number().int().optional(),
  /** Whether the `tasks` table exists, i.e. the migrations actually ran. Fase 1. */
  hasTasksTable: z.boolean().optional()
})

/** Result of the Phase 0 database probe. */
export type TaskDiaryDbProbeResult = z.infer<typeof dbProbeResultSchema>

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A task as seen by the renderer. */
export type TaskDto = z.infer<typeof taskSchema>
/** Lifecycle state of a task. */
export type TaskStatusDto = z.infer<typeof taskStatusSchema>
/** Recurrence frequency of a task series. */
export type RruleFreqDto = z.infer<typeof rruleFreqSchema>
/** A failed operation. */
export type AppErrorDto = z.infer<typeof appErrorSchema>

/** Request for `task:list`. */
export type ListTasksRequest = z.infer<typeof listTasksRequestSchema>
/** Request for `task:listRange`. */
export type ListTaskRangeRequest = z.infer<typeof listTaskRangeRequestSchema>
/** Request for `task:create`. */
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>
/** Request for `task:update`. */
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>
/** Request for `task:delete`. */
export type DeleteTaskRequest = z.infer<typeof deleteTaskRequestSchema>

/** Result of `task:list` / `task:create` / `task:update` / `task:setStatus`. */
export type TaskResultDto = z.infer<typeof taskResultSchema>
/** Result of `task:list` / `task:listRange`. */
export type TaskListResultDto = z.infer<typeof taskListResultSchema>
/** Result of `task:delete`. */
export type DeleteTaskResultDto = z.infer<typeof deleteTaskResultSchema>

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Every channel the main process listens on. Nothing outside this map exists. */
export const IPC_CHANNELS = {
  /** Phase 0: run the database probe and return its result. */
  dbProbe: 'taskdiary:db:probe',
  /** Phase 0: read the current OS theme preference. */
  themeIsDark: 'taskdiary:theme:is-dark',
  /** Phase 0: main pushes theme changes to the renderer. */
  themeChanged: 'taskdiary:theme:changed',
  /** Phase 1: tasks of one calendar day. */
  taskList: 'taskdiary:task:list',
  /** Phase 1: every task between two calendar days, inclusive. */
  taskListRange: 'taskdiary:task:list-range',
  /** Phase 1: insert a task. */
  taskCreate: 'taskdiary:task:create',
  /** Phase 1: partially update a task. */
  taskUpdate: 'taskdiary:task:update',
  /** Phase 1: delete a task. */
  taskDelete: 'taskdiary:task:delete',
  /** Phase 2: move a task through the state machine. */
  taskSetStatus: 'taskdiary:task:set-status',
  /** Phase 3: search the whole history by text, tags and status. */
  taskSearch: 'taskdiary:task:search',
  /** Phase 3: every tag in use, with how many tasks carry it. */
  tagList: 'taskdiary:tag:list',
  /**
   * Phase 2: channels the native menu uses to reach the renderer.
   *
   * Menu accelerators fire even when the focus is outside the page — inside a dialog, or
   * nowhere at all — so they cannot live only in the renderer. They carry no payload: the
   * renderer owns what "new task" means on the current day.
   */
  menuNewTask: 'taskdiary:menu:new-task',
  /** Jump to today. */
  menuToday: 'taskdiary:menu:go-today',
  /** Go to the previous day. */
  menuPreviousDay: 'taskdiary:menu:previous-day',
  /** Go to the next day. */
  menuNextDay: 'taskdiary:menu:next-day',
  /** Complete the selected task. */
  menuCompleteSelected: 'taskdiary:menu:complete-selected'
} as const

/** Name of any channel in {@link IPC_CHANNELS}. */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// ---------------------------------------------------------------------------
// The renderer-facing API
// ---------------------------------------------------------------------------

/** CRUD surface the preload exposes for tasks. */
export interface TaskApi {
  /** Tasks of one calendar day, ordered by start time. */
  list(request: ListTasksRequest): Promise<TaskListResultDto>
  /** Every task in an inclusive day range. */
  listRange(request: ListTaskRangeRequest): Promise<TaskListResultDto>
  /** Inserts a task and returns it as stored. */
  create(request: CreateTaskRequest): Promise<TaskResultDto>
  /** Applies a partial update and returns the task as stored. */
  update(request: UpdateTaskRequest): Promise<TaskResultDto>
  /** Deletes a task; `removed` is false when the id did not exist. */
  delete(request: DeleteTaskRequest): Promise<DeleteTaskResultDto>
  /** Moves a task through the state machine. Registered in Fase 2. */
  setStatus(request: { id: string; status: TaskStatusDto }): Promise<TaskResultDto>
  /** Searches the whole history by text, tags and status. */
  search(request: SearchTasksRequest): Promise<SearchTasksResultDto>
}

/** Tag channels, grouped apart because they carry no payload. */
export interface TagApi {
  /** Every tag in use, with how many tasks carry it. */
  list(): Promise<TagListResultDto>
}

/** Light/dark theme bridge backed by Electron's `nativeTheme`. */
export interface TaskDiaryThemeApi {
  /** Resolves the current OS theme preference. */
  isDark(): Promise<boolean>
  /**
   * Subscribes to theme changes.
   * @param callback Invoked with the new value whenever the OS theme changes.
   * @returns An unsubscribe function.
   */
  onChange(callback: (isDark: boolean) => void): () => void
}

/**
 * Commands the native menu pushes to the renderer when an accelerator fires.
 *
 * Derived from {@link IPC_CHANNELS} rather than written out: a literal copy would still
 * typecheck after a channel was renamed, and `isMenuCommand` would then silently stop
 * matching a channel the main process still sends.
 */
export const MENU_COMMAND_CHANNELS = [
  IPC_CHANNELS.menuNewTask,
  IPC_CHANNELS.menuToday,
  IPC_CHANNELS.menuPreviousDay,
  IPC_CHANNELS.menuNextDay,
  IPC_CHANNELS.menuCompleteSelected
] as const

/** Name of a command the native menu can push. */
export type MenuCommand = (typeof MENU_COMMAND_CHANNELS)[number]

/**
 * Reports whether a pushed channel is one this build knows about.
 *
 * @param channel Value received from the main process.
 * @returns True when it names a command declared in {@link MENU_COMMAND_CHANNELS}.
 */
export function isMenuCommand(channel: unknown): channel is MenuCommand {
  return (
    typeof channel === 'string' && (MENU_COMMAND_CHANNELS as readonly string[]).includes(channel)
  )
}

/** Bridge for the native menu's accelerator commands. */
export interface TaskDiaryMenuApi {
  /**
   * Subscribes to accelerator commands from the main process.
   *
   * Filters against the known command list before handing anything to the renderer: the
   * preload cannot know what the main process will send, so it checks rather than
   * forwards whatever arrives.
   *
   * @param callback Invoked with the command name.
   * @returns An unsubscribe function.
   */
  onCommand(callback: (command: MenuCommand) => void): () => void
}

/** The single API exposed to the renderer through `contextBridge`. */
export interface TaskDiaryApi {
  /** Phase 0 database diagnostics. */
  db: {
    probe(): Promise<z.infer<typeof dbProbeResultSchema>>
  }
  /** Phase 1 task CRUD, plus the Phase 3 search. */
  tasks: TaskApi
  /** Phase 3 tags. */
  tags: TagApi
  /** Phase 2 native menu accelerators. */
  menu: TaskDiaryMenuApi
  /** Light/dark theme bridge. */
  theme: TaskDiaryThemeApi
}
