import { IPC_CHANNELS, type MenuCommand } from '../../../shared/ipc'

/**
 * The `Ctrl+K` palette's contents, and how a query narrows them (S1).
 *
 * The palette deliberately owns no list of its own. Every entry is one of the
 * `MENU_COMMAND_CHANNELS` the native menu already fires, so an action cannot exist in one place
 * and be missing or differently worded in the other: both reach the same `runCommand` switch in
 * `hooks/use-shortcuts.ts`, and this table only decides which ones are *shown*.
 *
 * Nothing here imports React. The filtering and the selection arithmetic are the parts that
 * break quietly — an accent folding that misses `día`, a wrap that yields `-1` and indexes into
 * nothing — so they live in a module vitest can load without a DOM, matching how
 * `routes/view-mode.ts` carries the view logic that the title bar and the route table share.
 */

/** One palette entry: a command channel, plus how it is presented. */
export interface PaletteCommand {
  /** Channel fired when the entry is chosen. */
  channel: MenuCommand
  /** What the user reads, in Spanish (ADR-015). */
  label: string
  /** Accelerator that already exists on the native menu, as the user sees it. */
  shortcut: string
}

/**
 * Every command the palette offers, in menu order.
 *
 * The `shortcut` strings are not decoration: every one of them is the accelerator the native
 * menu registers in `src/main/index.ts` for the very same channel. Showing a hint that does not
 * fire would be worse than showing none, so these are copied rather than invented — and if a
 * menu accelerator moves, this table has to move with it.
 */
export const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  { channel: IPC_CHANNELS.menuNewTask, label: 'Nueva tarea', shortcut: 'Ctrl+N' },
  { channel: IPC_CHANNELS.menuToday, label: 'Hoy', shortcut: 'Ctrl+T' },
  { channel: IPC_CHANNELS.menuPreviousDay, label: 'Día anterior', shortcut: 'Ctrl+←' },
  { channel: IPC_CHANNELS.menuNextDay, label: 'Día siguiente', shortcut: 'Ctrl+→' },
  {
    channel: IPC_CHANNELS.menuCompleteSelected,
    label: 'Completar seleccionada',
    shortcut: 'Ctrl+Enter'
  }
]

/**
 * Folds a query or a label into a comparable form.
 *
 * Case alone would be a half-measure in a Spanish app: a fast typist on a keyboard that is
 * missing the accent writes `dia`, not `día`, and a palette that then finds nothing looks
 * broken rather than strict. Splitting off the diacritics makes both spellings match.
 *
 * @param value Raw user input or a label.
 * @returns The trimmed, lowercased, accent-free form.
 */
export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

/**
 * Narrows the commands to those matching what the user typed.
 *
 * Order is preserved rather than re-ranked: a matcher that re-sorts by score makes the list
 * reshuffle under the cursor while it is being read, which is worse than a slightly less clever
 * ranking.
 *
 * @param query What the user typed. An empty query keeps the whole list.
 * @param commands The list to narrow. Defaults to {@link PALETTE_COMMANDS}.
 * @returns The commands whose label contains the query, in their original order.
 */
export function filterCommands(
  query: string,
  commands: readonly PaletteCommand[] = PALETTE_COMMANDS
): readonly PaletteCommand[] {
  const needle = normalizeQuery(query)

  if (needle === '') {
    return commands
  }

  return commands.filter((command) => normalizeQuery(command.label).includes(needle))
}

/**
 * Moves the highlighted row by `step`, wrapping at both ends.
 *
 * `step` may be larger than the list, because a held arrow key delivers repeated events: the
 * modulo keeps that correct instead of trusting callers to clamp. The empty list is reachable —
 * a query can match nothing — and returns `0` rather than `-1`, which would index into nothing.
 *
 * @param current Index currently highlighted.
 * @param count How many rows the list holds.
 * @param step How far to move; positive is down, negative is up.
 * @returns The new index, always within `[0, count)`.
 */
export function nextIndex(current: number, count: number, step: number): number {
  if (count <= 0) {
    return 0
  }

  const moved = (current + step) % count

  return moved < 0 ? moved + count : moved
}
