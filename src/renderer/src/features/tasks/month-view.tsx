import { useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDaySummaries } from '../../hooks/use-day-summaries'
import { pathForView, type ViewMode } from '../../routes/view-mode'
import { TitleBar } from '../../shell/title-bar'
import { Sidebar } from '../../shell/sidebar'
import {
  formatMonthHeading,
  monthGrid,
  normalizeDateParam,
  startOfMonth,
  today
} from '../../shared/lib/date'
import { completionRatio, countTasks } from '../../shared/lib/day-summary'
import type { DaySummaryDto } from '../../../../shared/ipc'

/**
 * Month view: a conventional calendar whose cells carry a progress ring.
 *
 * §10.2 asks for the percentage of completed tasks per day and a dot when something is
 * running. Both are read off the same aggregate the rest of Fase 4 uses, and both are drawn
 * from the grid the month implies rather than from the data — the calendar is fully laid out
 * before the query resolves, so switching months never flashes an empty page.
 */

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Props of {@link MonthView}. */
export interface MonthViewProps {
  /** Any day of the month to show. */
  taskDate: string
}

/**
 * Renders the month view.
 *
 * @param props Month to show.
 * @returns The view element.
 */
export function MonthView({ taskDate }: MonthViewProps): React.JSX.Element {
  const navigate = useNavigate()
  const month = startOfMonth(taskDate)
  const cells = useMemo(() => monthGrid(taskDate), [taskDate])
  const { byDate } = useDaySummaries(cells[0].date, cells[cells.length - 1].date)

  const visibleCount = useMemo(() => countTasks(byDate.values()), [byDate])
  const handleNavigate = useCallback(
    (next: string): void => {
      void navigate(pathForView('month', next))
    },
    [navigate]
  )

  const handleSelectView = useCallback(
    (view: ViewMode): void => {
      void navigate(pathForView(view, taskDate))
    },
    [navigate, taskDate]
  )

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        view="month"
        taskDate={taskDate}
        onNavigate={handleNavigate}
        onSelectView={handleSelectView}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar visibleCount={visibleCount} />

        <div className="flex min-w-0 flex-1 flex-col overflow-auto p-4">
          <p className="text-muted-foreground mb-2 text-sm capitalize" data-testid="month-heading">
            {formatMonthHeading(month)}
          </p>

          <div className="grid grid-cols-7 gap-1">
            {WEEKDAY_SHORT.map((label) => (
              <span key={label} className="text-muted-foreground px-1 pb-1 text-center text-xs">
                {label}
              </span>
            ))}

            {cells.map((cell) => (
              <MonthCell
                key={cell.date}
                date={cell.date}
                inMonth={cell.inMonth}
                summary={byDate.get(cell.date)}
                isToday={cell.date === today()}
                onOpenDay={() => void navigate(pathForView('day', cell.date))}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Props of {@link MonthCell}. */
interface MonthCellProps {
  date: string
  inMonth: boolean
  summary: DaySummaryDto | undefined
  isToday: boolean
  onOpenDay: () => void
}

/**
 * Renders one day of the calendar.
 *
 * @param props Day, its aggregate and the click handler.
 * @returns The cell element.
 */
function MonthCell({
  date,
  inMonth,
  summary,
  isToday,
  onOpenDay
}: MonthCellProps): React.JSX.Element {
  const ratio = completionRatio(summary)

  return (
    <button
      type="button"
      data-testid="month-cell"
      data-date={date}
      data-in-month={inMonth}
      aria-label={`${date}, ${summary?.done ?? 0} de ${summary?.total ?? 0} completadas`}
      className={[
        'relative flex aspect-square flex-col items-center justify-center gap-1 rounded-md border text-xs',
        inMonth ? 'border-border' : 'border-transparent opacity-40',
        isToday ? 'border-primary' : ''
      ].join(' ')}
      onClick={onOpenDay}
    >
      <span className="tabular-nums">{date.slice(8, 10)}</span>

      {summary !== undefined && summary.total > 0 && (
        <ProgressRing ratio={ratio} label={`${Math.round(ratio * 100)}% completadas`} />
      )}

      {summary !== undefined && summary.inProgress > 0 && (
        <span
          data-testid="month-in-progress"
          className="absolute right-1 bottom-1 h-1.5 w-1.5 rounded-full bg-blue-500"
          aria-hidden="true"
        />
      )}
    </button>
  )
}

/** Props of {@link ProgressRing}. */
interface ProgressRingProps {
  /** Share of the day's tasks that are done, from 0 to 1. */
  ratio: number
  /** Accessible description of what the ring shows. */
  label: string
}

/**
 * Renders the completion ring.
 *
 * A conic-gradient rather than an SVG circle: it needs no extra node, no `stroke-dasharray`
 * arithmetic and no reflow, and the same markup at 100% and at 3% does not collapse the cell.
 * A day with no tasks renders nothing at all instead of an empty ring, which would say "0%"
 * about a day nobody planned.
 *
 * @param props Completion ratio and its accessible label.
 * @returns The ring element.
 */
function ProgressRing({ ratio, label }: ProgressRingProps): React.JSX.Element {
  const degrees = Math.round(ratio * 360)

  return (
    <span
      data-testid="month-ring"
      role="img"
      aria-label={label}
      className="h-7 w-7 rounded-full"
      style={{
        background: `conic-gradient(var(--color-primary) ${degrees}deg, var(--color-muted) ${degrees}deg 360deg)`
      }}
    />
  )
}

/**
 * Route component for `/month/:date`.
 *
 * @returns The route element.
 */
export function MonthRoute(): React.JSX.Element {
  const params = useParams<{ date?: string }>()
  const taskDate = normalizeDateParam(params.date)

  return <MonthView taskDate={taskDate} />
}