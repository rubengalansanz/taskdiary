import type { AppErrorDto, TaskDto } from '../../../../shared/ipc'

/**
 * The renderer's view of the task API.
 *
 * Everything here goes through `window.taskDiary`, the single contextBridge global. No
 * fetch, no direct database access: the renderer has no Node capability at all.
 *
 * The module turns the discriminated result the main process returns into a thrown
 * `TaskApiError`, so callers write ordinary `try`/`catch` instead of inspecting `ok` at
 * every call site. The error keeps the machine-readable `code`, because the UI needs it
 * to decide whether to show a field-level message or a generic one.
 */

/** Raised when a task operation is refused by the main process. */
export class TaskApiError extends Error {
  /** Stable code from the contract, e.g. `FOCUS_ALREADY_SET`. */
  readonly code: string
  /** Which field the rejection points at, when it points at one. */
  readonly field: string | undefined
  /** Per-field messages, when several failed at once. */
  readonly fieldMessages: Record<string, string> | undefined

  constructor(dto: AppErrorDto) {
    super(dto.message)

    this.name = 'TaskApiError'
    this.code = dto.code
    this.field = dto.details?.field
    this.fieldMessages = dto.details?.fieldMessages
  }
}

/**
 * Unwraps a result, or throws.
 *
 * @param result Discriminated result from the bridge.
 * @returns The success value.
 * @throws TaskApiError when the main process refused the operation.
 */
function unwrap<TResult extends { ok: true; tasks?: unknown } | { ok: true; task?: unknown }>(
  result: (TResult & { ok: true }) | { ok: false; error: AppErrorDto }
): TResult {
  if (!result.ok) {
    throw new TaskApiError(result.error)
  }

  return result
}

/** Tasks of one calendar day. */
export async function listTasks(taskDate: string): Promise<TaskDto[]> {
  const result = await window.taskDiary.tasks.list({ taskDate })

  return unwrap(result).tasks ?? []
}

/** Inserts a task and returns it as stored. */
export async function createTask(request: CreateTaskRequest): Promise<TaskDto> {
  const result = await window.taskDiary.tasks.create(request)

  return unwrap(result).task
}

/** Applies a partial update and returns the task as stored. */
export async function updateTask(request: UpdateTaskRequest): Promise<TaskDto> {
  const result = await window.taskDiary.tasks.update(request)

  return unwrap(result).task
}

/** Moves a task through the state machine. */
export async function setTaskStatus(id: string, status: TaskStatusDto): Promise<TaskDto> {
  const result = await window.taskDiary.tasks.setStatus({ id, status })

  return unwrap(result).task
}

/** Deletes a task. */
export async function deleteTask(id: string): Promise<boolean> {
  const result = await window.taskDiary.tasks.delete({ id })

  if (!result.ok) {
    throw new TaskApiError(result.error)
  }

  return result.removed
}

/**
 * Zod re-export for the renderer.
 *
 * The renderer's own form validation reuses the very schemas the main process enforces,
 * so the user sees the same message before the round trip that the main process would
 * have produced after it. Divergence here would mean the UI rejects valid input, or
 * accepts invalid input and shows an error the user cannot act on.
 */
export {
  createTaskRequestSchema,
  localDateSchema,
  rruleFreqSchema,
  setTaskStatusRequestSchema,
  taskStatusSchema,
  updateTaskRequestSchema
} from '../../../../shared/ipc'
