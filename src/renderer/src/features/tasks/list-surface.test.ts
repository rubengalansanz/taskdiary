import { describe, expect, it } from 'vitest'
import { resolveListSurface } from './list-surface'

/**
 * Which surface the day list shows (Fase 6, S4).
 *
 * `TaskList` used to decide this with four inline `&&` conditions over a `tasks` prop typed as
 * nullable. It never was: `DayState.tasks` is `TaskDto[]`, so the `tasks === null` branch was
 * unreachable, and a first read rendered *nothing at all* — no rows, no message, no skeleton.
 * On a failure the same conditions then showed the error and, right under it, "there are no tasks
 * for this day", which is the one thing nobody knows after a failed read.
 *
 * The precedence lives in one function so it can be pinned here rather than re-derived by
 * reading JSX.
 */

describe('resolveListSurface', () => {
  it('shows a skeleton while the first read is in flight', () => {
    // The bug: loading produced an empty array and every old branch was false, so the user saw
    // a blank panel with no indication anything was happening.
    expect(
      resolveListSurface({ isLoading: true, error: null, taskCount: 0, searching: false })
    ).toBe('loading')
  })

  it('shows the rows once there are some', () => {
    expect(
      resolveListSurface({ isLoading: false, error: null, taskCount: 3, searching: false })
    ).toBe('rows')
  })

  it('shows the empty state for a day with no tasks', () => {
    expect(
      resolveListSurface({ isLoading: false, error: null, taskCount: 0, searching: false })
    ).toBe('empty')
  })

  it('shows the error above everything else', () => {
    // A failed read means the count is not zero, it is unknown. Claiming otherwise in the empty
    // state below it was the second half of the bug.
    expect(
      resolveListSurface({
        isLoading: false,
        error: 'No se pudo leer',
        taskCount: 0,
        searching: false
      })
    ).toBe('error')
    expect(
      resolveListSurface({
        isLoading: false,
        error: 'No se pudo leer',
        taskCount: 4,
        searching: false
      })
    ).toBe('error')
  })

  it('keeps the error visible while a retry is already running', () => {
    // Hiding a known failure behind a skeleton to show "Cargando…" takes away the one thing the
    // user can act on — which is re-trying — at the exact moment they want to do it.
    expect(
      resolveListSurface({
        isLoading: true,
        error: 'No se pudo leer',
        taskCount: 0,
        searching: false
      })
    ).toBe('error')
  })

  it('treats a search that matches nothing as the same empty surface', () => {
    expect(
      resolveListSurface({ isLoading: false, error: null, taskCount: 0, searching: true })
    ).toBe('empty')
  })

  it('never returns a surface that leaves the panel blank', () => {
    // Every combination the props can take has to land on something. This is the regression the
    // original four conditions could not survive.
    for (const isLoading of [true, false]) {
      for (const error of [null, 'fallo']) {
        for (const taskCount of [0, 2]) {
          for (const searching of [true, false]) {
            expect(resolveListSurface({ isLoading, error, taskCount, searching })).not.toBeNull()
          }
        }
      }
    }
  })
})
