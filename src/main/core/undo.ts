import { randomUUID } from 'node:crypto'
import { UNDO_NOTICE_MS } from '../../shared/ipc'

/**
 * Snapshots behind the 5 s undo notice (S2).
 *
 * Undoing a completion cannot be `done → pending`: `TASK_STATUS_TRANSITIONS` makes `done`
 * terminal so that what was recorded as finished cannot later be rewritten, and reopening the
 * task in two hops would be a restriction in name only. So undo does not replay a transition at
 * all. It restores the row as it was captured immediately before the operation — which is what
 * `task.ts` says Fase 6 was always meant to do.
 *
 * The snapshot lives here rather than in the renderer for one reason: the renderer would have to
 * send the whole task back, and a channel that writes arbitrary task fields is a second way into
 * the database that skips every check `update` performs. A token issued from a row that was
 * already valid cannot be forged into anything else.
 */

/** How long a snapshot stays restorable: the notice the user sees. */
export const UNDO_TTL_MS = UNDO_NOTICE_MS

/**
 * How many snapshots are kept at once.
 *
 * The renderer shows one notice, so a handful is generous. The bound exists for the other case:
 * a client that loops. Each entry is one task, and an unbounded map in a long-lived main process
 * is a leak that only shows up after the app has been open for days.
 */
export const UNDO_CAPACITY = 20

/** One restorable operation. */
export interface UndoSnapshot<T> {
  /**
   * The task exactly as it was before the operation.
   *
   * Generic because what a faithful restore needs is not the same as what the renderer is shown:
   * the domain `Task` has no `seriesId`, and a recurring occurrence restored without its link to
   * its series stops materialising the next one. The repository stores a richer payload than the
   * UI ever sees, and this store does not care which.
   */
  task: T
  /**
   * True when the task was deleted, false when it was completed.
   *
   * Restoring is not the same statement in the two cases: a completion puts the old row back,
   * while a deletion has to re-insert a row that no longer exists. Keeping the distinction here
   * means the restore path never has to guess which happened.
   */
  wasDeleted: boolean
}

interface Entry<T> {
  snapshot: UndoSnapshot<T>
  expiresAt: number
}

/** Constructors' options. Present so the clock can be controlled in tests. */
export interface UndoStoreOptions {
  /** How many snapshots to keep. Defaults to {@link UNDO_CAPACITY}. */
  capacity?: number
  /** How long a snapshot stays restorable. Defaults to {@link UNDO_TTL_MS}. */
  ttlMs?: number
  /** Clock source. Defaults to `Date.now`. */
  now?: () => number
}

/**
 * A bounded, single-use store of undo snapshots.
 *
 * Every `remember` is paired with exactly one `take`: the token is consumed when it is read, so
 * a notice that can be double-clicked, or a channel that can be replayed, cannot resurrect a
 * task the user deleted on purpose.
 */
export class UndoStore<T> {
  private readonly entries = new Map<string, Entry<T>>()
  private readonly capacity: number
  private readonly ttlMs: number
  private readonly now: () => number

  /**
   * @param options Capacity, lifetime and clock overrides.
   */
  constructor(options: UndoStoreOptions = {}) {
    this.capacity = options.capacity ?? UNDO_CAPACITY
    this.ttlMs = options.ttlMs ?? UNDO_TTL_MS
    this.now = options.now ?? Date.now
  }

  /** How many snapshots are currently restorable, expired ones excluded. */
  get size(): number {
    this.prune()

    return this.entries.size
  }

  /**
   * Stores a snapshot and returns the token that restores it.
   *
   * @param snapshot The task before the operation, and whether it was deleted.
   * @returns An opaque, single-use token.
   */
  remember(snapshot: UndoSnapshot<T>): string {
    this.prune()

    const token = randomUUID()
    this.entries.set(token, { snapshot, expiresAt: this.now() + this.ttlMs })

    // `Map` keeps insertion order, so the first key is the oldest — which is exactly the one to
    // drop. Evicting the newest instead would throw away the notice the user is looking at.
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next()

      if (oldest.done === true) {
        break
      }

      this.entries.delete(oldest.value)
    }

    return token
  }

  /**
   * Consumes a token and returns what it restores.
   *
   * @param token A token from {@link remember}.
   * @returns The snapshot, or `null` when the token is unknown, already used or expired.
   */
  take(token: string): UndoSnapshot<T> | null {
    this.prune()

    const entry = this.entries.get(token)

    if (entry === undefined) {
      return null
    }

    this.entries.delete(token)

    return entry.snapshot
  }

  /** Drops every snapshot whose notice has run out. */
  private prune(): void {
    const now = this.now()

    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(token)
      }
    }
  }
}
