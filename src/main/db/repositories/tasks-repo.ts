import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { buildLikePattern, buildSearchText } from '../../core/search'
import type { TagsRepository } from './tags-repo'
import { AppError, APP_ERROR_MESSAGES } from '../../core/errors'
import { toAuditTimestamp } from '../../core/datetime'
import { occursOn } from '../../core/recurrence'
import { addDays } from '../../core/date-arith'
import type { StatsTotals } from '../../core/stats'
import type { TransferTask } from '../../core/transfer'
import { daysBetween, startOfWeek } from '../../core/date-arith'
import {
  diffTaskForUpdate,
  WRITABLE_TASK_FIELDS,
  type DaySummary,
  type RruleFreq,
  type Task,
  type TaskStatus,
  type WritableTaskField
} from '../../core/task'
import {
  assertFocusAvailable,
  assertOriginIsFirstOccurrence,
  assertStatusTransition,
  assertTimeRange,
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
  started_at: string | null
  completed_at: string | null
  /** Identity of the series this row belongs to, or `null` for a one-off. Added by `0004`. */
  series_id: string | null
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
  /** Tag names as typed; normalised by the tags repository. */
  tags: string[]
}

/** Fields accepted when creating a task: the content plus its recurrence rule. */
export type NewTaskInput = CreateTaskInput & RecurrenceInput

/** A tag filter set to apply to a search. Every field is optional and means "no filter". */
export interface TaskSearchFilter {
  /** Text looked for in the title and notes; folded before matching. */
  query?: string
  /** Restrict to these statuses. */
  statuses?: TaskStatus[]
  /** Restrict to tasks carrying **any** of these tags. */
  tagIds?: string[]
  /** Maximum rows to return. */
  limit?: number
}

/** A search result, with the real total even when the rows were cut short. */
export interface TaskSearchResult {
  /** The matching rows, newest day first. */
  tasks: Task[]
  /** How many rows matched in total. */
  total: number
  /** True when `total` exceeds `tasks.length`. */
  truncated: boolean
}

/**
 * Fields a partial update may touch. Omitted keys keep their stored value.
 *
 * `status` is here because changing status is an update; the state machine is enforced
 * in {@link TasksRepository.update}.
 */
export interface UpdateTaskInput extends Partial<NewTaskInput> {
  status?: TaskStatus
}

/** Rows a search returns when the caller does not say. */
const DEFAULT_SEARCH_LIMIT = 200

/** Hard ceiling, mirroring MAX_SEARCH_RESULTS in the contract. */
const MAX_SEARCH_LIMIT = 500

/** Column list shared by every read, kept in one place so reads cannot drift. */
const TASK_COLUMNS = `
  id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
  rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
  created_at, updated_at, started_at, completed_at, series_id
`.trim()

/** Shape of an already-grouped `GROUP BY task_date` row. `SUM` yields numbers, never null. */
interface DaySummaryRow {
  date: string
  pending: number
  in_progress: number
  done: number
  cancelled: number
  estimate_min: number
  real_seconds: number
  unmeasured_done: number
}

/**
 * Converts one grouped row into the domain summary.
 *
 * `total` deliberately excludes `cancelled`: the Month view's ring and the Heatmap's amber both
 * ask how much work a day held, and work nobody chose to do was never on the board.
 */
function toDaySummary(row: DaySummaryRow): DaySummary {
  return {
    date: row.date,
    total: row.pending + row.in_progress + row.done,
    done: row.done,
    inProgress: row.in_progress,
    pending: row.pending,
    cancelled: row.cancelled,
    estimateMin: row.estimate_min,
    realMin: Math.round(row.real_seconds / 60),
    unmeasuredDone: row.unmeasured_done
  }
}

/**
 * Maps a domain field name to its column name.
 *
 * The only place where a field name becomes SQL text, which is what keeps
 * {@link TasksRepository.writeUpdate} free of unvalidated identifiers. Typed as a total
 * `Record` over the writable fields: adding a `Task` field without a mapping here is a
 * compile error rather than a column that silently never gets written.
 */
const COLUMN_BY_FIELD: Readonly<Record<WritableTaskField, string>> = {
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
  updatedAt: 'updated_at',
  startedAt: 'started_at',
  completedAt: 'completed_at'
}

/** Narrows an arbitrary key to the set of columns an update may write. */
function isWritableField(key: string): key is WritableTaskField {
  return (WRITABLE_TASK_FIELDS as readonly string[]).includes(key)
}

/**
 * A repository bound to one open database handle.
 *
 * Created once at startup and passed to the IPC handlers. Holds no state beyond the
 * handle, so it is safe to share and trivially testable against `:memory:`.
 */
export class TasksRepository {
  private readonly database: Database.Database
  private readonly tags: TagsRepository

  /**
   * @param database An open database handle.
   * @param tags Repository used to read and write a task's tags. Passed in rather than
   *   built here so the IPC layer can hand the same instance to `tag:list`, and the two
   *   can never disagree about what a tag is.
   */
  constructor(database: Database.Database, tags: TagsRepository) {
    this.database = database
    this.tags = tags
  }

  /**
   * Materialises the occurrences due in an inclusive range, inside one transaction.
   *
   * ADR-004 chose lazy materialisation over an expanded row per occurrence, so this is where a
   * series turns into real rows. It runs from `listByDate` and `listByRange` because those are
   * the operations the user triggers by opening a day: splitting it into a separate channel
   * would leave a window in which the Week view counts a series the Day view has not
   * materialised yet, and the two would disagree about the same week.
   *
   * Three layers keep an occurrence from being written twice, and the transaction is only the
   * first of them: the engine decides whether the day is due, `idx_tasks_occurrence` rejects a
   * second row for the same `(rrule_from, task_date)`, and the transaction means a crash
   * between two inserts leaves a whole series rather than a prefix of one.
   *
   * @param fromDate First day of the range to materialise.
   * @param toDate Last day of the range, inclusive.
   */
  materializeRange(fromDate: string, toDate: string): void {
    if (fromDate > toDate) {
      return
    }

    const insert = this.database.transaction(() => {
      // Only the origin row can start a series. Occurrences carry the series' `rrule_from`
      // too, so selecting on `task_date = rrule_from` keeps them from being treated as
      // series of their own and multiplying the work on every read.
      const series = this.database
        .prepare(
          `SELECT ${TASK_COLUMNS}
             FROM tasks
            WHERE rrule_freq <> 'none'
              AND series_id = id
              AND rrule_from <= ?
              AND (rrule_until IS NULL OR rrule_until >= ?)
            ORDER BY rrule_from ASC`
        )
        .all(toDate, fromDate) as TaskRow[]

      for (const row of series) {
        const origin = toTask(row)

        for (let day = fromDate; day <= toDate; day = addDays(day, 1)) {
          if (!occursOn(origin, day)) {
            continue
          }

          this.insertOccurrence(origin, day)
        }
      }
    })

    insert()
  }

  /**
   * Writes one occurrence of a series on a day, if it is not there yet.
   *
   * The existence check is the cheap guard for the common case — a day read twice — and the
   * unique index is what closes the race when two reads overlap.
   *
   * @param origin The series row.
   * @param taskDate The day the occurrence belongs to.
   */
  private insertOccurrence(origin: Task, taskDate: string): void {
    const existing = this.database
      .prepare('SELECT 1 AS present FROM tasks WHERE series_id = ? AND task_date = ?')
      .get(origin.id, taskDate)

    if (existing !== undefined) {
      return
    }

    const now = toAuditTimestamp()
    const id = randomUUID()
    // `toTask` maps one row and knows nothing of `task_tags`, so the series' tags are read
    // separately. Without this an occurrence materialises unlabelled, and a sidebar filtered
    // by a tag quietly stops showing the series it was filtering.
    const originTags = this.tags
      .listForTask(origin.id)
      .map((tag) => tag.name)

    // An occurrence is new work nobody has done yet: `pending`, with no `started_at` and no
    // `completed_at`. Copying the series' status would paint the heatmap green for days
    // nobody worked, and `done` is terminal (ADR-014), so such a row could never be reopened.
    this.database
      .prepare(
        `INSERT INTO tasks (
           id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
           rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
           created_at, updated_at, started_at, completed_at, search_text, series_id
         ) VALUES (
           @id, @title, @notes, @taskDate, 'pending', @startMin, @endMin, @estimateMin, @color,
           @rruleFreq, @rruleInterval, @rruleDays, @rruleUntil, @rruleFrom,
           @createdAt, @createdAt, NULL, NULL, @searchText, @seriesId
         )`
      )
      .run({
        id,
        title: origin.title,
        notes: origin.notes,
        taskDate,
        startMin: origin.startMin,
        endMin: origin.endMin,
        estimateMin: origin.estimateMin,
        color: origin.color,
        rruleFreq: origin.rruleFreq,
        rruleInterval: origin.rruleInterval,
        rruleDays: origin.rruleDays === null ? null : origin.rruleDays.join(','),
        rruleUntil: origin.rruleUntil,
        rruleFrom: origin.rruleFrom,
        // The occurrence belongs to the series' identity, which is the origin row's id.
        seriesId: origin.id,
        createdAt: now,
        searchText: buildSearchText(origin.title, origin.notes)
      })

    if (originTags.length > 0) {
      this.tags.setForTask(id, originTags)
    }

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
    this.materializeRange(taskDate, taskDate)

    const rows = this.database
      .prepare(
        `SELECT ${TASK_COLUMNS}
           FROM tasks
          WHERE task_date = ?
          ORDER BY (start_min IS NULL), start_min ASC, created_at ASC`
      )
      .all(taskDate) as TaskRow[]

    return this.attachTags(rows.map(toTask))
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

    this.materializeRange(fromDate, toDate)

    const rows = this.database
      .prepare(
        `SELECT ${TASK_COLUMNS}
           FROM tasks
          WHERE task_date BETWEEN ? AND ?
          ORDER BY task_date ASC, (start_min IS NULL), start_min ASC, created_at ASC`
      )
      .all(fromDate, toDate) as TaskRow[]

    return this.attachTags(rows.map(toTask))
  }

  /**
   * Returns one `DaySummary` per calendar day in the range that holds work.
   *
   * One statement, one pass, `GROUP BY task_date`. The three Fase 4 views need counts and sums,
   * not tasks, so nothing here materialises a `TaskRow` and nothing leaves the database until a
   * day has already been collapsed to a single line.
   *
   * Real minutes are summed in *seconds* and converted once, here. Rounding each task to whole
   * minutes before summing would silently discard up to 59 seconds per task, which on a day of
   * short tasks is most of the day.
   *
   * @param fromDate First day of the range, `YYYY-MM-DD`, inclusive.
   * @param toDate Last day of the range, `YYYY-MM-DD`, inclusive.
   * @returns One summary per day that has work, ordered by date. Days with nothing are omitted,
   *   and an empty range yields an empty array.
   * @throws AppError `VALIDATION_FAILED` when the range is inverted.
   */
  summarizeRange(fromDate: string, toDate: string): DaySummary[] {
    if (fromDate > toDate) {
      throw new AppError(
        'VALIDATION_FAILED',
        'El rango de fechas está invertido: la fecha inicial es posterior a la final.',
        { field: 'fromDate' }
      )
    }

    this.materializeRange(fromDate, toDate)

    const rows = this.database
      .prepare(
        `SELECT
           task_date AS date,
           SUM(CASE WHEN status = 'pending'     THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
           SUM(CASE WHEN status = 'done'        THEN 1 ELSE 0 END) AS done,
           SUM(CASE WHEN status = 'cancelled'   THEN 1 ELSE 0 END) AS cancelled,
           SUM(CASE WHEN status <> 'cancelled'
                    THEN COALESCE(estimate_min, 0) ELSE 0 END) AS estimate_min,
           SUM(CASE WHEN status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL
                    THEN strftime('%s', completed_at) - strftime('%s', started_at)
                    ELSE 0 END) AS real_seconds,
           SUM(CASE WHEN status = 'done' AND (started_at IS NULL OR completed_at IS NULL)
                    THEN 1 ELSE 0 END) AS unmeasured_done
         FROM tasks
        WHERE task_date BETWEEN ? AND ?
        GROUP BY task_date
        ORDER BY task_date ASC`
      )
      .all(fromDate, toDate) as DaySummaryRow[]

    return rows.map(toDaySummary)
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

    return this.tags
      .listForTask(id)
      .reduce<Task>((task, tag) => ({ ...task, tags: [...task.tags, tag.name] }), toTask(row))
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
    // A recurring task's row is its first occurrence, so a series created without an explicit
    // origin starts on the day it was created. Without this the origin stayed `null` and the
    // `CHECK (rrule_freq = 'none' OR rrule_from IS NOT NULL)` constraint rejected the insert
    // with a raw SqliteError — a database message, on a perfectly reasonable request.
    const recurrence = normalizeRecurrence({
      ...input,
      rruleFrom: input.rruleFreq === 'none' ? null : (input.rruleFrom ?? input.taskDate)
    })

    assertOriginIsFirstOccurrence(input.taskDate, recurrence)

    this.database
      .prepare(
        `INSERT INTO tasks (
           id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
           rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
           created_at, updated_at, started_at, completed_at, search_text, series_id
         ) VALUES (
           @id, @title, @notes, @taskDate, 'pending', @startMin, @endMin, @estimateMin, @color,
           @rruleFreq, @rruleInterval, @rruleDays, @rruleUntil, @rruleFrom,
           @createdAt, @createdAt, NULL, NULL, @searchText, @seriesId
         )`
      )
      .run({
        id,
        // A series is its own first occurrence, so it claims its own id. Two series created
        // on the same day are then two ids rather than two rows fighting over one origin
        // date — which `0004` exists to allow and `0001`'s index forbade.
        seriesId: recurrence.rruleFreq === 'none' ? null : id,
        title: input.title,
        notes: input.notes,
        taskDate: input.taskDate,
        startMin: input.startMin,
        endMin: input.endMin,
        estimateMin: input.estimateMin,
        color: input.color,
        ...toRecurrenceColumns(recurrence),
        createdAt: now,
        updatedAt: now,
        searchText: buildSearchText(input.title, input.notes)
      })

    this.tags.setForTask(id, input.tags)

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

    if (
      content.rruleFreq !== undefined ||
      content.rruleDays !== undefined ||
      content.rruleUntil !== undefined
    ) {
      // Merged with the stored rule before validating: sending only `rruleDays` must
      // not reach the validator as a partial object, or the fields that were omitted
      // read as `undefined` and fail a check that has nothing to do with the change.
      //
      // The merge tests `!== undefined`, not truthiness. `??` read an explicit `null` as
      // "absent", which made `rruleDays: null` and `rruleUntil: null` silently keep the old
      // value: a series could gain a weekday list and an end date but never lose either.
      const merged = normalizeRecurrence({
        rruleFreq: content.rruleFreq ?? current.rruleFreq,
        rruleInterval: content.rruleInterval ?? current.rruleInterval,
        rruleDays: content.rruleDays !== undefined ? content.rruleDays : current.rruleDays,
        rruleUntil: content.rruleUntil !== undefined ? content.rruleUntil : current.rruleUntil,
        // A recurring task's row is its first occurrence, so clearing the origin on a
        // recurring task restores it to the task's own day rather than leaving the series
        // without one — the column's CHECK constraint rejects that outright.
        rruleFrom:
          current.rruleFreq !== 'none' && content.rruleFrom === null
            ? candidate.taskDate
            : (content.rruleFrom ?? current.rruleFrom)
      })

      Object.assign(candidate, merged)
    }

    // Checked against the merged state, not the payload. An update that sends only
    // `rruleDays` carries no `taskDate` at all, and comparing `undefined` against the origin
    // would reject every edit to a weekly series.
    assertOriginIsFirstOccurrence(candidate.taskDate, candidate)

    // The merged range is validated here, not at the IPC boundary, because only this
    // function can see both ends: an update carrying just `endMin` has to be checked
    // against the `startMin` already stored.
    assertTimeRange(candidate.startMin, candidate.endMin)

    if (statusChanged && candidate.status === 'in_progress') {
      assertFocusAvailable(candidate, this.findFocusHolder(candidate.taskDate, current.id))
    } else if (candidate.taskDate !== current.taskDate && candidate.status === 'in_progress') {
      // Dragging the focused task onto a day that already has one is the same collision
      // as two tasks claiming the focus, reached by a different route.
      assertFocusAvailable(candidate, this.findFocusHolder(candidate.taskDate, current.id))
    }

    const changed = diffTaskForUpdate(current, candidate)

    // Tags live in their own table, so an update that only changes them produces an empty
    // `changed` and would fall through this shortcut without ever being applied. They are
    // therefore written before it, and the shortcut only governs the `tasks` row.
    if (Object.keys(changed).length === 0) {
      if (input.tags !== undefined) {
        this.tags.setForTask(id, input.tags)
      }

      return this.findById(id)
    }

    changed.updatedAt = now
    changed.completedAt = resolveCompletedAt(
      current.completedAt,
      statusChanged ? input.status : undefined,
      now
    )
    changed.startedAt = resolveStartedAt(
      current.startedAt,
      statusChanged ? input.status : undefined,
      now
    )

    // One unit of work: the row, its tags and the derived search text either all land or
    // none do. Three independent statements would leave the task's tags replaced while its
    // row stayed stale if the process died between them — and a task whose tags say one
    // thing and whose row says another is exactly the kind of drift nobody notices until
    // it is expensive.
    this.transaction(() => {
      this.writeUpdate(id, changed)

      // `search_text` is derived from title and notes, so it is never accepted from the
      // caller: recomputing it here is what keeps the two from drifting.
      this.database
        .prepare('UPDATE tasks SET search_text = ? WHERE id = ?')
        .run(buildSearchText(candidate.title, candidate.notes), id)

      if (input.tags !== undefined) {
        this.tags.setForTask(id, input.tags)
      }
    })

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
   * Searches the whole history.
   *
   * Text matching runs against `search_text`, the folded copy built on write, because
   * SQLite's `LIKE` ignores ASCII case and nothing at all — accents make a comparison the
   * user would call broken. Filtering by tag and status stays in SQL.
   *
   * The `IN (...)` lists are built from `?` placeholders and bound parameters, never from
   * interpolated values, so a tag id cannot reach the statement as SQL.
   *
   * @param filter Query, statuses, tag ids and limit. Every field is optional.
   * @returns The matching rows plus the real total.
   */
  search(filter: TaskSearchFilter): TaskSearchResult {
    const clauses: string[] = []
    const parameters: unknown[] = []

    const query = (filter.query ?? '').trim()

    if (query.length > 0) {
      clauses.push("search_text LIKE ? ESCAPE '\\'")
      parameters.push(buildLikePattern(query))
    }

    const statuses = filter.statuses ?? []

    if (statuses.length > 0) {
      clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`)
      parameters.push(...statuses)
    }

    const tagIds = filter.tagIds ?? []

    if (tagIds.length > 0) {
      // "Any of these tags", which is what a filter sidebar means: selecting two tags
      // widens the result rather than narrowing it to tasks carrying both.
      clauses.push(
        `EXISTS (
           SELECT 1 FROM task_tags
            WHERE task_tags.task_id = tasks.id
              AND task_tags.tag_id IN (${tagIds.map(() => '?').join(', ')})
         )`
      )
      parameters.push(...tagIds)
    }

    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join('\n              AND ')}`
    const limit = Math.min(filter.limit ?? DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT)

    const total = (
      this.database.prepare(`SELECT COUNT(*) AS total FROM tasks ${where}`).get(...parameters) as {
        total: number
      }
    ).total

    const rows = this.database
      .prepare(
        `SELECT ${TASK_COLUMNS}
           FROM tasks
           ${where}
          ORDER BY task_date DESC, (start_min IS NULL), start_min ASC, created_at DESC
          LIMIT ?`
      )
      .all(...parameters, limit) as TaskRow[]

    return {
      tasks: this.attachTags(rows.map(toTask)),
      total,
      truncated: total > rows.length
    }
  }

  /**
   * Loads the tags of many tasks in one query.
   *
   * One query for the whole page rather than one per row: a day with thirty tasks would
   * otherwise cost thirty round trips through `listForTask`.
   *
   * @param tasks Tasks to enrich, in the order they should come back.
   * @returns The same tasks, each carrying its tags alphabetically.
   */
  private attachTags(tasks: Task[]): Task[] {
    if (tasks.length === 0) {
      return tasks
    }

    const rows = this.database
      .prepare(
        `SELECT tt.task_id, t.name
           FROM task_tags tt
           JOIN tags t ON t.id = tt.tag_id
          WHERE tt.task_id IN (${tasks.map(() => '?').join(', ')})
          ORDER BY t.name ASC`
      )
      .all(...tasks.map((task) => task.id)) as { task_id: string; name: string }[]

    const byTask = new Map<string, string[]>()

    for (const row of rows) {
      const names = byTask.get(row.task_id)

      if (names === undefined) {
        byTask.set(row.task_id, [row.name])
      } else {
        names.push(row.name)
      }
    }

    return tasks.map((task) => ({ ...task, tags: byTask.get(task.id) ?? [] }))
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
   * The numbers the Statistics view shows.
   *
   * Two statements, both aggregating. The first answers "which days hold completed work",
   * the second answers the totals, and neither returns a task. That split is what keeps a
   * streak — which is a question about *consecutive* days — cheap: SQL would have to walk the
   * whole history for every row comparison, while the set it returns is at most one entry per
   * day with work in it.
   *
   * Real minutes come from the two timestamps the stopwatch already writes (ADR-023). There
   * is no `completed_min` column, and adding one would store a second copy of a number that
   * could then disagree with the row it came from.
   *
   * @param today The day to anchor "today's" numbers and the current streak on.
   * @returns Completed days, totals and the week average.
   */
  stats(today: string): StatsTotals {
    const weekStart = addDays(startOfWeek(today), 0)

    // Bounded by the week: materialises a week of recurring series, nothing older.
    this.materializeRange(weekStart, today)

    const completed = this.database
      .prepare(
        `SELECT DISTINCT task_date AS date
           FROM tasks
          WHERE status = 'done'`
      )
      .all() as { date: string }[]

    const totals = this.database
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
           COALESCE(SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END), 0) AS in_progress,
           COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN COALESCE(estimate_min, 0) ELSE 0 END), 0) AS estimate_min,
           COALESCE(SUM(CASE WHEN status = 'done' AND started_at IS NOT NULL AND completed_at IS NOT NULL
                            THEN strftime('%s', completed_at) - strftime('%s', started_at)
                            ELSE 0 END), 0) AS real_seconds,
           COALESCE(SUM(CASE WHEN status = 'done' AND (started_at IS NULL OR completed_at IS NULL)
                            THEN 1 ELSE 0 END), 0) AS unmeasured_done
         FROM tasks`
      )
      .get() as {
      done: number
      in_progress: number
      estimate_min: number
      real_seconds: number
      unmeasured_done: number
    }

    const week = this.database
      .prepare(
        `SELECT
           COUNT(DISTINCT CASE WHEN status = 'done' THEN task_date END) AS days_with_work,
           COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done
         FROM tasks
        WHERE task_date BETWEEN ? AND ?`
      )
      .get(weekStart, today) as { days_with_work: number; done: number }

    return {
      today,
      totalDone: totals.done,
      totalInProgress: totals.in_progress,
      estimateMin: totals.estimate_min,
      realMin: Math.round(totals.real_seconds / 60),
      unmeasuredDone: totals.unmeasured_done,
      weekFrom: weekStart,
      weekDone: week.done,
      weekDaysElapsed: daysBetween(weekStart, today) + 1,
      completedDays: completed.map((row) => row.date)
    }
  }

  /**
   * Every task in the diary, oldest first, as the transfer format.
   *
   * The export reads tags per row: one ordered scan for the tasks and one small query each
   * for its tags. At the scale of a personal diary that is thousands of tiny prepared
   * statements, which is the right trade against loading the whole `task_tags` table into
   * memory to index it in JavaScript.
   *
   * @returns Every task, ready to serialise.
   */
  exportAll(): TransferTask[] {
    const rows = this.database
      .prepare(
        `SELECT ${TASK_COLUMNS}
           FROM tasks
          ORDER BY task_date ASC, (start_min IS NULL), start_min ASC, created_at ASC`
      )
      .all() as TaskRow[]

    return rows.map((row) => {
      const task = toTask(row)

      return {
        title: task.title,
        notes: task.notes,
        taskDate: task.taskDate,
        status: task.status,
        startMin: task.startMin,
        endMin: task.endMin,
        estimateMin: task.estimateMin,
        color: task.color,
        tags: this.tags.listForTask(task.id).map((tag) => tag.name),
        rruleFreq: task.rruleFreq,
        rruleInterval: task.rruleInterval,
        rruleDays: task.rruleDays,
        rruleUntil: task.rruleUntil,
        rruleFrom: task.rruleFrom,
        startedAt: task.startedAt,
        completedAt: task.completedAt
      }
    })
  }

  /**
   * Inserts a batch of transferred tasks, or none of them.
   *
   * One transaction around the whole batch. A partial import is the worst outcome available
   * here: the user believes their diary came back, half of it did, and nothing records which
   * half — so the gap surfaces weeks later with no way to tell what is missing.
   *
   * @param tasks Tasks that already passed validation.
   * @returns How many were inserted.
   * @throws AppError `DATABASE_ERROR` when any insert fails. Nothing is left behind.
   */
  importMany(tasks: TransferTask[]): number {
    return this.transaction(() => {
      let inserted = 0

      for (const task of tasks) {
        const id = randomUUID()
        const now = toAuditTimestamp()

        this.database
          .prepare(
            `INSERT INTO tasks (
               id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
               rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
               created_at, updated_at, started_at, completed_at, search_text, series_id
             ) VALUES (
               @id, @title, @notes, @taskDate, @status, @startMin, @endMin, @estimateMin, @color,
               @rruleFreq, @rruleInterval, @rruleDays, @rruleUntil, @rruleFrom,
               @createdAt, @createdAt, @startedAt, @completedAt, @searchText, @seriesId
             )`
          )
          .run({
            id,
            // A transferred series keeps its own identity rather than joining an existing one.
            // The file describes a diary, and merging two of them is a decision nobody asked
            // for. `null` for a one-off keeps the unique index out of the way entirely.
            seriesId: task.rruleFreq === 'none' ? null : id,
            title: task.title,
            notes: task.notes,
            taskDate: task.taskDate,
            status: task.status,
            startMin: task.startMin,
            endMin: task.endMin,
            estimateMin: task.estimateMin,
            color: task.color,
            rruleFreq: task.rruleFreq,
            rruleInterval: task.rruleInterval,
            rruleDays: task.rruleDays === null ? null : task.rruleDays.join(','),
            rruleUntil: task.rruleUntil,
            rruleFrom: task.rruleFrom,
            // Timestamps travel verbatim. Re-stamping them with "now" would make every
            // imported task look like it was created and finished just now, quietly rewriting
            // the history the export exists to preserve.
            startedAt: task.startedAt,
            completedAt: task.completedAt,
            createdAt: task.startedAt ?? task.completedAt ?? now,
            searchText: buildSearchText(task.title, task.notes)
          })

        if (task.tags.length > 0) {
          this.tags.setForTask(id, task.tags)
        }

        inserted += 1
      }

      return inserted
    })
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
      // `rruleDays` is a `number[]` in the domain and CSV in the column, so it is serialised
      // here exactly as `toRecurrenceColumns` serialises it on the way in. Binding it raw
      // throws `TypeError: SQLite3 can only bind numbers, strings, bigints, buffers, and
      // null` — which is how editing the weekdays of a weekly series used to crash the main
      // process. Create and insertOccurrence both got this right; only the writer forgot.
      parameters[key] = key === 'rruleDays' && Array.isArray(value) ? value.join(',') : value
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

/**
 * Decides the new `started_at` value.
 *
 * Stamped the moment a task becomes `in_progress` and cleared the moment it stops being
 * one. A task that returns to `in_progress` later gets a fresh start: the previous
 * stretch of work genuinely ended, and pretending otherwise would inflate the day.
 *
 * `updated_at` cannot serve this purpose — editing a running task's title would reset
 * the stopwatch, which is exactly the bug `0002_started_at` exists to prevent.
 *
 * @param current Stored start timestamp.
 * @param nextStatus Requested status, or `undefined` when the update does not touch it.
 * @param now Timestamp to stamp.
 * @returns The value to persist.
 */
function resolveStartedAt(
  current: string | null,
  nextStatus: TaskStatus | undefined,
  now: string
): string | null {
  if (nextStatus === undefined) {
    return current
  }

  return nextStatus === 'in_progress' ? now : null
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

/**
 * Maps a `tasks` row onto the domain model.
 *
 * The two enum casts are safe by construction, not by trust: `0001_init.sql` declares
 * `CHECK (status IN (...))` and `CHECK (rrule_freq IN (...))`, so a value outside the
 * union cannot be stored in the first place. The casts read as unchecked to a reviewer
 * because the guarantee lives in the schema rather than here — this comment is the link.
 */
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
    // Filled in by `attachTags`; a single row read carries none until it is looked up.
    tags: [],
    rruleFreq: row.rrule_freq as RruleFreq,
    rruleInterval: row.rrule_interval,
    rruleDays: row.rrule_days === null ? null : row.rrule_days.split(',').map(Number),
    rruleUntil: row.rrule_until,
    rruleFrom: row.rrule_from,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }
}
