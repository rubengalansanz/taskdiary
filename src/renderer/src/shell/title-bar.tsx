import { useUiStore } from '../stores/ui-store'
import { VIEW_LABELS, VIEW_MODES, type ViewMode } from '../routes/view-mode'
import { addDays, addMonths, today } from '../shared/lib/date'
import { Button } from '../components/ui/button'
import { DataMenu } from './data-menu'

/**
 * Top bar: navigate between days, jump to today, and switch views.
 *
 * The selected day is read from and written to the URL, never from a store: a day has to
 * be linkable and the system back button has to walk the history, which is the entire
 * point of a diary you read backwards.
 *
 * How far the arrows move, and which quick jumps make sense, depend on what is on screen.
 * Stepping one day while looking at a month is technically correct and practically useless —
 * twenty-six clicks to leave October — so each view declares its own stride. "Ayer" is
 * honest in the day view and meaningless in the week one, where the buttons collapse to the
 * single "Hoy" that does apply. The heatmap is anchored to today and has neither.
 */

/**
 * How far the arrows move in each view, forwards or backwards.
 *
 * `null` means the view has no date to move: the heatmap always shows the last 26 weeks.
 */
const NAV_STEP: Readonly<Record<ViewMode, ((date: string, delta: number) => string) | null>> = {
  day: (date, delta) => addDays(date, delta),
  week: (date, delta) => addDays(date, delta * 7),
  month: (date, delta) => addMonths(date, delta),
  heatmap: null,
  // The statistics screen follows the day it is anchored on, like Week and Month.
  stats: (date, delta) => addDays(date, delta)
}

/** Props of {@link TitleBar}. */
export interface TitleBarProps {
  /** View on screen. */
  view: ViewMode
  /** Day the view is centred on, as `YYYY-MM-DD`. Ignored by the heatmap. */
  taskDate: string
  /** Moves the URL to another day, stepping by whatever the view considers one period. */
  onNavigate: (taskDate: string) => void
  /** Switches view, keeping the day. */
  onSelectView: (view: ViewMode) => void
  /** Called after an import, so whatever is on screen reloads what just changed. */
  onImported?: () => void
}

/**
 * Renders the top bar.
 *
 * @param props View, day and the two navigation callbacks.
 * @returns The title bar element.
 */
export function TitleBar({
  view,
  taskDate,
  onNavigate,
  onSelectView,
  onImported
}: TitleBarProps): React.JSX.Element {
  const openDialog = useUiStore((state) => state.openDialog)
  const step = NAV_STEP[view]
  const canStep = step !== null

  /**
   * Moves by whole periods. A no-op on views that cannot move, so the button can stay disabled
   * rather than every caller re-checking `canStep`.
   */
  const shift = (delta: number, from: string): void => {
    if (step !== null) {
      onNavigate(step(from, delta))
    }
  }

  return (
    // Three clusters that wrap between each other, never inside.
    //
    // The bar used to be one flex row of fifteen fixed-width buttons. It needed 1241px and had
    // 1084, so it overflowed and pushed a horizontal scrollbar onto the whole window. Grouping
    // means the only thing that can give way is a *gap between groups*: no cluster ever splits,
    // and nothing is ever clipped or hidden behind a `hidden sm:flex`.
    //
    // `flex-wrap` rather than horizontal scrolling because a toolbar that scrolls sideways
    // hides the view switcher behind an edge nobody thinks to look for. Wrapping costs one
    // extra row at widths the app is unlikely to be used at, and costs nothing at 1100.
    <header
      data-testid="title-bar"
      className="border-border flex flex-wrap items-center gap-x-2 gap-y-2 border-b px-4 py-3"
    >
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="Periodo anterior"
          disabled={!canStep}
          onClick={() => shift(-1, taskDate)}
        >
          ‹
        </Button>

        {view === 'day' && (
          <>
            <Button variant="ghost" size="sm" onClick={() => shift(-1, today())}>
              Ayer
            </Button>

            <Button variant="ghost" size="sm" onClick={() => onNavigate(today())}>
              Hoy
            </Button>

            <Button variant="ghost" size="sm" onClick={() => shift(1, today())}>
              Mañana
            </Button>
          </>
        )}

        {view !== 'day' && view !== 'stats' && (
          <Button variant="ghost" size="sm" onClick={() => onNavigate(today())}>
            {view === 'week' ? 'Semana actual' : 'Mes actual'}
          </Button>
        )}

        <Button
          variant="outline"
          size="icon"
          aria-label="Periodo siguiente"
          disabled={!canStep}
          onClick={() => shift(1, taskDate)}
        >
          ›
        </Button>
      </div>

      <div
        data-testid="view-switcher"
        className="bg-muted flex shrink-0 items-center gap-1 rounded-md p-0.5"
      >
        {VIEW_MODES.map((mode) => (
          <Button
            key={mode}
            variant={view === mode ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={view === mode}
            onClick={() => onSelectView(mode)}
          >
            {VIEW_LABELS[mode]}
          </Button>
        ))}
      </div>

      <div className="ml-auto flex min-w-0 shrink items-center gap-2">
        {onImported !== undefined && <DataMenu onImported={onImported} />}

        <Button size="sm" onClick={() => openDialog('create')}>
          Nueva tarea
        </Button>
      </div>
    </header>
  )
}