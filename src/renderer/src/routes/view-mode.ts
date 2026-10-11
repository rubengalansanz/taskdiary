/**
 * The four views of the diary, and how each one is addressed.
 *
 * `ViewMode` used to live in the UI store next to `setView`. Fase 4 removed both, because the
 * route and the store were two answers to "which view is this?" and only one of them could be
 * the URL. Keeping the type here — a module that imports nothing — lets the title bar and the
 * route table share it without either importing the other.
 */

/** A view of the diary. */
export type ViewMode = 'day' | 'week' | 'month' | 'heatmap'

/** Every view, in the order the title bar shows them. */
export const VIEW_MODES: readonly ViewMode[] = ['day', 'week', 'month', 'heatmap']

/** Button label per view, in Spanish (ADR-015). */
export const VIEW_LABELS: Readonly<Record<ViewMode, string>> = {
  day: 'Día',
  week: 'Semana',
  month: 'Mes',
  heatmap: 'Actividad'
}

/**
 * Builds the path of a view showing a given day.
 *
 * The heatmap has no date because it has no selection: §10.2 defines it as "las últimas 26
 * semanas", anchored to today, and a date in that path would promise a range the view cannot
 * honour. The other three carry the day they are centred on — any day of the week for `week`,
 * any day of the month for `month` — so switching views keeps your place in the calendar
 * instead of jumping back to today.
 *
 * @param mode View to address.
 * @param taskDate Day to centre on, `YYYY-MM-DD`.
 * @returns The route path for that view.
 */
export function pathForView(mode: ViewMode, taskDate: string): string {
  return mode === 'heatmap' ? '/heatmap' : `/${mode}/${taskDate}`
}

/**
 * Reads the view out of a route path.
 *
 * Used as the key that re-syncs the store-driven parts of the shell with the route, and to
 * tell a stale `/week` link apart from an unknown path.
 *
 * @param pathname The path portion of the current location.
 * @returns The view, or `null` when the path names none.
 */
export function viewFromPath(pathname: string): ViewMode | null {
  const segment = pathname.split('/').filter(Boolean)[0]

  return VIEW_MODES.find((mode) => mode === segment) ?? null
}