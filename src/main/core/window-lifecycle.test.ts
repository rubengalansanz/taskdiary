import { describe, expect, it } from 'vitest'
import { activationFor } from './window-lifecycle'

/**
 * What has to happen to bring the window back (Fase 6, T6).
 *
 * Two callers need this answer and they must not answer it differently: a click on the tray
 * icon, and the `second-instance` handler that already existed. T6 is what makes that a real
 * risk — once minimizing hides the window, the old handler's `if (isMinimized()) restore()`
 * reaches a window that is *hidden* rather than minimized, calls `focus()` on something the
 * user cannot see, and the app looks like it ignored the launch.
 *
 * The rule lives here so the two callers share it by construction.
 */

describe('activationFor', () => {
  it('does nothing when there is no window to show', () => {
    // The caller answers this one by creating a window; this function only says what to do with
    // one that already exists.
    expect(activationFor({ exists: false, hidden: false, minimized: false })).toBe('none')
  })

  it('restores a minimized window', () => {
    expect(activationFor({ exists: true, hidden: false, minimized: true })).toBe('restore')
  })

  it('shows a window that minimizing hid to the tray', () => {
    expect(activationFor({ exists: true, hidden: true, minimized: false })).toBe('show')
  })

  it('shows before restoring when a window is both', () => {
    // `show()` is what makes it visible at all; `restore()` only un-minimises a window that is
    // already on screen. Doing them in the wrong order leaves the window restored but hidden,
    // which is the bug this whole extraction exists to prevent.
    expect(activationFor({ exists: true, hidden: true, minimized: true })).toBe('show-then-restore')
  })

  it('leaves an ordinary visible window alone', () => {
    // Already on screen: the caller only needs to focus it, which is not an activation.
    expect(activationFor({ exists: true, hidden: false, minimized: false })).toBe('none')
  })

  it('answers the same way for every combination it can be handed', () => {
    const actions = new Set<string>()

    for (const exists of [true, false]) {
      for (const hidden of [true, false]) {
        for (const minimized of [true, false]) {
          actions.add(activationFor({ exists, hidden, minimized }))
        }
      }
    }

    expect(actions).toEqual(new Set(['none', 'restore', 'show', 'show-then-restore']))
  })
})
