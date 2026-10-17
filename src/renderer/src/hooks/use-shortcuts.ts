import { useCallback, useEffect } from 'react'
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
 * The single implementation of every application command.
 *
 * Three callers now reach a command — the keyboard, the native menu, and the `Ctrl+K` palette —
 * and they have to reach the *same* one. Keeping the switch inside `useGlobalShortcuts` would
 * have forced the palette to grow its own copy, which is exactly the drift the file header warns
 * against: a palette whose "Día anterior" navigates somewhere the menu's does not. So the switch
 * lives here and the palette calls it like everyone else.
 *
 * Reads the URL and the store when it fires, so it never closes over stale state.
 *
 * @returns A function taking a command channel.
 */
export function useRunCommand(): (channel: string) => void {
  const navigate = useNavigate()
  const openDialog = useUiStore((state) => state.openDialog)

  return useCallback(
    (channel: string): void => {
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
    },
    [navigate, openDialog]
  )
}

/**
 * Binds the application commands.
 *
 * Must be called from inside a `Router` and while the window exists.
 */
export function useGlobalShortcuts(): void {
  const runCommand = useRunCommand()
  const dialog = useUiStore((state) => state.dialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const paletteOpen = useUiStore((state) => state.paletteOpen)
  const openPalette = useUiStore((state) => state.openPalette)
  const closePalette = useUiStore((state) => state.closePalette)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Escape closes the dialog and nothing else: an Esc that navigated away would lose
      // the user's place in their own history.
      if (event.key === 'Escape') {
        if (dialog !== null) {
          event.preventDefault()
          closeDialog()
        }

        if (paletteOpen) {
          event.preventDefault()
          closePalette()
        }

        return
      }

      if (!event.ctrlKey && !event.metaKey) {
        return
      }

      // While the palette is up it owns every modifier combination: `Ctrl+Left` in there means
      // "move between palette rows", not "go to the previous day". Letting the day navigation
      // through would have the palette and the shell fighting over the arrow keys. Only `Ctrl+K`
      // still belongs to the shell while it is open, and that is handled here.
      if (paletteOpen) {
        if (event.key === 'k' || event.key === 'K') {
          event.preventDefault()
          closePalette()
        }

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

        case 'k':
        case 'K':
          event.preventDefault()
          openPalette()
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
  }, [runCommand, dialog, closeDialog, paletteOpen, openPalette, closePalette])
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
