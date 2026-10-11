import { useCallback, useEffect, useMemo, useReducer, useSyncExternalStore } from 'react'
import { summarizeRange, TaskApiError } from '../shared/api/tasks-api'
import type { DaySummaryDto } from '../../../shared/ipc'

/**
 * Per-range day aggregates, as an external store.
 *
 * ADR-017 puts task data in an external store read through `useSyncExternalStore` rather than
 * in Zustand, and this follows that shape for the aggregates: the Week, Month and Heatmap
 * views are three readings of the same numbers, and a week has to survive navigating away from
 * it and back.
 *
 * The key is the range, not the day. A week view needs seven days, a month up to forty-two and
 * the heatmap 182, and the database can only answer a range in one grouped pass — so caching
 * per day would mean 182 round trips to build a screen that is a single query.
 */

/** Cached state of one range. */
interface RangeState {
  status: 'loading' | 'ready' | 'error'
  /** Days that hold work. Absent days are simply not in here. */
  days: DaySummaryDto[]
  error: string | null
}

/** Served while the first read for a range is in flight. */
const ABSENT: RangeState = { status: 'loading', days: [], error: null }

const ranges = new Map<string, RangeState>()
const inFlight = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

/**
 * How many ranges stay cached before the oldest are dropped.
 *
 * A month grid and a 26-week heatmap are two ranges; leaving a dozen keeps every month of the
 * current year warm without letting a long session accumulate one entry per week touched.
 */
const MAX_CACHED_RANGES = 12

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

function trim(): void {
  while (ranges.size > MAX_CACHED_RANGES) {
    const oldest = ranges.keys().next()

    if (oldest.done === true) break

    ranges.delete(oldest.value)
    inFlight.delete(oldest.value)
  }
}

/** Cache key for an inclusive range. */
function keyFor(fromDate: string, toDate: string): string {
  return `${fromDate}..${toDate}`
}

/**
 * Starts a read for the range unless one is already in flight or already cached.
 *
 * Safe to call on every render of every consumer: the in-flight map collapses concurrent
 * calls, so the Month view and the Heatmap opening at once over an overlapping range produce
 * one round trip each rather than one per component.
 *
 * @param fromDate First day of the range.
 * @param toDate Last day of the range, inclusive.
 */
function ensureLoaded(fromDate: string, toDate: string): void {
  const key = keyFor(fromDate, toDate)

  if (ranges.has(key) || inFlight.has(key)) {
    return
  }

  const pending = summarizeRange(fromDate, toDate)
    .then((loaded) => {
      inFlight.delete(key)
      ranges.set(key, { status: 'ready', days: loaded, error: null })
      trim()
      emit()
    })
    .catch((cause: unknown) => {
      inFlight.delete(key)
      ranges.set(key, {
        status: 'error',
        days: [],
        error: cause instanceof TaskApiError ? cause.message : 'No se pudieron cargar los totales.'
      })
      emit()
    })

  inFlight.set(key, pending)
}

/**
 * Drops every cached range.
 *
 * A write moves a task between days, changes its status or its estimate, and every one of
 * those moves three counters somewhere in the grid. No caller can name the ranges affected,
 * so the whole store goes.
 */
export function invalidateSummaries(): void {
  ranges.clear()
  inFlight.clear()
  emit()
}

/** What {@link useDaySummaries} exposes to a view. */
export interface UseDaySummariesResult {
  /** Aggregates indexed by day, so a cell looks itself up instead of scanning a list. */
  byDate: ReadonlyMap<string, DaySummaryDto>
  /** True until the first read for this range resolves. */
  isLoading: boolean
  /** Message when the read failed, `null` otherwise. */
  error: string | null
  /** Forces a re-read of the current range. */
  refresh: () => void
}

/**
 * Subscribes a view to one range's day aggregates.
 *
 * `byDate` starts empty and fills in. It is never replaced with a placeholder that collapses
 * the layout, because RNF-03's "sin parpadeo" is not about animation: a view that returns early
 * with a spinner on every navigation is exactly the blank flash the requirement forbids. The
 * grid is drawn from the dates in the URL, so it is on screen immediately and the numbers land
 * inside it.
 *
 * @param fromDate First day of the range, `YYYY-MM-DD`.
 * @param toDate Last day of the range, inclusive.
 * @returns The range's aggregates indexed by date, plus loading state and a refresh function.
 */
export function useDaySummaries(fromDate: string, toDate: string): UseDaySummariesResult {
  const key = keyFor(fromDate, toDate)

  // Bumping a counter re-renders after `invalidateSummaries` drops the entry, so the effect
  // below re-reads. Without it, an explicit refresh would leave the view on stale numbers.
  const [nonce, bump] = useReducer((value: number) => value + 1, 0)

  useEffect(() => {
    ensureLoaded(fromDate, toDate)
  }, [fromDate, toDate, nonce])

  const state = useSyncExternalStore(
    subscribe,
    (): RangeState => ranges.get(key) ?? ABSENT,
    (): RangeState => ABSENT
  )

  const byDate = useMemo(
    () => new Map(state.days.map((day) => [day.date, day])),
    [state.days]
  )

  const refresh = useCallback(() => {
    invalidateSummaries()
    bump()
  }, [])

  return {
    byDate,
    isLoading: state.status === 'loading',
    error: state.error,
    refresh
  }
}