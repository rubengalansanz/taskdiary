import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { listTags, searchTasks } from '../shared/api/tasks-api'
import type { SearchTasksRequest, TagDto, TaskDto, TaskStatusDto } from '../../../shared/ipc'

/**
 * Debounced search and tag listing, both cached per query.
 *
 * A cache rather than a request on every keystroke, and a debounce in front of it: typing
 * "informe" must not fire six searches across the whole history. The cache covers the
 * backspacing case — going back to a query already typed costs nothing.
 *
 * Same shape as `use-tasks`: an external store with `useSyncExternalStore`, because the
 * main process owns this data and the cache is only a projection of it.
 */

/** How long to wait after the last keystroke before searching. */
export const SEARCH_DEBOUNCE_MS = 150

/** One cached search. */
interface SearchEntry {
  status: 'loading' | 'ready' | 'error'
  tasks: TaskDto[]
  total: number
  truncated: boolean
  error: string | null
}

const LOADING: SearchEntry = {
  status: 'loading',
  tasks: [],
  total: 0,
  truncated: false,
  error: null
}

const searches = new Map<string, SearchEntry>()
const listeners = new Set<() => void>()

/** Maximum queries kept; the oldest are dropped first. */
const MAX_CACHED_SEARCHES = 20

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

/**
 * Builds the cache key for a filter.
 *
 * The filter object is stable per render only when the store is stable, so the key is
 * built from its parts rather than from `JSON.stringify` of a live object.
 *
 * @param query Search text.
 * @param statuses Selected statuses.
 * @param tagIds Selected tag ids.
 * @returns A key that is equal exactly when two searches would return the same rows.
 */
function cacheKey(query: string, statuses: TaskStatusDto[], tagIds: string[]): string {
  const parts = [
    query.trim().toLowerCase(),
    [...statuses].sort().join('|'),
    [...tagIds].sort().join('|')
  ]

  return parts.join('::')
}

function trim(): void {
  while (searches.size > MAX_CACHED_SEARCHES) {
    const oldest = searches.keys().next()

    if (oldest.done === true) break

    searches.delete(oldest.value)
  }
}

/** Drops every cached search and tells the subscribers. */
export function invalidateSearches(): void {
  searches.clear()
  emit()
}

/** What {@link useSearch} exposes. */
export interface UseSearchResult extends SearchEntry {
  /** True while the text differs from what has been searched for. */
  isDebouncing: boolean
  /** Runs the search again, bypassing the cache. */
  refresh: () => void
}

/**
 * Searches the history, debounced by {@link SEARCH_DEBOUNCE_MS}.
 *
 * The debounce is expressed as "the applied filter lags behind the typed one" rather than
 * as a timer that calls `setState` in an effect body: nothing is set synchronously
 * during render, and the pending value is visible as {@link UseSearchResult.isDebouncing}.
 *
 * @param query Free text the user typed.
 * @param statuses Selected statuses.
 * @param tagIds Selected tag ids.
 * @returns The matching tasks, the real total, and whether the list was cut short.
 */
export function useSearch(
  query: string,
  statuses: TaskStatusDto[],
  tagIds: string[]
): UseSearchResult {
  const wantedKey = cacheKey(query, statuses, tagIds)
  const [applied, setApplied] = useState({ key: wantedKey, query, statuses, tagIds })
  // Bumped by `refresh()`. Without it a refresh would only mutate the cache and the fetch
  // effect below — whose deps never change — would not re-run, leaving the entry stuck in
  // LOADING forever.
  const [nonce, setNonce] = useState(0)

  const isDebouncing = applied.key !== wantedKey

  useEffect(() => {
    if (applied.key === wantedKey) {
      return undefined
    }

    const timer = setTimeout(() => {
      setApplied({ key: wantedKey, query, statuses, tagIds })
    }, SEARCH_DEBOUNCE_MS)

    return (): void => {
      clearTimeout(timer)
    }
  }, [applied.key, wantedKey, query, statuses, tagIds])

  useEffect(() => {
    if (searches.has(applied.key)) {
      return undefined
    }

    searches.set(applied.key, LOADING)
    emit()

    const request: SearchTasksRequest = {
      ...(applied.query.trim().length === 0 ? {} : { query: applied.query }),
      ...(applied.statuses.length === 0 ? {} : { statuses: applied.statuses }),
      ...(applied.tagIds.length === 0 ? {} : { tagIds: applied.tagIds })
    }

    void searchTasks(request)
      .then((result) => {
        searches.set(applied.key, {
          status: 'ready',
          tasks: result.tasks,
          total: result.total,
          truncated: result.truncated,
          error: null
        })
        trim()
        emit()
      })
      .catch((cause: unknown) => {
        searches.set(applied.key, {
          ...LOADING,
          status: 'error',
          error: cause instanceof Error ? cause.message : 'No se pudo buscar.'
        })
        emit()
      })
  }, [applied.key, applied.query, applied.statuses, applied.tagIds, nonce])

  const state = useSyncExternalStore(
    subscribe,
    (): SearchEntry => searches.get(applied.key) ?? LOADING,
    (): SearchEntry => LOADING
  )

  const refresh = useCallback(() => {
    searches.delete(applied.key)
    setNonce((value) => value + 1)
  }, [applied.key])

  return { ...state, isDebouncing, refresh }
}

/**
 * The tag list, cached for the session and published as a store.
 *
 * Subscribed through `useSyncExternalStore` like the other two caches, not through a
 * one-shot `useEffect`. The difference is not cosmetic: `invalidateTags()` emits, and a
 * subscriber that never subscribed simply does not hear it, so a tag created through the
 * form would not appear in the sidebar until the window was reloaded.
 */

/** What the tag store publishes. */
interface TagsSnapshot {
  /** The tags, most used first. */
  tags: TagDto[]
  /** True while a read is in flight. */
  isLoading: boolean
  /** Failure message, or `null`. */
  error: string | null
  /** Bumped by every invalidation, so the loading effect re-runs. */
  revision: number
}

let tagsSnapshot: TagsSnapshot = { tags: [], isLoading: true, error: null, revision: 0 }
let tagsPending: Promise<void> | null = null

function publishTags(next: Partial<TagsSnapshot>): void {
  tagsSnapshot = { ...tagsSnapshot, ...next }
  emit()
}

function getTagsSnapshot(): TagsSnapshot {
  return tagsSnapshot
}

/**
 * Starts a read of the tag list, unless one is already cached or in flight.
 *
 * A write landing mid-flight invalidates the answer: the response describes the state
 * before the write, and publishing it would put the sidebar back where it started. So the
 * revision is captured at request time and compared on arrival — a stale response is
 * dropped, `isLoading` stays true from the invalidation, and `finally` re-arms the read.
 *
 * Without that last step the invalidation is lost silently and the sidebar sits on
 * pre-write tags until the *next* write.
 */
function ensureTags(): void {
  if (!tagsSnapshot.isLoading || tagsPending !== null) {
    return
  }

  const startedAtRevision = tagsSnapshot.revision

  tagsPending = listTags()
    .then((tags) => {
      if (tagsSnapshot.revision !== startedAtRevision) {
        return
      }

      publishTags({ tags, isLoading: false, error: null })
    })
    .catch((cause: unknown) => {
      if (tagsSnapshot.revision !== startedAtRevision) {
        return
      }

      publishTags({
        tags: [],
        isLoading: false,
        error: cause instanceof Error ? cause.message : 'No se pudieron cargar las etiquetas.'
      })
    })
    .finally(() => {
      tagsPending = null

      if (tagsSnapshot.isLoading) {
        ensureTags()
      }
    })
}

/**
 * Marks the tag list stale and tells every subscriber.
 *
 * The list is not refetched here: the sidebar does it in response, so a write that did
 * not actually change the tags — renaming a task's title — costs no round trip.
 */
export function invalidateTags(): void {
  publishTags({
    tags: [],
    isLoading: true,
    error: null,
    revision: tagsSnapshot.revision + 1
  })
}

/** What {@link useTags} exposes. */
export interface UseTagsResult {
  /** The tags, most used first. */
  tags: TagDto[]
  /** True while a read is in flight. */
  isLoading: boolean
  /** Failure message, or `null`. */
  error: string | null
}

/**
 * Subscribes the sidebar to the tag list.
 *
 * @returns The tags plus loading and error state.
 */
export function useTags(): UseTagsResult {
  const snapshot = useSyncExternalStore(subscribe, getTagsSnapshot, getTagsSnapshot)

  useEffect(() => {
    ensureTags()
  }, [snapshot.isLoading, snapshot.revision])

  return { tags: snapshot.tags, isLoading: snapshot.isLoading, error: snapshot.error }
}
