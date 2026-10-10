import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '../stores/ui-store'
import { addDays, normalizeDateParam, today } from '../shared/lib/date'
import { IPC_CHANNELS } from '../../../shared/ipc'

/**
 * Application commands, bound to both the keyboard and the native menu.
 *
 * One table, two triggers. A menu accelerator and its keyboard shortcut reach this module
 * by different routes — `keydown` and an IPC push from the main process — but they end up
 * in the same `runCommand`, so the two cannot drift apart.
 *
 * The bindings live at window level so they keep working while focus is inside a dialog
 * or a text field. Every handler reads the URL and the store at the moment it fires, so
 * none of them closes over stale state.
 */

/**
 * Event announcing "complete the selected task".
 *
 * Completing needs the day view, which owns the write and the error surface. A window
 * level binding cannot reach it without duplicating the day's logic, so the command is
 * announced and the view decides whether it applies.
 */
export const COMPLETE_SELECTED_EVENT = 'taskdiary:complete-selected'

/**
 * Binds the application commands.
 *
 * Must be called from inside a `Router` and while the window exists.
 */
export function useGlobalShortcuts(): void {
  const navigate = useNavigate()
  const dialog = useUiStore((state) => state.dialog)
  const openDialog = useUiStore((state) => state.openDialog)
  const closeDialog = useUiStore((state) => state.closeDialog)

  useEffect(() => {
    function runCommand(channel: string): void {
      switch (channel) {
        case IPC_CHANNELS.menuNewTask:
          openDialog('create')
          break

        case IPC_CHANNELS.menuToday:
          void navigate(`/day/${today()}`)
          break

        case IPC_CHANNELS.menuPreviousDay:
          void navigate(`/day/${addDays(currentDay(), -1)}`)
          break

        case IPC_CHANNELS.menuNextDay:
          void navigate(`/day/${addDays(currentDay(), 1)}`)
          break

        case IPC_CHANNELS.menuCompleteSelected:
          window.dispatchEvent(new CustomEvent(COMPLETE_SELECTED_EVENT))
          break

        default:
          break
      }
    }

    function onKeyDown(event: KeyboardEvent): void {
      // Escape closes the dialog and nothing else: an Esc that navigated away would lose
      // the user's place in their own history.
      if (event.key === 'Escape') {
        if (dialog !== null) {
          event.preventDefault()
          closeDialog()
        }

        return
      }

      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      switch (event.key) {
        case 'n':
        case 'N':
          event.preventDefault()
          runCommand(IPC_CHANNELS.menuNewTask)
          break

        case 'ArrowLeft':
          event.preventDefault()
          runCommand(IPC_CHANNELS.menuPreviousDay)
          break

        case 'ArrowRight':
          event.preventDefault()
          runCommand(IPC_CHANNELS.menuNextDay)
          break

        case 't':
        case 'T':
          event.preventDefault()
          runCommand(IPC_CHANNELS.menuToday)
          break

        default:
          break
      }
    }

    const unsubscribeMenu = window.taskDiary.menu.onCommand(runCommand)

    window.addEventListener('keydown', onKeyDown)

    return (): void => {
      window.removeEventListener('keydown', onKeyDown)
      unsubscribeMenu()
    }
  }, [navigate, dialog, openDialog, closeDialog])
}

/**
 * Runs `onComplete` when the complete-selected command fires.
 *
 * @param onComplete Receives the id of the task to complete.
 */
export function useCompleteSelected(onComplete: (taskId: string) => void): void {
  useEffect(() => {
    function onCompleteSelected(): void {
      // Read the store imperatively: the command arrives as an event, and subscribing to
      // the store here would re-register the listener on every selection change.
      const { selectedTaskId } = useUiStore.getState()

      if (selectedTaskId !== null) {
        onComplete(selectedTaskId)
      }
    }

    window.addEventListener(COMPLETE_SELECTED_EVENT, onCompleteSelected)

    return (): void => {
      window.removeEventListener(COMPLETE_SELECTED_EVENT, onCompleteSelected)
    }
  }, [onComplete])
}

/** Reads the day currently in the URL hash. */
function currentDay(): string {
  const match = window.location.hash.match(/\/day\/(\d{4}-\d{2}-\d{2})/)

  return normalizeDateParam(match?.[1])
}
