import { useEffect } from 'react'
import { invalidateAll } from '../hooks/use-tasks'
import { UNDO_NOTICE_MS } from '../../../shared/ipc'
import { undoTask } from '../shared/api/tasks-api'
import { useUiStore } from '../stores/ui-store'

/**
 * The 5 s "Deshacer" notice (Fase 6, S2).
 *
 * Mounted once by the shell, for the same reason the palette is: completing a task from the
 * keyboard, or deleting one from the day view, should leave the same offer wherever the user
 * happens to be five seconds later.
 *
 * The duration is the main process's `UNDO_NOTICE_MS`, not a number written here. The main
 * process is the one that decides how long a snapshot is actually restorable, and a notice that
 * outlived its token would offer a button that silently does nothing.
 */

/**
 * Renders the notice.
 *
 * @returns The notice element, or nothing when no notice is showing.
 */
export function UndoNoticeView(): React.JSX.Element | null {
  const notice = useUiStore((state) => state.undoNotice)
  const clearUndoNotice = useUiStore((state) => state.clearUndoNotice)

  useEffect(() => {
    if (notice === null) {
      return
    }

    const timer = setTimeout(clearUndoNotice, UNDO_NOTICE_MS)

    return (): void => {
      clearTimeout(timer)
    }
  }, [notice, clearUndoNotice])

  async function undo(): Promise<void> {
    if (notice === null) {
      return
    }

    // Take the notice down first: the operation is already on its way, and leaving the button
    // up would invite a second press that the token has already been spent on.
    clearUndoNotice()

    await undoTask(notice.token)

    // The restore rewrote a row the day view may have cached before the change, so every
    // cached day is now stale — not just the one the notice came from, because a deleted task
    // can have been counted in a search or a summary too.
    invalidateAll()
  }

  if (notice === null) {
    return null
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-notice"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-md border border-border bg-background px-4 py-3 text-sm shadow-lg"
    >
      <span>{notice.message}</span>
      <button
        type="button"
        data-testid="undo-notice-action"
        onClick={(): void => {
          void undo()
        }}
        className="font-medium underline underline-offset-2"
      >
        Deshacer
      </button>
    </div>
  )
}
