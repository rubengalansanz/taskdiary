import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from '../database'
import { runMigrations } from '../migrate'
import { TasksRepository, type NewTaskInput } from './tasks-repo'
import { AppError } from '../../core/errors'
import type Database from 'better-sqlite3'

/**
 * Repository behaviour against a real in-memory SQLite database.
 *
 * Every test here runs actual SQL. The point of Fase 1 is that a bad payload never
 * reaches storage, and that claim is only worth something if the assertions are made
 * against the database rather than against a mock of it.
 */

const TODAY = '2026-10-10'
const TOMORROW = '2026-10-11'

let database: Database.Database
let repository: TasksRepository

beforeEach(() => {
  database = openInMemoryDatabase()
  runMigrations(database)
  repository = new TasksRepository(database)
})

/** A minimal valid create payload, overridable per test. */
function newTask(overrides: Partial<NewTaskInput> = {}): NewTaskInput {
  return {
    title: 'Preparar informe trimestral',
    notes: null,
    taskDate: TODAY,
    startMin: 9 * 60,
    endMin: 10 * 60,
    estimateMin: 60,
    color: null,
    rruleFreq: 'none',
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: null,
    ...overrides
  }
}

/** Raw row count, read straight from SQLite. */
function rowCount(table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as {
    total: number
  }

  return row.total
}

/** Waits long enough for the millisecond clock to move on. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5))
}

describe('TasksRepository.create', () => {
  it('persists a task and reads it back', () => {
    const created = repository.create(newTask())

    expect(created.title).toBe('Preparar informe trimestral')
    expect(created.status).toBe('pending')
    expect(rowCount('tasks')).toBe(1)
  })

  it('persists task_date as a local string, never an instant', () => {
    const created = repository.create(newTask({ taskDate: '2026-02-28' }))

    const row = database.prepare('SELECT task_date FROM tasks WHERE id = ?').get(created.id) as {
      task_date: string
    }

    expect(typeof row.task_date).toBe('string')
    expect(row.task_date).toBe('2026-02-28')
  })

  it('persists times as integers of minutes since midnight', () => {
    const created = repository.create(newTask({ startMin: 530, endMin: 590 }))

    const row = database
      .prepare('SELECT start_min, end_min, estimate_min FROM tasks WHERE id = ?')
      .get(created.id) as { start_min: number; end_min: number; estimate_min: number }

    expect(row.start_min).toBe(530)
    expect(row.end_min).toBe(590)
    expect(row.estimate_min).toBe(60)
    expect(Number.isInteger(row.start_min)).toBe(true)
  })

  it('generates the id, so the caller cannot collide with an existing row', () => {
    const first = repository.create(newTask())
    const second = repository.create(newTask())

    expect(first.id).not.toBe(second.id)
  })

  it('stamps both audit columns with the same instant', () => {
    const created = repository.create(newTask())

    expect(created.createdAt).toBe(created.updatedAt)
    expect(new Date(created.createdAt).toISOString()).toBe(created.createdAt)
  })

  it('leaves completed_at null for a new task', () => {
    expect(repository.create(newTask()).completedAt).toBeNull()
  })

  it('strips series metadata from a non-recurring task', () => {
    const created = repository.create(
      newTask({ rruleFreq: 'none', rruleFrom: '2026-10-01', rruleDays: [1, 2] })
    )

    expect(created.rruleFrom).toBeNull()
    expect(created.rruleDays).toBeNull()
  })

  it('round-trips the weekday list of a weekly series through the CSV column', () => {
    const created = repository.create(
      newTask({ rruleFreq: 'weekly', rruleFrom: TODAY, rruleDays: [1, 3, 5] })
    )

    const row = database.prepare('SELECT rrule_days FROM tasks WHERE id = ?').get(created.id) as {
      rrule_days: string
    }

    expect(row.rrule_days).toBe('1,3,5')
    expect(created.rruleDays).toEqual([1, 3, 5])
  })
})

describe('TasksRepository.listByDate', () => {
  it('returns only the requested day', () => {
    repository.create(newTask({ taskDate: TODAY }))
    repository.create(newTask({ taskDate: TOMORROW }))

    expect(repository.listByDate(TODAY)).toHaveLength(1)
  })

  it('orders by start time', () => {
    repository.create(newTask({ title: 'Tarde', startMin: 14 * 60 }))
    repository.create(newTask({ title: 'Mañana', startMin: 8 * 60 }))
    repository.create(newTask({ title: 'Mediodía', startMin: 12 * 60 }))

    expect(repository.listByDate(TODAY).map((task) => task.title)).toEqual([
      'Mañana',
      'Mediodía',
      'Tarde'
    ])
  })

  it('sorts unscheduled tasks last, since they have no place on a timeline', () => {
    repository.create(newTask({ title: 'Sin hora', startMin: null, endMin: null }))
    repository.create(newTask({ title: 'Con hora', startMin: 10 * 60 }))

    expect(repository.listByDate(TODAY).map((task) => task.title)).toEqual(['Con hora', 'Sin hora'])
  })

  it('returns an empty list for a day with no tasks', () => {
    expect(repository.listByDate('2026-01-01')).toEqual([])
  })
})

describe('TasksRepository.listByRange', () => {
  it('is inclusive on both ends', () => {
    repository.create(newTask({ taskDate: '2026-10-09' }))
    repository.create(newTask({ taskDate: '2026-10-10' }))
    repository.create(newTask({ taskDate: '2026-10-11' }))

    expect(repository.listByRange('2026-10-09', '2026-10-11')).toHaveLength(3)
    expect(repository.listByRange('2026-10-10', '2026-10-10')).toHaveLength(1)
  })

  it('orders by date, then by start time', () => {
    repository.create(newTask({ taskDate: '2026-10-11', startMin: 8 * 60 }))
    repository.create(newTask({ taskDate: '2026-10-10', startMin: 8 * 60 }))

    expect(repository.listByRange('2026-10-10', '2026-10-11').map((t) => t.taskDate)).toEqual([
      '2026-10-10',
      '2026-10-11'
    ])
  })

  it('rejects an inverted range with a domain error', () => {
    expect(() => repository.listByRange('2026-10-11', '2026-10-10')).toThrow(AppError)
    expect(() => repository.listByRange('2026-10-11', '2026-10-10')).toThrow(/invertido/i)
  })
})

describe('TasksRepository.findById', () => {
  it('throws TASK_NOT_FOUND for an unknown id', () => {
    expect(() => repository.findById('no-existe')).toThrow(/no existe/i)

    try {
      repository.findById('no-existe')
    } catch (error) {
      expect((error as AppError).code).toBe('TASK_NOT_FOUND')
    }
  })
})

describe('TasksRepository.update', () => {
  it('changes only the fields that were sent', () => {
    const created = repository.create(newTask())

    const updated = repository.update(created.id, { title: 'Informe Q3' })

    expect(updated.title).toBe('Informe Q3')
    expect(updated.startMin).toBe(created.startMin)
    expect(updated.taskDate).toBe(created.taskDate)
  })

  it('does not bump updated_at when nothing actually changed', () => {
    const created = repository.create(newTask())

    const updated = repository.update(created.id, { title: created.title })

    expect(updated.updatedAt).toBe(created.updatedAt)
  })

  it('bumps updated_at when something does change', async () => {
    const created = repository.create(newTask())

    // ISO-8601 has millisecond resolution and SQLite is fast; without crossing a tick
    // the two writes would land on the same string and prove nothing.
    await tick()

    const updated = repository.update(created.id, { title: 'Otro título' })

    expect(updated.updatedAt).not.toBe(created.updatedAt)
    expect(Date.parse(updated.updatedAt)).toBeGreaterThan(Date.parse(created.updatedAt))
    expect(updated.createdAt).toBe(created.createdAt)
  })

  it('never moves updated_at backwards', async () => {
    const created = repository.create(newTask())

    await tick()

    const updated = repository.update(created.id, { title: 'Otro título' })

    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(created.updatedAt))
  })

  it('never writes undefined into a column that was not sent', () => {
    const created = repository.create(newTask({ notes: 'Notas originales' }))

    repository.update(created.id, { title: 'Solo el título' })

    expect(repository.findById(created.id).notes).toBe('Notas originales')
  })

  it('clears a nullable column when explicitly set to null', () => {
    const created = repository.create(newTask({ notes: 'Notas' }))

    expect(repository.update(created.id, { notes: null }).notes).toBeNull()
  })

  it('moves a task to another day', () => {
    const created = repository.create(newTask())

    expect(repository.update(created.id, { taskDate: TOMORROW }).taskDate).toBe(TOMORROW)
    expect(repository.listByDate(TODAY)).toHaveLength(0)
    expect(repository.listByDate(TOMORROW)).toHaveLength(1)
  })

  it('throws TASK_NOT_FOUND for an unknown id', () => {
    expect(() => repository.update('no-existe', { title: 'x' })).toThrow(/no existe/i)
  })

  it('validates the merged range, not just the fields the payload carries', () => {
    // The IPC layer cannot catch this: the update carries only `endMin`, and the
    // `startMin` that makes it invalid is already in the database. A boundary check
    // that only looks at what arrived would let 10:00–05:00 through.
    const created = repository.create(newTask({ startMin: 600, endMin: null }))

    expect(() => repository.update(created.id, { endMin: 300 })).toThrow(
      /posterior a la hora de inicio/
    )
    expect(repository.findById(created.id).endMin).toBeNull()
  })

  it('accepts an end that lands after the stored start', () => {
    const created = repository.create(newTask({ startMin: 600, endMin: null }))

    expect(repository.update(created.id, { endMin: 660 }).endMin).toBe(660)
  })

  it('rejects a start moved past the stored end', () => {
    const created = repository.create(newTask({ startMin: 540, endMin: 600 }))

    expect(() => repository.update(created.id, { startMin: 660 })).toThrow(
      /posterior a la hora de inicio/
    )
  })

  it('re-validates the recurrence when only the weekday list is sent', () => {
    const created = repository.create(
      newTask({ rruleFreq: 'weekly', rruleFrom: TODAY, rruleDays: [1, 2] })
    )

    // Sending `rruleDays` without `rruleFreq` still changes the rule, so it must still
    // go through the validator.
    expect(() => repository.update(created.id, { rruleDays: [0, 9] })).toThrow(/lunes/)
  })
})

describe('TasksRepository status machine', () => {
  it('allows pending to move to in_progress', () => {
    const created = repository.create(newTask())

    expect(repository.update(created.id, { status: 'in_progress' }).status).toBe('in_progress')
  })

  it('stamps started_at the moment the task becomes in_progress', async () => {
    const created = repository.create(newTask())

    expect(created.startedAt).toBeNull()

    await tick()

    const running = repository.update(created.id, { status: 'in_progress' })

    expect(running.startedAt).not.toBeNull()
    expect(Date.parse(running.startedAt ?? '')).toBeGreaterThan(Date.parse(created.updatedAt))
  })

  it('keeps started_at across unrelated edits to a running task', async () => {
    const created = repository.create(newTask())
    const running = repository.update(created.id, { status: 'in_progress' })

    await tick()

    // The whole point of 0002: renaming a running task must not reset the stopwatch.
    const renamed = repository.update(created.id, { title: 'Otro nombre' })

    expect(renamed.startedAt).toBe(running.startedAt)
  })

  it('clears started_at when the task stops running', () => {
    const created = repository.create(newTask())
    repository.update(created.id, { status: 'in_progress' })

    expect(repository.update(created.id, { status: 'done' }).startedAt).toBeNull()
  })

  it('gives a fresh start when a task resumes later', async () => {
    const created = repository.create(newTask())
    const first = repository.update(created.id, { status: 'in_progress' })

    repository.update(created.id, { status: 'pending' })
    await tick()
    const second = repository.update(created.id, { status: 'in_progress' })

    expect(second.startedAt).not.toBe(first.startedAt)
  })

  it('stamps completed_at the first time a task reaches done', () => {
    const created = repository.create(newTask())

    const done = repository.update(created.id, { status: 'done' })

    expect(done.completedAt).not.toBeNull()
  })

  it('clears completed_at when the task leaves done, so cancelling cannot fake a completion', () => {
    const created = repository.create(newTask())
    repository.update(created.id, { status: 'in_progress' })

    expect(repository.update(created.id, { status: 'cancelled' }).completedAt).toBeNull()
  })

  it('treats done as terminal, with no route back to pending', () => {
    const created = repository.create(newTask())
    repository.update(created.id, { status: 'done' })

    for (const target of ['pending', 'in_progress', 'cancelled'] as const) {
      expect(() => repository.update(created.id, { status: target })).toThrow(
        /No se puede pasar de done/
      )
    }
  })

  it('un-cancels back to pending, because cancelling recorded nothing', () => {
    const created = repository.create(newTask())
    repository.update(created.id, { status: 'cancelled' })

    expect(repository.update(created.id, { status: 'pending' }).status).toBe('pending')
  })

  it('rejects reopening a completed task as pending', () => {
    const created = repository.create(newTask())
    repository.update(created.id, { status: 'done' })

    try {
      repository.update(created.id, { status: 'pending' })
      expect.unreachable('the transition done → pending must be refused')
    } catch (error) {
      expect((error as AppError).code).toBe('TASK_INVALID_TRANSITION')
    }
  })

  it('reports TASK_INVALID_TRANSITION with both statuses in the message', () => {
    const created = repository.create(newTask())
    repository.update(created.id, { status: 'done' })

    try {
      repository.update(created.id, { status: 'in_progress' })
    } catch (error) {
      expect((error as AppError).code).toBe('TASK_INVALID_TRANSITION')
      expect((error as AppError).message).toContain('done')
      expect((error as AppError).message).toContain('in_progress')
    }
  })

  it('refuses a second in_progress task on the same day', () => {
    const first = repository.create(newTask({ title: 'Primera' }))
    repository.create(newTask({ title: 'Segunda' }))
    repository.update(first.id, { status: 'in_progress' })
    const second = repository.listByDate(TODAY).find((t) => t.title === 'Segunda')

    try {
      repository.update(second?.id ?? '', { status: 'in_progress' })
      expect.unreachable('the focus rule must refuse the second task')
    } catch (error) {
      expect((error as AppError).code).toBe('FOCUS_ALREADY_SET')
      expect((error as AppError).message).toContain('Primera')
    }
  })

  it('names the conflicting task in the error message', () => {
    const first = repository.create(newTask({ title: 'Informe' }))
    const second = repository.create(newTask({ title: 'Revisión' }))
    repository.update(first.id, { status: 'in_progress' })

    try {
      repository.update(second.id, { status: 'in_progress' })
    } catch (error) {
      expect((error as AppError).message).toContain('Informe')
    }
  })

  it('lets a task keep the focus without treating itself as a conflict', () => {
    const created = repository.create(newTask())

    repository.update(created.id, { status: 'in_progress' })

    expect(() => repository.update(created.id, { status: 'in_progress' })).not.toThrow()
  })

  it('frees the focus when the holder leaves in_progress', () => {
    const first = repository.create(newTask({ title: 'Primera' }))
    const second = repository.create(newTask({ title: 'Segunda' }))
    repository.update(first.id, { status: 'in_progress' })
    repository.update(first.id, { status: 'done' })

    expect(repository.update(second.id, { status: 'in_progress' }).status).toBe('in_progress')
  })

  it('allows two in_progress tasks on different days', () => {
    const first = repository.create(newTask({ taskDate: TODAY }))
    const second = repository.create(newTask({ taskDate: TOMORROW }))

    repository.update(first.id, { status: 'in_progress' })

    expect(repository.update(second.id, { status: 'in_progress' }).status).toBe('in_progress')
  })
})

describe('TasksRepository.delete', () => {
  it('removes the row and reports it', () => {
    const created = repository.create(newTask())

    expect(repository.delete(created.id)).toBe(true)
    expect(rowCount('tasks')).toBe(0)
  })

  it('reports false for an id that does not exist', () => {
    expect(repository.delete('no-existe')).toBe(false)
  })

  it('leaves other tasks untouched', () => {
    const keep = repository.create(newTask({ title: 'Se queda' }))
    repository.create(newTask({ title: 'Se borra' }))
    const doomed = repository.listByDate(TODAY).find((t) => t.title === 'Se borra')

    repository.delete(doomed?.id ?? '')

    expect(repository.listByDate(TODAY).map((t) => t.id)).toEqual([keep.id])
  })
})

describe('TasksRepository.countByDate', () => {
  it('counts only the requested day', () => {
    repository.create(newTask({ taskDate: TODAY }))
    repository.create(newTask({ taskDate: TODAY }))
    repository.create(newTask({ taskDate: TOMORROW }))

    expect(repository.countByDate(TODAY)).toBe(2)
    expect(repository.countByDate(TOMORROW)).toBe(1)
  })
})

describe('TasksRepository.transaction', () => {
  it('rolls back every write when the unit of work throws', () => {
    expect(() =>
      repository.transaction(() => {
        repository.create(newTask({ title: 'Se descarta' }))
        throw new Error('fallo simulado')
      })
    ).toThrow(/fallo simulado/)

    expect(rowCount('tasks')).toBe(0)
  })

  it('commits when the unit of work returns normally', () => {
    repository.transaction(() => repository.create(newTask()))

    expect(rowCount('tasks')).toBe(1)
  })
})
