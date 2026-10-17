import { create } from 'zustand'
import type { TaskStatusDto } from '../../../shared/ipc'

/**
 * UI-only state (ADR-006, plan rule §2.6).
 *
 * The selected date is deliberately **absent**: it lives in the URL
 * (`/day/2026-10-10`) so the day is linkable and the system back button works, which is
 * the whole point of a diary you navigate backwards through.
 *
 * The active view is absent for the same reason. Until Fase 4 it lived here, and that was a
 * second source of truth for one fact: the URL said `day` while the store said `week`, and the
 * store was the one the title bar believed. The route now decides both — `/week/2026-10-10`
 * *is* the week view of that week — so neither can disagree with the other. What stays here is
 * state nobody would put in a URL: which modal is open, what the user typed, which filters
 * are on.
 *
 * Task data is not here either. It is server state with its own cache in
 * `hooks/use-tasks.ts`; putting it in Zustand would mean invalidating it in two places.
 */

/** Modal dialog currently open. `null` means none. */
export type OpenDialog = 'create' | 'edit' | null

/**
 * The "Deshacer" notice (Fase 6, S2).
 *
 * Held here rather than in the day view because the notice outlives the interaction that caused
 * it: completing or deleting happens in a view, but the thing the user might click five seconds
 * later is not that view's business, and a notice that disappeared on navigation would take the
 * offer away from someone who simply looked away.
 */
export interface UndoNotice {
  /** What happened, in Spanish (ADR-015). */
  message: string
  /** Token the main process issued for this one operation. */
  token: string
}

/** State and actions of the UI store. */
interface UiState {
  /** Which modal is open. */
  dialog: OpenDialog
  /** Id of the task being edited, when `dialog` is `edit`. */
  editingTaskId: string | null
  /**
   * Whether the `Ctrl+K` palette is open.
   *
   * Deliberately **not** a member of {@link OpenDialog}, even though the palette is modal. The
   * day view reads `dialog !== null` to decide whether to render the create/edit form, so
   * folding the palette into that union would open the task form every time the palette
   * appeared. Separate fields also let each be closed by its own `Escape`, without either
   * pretending to be the other.
   */
  paletteOpen: boolean
  /** Id of the row the user selected, target of Ctrl+Enter. */
  selectedTaskId: string | null
  /** Free text the user typed in the search box, before debouncing. */
  searchQuery: string
  /** The undo notice on screen, or `null` when there is none. */
  undoNotice: UndoNotice | null
  /** Statuses the sidebar is filtering by. Empty means every status. */
  statusFilter: TaskStatusDto[]
  /** Tag ids the sidebar is filtering by. Empty means every task. */
  tagFilter: string[]
  /** Opens a modal, remembering which task is being edited. */
  openDialog: (dialog: Exclude<OpenDialog, null>, taskId?: string) => void
  /** Closes whichever modal is open. */
  closeDialog: () => void
  /** Opens the command palette. */
  openPalette: () => void
  /** Closes the command palette. */
  closePalette: () => void
  /** Shows the undo notice, replacing any notice already on screen. */
  showUndoNotice: (notice: UndoNotice) => void
  /** Takes the undo notice down, whether it expired or was used. */
  clearUndoNotice: () => void
  /** Selects a row, or clears the selection with `null`. */
  selectTask: (taskId: string | null) => void
  /** Records what the user typed in the search box. */
  setSearchQuery: (query: string) => void
  /** Adds or removes a status from the filter. */
  toggleStatusFilter: (status: TaskStatusDto) => void
  /** Adds or removes a tag from the filter. */
  toggleTagFilter: (tagId: string) => void
  /** Clears the text, the status filter and the tag filter in one go. */
  clearFilters: () => void
}

/**
 * Adds or removes a value from a filter list.
 *
 * Selecting a second tag has to widen the result rather than narrow it, so this is a
 * membership toggle and never an intersection — see the search test that pins the OR
 * semantics.
 *
 * @param current Values currently selected.
 * @param value The value to toggle.
 * @returns The new list.
 */
function toggle<T>(current: T[], value: T): T[] {
  return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]
}

/** The UI store. */
export const useUiStore = create<UiState>((set) => ({
  dialog: null,
  editingTaskId: null,
  paletteOpen: false,
  undoNotice: null,
  selectedTaskId: null,
  searchQuery: '',
  statusFilter: [],
  tagFilter: [],

  openDialog: (dialog, taskId) =>
    set({ dialog, editingTaskId: dialog === 'edit' ? (taskId ?? null) : null }),

  closeDialog: () => set({ dialog: null, editingTaskId: null }),

  openPalette: () => set({ paletteOpen: true }),

  closePalette: () => set({ paletteOpen: false }),

  showUndoNotice: (undoNotice) => set({ undoNotice }),

  clearUndoNotice: () => set({ undoNotice: null }),

  selectTask: (selectedTaskId) => set({ selectedTaskId }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  toggleStatusFilter: (status) =>
    set((state) => ({ statusFilter: toggle(state.statusFilter, status) })),

  toggleTagFilter: (tagId) => set((state) => ({ tagFilter: toggle(state.tagFilter, tagId) })),

  clearFilters: () => set({ searchQuery: '', statusFilter: [], tagFilter: [] })
}))
