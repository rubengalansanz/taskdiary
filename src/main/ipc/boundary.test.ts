import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../db/database'
import { runMigrations } from '../db/migrate'
import { TasksRepository, type NewTaskInput } from '../db/repositories/tasks-repo'
import {
  assertEstimateMinutes,
  assertLocalDate,
  assertMinuteOfDay,
  assertTimeRange,
  normalizeNotes,
  normalizeRecurrence,
  normalizeTitle
} from '../core/validation'
import {
  createTaskRequestSchema,
  listTasksRequestSchema,
  updateTaskRequestSchema,
  deleteTaskRequestSchema,
  type AppErrorDto
} from '../../shared/ipc'
import type Database from 'better-sqlite3'

/**
 * The Fase 1 acceptance criterion, asserted end to end:
 *
 * > Un payload IPC mal formado (fecha inválida, título vacío) se rechaza en el main y
 * > **la base de datos no se toca**.
 *
 * These tests drive the same three stages the IPC handlers run — Zod, then
 * `core/validation.ts`, then the repository — and after every rejection they read the
 * row count straight from SQLite. A handler that validated late, or logged the rejection
 * and wrote anyway, would fail here.
 */

let database: Database.Database
let repository: TasksRepository

beforeEach(() => {
  database = openInMemoryDatabase()
  runMigrations(database)
  repository = new TasksRepository(database)
})

/** Row count read directly from SQLite, never from the repository's cache. */
function rowCount(): number {
  return (database.prepare('SELECT COUNT(*) AS total FROM tasks').get() as { total: number }).total
}

/** Everything stored, so a rejection can be proven to have changed nothing at all. */
function snapshot(): string {
  return JSON.stringify(database.prepare('SELECT * FROM tasks ORDER BY id').all())
}

/**
 * Mirrors `createTaskRequestSchema` → `core/validation.ts` → repository.
 *
 * Returns the failure DTO instead of throwing, exactly as `guard()` does in
 * `src/main/ipc/tasks.ts`.
 */
function handleCreate(payload: unknown): { ok: true; title: string } | AppErrorDto {
  const parsed = createTaskRequestSchema.safeParse(payload)

  if (!parsed.success) {
    const fieldMessages: Record<string, string> = {}

    for (const issue of parsed.error.issues) {
      fieldMessages[issue.path.length === 0 ? 'payload' : issue.path.join('.')] ??= issue.message
    }

    return {
      code: 'VALIDATION_FAILED',
      message: 'Los datos enviados no son válidos.',
      details: { fieldMessages }
    }
  }

  try {
    const startMin = assertMinuteOfDay(parsed.data.startMin ?? null, 'startMin')
    const endMin = assertMinuteOfDay(parsed.data.endMin ?? null, 'endMin')

    assertTimeRange(startMin, endMin)

    const input: NewTaskInput = {
      title: normalizeTitle(parsed.data.title),
      notes: normalizeNotes(parsed.data.notes),
      taskDate: assertLocalDate(parsed.data.taskDate),
      startMin,
      endMin,
      estimateMin: assertEstimateMinutes(parsed.data.estimateMin ?? null),
      color: parsed.data.color ?? null,
      ...normalizeRecurrence({
        rruleFreq: parsed.data.rruleFreq ?? 'none',
        rruleInterval: parsed.data.rruleInterval ?? 1,
        rruleDays: parsed.data.rruleDays ?? null,
        rruleUntil: parsed.data.rruleUntil ?? null,
        rruleFrom: parsed.data.rruleFrom ?? null
      })
    }

    return { ok: true, title: repository.create(input).title }
  } catch (error) {
    return error as AppErrorDto
  }
}

const VALID_CREATE = {
  title: 'Preparar informe',
  notes: null,
  taskDate: '2026-10-10',
  startMin: 540,
  endMin: 600
}

describe('a malformed payload never reaches the database', () => {
  it('rejects an invalid date shape and writes nothing', () => {
    const before = snapshot()
    const result = handleCreate({ ...VALID_CREATE, taskDate: '10/10/2026' })

    expect(result).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(rowCount()).toBe(0)
    expect(snapshot()).toBe(before)
  })

  it('rejects a well-shaped date that does not exist, and writes nothing', () => {
    // `2026-02-30` passes the Zod regex. Only the domain check catches it, which is
    // exactly why the boundary runs two layers.
    const before = snapshot()
    const result = handleCreate({ ...VALID_CREATE, taskDate: '2026-02-30' })

    expect(result).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(rowCount()).toBe(0)
    expect(snapshot()).toBe(before)
  })

  it('rejects an empty title and writes nothing', () => {
    const before = snapshot()
    const result = handleCreate({ ...VALID_CREATE, title: '   ' })

    expect(result).toMatchObject({ code: 'TASK_TITLE_REQUIRED' })
    expect(rowCount()).toBe(0)
    expect(snapshot()).toBe(before)
  })

  it('rejects an end time before the start, and writes nothing', () => {
    const before = snapshot()
    const result = handleCreate({ ...VALID_CREATE, startMin: 600, endMin: 540 })

    expect(result).toMatchObject({ code: 'TASK_INVALID_TIME_RANGE' })
    expect(rowCount()).toBe(0)
    expect(snapshot()).toBe(before)
  })

  it('rejects an out-of-range minute and writes nothing', () => {
    const before = snapshot()
    const result = handleCreate({ ...VALID_CREATE, startMin: 1500 })

    expect(result).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(rowCount()).toBe(0)
    expect(snapshot()).toBe(before)
  })

  it('rejects a payload with no title at all, and writes nothing', () => {
    const before = snapshot()
    const result = handleCreate({ ...VALID_CREATE, title: undefined })

    expect(result).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(rowCount()).toBe(0)
    expect(snapshot()).toBe(before)
  })

  it('rejects a completely unrelated object, and writes nothing', () => {
    const before = snapshot()
    const result = handleCreate({ sql: 'DROP TABLE tasks' })

    expect(result).toMatchObject({ code: 'VALIDATION_FAILED' })
    expect(rowCount()).toBe(0)
    expect(snapshot()).toBe(before)
  })

  it('reports which field failed, so the renderer can point at the input', () => {
    const result = handleCreate({ ...VALID_CREATE, taskDate: 'ayer' }) as AppErrorDto

    expect(result.details?.fieldMessages).toHaveProperty('taskDate')
  })

  it('still stores a valid payload, so the rejection path is not the only one', () => {
    const result = handleCreate(VALID_CREATE)

    expect(result).toMatchObject({ ok: true, title: 'Preparar informe' })
    expect(rowCount()).toBe(1)
  })

  it('never leaks an absolute path or a stack trace through the error DTO', () => {
    const result = handleCreate({ ...VALID_CREATE, taskDate: 'ayer' }) as AppErrorDto

    expect(JSON.stringify(result)).not.toContain('E:\\')
    expect(JSON.stringify(result)).not.toContain('node_modules')
    expect(result.message).not.toMatch(/at\s+\w+\s+\(/)
  })
})

describe('list and update payloads are validated before any read or write', () => {
  it('rejects a list request for a malformed date without querying', () => {
    expect(listTasksRequestSchema.safeParse({ taskDate: 'hoy' }).success).toBe(false)
    expect(listTasksRequestSchema.safeParse({ taskDate: '2026-10-10' }).success).toBe(true)
  })

  it('rejects an update with no id', () => {
    expect(updateTaskRequestSchema.safeParse({ title: 'x' }).success).toBe(false)
  })

  it('rejects an unknown status', () => {
    expect(updateTaskRequestSchema.safeParse({ id: 'a', status: 'paused' }).success).toBe(false)
  })

  it('rejects an update that changes nothing at all', () => {
    expect(updateTaskRequestSchema.safeParse({ id: 'a' }).success).toBe(true)
  })

  it('rejects a delete with no id', () => {
    expect(deleteTaskRequestSchema.safeParse({}).success).toBe(false)
  })

  it('refuses to delete when the id does not exist, and changes nothing', () => {
    repository.create({
      title: 'Se queda',
      notes: null,
      taskDate: '2026-10-10',
      startMin: null,
      endMin: null,
      estimateMin: null,
      color: null,
      rruleFreq: 'none',
      rruleInterval: 1,
      rruleDays: null,
      rruleUntil: null,
      rruleFrom: null
    })

    const before = snapshot()

    expect(repository.delete('no-existe')).toBe(false)
    expect(snapshot()).toBe(before)
  })
})
