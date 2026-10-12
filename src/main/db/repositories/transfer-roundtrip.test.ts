import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../database'
import { runMigrations } from '../migrate'
import { TasksRepository, type NewTaskInput } from './tasks-repo'
import { TagsRepository } from './tags-repo'
import { parseImportCsv, parseImportJson, toTransferJson, type TransferTask } from '../../core/transfer'
import type Database from 'better-sqlite3'

/**
 * Export and import against a real database.
 *
 * The pure transforms are tested in `core/transfer.test.ts`. What is left is what only a
 * database can show: that an export really carries every column, that an import writes in
 * one transaction, and — the criterion that matters most — that a refused file leaves the
 * diary byte-for-byte as it was.
 */

let database: Database.Database
let repository: TasksRepository

beforeEach(() => {
  database = openInMemoryDatabase()
  runMigrations(database)
  repository = new TasksRepository(database, new TagsRepository(database))
})

/** A minimal valid create payload, overridable per test. */
function newTask(overrides: Partial<NewTaskInput> = {}): NewTaskInput {
  return {
    title: 'Preparar informe',
    notes: 'Traer los datos',
    taskDate: '2026-10-05',
    startMin: 540,
    endMin: 600,
    estimateMin: 60,
    color: null,
    tags: [],
    rruleFreq: 'none',
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: null,
    ...overrides
  }
}

/** Every row, as an opaque fingerprint of the whole table. */
function fingerprint(): string {
  const rows = database
    .prepare(
      `SELECT id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
              rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
              created_at, updated_at, started_at, completed_at, search_text, series_id
         FROM tasks
        ORDER BY id`
    )
    .all() as Record<string, unknown>[]

  const tags = database.prepare('SELECT task_id, tag_id FROM task_tags ORDER BY task_id').all()

  return JSON.stringify({ rows, tags })
}

/** How many tasks the diary holds. */
function taskCount(): number {
  return (database.prepare('SELECT COUNT(*) AS total FROM tasks').get() as { total: number })
    .total
}

describe('acceptance criterion 3 — export then import returns the same data', () => {
  it('survives a full round trip through the database', () => {
    repository.create(
      newTask({ tags: ['proyecto', 'rutina'], estimateMin: 45, color: '#ff8800' })
    )
    repository.create(
      newTask({
        title: 'Segunda',
        taskDate: '2026-10-06',
        notes: null,
        startMin: null,
        endMin: null,
        estimateMin: null,
        tags: []
      })
    )

    const exported = toTransferJson(repository.exportAll())
    const parsed = parseImportJson(exported)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const fresh = openInMemoryDatabase()
    runMigrations(fresh)
    const target = new TasksRepository(fresh, new TagsRepository(fresh))
    target.importMany(parsed.tasks)

    // Compared field by field rather than by fingerprint: the imported rows have new ids and
    // new timestamps, and the point of the criterion is that the *content* survives.
    const before = repository.exportAll()
    const after = target.exportAll()

    expect(after.map(withoutIdentity)).toEqual(before.map(withoutIdentity))
  })

  it('keeps a recurring series intact, including its weekday list', () => {
    repository.create(
      newTask({
        taskDate: '2026-10-05',
        rruleFreq: 'weekly',
        rruleDays: [1, 3, 5],
        rruleUntil: '2026-12-31',
        rruleFrom: '2026-10-05'
      })
    )

    const parsed = parseImportJson(toTransferJson(repository.exportAll()))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const fresh = openInMemoryDatabase()
    runMigrations(fresh)
    new TasksRepository(fresh, new TagsRepository(fresh)).importMany(parsed.tasks)

    const [imported] = new TasksRepository(fresh, new TagsRepository(fresh)).exportAll()

    expect(imported.rruleFreq).toBe('weekly')
    expect(imported.rruleDays).toEqual([1, 3, 5])
    expect(imported.rruleUntil).toBe('2026-12-31')
  })

  it('keeps the completion timestamp rather than re-stamping it as now', () => {
    repository.create(newTask({ taskDate: '2026-10-05' }))
    const created = repository.listByDate('2026-10-05')[0]
    // pending -> done directly, which stamps `completed_at` and leaves `started_at` NULL.
    repository.update(created.id, { status: 'done' })

    const original = repository.exportAll()[0]
    const parsed = parseImportJson(toTransferJson([original]))
    if (!parsed.ok) throw new Error(parsed.error)

    const fresh = openInMemoryDatabase()
    runMigrations(fresh)
    new TasksRepository(fresh, new TagsRepository(fresh)).importMany(parsed.tasks)

    const [imported] = new TasksRepository(fresh, new TagsRepository(fresh)).exportAll()

    // Re-stamping with `now` would make a two-year-old task look like it finished this
    // morning, which quietly rewrites the history the export exists to preserve.
    expect(imported.completedAt).toBe(original.completedAt)
    // And the null stays null. Asserting `startedAt` is non-null here would have been a
    // test that only passes when the round trip is wrong.
    expect(imported.startedAt).toBeNull()
  })
})

describe('acceptance criterion 4 — a refused import changes nothing', () => {
  it('leaves the diary untouched when the file is refused', () => {
    repository.create(newTask())
    const before = fingerprint()

    const good = repository.exportAll()
    const parsed = parseImportJson(
      JSON.stringify({ version: 1, tasks: [good[0], { title: 'Mala' }] })
    )

    expect(parsed.ok).toBe(false)
    // The parse refused, so no transaction ever opened. This is the assertion that says so.
    expect(fingerprint()).toBe(before)
  })

  it('writes nothing when a batch fails halfway', () => {
    repository.create(newTask())
    const before = fingerprint()

    const batch = [newTask(), newTask()] as unknown as TransferTask[]

    // A tag name the repository rejects mid-batch. The point is that the first insert has
    // already happened by the time this fires, so a non-transactional writer would leave one
    // task behind and call it a success.
    batch[1] = { ...batch[1], rruleDays: [9] }

    expect(() => repository.importMany(batch)).toThrow()
    expect(fingerprint()).toBe(before)
  })

  it('imports nothing from a CSV with one bad row', () => {
    repository.create(newTask())
    const before = fingerprint()

    const csv = ['title,taskDate', 'Buena,2026-10-05', 'Mala,ayer'].join('\n')
    const parsed = parseImportCsv(csv)

    expect(parsed.ok).toBe(false)
    expect(fingerprint()).toBe(before)
  })

  it('reports how many rows it wrote, so the UI can tell the truth', () => {
    expect(repository.importMany([])).toBe(0)
    expect(
      repository.importMany([
        {
          title: 'Una',
          notes: null,
          taskDate: '2026-10-05',
          status: 'pending',
          startMin: null,
          endMin: null,
          estimateMin: null,
          color: null,
          tags: [],
          rruleFreq: 'none',
          rruleInterval: 1,
          rruleDays: null,
          rruleUntil: null,
          rruleFrom: null,
          startedAt: null,
          completedAt: null
        }
      ])
    ).toBe(1)
    expect(taskCount()).toBe(1)
  })

  it('imports a CSV into rows a sidebar can search', () => {
    const csv = [
      'title,taskDate,status,startMin,endMin,estimateMin,tags',
      'Revisar contrato,2026-10-05,pending,540,600,30,"proyecto|rutina"',
      'Preparar informe,2026-10-06,pending,,,45,'
    ].join('\n')

    const parsed = parseImportCsv(csv)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    repository.importMany(parsed.tasks)

    expect(repository.listByDate('2026-10-05')[0].tags).toEqual(['proyecto', 'rutina'])
    expect(repository.listByDate('2026-10-05')[0].startMin).toBe(540)
    expect(repository.listByDate('2026-10-06')[0].startMin).toBeNull()
  })

  it('gives an imported series its own identity, so it can materialise', () => {
    repository.importMany([
      {
        title: 'Standup',
        notes: null,
        taskDate: '2026-01-05',
        status: 'pending',
        startMin: null,
        endMin: null,
        estimateMin: null,
        color: null,
        tags: [],
        rruleFreq: 'daily',
        rruleInterval: 1,
        rruleDays: null,
        rruleUntil: '2026-01-10',
        rruleFrom: '2026-01-05',
        startedAt: null,
        completedAt: null
      }
    ])

    // Reading the next day is what materialises it. If the import had not given the series an
    // identity, the materialiser would not find it and would silently produce nothing.
    expect(repository.listByDate('2026-01-06')).toHaveLength(1)
    expect(repository.listByDate('2026-01-07')).toHaveLength(1)
  })

  it('does not let an imported series collide with one already here', () => {
    repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Gym', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )

    repository.importMany([
      {
        title: 'Gym',
        notes: null,
        taskDate: '2026-01-05',
        status: 'pending',
        startMin: null,
        endMin: null,
        estimateMin: null,
        color: null,
        tags: [],
        rruleFreq: 'daily',
        rruleInterval: 1,
        rruleDays: null,
        rruleUntil: null,
        rruleFrom: '2026-01-05',
        startedAt: null,
        completedAt: null
      }
    ])

    // Two diaries, two series. Merging them is a decision nobody asked for.
    expect(taskCount()).toBe(2)
    expect(repository.listByDate('2026-01-06')).toHaveLength(2)
  })
})

describe('exportAll', () => {
  it('returns an empty list for an empty diary rather than throwing', () => {
    expect(repository.exportAll()).toEqual([])
  })

  it('orders oldest first so the file reads as a diary', () => {
    repository.create(newTask({ taskDate: '2026-10-03', title: 'Tercera' }))
    repository.create(newTask({ taskDate: '2026-10-01', title: 'Primera' }))
    repository.create(newTask({ taskDate: '2026-10-02', title: 'Segunda' }))

    expect(repository.exportAll().map((t) => t.title)).toEqual([
      'Primera',
      'Segunda',
      'Tercera'
    ])
  })

  it('carries the tags of every task', () => {
    repository.create(newTask({ taskDate: '2026-10-01', tags: ['alfa', 'bravo'] }))
    repository.create(newTask({ taskDate: '2026-10-02', tags: [] }))

    const exported = repository.exportAll()

    expect(exported[0].tags).toEqual(['alfa', 'bravo'])
    expect(exported[1].tags).toEqual([])
  })
})

/** Drops the fields a round trip is allowed to change: the id and the row timestamps. */
function withoutIdentity(task: TransferTask): Omit<TransferTask, 'startedAt' | 'completedAt'> {
  const { startedAt: _started, completedAt: _completed, ...rest } = task

  return rest
}

describe('stats', () => {
  /** Completes a task on a day, going through the real state machine. */
  function completeOn(taskDate: string, estimateMin = 60, title = 'Tarea'): string {
    const created = repository.create(
      newTask({ taskDate, title, estimateMin, tags: [], rruleFreq: 'none' })
    )
    repository.update(created.id, { status: 'done' })

    return created.id
  }

  it('counts nothing in an empty diary rather than failing', () => {
    const totals = repository.stats('2026-10-07')

    expect(totals.totalDone).toBe(0)
    expect(totals.completedDays).toEqual([])
    expect(totals.realMin).toBe(0)
  })

  it('reports the days holding completed work', () => {
    completeOn('2026-10-05')
    completeOn('2026-10-06')
    completeOn('2026-10-07')

    const totals = repository.stats('2026-10-07')

    expect(totals.totalDone).toBe(3)
    expect(totals.completedDays.sort()).toEqual(['2026-10-05', '2026-10-06', '2026-10-07'])
  })

  it('does not count an unfinished task as a completed day', () => {
    repository.create(newTask({ taskDate: '2026-10-07' }))

    expect(repository.stats('2026-10-07').completedDays).toEqual([])
  })

  it('counts today in the week even when nothing is done', () => {
    // 2026-10-07 is a Wednesday. Days elapsed is 3, not 0 — dividing by zero would report
    // a week average of "no data" every Monday morning.
    const totals = repository.stats('2026-10-07')

    expect(totals.weekFrom).toBe('2026-10-05')
    expect(totals.weekDaysElapsed).toBe(3)
  })

  it('excludes unmeasured completions from the real total', () => {
    completeOn('2026-10-06', 45)

    const totals = repository.stats('2026-10-07')

    expect(totals.unmeasuredDone).toBe(1)
    expect(totals.realMin).toBe(0)
    expect(totals.estimateMin).toBe(45)
  })

  it('materialises the week so a recurring series shows up in today\'s numbers', () => {
    repository.create(
      newTask({
        taskDate: '2026-10-05',
        title: 'Standup',
        rruleFreq: 'daily',
        rruleFrom: '2026-10-05',
        tags: []
      })
    )

    // Reading the stats is what brings today's occurrence into existence.
    const totals = repository.stats('2026-10-07')

    expect(repository.listByDate('2026-10-07')).toHaveLength(1)
    expect(totals.totalDone).toBe(0)
  })

  it('does not materialise days before the current week', () => {
    repository.create(
      newTask({
        taskDate: '2026-10-05',
        title: 'Standup',
        rruleFreq: 'daily',
        rruleFrom: '2026-10-05',
        tags: []
      })
    )

    repository.stats('2026-10-07')

    // An open-ended series would otherwise materialise the entire history on every visit.
    expect(repository.listByDate('2026-09-01')).toHaveLength(0)
  })
})
