import { useCallback, useEffect, useReducer, useSyncExternalStore } from 'react'
import { listTasks, TaskApiError } from '../shared/api/tasks-api'
import type { TaskDto } from '../../../shared/ipc'

/**
 * Per-day task cache, as an external store.
 *
 * Deliberately not a Zustand store. ADR-006 splits the two on purpose: Zustand holds
 * *UI* state the user chose, while task data is *server state* — owned by the main
 * process, fetched on demand, replaceable, and never a source of truth here. Modelling it
 * as an external store with `useSyncExternalStore` says exactly that, and it means a
 * mutation invalidates one place instead of two.
 *
 * Invalidation is by date, never by id. A write can move a task between days, and a cache
 * keyed by identity would miss the day the task left.
 */

/** Lifecycle of one day's data. */
export type DayStatus = 'loading' | 'ready' | 'error'

/** State of one cached day. */
export interface DayState {
  /** Where the read got to. */
  status: DayStatus
  /** Tasks read so far; empty while the first read is in flight. */
  tasks: TaskDto[]
  /** Human readable failure reason, or `null`. */
  error: string | null
}

const READY_EMPTY: DayState = { status: 'ready', tasks: [], error: null }
const LOADING: DayState = { status: 'loading', tasks: [], error: null }

/** Days that have never been read: not loading, not ready, just absent. */
const ABSENT: DayState = { status: 'loading', tasks: [], error: null }

const days = new Map<string, DayState>()
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

/** How many days stay cached before the oldest are dropped. */
const MAX_CACHED_DAYS = 31

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return (): void => {
    listeners.delete(listener)
  }
}

function trim(): void {
  while (days.size > MAX_CACHED_DAYS) {
    const oldest = days.keys().next()

    if (oldest.done === true) break

    days.delete(oldest.value)
    inFlight.delete(oldest.value)
  }
}

/**
 * Starts a read for `taskDate` unless one is already in flight or already cached.
 *
 * Safe to call on every render of every consumer: the in-flight map collapses concurrent
 * calls, so two components mounting on the same day produce one IPC round trip, not two.
 *
 * @param taskDate Day to load.
 */
function ensureLoaded(taskDate: string): void {
  if (days.has(taskDate) || inFlight.has(taskDate)) {
    return
  }

  const pending = listTasks(taskDate)
    .then((loaded) => {
      inFlight.delete(taskDate)
      days.set(taskDate, { status: 'ready', tasks: loaded, error: null })
      trim()
      emit()
    })
    .catch((cause: unknown) => {
      inFlight.delete(taskDate)
      days.set(taskDate, {
        status: 'error',
        tasks: [],
        error: cause instanceof TaskApiError ? cause.message : 'No se pudieron cargar las tareas.'
      })
      emit()
    })

  inFlight.set(taskDate, pending)
}

/**
 * Drops the cached list for one day and tells any subscriber.
 *
 * Emits even though the caller usually follows with `refresh()`: a second subscriber on
 * the same day has no nonce of its own to bump, and would otherwise keep rendering the
 * entry this call just removed.
 *
 * @param taskDate Day to forget.
 */
export function invalidateDate(taskDate: string): void {
  days.delete(taskDate)
  inFlight.delete(taskDate)
  emit()
}

/**
 * Drops both days a write can touch: the day the task is on now, and the one it left if
 * the write moved it.
 *
 * @param currentDay Day before the write.
 * @param nextDay Day after the write, when it changed.
 */
export function invalidateMove(currentDay: string, nextDay?: string): void {
  invalidateDate(currentDay)

  if (nextDay !== undefined && nextDay !== currentDay) {
    invalidateDate(nextDay)
  }
}

/**
 * Drops every cached day.
 *
 * For changes whose footprint the caller cannot name — an import, or a materialisation
 * reaching back over past days.
 */
export function invalidateAll(): void {
  days.clear()
  inFlight.clear()
  emit()
}

/** What {@link useTasks} exposes to a view. */
export interface UseTasksResult extends DayState {
  /** Forces a re-read of the current day. */
  refresh: () => void
}

/**
 * Subscribes the component to one day's cached tasks.
 *
 * The first read per day goes to the main process. Navigating back to a day already seen
 * is served from the cache, which is what keeps day-to-day switching inside the 100 ms of
 * RNF-03 without loading the whole table into memory.
 *
 * @param taskDate Day as `YYYY-MM-DD`.
 * @returns That day's state plus a refresh function.
 */
export function useTasks(taskDate: string): UseTasksResult {
  // Bumping a counter re-renders after `invalidateDate` drops the entry, so the effect
  // below re-reads. Without it, an explicit refresh would leave the view on stale data.
  const [nonce, bump] = useReducer((value: number) => value + 1, 0)

  useEffect(() => {
    ensureLoaded(taskDate)
  }, [taskDate, nonce])

  const state = useSyncExternalStore(
    subscribe,
    (): DayState => days.get(taskDate) ?? ABSENT,
    (): DayState => ABSENT
  )

  const refresh = useCallback(() => {
    invalidateDate(taskDate)
    bump()
  }, [taskDate])

  return { ...state, refresh }
}

/**
 * Reads a day's state without subscribing.
 *
 * For code that needs the value outside React's render cycle.
 *
 * @param taskDate Day as `YYYY-MM-DD`.
 * @returns The cached state, or `null` when the day was never read.
 */
export function peekDay(taskDate: string): DayState | null {
  return days.get(taskDate) ?? null
}

export { LOADING, READY_EMPTY }
