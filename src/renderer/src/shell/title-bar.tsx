import { useUiStore, type ViewMode } from '../stores/ui-store'
import { addDays, today } from '../shared/lib/date'
import { Button } from '../components/ui/button'

/**
 * Top bar: navigate between days, jump to today, and switch views.
 *
 * The selected day is read from and written to the URL, never from a store: a day has to
 * be linkable and the system back button has to walk the history, which is the entire
 * point of a diary you read backwards.
 */

const VIEW_LABELS: Readonly<Record<ViewMode, string>> = { day: 'Día' }

/** Props of {@link TitleBar}. */
export interface TitleBarProps {
  /** Day currently shown, as `YYYY-MM-DD`. */
  taskDate: string
  /** Moves the URL to another day. */
  onNavigate: (taskDate: string) => void
}

/**
 * Renders the top bar.
 *
 * @param props Day and navigation callback.
 * @returns The title bar element.
 */
export function TitleBar({ taskDate, onNavigate }: TitleBarProps): React.JSX.Element {
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const openDialog = useUiStore((state) => state.openDialog)

  return (
    <header className="border-border flex items-center gap-2 border-b px-4 py-3">
      <Button
        variant="outline"
        size="icon"
        aria-label="Día anterior"
        onClick={() => onNavigate(addDays(taskDate, -1))}
      >
        ‹
      </Button>

      <Button variant="ghost" size="sm" onClick={() => onNavigate(addDays(today(), -1))}>
        Ayer
      </Button>

      <Button variant="ghost" size="sm" onClick={() => onNavigate(today())}>
        Hoy
      </Button>

      <Button variant="ghost" size="sm" onClick={() => onNavigate(addDays(today(), 1))}>
        Mañana
      </Button>

      <Button
        variant="outline"
        size="icon"
        aria-label="Día siguiente"
        onClick={() => onNavigate(addDays(taskDate, 1))}
      >
        ›
      </Button>

      <div className="bg-muted flex items-center gap-1 rounded-md p-0.5">
        {(Object.keys(VIEW_LABELS) as ViewMode[]).map((mode) => (
          <Button
            key={mode}
            variant={view === mode ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={view === mode}
            onClick={() => setView(mode)}
          >
            {VIEW_LABELS[mode]}
          </Button>
        ))}
      </div>

      <div className="ml-auto">
        <Button size="sm" onClick={() => openDialog('create')}>
          Nueva tarea
        </Button>
      </div>
    </header>
  )
}
