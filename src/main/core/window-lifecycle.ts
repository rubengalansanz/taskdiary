/**
 * What has to happen to bring the window back (Fase 6, T6).
 *
 * Two callers need this answer and they must not give it differently: a click on the tray icon,
 * and the `second-instance` handler that has existed since Phase 1. T6 is what turns that into
 * a real risk — once minimizing *hides* the window, the old `if (isMinimized()) restore()`
 * reaches a window that is hidden rather than minimized, calls `focus()` on something the user
 * cannot see, and the app appears to have ignored the launch.
 *
 * The rule lives in one function so the two callers share it by construction rather than by
 * discipline.
 */

/** What the caller has to do to the window. */
export type ActivationAction =
  /** Nothing: either there is no window, or it is already visible and focusable. */
  | 'none'
  /** `restore()`. */
  | 'restore'
  /** `show()`. */
  | 'show'
  /** `show()` and then `restore()`, in that order. */
  | 'show-then-restore'

/** What the window currently looks like. */
export interface WindowState {
  /** False when the app has no window at all. */
  exists: boolean
  /** True when the window exists but is not on screen. */
  hidden: boolean
  /** True when the window is minimized. */
  minimized: boolean
}

/**
 * Decides how to bring a window forward.
 *
 * Order matters more than it looks. `show()` is what makes a hidden window visible; `restore()`
 * only un-minimises one that is already on screen. Restoring first and showing afterwards leaves
 * the window un-minimised but hidden, which is the exact failure T6 introduces if the two callers
 * disagree — so the both-true case is named rather than left to a boolean.
 *
 * @param state The window's current condition.
 * @returns What the caller must do. Never throws on an absent window.
 */
export function activationFor(state: WindowState): ActivationAction {
  if (!state.exists) {
    return 'none'
  }

  if (state.hidden) {
    return state.minimized ? 'show-then-restore' : 'show'
  }

  return state.minimized ? 'restore' : 'none'
}
