/**
 * Which surface the day list shows (Fase 6, S4).
 *
 * The precedence lived in four inline conditions inside `TaskList`, over a `tasks` prop typed as
 * nullable. It never was nullable — `DayState.tasks` is `TaskDto[]` — so the loading branch was
 * unreachable and the list rendered nothing at all on a first read. Pulling the decision into a
 * function this plain is what makes it testable at all: this project runs vitest on
 * `environment: 'node'` with no jsdom, so anything decided inside JSX is only ever checked by
 * looking at the screen.
 */

/** What the day list shows for a given read. */
export type ListSurface = 'loading' | 'error' | 'empty' | 'rows'

/** What the props say about the current read. */
export interface ListSurfaceInput {
  /** True while a read is in flight. */
  isLoading: boolean
  /** Failure message from the last read, or `null`. */
  error: string | null
  /** How many tasks came back. */
  taskCount: number
  /** True when the rows come from a search rather than from the day. */
  searching: boolean
}

/**
 * Picks the one surface to render.
 *
 * The order is the whole point. A failure outranks everything: after a failed read the count is
 * not zero, it is unknown, and the empty state would be asserting something nobody knows. A
 * failure also outranks an in-flight retry, because replacing a known error with a skeleton
 * removes the one action the user still has at the moment they most want it.
 *
 * @param input The current props.
 * @returns The surface to render. Never null: every combination lands somewhere.
 */
export function resolveListSurface(input: ListSurfaceInput): ListSurface {
  if (input.error !== null) {
    return 'error'
  }

  if (input.isLoading) {
    return 'loading'
  }

  return input.taskCount === 0 ? 'empty' : 'rows'
}
