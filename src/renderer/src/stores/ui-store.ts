import { create } from 'zustand'

/**
 * UI-only state (ADR-006, plan rule §2.6).
 *
 * The selected date is deliberately **absent**: it lives in the URL
 * (`/day/2026-10-10`) so the day is linkable and the system back button works, which is
 * the whole point of a diary you navigate backwards through. What stays here is state the
 * user chose that nobody would put in a URL — which view is active, whether the form is
 * open.
 *
 * Task data is not here either. It is server state with its own cache in
 * `hooks/use-tasks.ts`; putting it in Zustand would mean invalidating it in two places.
 */

/** Views the title bar can switch to. Fases 4 and 5 add the rest. */
export type ViewMode = 'day'

/** Modal dialog currently open. `null` means none. */
export type OpenDialog = 'create' | 'edit' | null

/** State and actions of the UI store. */
interface UiState {
  /** Active view. */
  view: ViewMode
  /** Which modal is open. */
  dialog: OpenDialog
  /** Id of the task being edited, when `dialog` is `edit`. */
  editingTaskId: string | null
  /** Id of the row the user selected, target of Ctrl+Enter. */
  selectedTaskId: string | null
  /** Switches the active view. */
  setView: (view: ViewMode) => void
  /** Opens a modal, remembering which task is being edited. */
  openDialog: (dialog: Exclude<OpenDialog, null>, taskId?: string) => void
  /** Closes whichever modal is open. */
  closeDialog: () => void
  /** Selects a row, or clears the selection with `null`. */
  selectTask: (taskId: string | null) => void
}

/** The UI store. */
export const useUiStore = create<UiState>((set) => ({
  view: 'day',
  dialog: null,
  editingTaskId: null,
  selectedTaskId: null,

  setView: (view) => set({ view }),

  openDialog: (dialog, taskId) =>
    set({ dialog, editingTaskId: dialog === 'edit' ? (taskId ?? null) : null }),

  closeDialog: () => set({ dialog: null, editingTaskId: null }),

  selectTask: (selectedTaskId) => set({ selectedTaskId })
}))
