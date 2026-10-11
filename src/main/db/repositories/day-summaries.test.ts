import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../database'
import { runMigrations } from '../migrate'
import { TasksRepository, type NewTaskInput } from './tasks-repo'
import { TagsRepository } from './tags-repo'
import { AppError } from '../../core/errors'
import type Database from 'better-sqlite3'

/**
 * Day aggregates, against a real in-memory SQLite database.
 *
 * The acceptance criterion for Fase 4 is not "the heatmap looks right", it is "the heatmap is
 * built with `GROUP BY task_date` in SQL, not by loading the whole table". A view that renders
 * correctly while quietly reading every task row passes every behavioural test in this file and
 * still violates the criterion, so one test here pins the shape of the query itself.
 */

const MONDAY = '2026-10-05'
const TUESDAY = '2026-10-06'
const NEXT_MONDAY = '2026-10-12'

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
    title: 'Preparar informe trimestral',
    notes: null,
    taskDate: MONDAY,
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

/**
 * Stamps `started_at` and `completed_at` directly.
 *
 * `update()` owns those columns, and steering it into an exact pair of instants means sleeping
 * between two calls. The aggregate is defined over the two timestamps, so the test sets the two
 * timestamps and asserts on the difference.
 */
function stamp(taskId: string, startedAt: string | null, completedAt: string | null): void {
  database.prepare('UPDATE tasks SET started_at = ?, completed_at = ? WHERE id = ?').run(
    startedAt,
    completedAt,
    taskId
  )
}

/** The SQL every statement is prepared with, captured rather than trusted. */
function captureSql<T>(run: () => T): { result: T; sql: string[] } {
  const seen: string[] = []
  const original = database.prepare.bind(database)

  database.prepare = (statement: string) => {
    seen.push(statement)
    return original(statement)
  }

  try {
    return { result: run(), sql: seen }
  } finally {
    database.prepare = original
  }
}

describe('summarizeRange', () => {
  it('aggregates with GROUP BY task_date rather than reading task rows', () => {
    repository.create(newTask({ taskDate: MONDAY }))

    const { result, sql } = captureSql(() => repository.summarizeRange(MONDAY, NEXT_MONDAY))

    expect(result).toHaveLength(1)
    const aggregate = sql.find((statement) => /GROUP\s+BY\s+task_date/i.test(statement))

    // No such statement: the method is counting in JavaScript over rows it loaded first, which is
    // exactly what "no cargando la tabla entera" forbids.
    expect(aggregate, `ninguna consulta aggregation-bearing en: ${sql.join(' | ')}`).toBeDefined()
    expect(aggregate).not.toMatch(/\bSELECT\b(?![\s\S]*GROUP BY)[\s\S]*\bid,\s*title\b/i)
  })

  it('returns one row per day that has work, not one per day in the range', () => {
    repository.create(newTask({ taskDate: MONDAY }))
    repository.create(newTask({ taskDate: TUESDAY }))
    repository.create(newTask({ taskDate: TUESDAY }))

    const days = repository.summarizeRange(MONDAY, NEXT_MONDAY)

    expect(days.map((day) => day.date)).toEqual([MONDAY, TUESDAY])
  })

  it('counts each status without mixing them up', () => {
    const done = repository.create(newTask({ taskDate: MONDAY, title: 'Hecho' }))
    repository.create(newTask({ taskDate: MONDAY, title: 'Pendiente' }))
    repository.create(newTask({ taskDate: MONDAY, title: 'Corriendo' }))
    repository.create(newTask({ taskDate: MONDAY, title: 'Cancelada' }))
    repository.update(done.id, { status: 'done' })
    repository.update(repository.listByDate(MONDAY).find((t) => t.title === 'Corriendo')!.id, {
      status: 'in_progress'
    })
    repository.update(repository.listByDate(MONDAY).find((t) => t.title === 'Cancelada')!.id, {
      status: 'cancelled'
    })

    const [day] = repository.summarizeRange(MONDAY, MONDAY)

    expect(day.done).toBe(1)
    expect(day.inProgress).toBe(1)
    expect(day.pending).toBe(1)
    expect(day.cancelled).toBe(1)
    // A cancelled task is not work: it must not inflate the ring or the heatmap's amber.
    expect(day.total).toBe(3)
  })

  it('sums the estimated minutes of the day', () => {
    repository.create(newTask({ taskDate: MONDAY, estimateMin: 30 }))
    repository.create(newTask({ taskDate: MONDAY, estimateMin: 45 }))
    repository.create(newTask({ taskDate: MONDAY, estimateMin: null }))

    const [day] = repository.summarizeRange(MONDAY, MONDAY)

    // A task with no estimate contributes zero rather than poisoning SUM with NULL.
    expect(day.estimateMin).toBe(75)
  })

  it('measures real minutes from started_at to completed_at', () => {
    const task = repository.create(newTask({ taskDate: MONDAY, estimateMin: 30 }))
    repository.update(task.id, { status: 'done' })
    stamp(task.id, '2026-10-05T09:00:00.000Z', '2026-10-05T11:30:00.000Z')

    const [day] = repository.summarizeRange(MONDAY, MONDAY)

    expect(day.realMin).toBe(150)
    expect(day.estimateMin).toBe(30)
  })

  it('reports an unmeasured completion instead of counting it as zero real minutes', () => {
    const task = repository.create(newTask({ taskDate: MONDAY }))
    stamp(task.id, null, '2026-10-05T11:30:00.000Z')
    repository.update(task.id, { status: 'done' })

    const [day] = repository.summarizeRange(MONDAY, MONDAY)

    // Migration 0002 already set this precedent for the stopwatch: nobody knows when a task
    // started, so the elapsed time is unknown. Reporting 0 real minutes would make the Week
    // view claim the estimate was missed by 100% when the truth is "never measured".
    expect(day.done).toBe(1)
    expect(day.realMin).toBe(0)
    expect(day.unmeasuredDone).toBe(1)
  })

  it('rounds the day total once rather than per task', () => {
    const a = repository.create(newTask({ taskDate: MONDAY }))
    const b = repository.create(newTask({ taskDate: MONDAY }))
    repository.update(a.id, { status: 'done' })
    repository.update(b.id, { status: 'done' })
    stamp(a.id, '2026-10-05T09:00:00.000Z', '2026-10-05T09:00:40.000Z')
    stamp(b.id, '2026-10-05T09:00:00.000Z', '2026-10-05T09:00:40.000Z')

    const [day] = repository.summarizeRange(MONDAY, MONDAY)

    // 80 seconds in total. Truncating each task to whole minutes first would report 0 and lose
    // work that really happened; summing seconds and converting once keeps it.
    expect(day.realMin).toBe(1)
  })

  it('keeps the range inclusive on both ends', () => {
    repository.create(newTask({ taskDate: MONDAY }))
    repository.create(newTask({ taskDate: NEXT_MONDAY }))

    const days = repository.summarizeRange(MONDAY, NEXT_MONDAY)

    expect(days.map((day) => day.date)).toEqual([MONDAY, NEXT_MONDAY])
  })

  it('returns nothing for a range with no work', () => {
    expect(repository.summarizeRange(MONDAY, NEXT_MONDAY)).toEqual([])
  })

  it('rejects an inverted range', () => {
    expect(() => repository.summarizeRange(NEXT_MONDAY, MONDAY)).toThrow(AppError)

    try {
      repository.summarizeRange(NEXT_MONDAY, MONDAY)
    } catch (error) {
      expect((error as AppError).code).toBe('VALIDATION_FAILED')
    }
  })
})