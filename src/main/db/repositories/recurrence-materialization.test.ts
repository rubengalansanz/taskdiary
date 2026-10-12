import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../database'
import { runMigrations } from '../migrate'
import { TasksRepository, type NewTaskInput } from './tasks-repo'
import { TagsRepository } from './tags-repo'
import type Database from 'better-sqlite3'

/**
 * Lazy materialisation of recurring occurrences.
 *
 * The acceptance criteria for Fase 5 are precise and all three of them are about this file:
 * a weekly series appears on the right day exactly once, a series whose `until` has passed
 * generates nothing, and the unique index plus the transaction make a duplicate impossible.
 *
 * The duplicate case is the interesting one. Reading a day materialises it, so reading the same
 * day twice is the normal path — not an edge case — and a crash between the SELECT and the
 * INSERT must not leave two rows for one occurrence.
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
    title: 'Revisión semanal',
    notes: null,
    taskDate: '2026-10-05',
    startMin: 9 * 60,
    endMin: 10 * 60,
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

/** Titles on a day, as the Day view would see them. */
function titlesOn(taskDate: string): string[] {
  return repository
    .listByDate(taskDate)
    .map((task) => task.title)
    .sort()
}

/**
 * How many rows one series holds on one day.
 *
 * Keyed by `series_id`, the series' identity. It was once keyed by `rrule_from`, and that is
 * the bug `0004` fixes: an origin date is not a series, so two series born the same day
 * counted as one.
 */
function occurrenceCount(seriesId: string, taskDate: string): number {
  const row = database
    .prepare('SELECT COUNT(*) AS total FROM tasks WHERE series_id = ? AND task_date = ?')
    .get(seriesId, taskDate) as { total: number }

  return row.total
}

describe('acceptance criterion 1 — a weekly series appears exactly once per day', () => {
  it('materialises the occurrence on the day it is due', () => {
    repository.create(
      newTask({ rruleFreq: 'weekly', rruleDays: [1, 3], rruleFrom: '2026-10-05' })
    )

    expect(titlesOn('2026-10-05')).toEqual(['Revisión semanal'])
    expect(titlesOn('2026-10-07')).toEqual(['Revisión semanal'])
    expect(titlesOn('2026-10-06')).toEqual([])
  })

  it('materialises once, however many times the day is read', () => {
    // Reading a day is what materialises it, so re-reading is the normal path rather than an
    // edge case. Ten reads, one row.
    const series = repository.create(
      newTask({ rruleFreq: 'weekly', rruleDays: [1], rruleFrom: '2026-10-05' })
    )

    for (let attempt = 0; attempt < 10; attempt += 1) {
      repository.listByDate('2026-10-05')
    }

    expect(occurrenceCount(series.id, '2026-10-05')).toBe(1)
    expect(titlesOn('2026-10-05')).toEqual(['Revisión semanal'])
  })

  it('materialises each week of the series separately', () => {
    const series = repository.create(
      newTask({ rruleFreq: 'weekly', rruleDays: [1], rruleFrom: '2026-10-05' })
    )

    repository.listByDate('2026-10-05')
    repository.listByDate('2026-10-12')
    repository.listByDate('2026-10-19')

    expect(occurrenceCount(series.id, '2026-10-12')).toBe(1)
    expect(occurrenceCount(series.id, '2026-10-19')).toBe(1)
  })

  it('does not materialise a day the series does not reach', () => {
    repository.create(
      newTask({ rruleFreq: 'weekly', rruleDays: [1, 3], rruleFrom: '2026-10-05' })
    )

    repository.listByDate('2026-10-06')

    expect(titlesOn('2026-10-06')).toEqual([])
  })

  it('honours the interval', () => {
    repository.create(
      newTask({
        rruleFreq: 'weekly',
        rruleDays: [1],
        rruleInterval: 2,
        rruleFrom: '2026-10-05'
      })
    )

    expect(titlesOn('2026-10-05')).toEqual(['Revisión semanal'])
    expect(titlesOn('2026-10-12')).toEqual([])
    expect(titlesOn('2026-10-19')).toEqual(['Revisión semanal'])
  })

  it('keeps the occurrence on its own day, not the series origin', () => {
    repository.create(
      newTask({ rruleFreq: 'weekly', rruleDays: [3], rruleFrom: '2026-10-05' })
    )

    repository.listByDate('2026-10-14')

    // The occurrence belongs to the 14th. A materialiser that copied the origin date instead
    // would put every occurrence on the 5th and quietly fill a week nobody scheduled.
    expect(repository.listByDate('2026-10-14')[0].taskDate).toBe('2026-10-14')
    expect(repository.listByDate('2026-10-05')[0].taskDate).toBe('2026-10-05')
  })
})

describe('acceptance criterion 2 — a series whose until has passed', () => {
  it('generates no occurrence after until', () => {
    repository.create(
      newTask({
        taskDate: '2026-01-01',
        rruleFreq: 'daily',
        rruleFrom: '2026-01-01',
        rruleUntil: '2026-01-31'
      })
    )

    expect(titlesOn('2026-01-31')).toEqual(['Revisión semanal'])
    expect(titlesOn('2026-02-01')).toEqual([])
    expect(titlesOn('2026-10-05')).toEqual([])
  })

  it('still materialises days inside the series', () => {
    repository.create(
      newTask({
        taskDate: '2026-01-01',
        rruleFreq: 'daily',
        rruleFrom: '2026-01-01',
        rruleUntil: '2026-01-31'
      })
    )

    expect(titlesOn('2026-01-15')).toEqual(['Revisión semanal'])
  })

  it('treats until as inclusive', () => {
    repository.create(
      newTask({
        taskDate: '2026-01-01',
        rruleFreq: 'daily',
        rruleFrom: '2026-01-01',
        rruleUntil: '2026-01-31'
      })
    )

    // The schema says `rrule_until` is inclusive. Reading it exclusively drops the user's
    // last day, which is the day they most likely told the app they wanted.
    expect(titlesOn('2026-01-31')).toEqual(['Revisión semanal'])
  })
})

describe('acceptance criterion 5 — the unique index and the transaction', () => {
  it('refuses a second occurrence at the storage layer, not just in the materialiser', () => {
    const series = repository.create(
      newTask({ rruleFreq: 'weekly', rruleDays: [1], rruleFrom: '2026-10-05' })
    )
    repository.listByDate('2026-10-05')

    // The index is the last line of defence and has to hold on its own: the materialiser's own
    // existence check is the first. So this goes straight to SQL, bypassing both, and the
    // constraint is what rejects it.
    expect(() =>
      database
        .prepare(
          `INSERT INTO tasks (
             id, title, notes, task_date, status, start_min, end_min, estimate_min, color,
             rrule_freq, rrule_interval, rrule_days, rrule_until, rrule_from,
             created_at, updated_at, started_at, completed_at, search_text, series_id
           ) VALUES (
             'rogue', 'Revisión semanal', NULL, '2026-10-05', 'pending', 540, 600, 60, NULL,
             'weekly', 1, '1', NULL, '2026-10-05',
             '2026-10-05T08:00:00.000Z', '2026-10-05T08:00:00.000Z', NULL, NULL,
             'revision semanal', @seriesId
           )`
        )
        .run({ seriesId: series.id })
    ).toThrow(/UNIQUE/)

    expect(occurrenceCount(series.id, '2026-10-05')).toBe(1)
  })

  it('materialises a whole range atomically', () => {
    repository.create(
      newTask({
        taskDate: '2026-10-01',
        rruleFreq: 'daily',
        rruleFrom: '2026-10-01',
        rruleUntil: '2026-10-10'
      })
    )

    const before = database.prepare('SELECT COUNT(*) AS total FROM tasks').get() as {
      total: number
    }

    // Reading the range materialises every day of the series at once, inside one transaction.
    repository.listByRange('2026-10-01', '2026-10-10')
    const after = database.prepare('SELECT COUNT(*) AS total FROM tasks').get() as {
      total: number
    }

    // The origin row already sits on 2026-10-01, so the range adds the nine days after it.
    expect(after.total - before.total).toBe(9)
    expect(repository.listByDate('2026-10-10')).toHaveLength(1)
  })

  it('leaves no half-materialised series when the insert fails', () => {
    repository.create(
      newTask({
        taskDate: '2026-10-01',
        rruleFreq: 'daily',
        rruleFrom: '2026-10-01',
        rruleUntil: '2026-10-10'
      })
    )

    const countTasks = (): number =>
      (database.prepare('SELECT COUNT(*) AS total FROM tasks').get() as { total: number }).total

    const before = countTasks()

    // Drop the table the materialiser writes to. Every occurrence insert now fails, and the
    // transaction has to leave the series exactly as it found it: ten rows for one series, or
    // one. Never a prefix.
    database.exec('ALTER TABLE tasks RENAME TO tasks_hidden')
    database.exec('CREATE TABLE tasks (id TEXT PRIMARY KEY, only TEXT)')

    expect(() => repository.listByRange('2026-10-01', '2026-10-10')).toThrow()

    database.exec('DROP TABLE tasks')
    database.exec('ALTER TABLE tasks_hidden RENAME TO tasks')

    expect(countTasks()).toBe(before)
  })
})

describe('what an occurrence inherits', () => {
  it('starts pending, never done', () => {
    repository.create(
      newTask({ taskDate: '2026-10-05', rruleFreq: 'daily', rruleFrom: '2026-10-05' })
    )

    // A materialised occurrence was not completed by anybody. Copying the series' status
    // would paint the heatmap green for days nobody worked, and `done` is terminal.
    expect(repository.listByDate('2026-10-05')[0].status).toBe('pending')
    expect(repository.listByDate('2026-10-05')[0].completedAt).toBeNull()
    expect(repository.listByDate('2026-10-05')[0].startedAt).toBeNull()
  })

  it('copies the title, notes, schedule, estimate and colour', () => {
    repository.create(
      newTask({
        title: 'Revisión semanal',
        notes: 'Traer el informe',
        startMin: 8 * 60 + 30,
        endMin: 9 * 60 + 30,
        estimateMin: 45,
        color: '#ff0000',
        taskDate: '2026-10-05',
        rruleFreq: 'daily',
        rruleFrom: '2026-10-05'
      })
    )

    const occurrence = repository.listByDate('2026-10-06')[0]

    expect(occurrence.title).toBe('Revisión semanal')
    expect(occurrence.notes).toBe('Traer el informe')
    expect(occurrence.startMin).toBe(8 * 60 + 30)
    expect(occurrence.endMin).toBe(9 * 60 + 30)
    expect(occurrence.estimateMin).toBe(45)
    expect(occurrence.color).toBe('#ff0000')
  })

  it('copies the tags, so a filtered sidebar finds occurrences', () => {
    repository.create(
      newTask({
        rruleFreq: 'daily',
        rruleFrom: '2026-10-05',
        tags: ['proyecto']
      })
    )

    expect(repository.listByDate('2026-10-06')[0].tags).toEqual(['proyecto'])
  })

  it('gives the occurrence its own id, distinct from the series', () => {
    const series = repository.create(newTask({ rruleFreq: 'daily', rruleFrom: '2026-10-05' }))

    expect(repository.listByDate('2026-10-06')[0].id).not.toBe(series.id)
  })

  it('never materialises the series row itself twice', () => {
    repository.create(newTask({ rruleFreq: 'daily', rruleFrom: '2026-10-05' }))

    repository.listByDate('2026-10-05')

    expect(repository.listByDate('2026-10-05')).toHaveLength(1)
  })
})

describe('a one-off task is never materialised', () => {
  it('produces exactly one row, however often the day is read', () => {
    repository.create(newTask({ rruleFreq: 'none' }))

    for (let attempt = 0; attempt < 5; attempt += 1) {
      repository.listByDate('2026-10-05')
    }

    expect(repository.listByDate('2026-10-05')).toHaveLength(1)
  })
})

describe('editing the series itself', () => {
  it('persists a valid change to the weekday list', () => {
    // The suite could not catch this class of bug by construction: the only test that touched
    // `rruleDays` on update sent an *invalid* list, which `normalizeRecurrence` rejects long
    // before the writer runs. A test that only proves the validator fires says nothing about
    // the writer, and the writer was the broken half.
    const created = repository.create(
      newTask({ taskDate: '2026-10-05', rruleFreq: 'weekly', rruleDays: [1, 3] })
    )

    const updated = repository.update(created.id, { rruleDays: [1, 3, 5] })

    expect(updated.rruleDays).toEqual([1, 3, 5])
    expect(repository.findById(created.id).rruleDays).toEqual([1, 3, 5])
  })

  it('stores the list as CSV, the shape the column holds', () => {
    const created = repository.create(
      newTask({ taskDate: '2026-10-05', rruleFreq: 'weekly', rruleDays: [1, 3] })
    )
    repository.update(created.id, { rruleDays: [2, 4, 6] })

    const row = database
      .prepare('SELECT rrule_days AS days FROM tasks WHERE id = ?')
      .get(created.id) as { days: string }

    expect(row.days).toBe('2,4,6')
  })

  it('clears the list without leaving a stale string behind', () => {
    const created = repository.create(
      newTask({ taskDate: '2026-10-05', rruleFreq: 'weekly', rruleDays: [1, 3] })
    )

    const updated = repository.update(created.id, { rruleDays: null })

    expect(updated.rruleDays).toBeNull()
  })

  it('still refuses an invalid list before touching the row', () => {
    const created = repository.create(
      newTask({ taskDate: '2026-10-05', rruleFreq: 'weekly', rruleDays: [1, 3] })
    )

    expect(() => repository.update(created.id, { rruleDays: [0, 9] })).toThrow()
    expect(repository.findById(created.id).rruleDays).toEqual([1, 3])
  })
})

describe('two series born on the same day', () => {
  // This is the case `0004` exists for. `0001` made `idx_tasks_occurrence` unique on
  // `(rrule_from, task_date)`, and `rrule_from` is a date: two recurring tasks created on the
  // same morning shared an origin and the second one died on
  // `UNIQUE constraint failed: tasks.rrule_from, tasks.task_date`. Creating "Standup" and
  // "Gym" as daily series was impossible — the most ordinary use the feature has.
  it('can both exist', () => {
    repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Standup', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )
    repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Gym', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )

    const onOrigin = repository
      .listByDate('2026-01-05')
      .map((task) => task.title)
      .sort()

    expect(onOrigin).toEqual(['Gym', 'Standup'])
  })

  it('materialises both, each day, without either swallowing the other', () => {
    repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Standup', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )
    repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Gym', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )

    const later = repository
      .listByDate('2026-01-06')
      .map((task) => task.title)
      .sort()

    expect(later).toEqual(['Gym', 'Standup'])
  })

  it('still refuses a duplicate occurrence of one series on one day', () => {
    const series = repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Standup', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )

    repository.listByDate('2026-01-06')
    repository.listByDate('2026-01-06')

    const row = database
      .prepare('SELECT COUNT(*) AS total FROM tasks WHERE series_id = ? AND task_date = ?')
      .get(series.id, '2026-01-06') as { total: number }

    expect(row.total).toBe(1)
  })

  it('gives each series its own identity', () => {
    const standup = repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Standup', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )
    const gym = repository.create(
      newTask({ taskDate: '2026-01-05', title: 'Gym', rruleFreq: 'daily', rruleFrom: '2026-01-05' })
    )

    expect(standup.id).not.toBe(gym.id)

    // Reading the day is what materialises it, so the occurrence rows do not exist until then.
    repository.listByDate('2026-01-06')

    const ids = database
      .prepare(
        `SELECT series_id FROM tasks WHERE task_date = '2026-01-06' AND title IN ('Standup','Gym')`
      )
      .all() as { series_id: string }[]

    expect(ids.map((row) => row.series_id).sort()).toEqual([gym.id, standup.id].sort())
  })
})
