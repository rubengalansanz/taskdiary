import { describe, expect, it } from 'vitest'
import { UNDO_CAPACITY, UNDO_TTL_MS, UndoStore } from './undo'
import type { Task } from './task'

/**
 * The undo snapshots behind the 5 s notice (S2).
 *
 * `done` is terminal, so undoing a completion cannot be `done → pending` — the domain refuses
 * that transition on purpose. Fase 6 therefore stores what the row looked like *before* the
 * operation and writes it back. These tests pin the properties that make that safe to offer:
 * a token restores exactly once, an unknown or expired token restores nothing, and the store
 * cannot grow without bound.
 */

/** A minimal task; only the fields the store reads matter here. */
function aTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Standup',
    notes: null,
    taskDate: '2026-10-10',
    status: 'done',
    startMin: 540,
    endMin: null,
    estimateMin: null,
    color: null,
    tags: ['proyecto'],
    rruleFreq: 'none',
    rruleInterval: 1,
    rruleDays: null,
    rruleUntil: null,
    rruleFrom: null,
    createdAt: '2026-10-09T10:00:00.000Z',
    updatedAt: '2026-10-10T11:00:00.000Z',
    startedAt: null,
    completedAt: '2026-10-10T11:00:00.000Z',
    sortOrder: null,
    ...overrides
  }
}

describe('UndoStore', () => {
  it('hands back a token that restores the snapshot it stored', () => {
    const store = new UndoStore<Task>()
    const token = store.remember({ task: aTask(), wasDeleted: false })

    expect(token).toBeTruthy()
    expect(store.take(token)).toEqual({ task: aTask(), wasDeleted: false })
  })

  it('restores a snapshot only once', () => {
    const store = new UndoStore<Task>()
    const token = store.remember({ task: aTask(), wasDeleted: true })

    expect(store.take(token)).not.toBeNull()
    // The notice can be clicked twice, or the channel can be replayed. A second restore would
    // resurrect a task the user deleted on purpose.
    expect(store.take(token)).toBeNull()
  })

  it('restores nothing for a token it never issued', () => {
    const store = new UndoStore<Task>()

    expect(store.take('not-a-token')).toBeNull()
    expect(store.take('')).toBeNull()
  })

  it('never issues the same token twice', () => {
    const store = new UndoStore<Task>()
    const tokens = new Set(
      Array.from({ length: 50 }, () => store.remember({ task: aTask(), wasDeleted: false }))
    )

    expect(tokens.size).toBe(50)
  })

  it('forgets a snapshot once the notice has expired', () => {
    let clock = 1_000
    const store = new UndoStore<Task>({ ttlMs: UNDO_TTL_MS, now: () => clock })
    const token = store.remember({ task: aTask(), wasDeleted: false })

    clock += UNDO_TTL_MS - 1
    expect(store.take(token)).not.toBeNull()

    const later = store.remember({ task: aTask(), wasDeleted: false })
    clock += UNDO_TTL_MS + 1
    expect(store.take(later)).toBeNull()
  })

  it('keeps only the most recent snapshots once it is full', () => {
    let clock = 0
    const store = new UndoStore<Task>({ capacity: 3, ttlMs: 10_000, now: () => clock })

    const tokens = Array.from({ length: 5 }, () => {
      clock += 1

      return store.remember({ task: aTask(), wasDeleted: false })
    })

    expect(store.size).toBe(3)
    // The two oldest fell out; the three newest are still restorable.
    expect(store.take(tokens[0])).toBeNull()
    expect(store.take(tokens[1])).toBeNull()
    expect(store.take(tokens[4])).not.toBeNull()
  })

  it('has a capacity that cannot be turned into unbounded memory', () => {
    // The renderer only ever shows one notice, but a misbehaving client could loop. The default
    // bound is the backstop for that, not a number to tune per install.
    expect(UNDO_CAPACITY).toBeGreaterThan(0)
    expect(UNDO_CAPACITY).toBeLessThanOrEqual(100)
  })

  it('shows a five second notice, not an indefinite one', () => {
    // The notice is an escape hatch, not an edit history: it disappears on its own so a task
    // deleted by accident does not haunt the user with a stale "Deshacer" tomorrow.
    expect(UNDO_TTL_MS).toBe(5_000)
  })
})
