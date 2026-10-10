/**
 * Task domain model: statuses, recurrence frequencies and the state machine.
 *
 * This module is pure. It imports nothing but `./errors`, so it stays unit-testable in
 * plain Node with no database and no Electron (plan rule §2.10).
 *
 * Dates are local `YYYY-MM-DD` strings and times are integer minutes since midnight —
 * never `Date` objects, never UTC instants (ADR-003, plan rule §2.7).
 */

/** Lifecycle state of a task. */
export const TASK_STATUSES = ['pending', 'in_progress', 'done', 'cancelled'] as const

/** Union of every task status. */
export type TaskStatus = (typeof TASK_STATUSES)[number]

/** Recurrence frequency of a task series. `none` means the task does not repeat. */
export const RRULE_FREQUENCIES = ['none', 'daily', 'weekly', 'monthly', 'weekdays'] as const

/** Union of every recurrence frequency. */
export type RruleFreq = (typeof RRULE_FREQUENCIES)[number]

/** A task as the domain sees it, independent of storage or transport. */
export interface Task {
  /** UUID v4, assigned on creation. */
  id: string
  /** Non-empty title, already trimmed. */
  title: string
  /** Free-form notes, or `null` when the user left them empty. */
  notes: string | null
  /** Local calendar day as `YYYY-MM-DD`. */
  taskDate: string
  /** Current lifecycle state. */
  status: TaskStatus
  /** Minutes since midnight at which the task starts, or `null` when unscheduled. */
  startMin: number | null
  /** Minutes since midnight at which the task ends, or `null` when not finished. */
  endMin: number | null
  /** Planned duration in minutes, or `null` when not estimated. */
  estimateMin: number | null
  /** Optional user colour, `null` when unset. */
  color: string | null
  /** Recurrence frequency; `none` for a one-off task. */
  rruleFreq: RruleFreq
  /** How many frequency periods elapse between occurrences. Always ≥ 1. */
  rruleInterval: number
  /** ISO weekdays (1 = Monday … 7 = Sunday) for weekly rules, or `null`. */
  rruleDays: number[] | null
  /** Inclusive last day of the series as `YYYY-MM-DD`, or `null` when open-ended. */
  rruleUntil: string | null
  /** Origin day of the series as `YYYY-MM-DD`; `null` for a one-off task. */
  rruleFrom: string | null
  /** ISO-8601 UTC creation timestamp. */
  createdAt: string
  /** ISO-8601 UTC last-modification timestamp. */
  updatedAt: string
  /** ISO-8601 UTC completion timestamp, or `null` while not done. */
  completedAt: string | null
}

/**
 * Which status transitions the domain allows.
 *
 * `done` is terminal: no transition leaves it. This is the invariant that makes a diary
 * trustworthy — what was recorded as finished cannot later be rewritten as something
 * else.
 *
 * It would be easy to add `done → cancelled` and, through it, reopen the task in two
 * steps (`done → cancelled → pending`) while still claiming `done → pending` is
 * forbidden. That door stays shut: a two-step route to a forbidden state is not a
 * restriction, it is a comment.
 *
 * Removing a completed task from the diary is therefore a *delete*, not a status change,
 * and Fase 6's undo restores a snapshot rather than replaying a transition.
 *
 * `cancelled → pending` *is* allowed, and the asymmetry with `done` is deliberate:
 * cancelling records that nothing happened, so changing one's mind later is honest.
 */
export const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['in_progress', 'done', 'cancelled'],
  in_progress: ['done', 'pending', 'cancelled'],
  done: [],
  cancelled: ['pending']
}

/** Statuses that record something final and can never be undone through the machine. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ['done', 'cancelled']

/**
 * Reports whether a status change is permitted.
 *
 * A transition to the *same* status is not a transition and is rejected; callers that
 * want idempotency must check for equality themselves rather than rely on this.
 *
 * @param from Current status.
 * @param to Requested status.
 * @returns True when `from → to` is allowed by {@link TASK_STATUS_TRANSITIONS}.
 */
export function canTransitionTaskStatus(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_STATUS_TRANSITIONS[from].includes(to)
}

/**
 * Reports whether a status is terminal.
 *
 * `cancelled` is terminal for *storage* purposes — it counts as finished in the day's
 * totals — even though the machine lets it go back to `pending`. Un-cancelling is a
 * small honesty, not a reopening of history.
 *
 * @param status Status to inspect.
 * @returns True when no transition out of `status` exists.
 */
export function isTerminalTaskStatus(status: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(status)
}

/**
 * Reports whether a task repeats.
 *
 * @param task Task to inspect.
 * @returns True when the task belongs to a recurring series.
 */
export function isRecurring(task: Task): boolean {
  return task.rruleFreq !== 'none'
}

/**
 * Fields a partial update is allowed to write.
 *
 * This is the single source of truth for the domain side. `TasksRepository` maps the
 * same keys to column names through its own `COLUMN_BY_FIELD`, which TypeScript forces
 * to be a total `Record` over these keys — so adding a `Task` field without a column
 * mapping is a compile error, not a silent gap.
 */
export const WRITABLE_TASK_FIELDS = [
  'title',
  'notes',
  'taskDate',
  'status',
  'startMin',
  'endMin',
  'estimateMin',
  'color',
  'rruleFreq',
  'rruleInterval',
  'rruleDays',
  'rruleUntil',
  'rruleFrom',
  'updatedAt',
  'completedAt'
] as const satisfies readonly (keyof Omit<Task, 'id' | 'createdAt'>)[]

/** A field a partial update may write. */
export type WritableTaskField = (typeof WRITABLE_TASK_FIELDS)[number]

/**
 * Returns the fields that a write must persist.
 *
 * Only the fields that actually differ, so the caller can skip the write entirely when
 * nothing moved.
 *
 * @param current Row as stored.
 * @param next Row as requested.
 * @returns The subset of writable fields that differ, excluding `id` and `createdAt`.
 */
export function diffTaskForUpdate(
  current: Task,
  next: Task
): Partial<Omit<Task, 'id' | 'createdAt'>> {
  const changed: Partial<Omit<Task, 'id' | 'createdAt'>> = {}

  for (const key of WRITABLE_TASK_FIELDS) {
    if (!areTaskFieldValuesEqual(current[key], next[key])) {
      Object.assign(changed, { [key]: next[key] })
    }
  }

  return changed
}

function areTaskFieldValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index])
  }

  return a === b
}
