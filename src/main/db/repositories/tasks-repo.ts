import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { AppError, APP_ERROR_MESSAGES } from '../../core/errors'
import { toAuditTimestamp } from '../../core/datetime'
import { diffTaskForUpdate, type RruleFreq, type Task, type TaskStatus } from '../../core/task'
import {
  assertFocusAvailable,
  assertStatusTransition,
  normalizeRecurrence,
  type RecurrenceInput
} from '../../core/validation'

/**
 * The only layer that writes SQL.
 *
 * Rule §2.9: every statement is parameterised. No SQL string is ever built by
 * concatenating a *value*, and the only dynamic fragment ever produced is the
 * `SET column = @column` list, whose column names come from {@link COLUMN_BY_FIELD}, a
 * compile-time constant.
 *
 * The repository assumes its input has already been validated by `core/validation.ts`
 * and, at the IPC boundary, by Zod. What it *does* own is the rules that need to see the
 * database: the status machine against the stored row, and the one-task-in-progress rule
 * against its neighbours.
 */

/** Shape of a `tasks` row as SQLite returns it. Nullable columns are nullable here too. */
interface TaskRow {
  id: string
  title: string
  notes: string | null
  task_date: string
  status: string
  start_min: number | null
  end_min: number | null
  estimate_min: number | null
  color: string | null
  rrule_freq: string
  rrule_interval: number
  rrule_days: string | null
  rrule_until: string | null
  rrule_from: string | null
  created_at: string
  updated_at: string
  completed_at: string | null
}

/** Non-recurrence fields accepted when creating a task, as they arrive from the IPC layer. */
export interface CreateTaskInput {
  title: string
  notes: string | null
  taskDate: string
  startMin: number | null
  endMin: number | null
  estimateMin: number | null
  color: string | null
}

/** Fields accepted when creating a task: the content plus its recurrence rule. */
export type NewTaskInput = CreateTaskInput & RecurrenceInput

/**
 * Fields a partial update may touch. Omitted keys keep their stored value.
 *
 * `status` is here because changing status is an update; the state machine is enforced
 * in {@link TasksRepository.update}.
 */
export interface UpdateTaskInput extends Partial<NewTaskInput> {
  status?: TaskStatus
}

/** Column list shared by every read, kept in one place so reads cannot drift. */
const TASK_COLUMNS = `
  id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
  rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
  created_at, updated_at, completed_at
`.trim()

/**
 * Maps a domain field name to its column name. Total by construction.
 *
 * This table is the only place where a field name becomes SQL text, which is what keeps
 * {@link TasksRepository.writeUpdate} free of unvalidated identifiers.
 */
const COLUMN_BY_FIELD: Readonly<Record<keyof Omit<Task, 'id'>, string>> = {
  title: 'title',
  notes: 'notes',
  taskDate: 'task_date',
  status: 'status',
  startMin: 'start_min',
  endMin: 'end_min',
  estimateMin: 'estimate_min',
  color: 'color',
  rruleFreq: 'rrule_freq',
  rruleInterval: 'rrule_interval',
  rruleDays: 'rrule_days',
  rruleUntil: 'rrule_until',
  rruleFrom: 'rrule_from',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  completedAt: 'completed_at'
}

/** Columns a partial update is allowed to write. */
type WritableField = keyof Omit<Task, 'id' | 'createdAt'>

const WRITABLE_FIELDS: readonly WritableField[] = [
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
]

/** Narrows an arbitrary key to the set of columns an update may write. */
function isWritableField(key: string): key is WritableField {
  return (WRITABLE_FIELDS as readonly string[]).includes(key)
}

/**
 * A repository bound to one open database handle.
 *
 * Created once at startup and passed to the IPC handlers. Holds no state beyond the
 * handle, so it is safe to share and trivially testable against `:memory:`.
 */
export class TasksRepository {
  private readonly database: Database.Database

  constructor(database: Database.Database) {
    this.database = database
  }

  /**
   * Returns the tasks of a single calendar day, ordered by start time.
   *
   * Unscheduled tasks (`start_min IS NULL`) sort last rather than first: the Day view is
   * a timeline, and a task with no time has nowhere to sit on it.
   *
   * @param taskDate Local calendar day as `YYYY-MM-DD`.
   * @returns The day's tasks.
   */
  listByDate(taskDate: string): Task[] {
    const rows = this.database
      .prepare(
        `SELECT ${TASK_COLUMNS}
           FROM tasks
          WHERE task_date = ?
          ORDER BY (start_min IS NULL), start_min ASC, created_at ASC`
      )
      .all(taskDate) as TaskRow[]

    return rows.map(toTask)
  }

  /**
   * Returns every task between two calendar days, inclusive.
   *
   * Backs the Week view (Fase 4) and the Heatmap. Same ordering contract as
   * {@link listByDate}, so a range renders as consecutive day timelines.
   *
   * @param fromDate First day, inclusive, as `YYYY-MM-DD`.
   * @param toDate Last day, inclusive, as `YYYY-MM-DD`.
   * @returns The tasks in the range, ordered by date then start time.
   * @throws AppError `VALIDATION_FAILED` when the range is inverted.
   */
  listByRange(fromDate: string, toDate: string): Task[] {
    if (fromDate > toDate) {
      throw new AppError(
        'VALIDATION_FAILED',
        'El rango de fechas está invertido: la fecha inicial es posterior a la final.',
        { field: 'fromDate' }
      )
    }

    const rows = this.database
      .prepare(
        `SELECT ${TASK_COLUMNS}
           FROM tasks
          WHERE task_date BETWEEN ? AND ?
          ORDER BY task_date ASC, (start_min IS NULL), start_min ASC, created_at ASC`
      )
      .all(fromDate, toDate) as TaskRow[]

    return rows.map(toTask)
  }

  /**
   * Returns one task by id.
   *
   * @param id Task UUID.
   * @returns The task.
   * @throws AppError `TASK_NOT_FOUND` when no row matches.
   */
  findById(id: string): Task {
    const row = this.database.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id) as
      TaskRow | undefined

    if (row === undefined) {
      throw new AppError('TASK_NOT_FOUND', APP_ERROR_MESSAGES.taskNotFound(), { field: 'id' })
    }

    return toTask(row)
  }

  /**
   * Reports whether a task exists, without materialising it.
   *
   * @param id Task UUID.
   * @returns True when a row matches.
   */
  exists(id: string): boolean {
    const row = this.database.prepare('SELECT 1 AS present FROM tasks WHERE id = ?').get(id) as
      { present: number } | undefined

    return row !== undefined
  }

  /**
   * Returns the task currently `in_progress` on a given day, if any.
   *
   * Backs the focus rule: a status change to `in_progress` is refused when someone else
   * already holds it.
   *
   * @param taskDate Local calendar day as `YYYY-MM-DD`.
   * @param excludeTaskId Task to ignore, so re-saving the focused task is not a conflict.
   * @returns The focus holder, or `null` when the day has none.
   */
  findFocusHolder(taskDate: string, excludeTaskId?: string): Task | null {
    const row =
      excludeTaskId === undefined
        ? (this.database
            .prepare(
              `SELECT ${TASK_COLUMNS} FROM tasks WHERE task_date = ? AND status = 'in_progress'`
            )
            .get(taskDate) as TaskRow | undefined)
        : (this.database
            .prepare(
              `SELECT ${TASK_COLUMNS}
                 FROM tasks
                WHERE task_date = ? AND status = 'in_progress' AND id <> ?`
            )
            .get(taskDate, excludeTaskId) as TaskRow | undefined)

    return row === undefined ? null : toTask(row)
  }

  /**
   * Inserts a task.
   *
   * The id and both audit timestamps are generated here, never accepted from the caller:
   * a renderer that could choose an id could collide with an existing row on insert, and
   * a caller-supplied clock would make history lie.
   *
   * New tasks always start as `pending`. The status machine only ever moves an existing
   * task forward, and starting mid-lifecycle would bypass that.
   *
   * @param input Validated task fields, already normalised by `core/validation.ts`.
   * @returns The stored task, as read back from the database.
   * @throws AppError `FOCUS_ALREADY_SET` when inserting an already-focused task on a
   *   day that has one. Reachable only through a direct repository call; the IPC
   *   `task:create` payload has no `status` field.
   */
  create(input: NewTaskInput): Task {
    const id = randomUUID()
    const now = toAuditTimestamp()

    this.database
      .prepare(
        `INSERT INTO tasks (
           id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
           rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
           created_at, updated_at, completed_at
         ) VALUES (
           @id, @title, @notes, @taskDate, 'pending', @startMin, @endMin, @estimateMin, @color,
           @rruleFreq, @rruleInterval, @rruleDays, @rruleUntil, @rruleFrom,
           @createdAt, @updatedAt, NULL
         )`
      )
      .run({
        id,
        title: input.title,
        notes: input.notes,
        taskDate: input.taskDate,
        startMin: input.startMin,
        endMin: input.endMin,
        estimateMin: input.estimateMin,
        color: input.color,
        ...toRecurrenceColumns(normalizeRecurrence(input)),
        createdAt: now,
        updatedAt: now
      })

    return this.findById(id)
  }

  /**
   * Applies a partial update to a task.
   *
   * Only the fields present in `input` are written, and only those whose value actually
   * differs: a no-op update must not bump `updated_at`, or "last touched" stops meaning
   * anything in the Heatmap.
   *
   * @param id Task UUID.
   * @param input Validated fields to change.
   * @returns The stored task after the update.
   * @throws AppError `TASK_NOT_FOUND`, `TASK_INVALID_TRANSITION` or `FOCUS_ALREADY_SET`.
   */
  update(id: string, input: UpdateTaskInput): Task {
    const current = this.findById(id)
    const now = toAuditTimestamp()

    // Re-requesting the status a task already has is a no-op, not a transition. A user
    // clicking "en curso" on the task that is already running must not see an error,
    // and the machine has no self-transitions to validate it against.
    const statusChanged = input.status !== undefined && input.status !== current.status

    if (statusChanged) {
      assertStatusTransition(current, input.status as TaskStatus)
    }

    const content = definedOnly(input)

    // The timestamps are deliberately left out of this first pass. `updatedAt` is
    // generated here, so including it would make every update look like a change and
    // turn a no-op save into a write — which would make "last touched" meaningless in
    // the Heatmap.
    const candidate: Task = {
      ...current,
      ...content,
      status: input.status ?? current.status
    }

    if (content.rruleFreq !== undefined) {
      Object.assign(candidate, normalizeRecurrence(content as RecurrenceInput))
    }

    if (statusChanged && candidate.status === 'in_progress') {
      assertFocusAvailable(candidate, this.findFocusHolder(candidate.taskDate, current.id))
    } else if (candidate.taskDate !== current.taskDate && candidate.status === 'in_progress') {
      // Dragging the focused task onto a day that already has one is the same collision
      // as two tasks claiming the focus, reached by a different route.
      assertFocusAvailable(candidate, this.findFocusHolder(candidate.taskDate, current.id))
    }

    const changed = diffTaskForUpdate(current, candidate)

    if (Object.keys(changed).length === 0) {
      return current
    }

    changed.updatedAt = now
    changed.completedAt = resolveCompletedAt(
      current.completedAt,
      statusChanged ? input.status : undefined,
      now
    )

    this.writeUpdate(id, changed)

    return this.findById(id)
  }

  /**
   * Deletes a task.
   *
   * `task_tags` rows go with it through `ON DELETE CASCADE`, but only while
   * `PRAGMA foreign_keys = ON` — a per-connection setting SQLite does not persist. A
   * handle opened through `openDatabase` has it on.
   *
   * @param id Task UUID.
   * @returns True when a row was removed, false when the id did not exist.
   */
  delete(id: string): boolean {
    const result = this.database.prepare('DELETE FROM tasks WHERE id = ?').run(id)

    return result.changes > 0
  }

  /**
   * Counts the tasks of a day. Cheap enough to call on every render of the summary bar.
   *
   * @param taskDate Local calendar day as `YYYY-MM-DD`.
   * @returns The number of tasks stored for that day.
   */
  countByDate(taskDate: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS total FROM tasks WHERE task_date = ?')
      .get(taskDate) as { total: number }

    return row.total
  }

  /**
   * Runs `work` inside a SQLite transaction.
   *
   * Exposed so the IPC layer can group several repository calls into one atomic unit
   * without reaching for the `Database` handle itself.
   *
   * @param work Unit of work.
   * @returns Whatever `work` returned.
   */
  transaction<T>(work: () => T): T {
    return this.database.transaction(work)()
  }

  private writeUpdate(id: string, changed: Partial<Omit<Task, 'id' | 'createdAt'>>): void {
    const assignments: string[] = []
    const parameters: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(changed)) {
      if (!isWritableField(key)) {
        throw new Error(`Task field is not writable: ${key}`)
      }

      // The column name comes from a compile-time constant and the value from a named
      // parameter. Neither is ever interpolated as text into the statement.
      assignments.push(`${COLUMN_BY_FIELD[key]} = @${key}`)
      parameters[key] = value
    }

    this.database
      .prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = @id`)
      .run({ ...parameters, id })
  }
}

/**
 * Decides the new `completed_at` value.
 *
 * `completed_at` is stamped the first time a task reaches `done` and cleared the moment
 * it leaves. Stamping once means a `done → cancelled → done` round trip keeps the
 * original completion time, which is the honest one.
 *
 * @param current Stored completion timestamp.
 * @param nextStatus Requested status, or `undefined` when the update does not touch it.
 * @param now Timestamp to stamp.
 * @returns The value to persist.
 */
function resolveCompletedAt(
  current: string | null,
  nextStatus: TaskStatus | undefined,
  now: string
): string | null {
  if (nextStatus === undefined) {
    return current
  }

  return nextStatus === 'done' ? (current ?? now) : null
}

/** Strips `undefined` keys so a partial update never writes `undefined` into a column. */
function definedOnly(input: Partial<NewTaskInput>): Partial<NewTaskInput> {
  const result: Partial<NewTaskInput> = {}

  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) {
      Object.assign(result, { [key]: value })
    }
  }

  return result
}

/** Serialises the weekday list to the CSV the schema stores. */
function toRecurrenceColumns(recurrence: RecurrenceInput): Record<string, unknown> {
  return {
    rruleFreq: recurrence.rruleFreq,
    rruleInterval: recurrence.rruleInterval,
    rruleDays: recurrence.rruleDays === null ? null : recurrence.rruleDays.join(','),
    rruleUntil: recurrence.rruleUntil,
    rruleFrom: recurrence.rruleFrom
  }
}

/** Maps a `tasks` row onto the domain model. */
function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    title: row.title,
    notes: row.notes,
    taskDate: row.task_date,
    status: row.status as TaskStatus,
    startMin: row.start_min,
    endMin: row.end_min,
    estimateMin: row.estimate_min,
    color: row.color,
    rruleFreq: row.rrule_freq as RruleFreq,
    rruleInterval: row.rrule_interval,
    rruleDays: row.rrule_days === null ? null : row.rrule_days.split(',').map(Number),
    rruleUntil: row.rrule_until,
    rruleFrom: row.rrule_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at
  }
}
