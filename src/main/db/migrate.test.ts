import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase, hasTable, pingDatabase } from './database'
import { readSchemaVersion, runMigrations } from './migrate'
import { latestSchemaVersion } from './migrations'
import type Database from 'better-sqlite3'

/**
 * Migrations run against real SQL through the same `better-sqlite3` binding the app
 * uses (ADR-011). `:memory:` needs no `ELECTRON_RUN_AS_NODE` and no mocked layer, so a
 * passing test means the DDL is valid, not that a stub agreed.
 */

let database: Database.Database

beforeEach(() => {
  database = openInMemoryDatabase()
})

describe('runMigrations', () => {
  it('applies every bundled migration to a fresh database', () => {
    const report = runMigrations(database)

    expect(report.fromVersion).toBe(0)
    expect(report.toVersion).toBe(latestSchemaVersion())
    expect(report.applied).toHaveLength(latestSchemaVersion())
  })

  it('records the schema version in PRAGMA user_version', () => {
    runMigrations(database)

    expect(readSchemaVersion(database)).toBe(latestSchemaVersion())
  })

  it('creates the tables the plan defines', () => {
    runMigrations(database)

    for (const table of ['tasks', 'tags', 'task_tags', 'settings']) {
      expect(hasTable(database, table), `missing table ${table}`).toBe(true)
    }
  })

  it('is idempotent: running twice applies nothing the second time', () => {
    runMigrations(database)
    const second = runMigrations(database)

    expect(second.fromVersion).toBe(latestSchemaVersion())
    expect(second.toVersion).toBe(latestSchemaVersion())
    expect(second.applied).toEqual([])
  })

  it('enforces foreign keys, so ON DELETE CASCADE works', () => {
    runMigrations(database)

    const enabled = database.pragma('foreign_keys') as { foreign_keys: number }[]

    expect(enabled[0]?.foreign_keys).toBe(1)
  })

  it('rejects a status outside the state machine at the storage layer', () => {
    runMigrations(database)

    expect(() => insertRawTask(database, { status: 'paused' })).toThrow(/CHECK constraint/i)
  })

  it('rejects two in_progress tasks on the same day', () => {
    runMigrations(database)

    insertRawTask(database, { id: 'a', status: 'in_progress', task_date: '2026-10-10' })
    expect(() =>
      insertRawTask(database, { id: 'b', status: 'in_progress', task_date: '2026-10-10' })
    ).toThrow(/UNIQUE constraint/i)
  })

  it('allows one in_progress task per day across different days', () => {
    runMigrations(database)

    insertRawTask(database, { id: 'a', status: 'in_progress', task_date: '2026-10-10' })
    expect(() =>
      insertRawTask(database, { id: 'b', status: 'in_progress', task_date: '2026-10-11' })
    ).not.toThrow()
  })

  it('rejects a recurring task with no series origin', () => {
    runMigrations(database)

    expect(() =>
      insertRawTask(database, { id: 'a', rrule_freq: 'daily', rrule_from: null })
    ).toThrow(/CHECK constraint/i)
  })

  it('cascades task_tags when a task is deleted', () => {
    runMigrations(database)
    insertRawTask(database, { id: 'a' })

    database.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run('tag-1', 'proyecto')
    database.prepare('INSERT INTO task_tags (task_id, tag_id) VALUES (?, ?)').run('a', 'tag-1')

    database.prepare('DELETE FROM tasks WHERE id = ?').run('a')

    const remaining = database.prepare('SELECT COUNT(*) AS total FROM task_tags').get() as {
      total: number
    }

    expect(remaining.total).toBe(0)
  })

  it('leaves the database usable after a migration run', () => {
    runMigrations(database)

    expect(pingDatabase(database)).toBe(1)
  })
})

/** Bypasses the repository to prove the *schema* enforces a rule, not the application. */
function insertRawTask(
  target: Database.Database,
  overrides: {
    id?: string
    status?: string
    task_date?: string
    rrule_freq?: string
    rrule_from?: string | null
  } = {}
): void {
  target
    .prepare(
      `INSERT INTO tasks (
         id, title, task_date, status, rrule_freq, rrule_interval, rrule_from,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 1, ?, '2026-10-10T08:00:00.000Z', '2026-10-10T08:00:00.000Z')`
    )
    .run(
      overrides.id ?? 'task-1',
      'Tarea',
      overrides.task_date ?? '2026-10-10',
      overrides.status ?? 'pending',
      overrides.rrule_freq ?? 'none',
      overrides.rrule_from ?? null
    )
}
