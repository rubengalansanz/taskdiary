import { useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDaySummaries } from '../../hooks/use-day-summaries'
import { pathForView, type ViewMode } from '../../routes/view-mode'
import { TitleBar } from '../../shell/title-bar'
import { Sidebar } from '../../shell/sidebar'
import { formatMinutesSigned, normalizeDateParam, today, weekDates } from '../../shared/lib/date'
import { countTasks, estimateDrift } from '../../shared/lib/day-summary'
import type { DaySummaryDto } from '../../../../shared/ipc'

/**
 * Week view: seven columns and, above them, the balance of each day.
 *
 * §10.2 asks for the tasks stacked per day plus a top bar with the estimated/real balance. The
 * numbers come from one `GROUP BY task_date` over the week — the view never sees a task — and
 * the columns are laid out from the seven dates the URL implies, so the grid is on screen
 * before any of it arrives. That is what keeps a week change inside RNF-03: there is no layout
 * to collapse while the query runs.
 */

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Props of {@link WeekView}. */
export interface WeekViewProps {
  /** Any day of the week to show. */
  taskDate: string
}

/**
 * Renders the week view.
 *
 * @param props Week to show.
 * @returns The view element.
 */
export function WeekView({ taskDate }: WeekViewProps): React.JSX.Element {
  const navigate = useNavigate()
  const days = useMemo(() => weekDates(taskDate), [taskDate])
  const { byDate } = useDaySummaries(days[0], days[days.length - 1])

  const visibleCount = useMemo(() => countTasks(byDate.values()), [byDate])

  const handleNavigate = useCallback(
    (next: string): void => {
      void navigate(pathForView('week', next))
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
        view="week"
        taskDate={taskDate}
        onNavigate={handleNavigate}
        onSelectView={handleSelectView}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar visibleCount={visibleCount} />

        <div className="flex min-w-0 flex-1 flex-col overflow-auto p-4">
          <div className="grid grid-cols-7 gap-2">
            {days.map((date, index) => (
              <WeekColumn
                key={date}
                date={date}
                weekday={WEEKDAY_SHORT[index]}
                summary={byDate.get(date)}
                isToday={date === today()}
                onOpenDay={() => void navigate(pathForView('day', date))}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

/** Props of {@link WeekColumn}. */
interface WeekColumnProps {
  date: string
  weekday: string
  summary: DaySummaryDto | undefined
  isToday: boolean
  onOpenDay: () => void
}

/**
 * Renders one day of the week.
 *
 * @param props Day, its aggregate and the click handler.
 * @returns The column element.
 */
function WeekColumn({
  date,
  weekday,
  summary,
  isToday,
  onOpenDay
}: WeekColumnProps): React.JSX.Element {
  return (
    <section
      data-testid="week-column"
      data-date={date}
      className={['flex min-h-48 flex-col rounded-md border p-2', isToday ? 'border-primary' : 'border-border'].join(' ')}
    >
      <header className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-medium">{weekday}</span>
        <button
          type="button"
          data-testid="week-day-link"
          className="text-muted-foreground hover:text-foreground text-xs tabular-nums"
          onClick={onOpenDay}
        >
          {date.slice(8, 10)}
        </button>
      </header>

      <Balance summary={summary} />

      <p className="text-muted-foreground mt-2 text-xs">
        {summary === undefined
          ? '—'
          : `${summary.done}/${summary.total} completadas` +
            (summary.inProgress > 0 ? ` · ${summary.inProgress} en curso` : '')}
      </p>
    </section>
  )
}

/** Props of {@link Balance}. */
interface BalanceProps {
  summary: DaySummaryDto | undefined
}

/**
 * Estimated against real, for one day.
 *
 * Says "no medido" rather than showing a zero when the day's completed work has no timing.
 * A day of finished work with no `started_at` — every task from before migration 0002, and
 * any task completed without ever running — has a real duration nobody can recover, and
 * printing `0:00` next to an estimate would read as "you blew through the budget".
 *
 * @param props The day's aggregate.
 * @returns The balance element.
 */
function Balance({ summary }: BalanceProps): React.JSX.Element {
  if (summary === undefined || summary.unmeasuredDone > 0) {
    return (
      <p className="text-muted-foreground text-xs" data-testid="week-balance">
        {summary === undefined ? '—' : 'Tiempo no medido'}
      </p>
    )
  }

  const drift = estimateDrift(summary)

  return (
    <p className="text-xs tabular-nums" data-testid="week-balance">
      <span className="text-muted-foreground">estimado </span>
      {formatMinutesSigned(summary.estimateMin)}
      <span className="text-muted-foreground"> · real </span>
      {formatMinutesSigned(summary.realMin)}
      <span className={drift > 0 ? 'text-destructive' : 'text-muted-foreground'}>
        {' '}
        ({drift > 0 ? '+' : ''}
        {formatMinutesSigned(drift)})
      </span>
    </p>
  )
}

/**
 * Route component for `/week/:date`.
 *
 * @returns The route element.
 */
export function WeekRoute(): React.JSX.Element {
  const params = useParams<{ date?: string }>()
  const taskDate = normalizeDateParam(params.date)

  return <WeekView taskDate={taskDate} />
}