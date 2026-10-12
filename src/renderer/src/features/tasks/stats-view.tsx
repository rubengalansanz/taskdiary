import { useCallback, useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useDaySummaries } from '../../hooks/use-day-summaries'
import { pathForView, type ViewMode } from '../../routes/view-mode'
import { TitleBar } from '../../shell/title-bar'
import { Sidebar } from '../../shell/sidebar'
import { formatMinutesSigned, normalizeDateParam, startOfWeek } from '../../shared/lib/date'
import { countTasks } from '../../shared/lib/day-summary'
import { useStats } from '../../hooks/use-stats'
import type { StatsSummaryDto } from '../../../../shared/ipc'

/**
 * Statistics: the numbers that answer "¿cómo voy?".
 *
 * §10.2 asks for completed-today, week average, current streak, longest streak, total time
 * and the share of estimates met. They arrive in one payload rather than six queries, because
 * six cards that fill in at different times read as six different states.
 *
 * Like the other Fase 4 views, the layout is drawn from the date in the URL and the numbers
 * land inside it, so opening the screen is never a blank frame (RNF-03).
 */

const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Props of {@link StatsView}. */
export interface StatsViewProps {
  /** Day the numbers are anchored on. */
  taskDate: string
}

/**
 * Renders the Statistics view.
 *
 * @param props Day to anchor on.
 * @returns The view element.
 */
export function StatsView({ taskDate }: StatsViewProps): React.JSX.Element {
  const navigate = useNavigate()
  const { stats, isLoading, error } = useStats(taskDate)
  const weekFrom = useMemo(() => startOfWeek(taskDate), [taskDate])
  const { byDate } = useDaySummaries(weekFrom, taskDate)
  const weekTotal = useMemo(() => countTasks(byDate.values()), [byDate])

  const handleNavigate = useCallback(
    (next: string): void => {
      void navigate(pathForView('stats', next))
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
        view="stats"
        taskDate={taskDate}
        onNavigate={handleNavigate}
        onSelectView={handleSelectView}
        onImported={() => undefined}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar visibleCount={weekTotal} />

        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-4">
          {error !== null && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Card label="Completadas" value={stats?.totalDone} loading={isLoading} />
            <Card
              label="Racha actual"
              value={stats?.currentStreak}
              loading={isLoading}
              suffix="días"
              testId="stat-streak"
            />
            <Card
              label="Racha máxima"
              value={stats?.longestStreak}
              loading={isLoading}
              suffix="días"
              testId="stat-longest"
            />
            <Card
              label="Esta semana"
              value={stats?.weekDone}
              loading={isLoading}
              suffix={`/ ${stats?.weekDaysElapsed ?? '—'} días`}
            />
            <Card
              label="Tiempo real"
              value={stats === undefined ? undefined : stats.realMin}
              loading={isLoading}
              format="duration"
              testId="stat-real"
            />
            <Card
              label="Cumplimiento"
              value={stats === undefined ? undefined : Math.round(stats.complianceRatio * 100)}
              loading={isLoading}
              suffix="%"
              testId="stat-compliance"
            />
          </div>

          {stats !== undefined && stats.unmeasuredDone > 0 && (
            <p className="text-muted-foreground text-xs" data-testid="stats-unmeasured">
              {stats.unmeasuredDone}{' '}
              {stats.unmeasuredDone === 1 ? 'tarea completada' : 'tareas completadas'} sin
              cronómetro, excluida{' '}
              {stats.unmeasuredDone === 1 ? 'del tiempo real' : 'del tiempo real'}.
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">Esta semana</h2>

            <div className="flex items-end gap-2">
              {stats?.week.map((day, index) => (
                <WeekBar
                  key={day.date}
                  label={WEEKDAY_SHORT[(index + new Date(`${day.date}T00:00:00Z`).getUTCDay() + 6) % 7]}
                  done={day.done}
                  total={day.total}
                  date={day.date}
                  onOpen={() => void navigate(pathForView('day', day.date))}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/** Props of {@link Card}. */
interface CardProps {
  label: string
  value: number | undefined
  loading: boolean
  suffix?: string
  format?: 'number' | 'duration'
  testId?: string
}

/**
 * Renders one statistic.
 *
 * An em dash until the number arrives, never a zero: a card that reads 0 while loading claims
 * the user has done nothing, which is the one thing a statistics screen must never assert
 * without knowing.
 *
 * @param props Label, value and how to render it.
 * @returns The card element.
 */
function Card({ label, value, loading, suffix, format = 'number', testId }: CardProps): React.JSX.Element {
  return (
    <div className="border-border rounded-md border p-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums" data-testid={testId}>
        {value === undefined
          ? loading
            ? '—'
            : '—'
          : format === 'duration'
            ? formatMinutesSigned(value)
            : value}
        {value !== undefined && suffix !== undefined && (
          <span className="text-muted-foreground ml-1 text-xs font-normal">{suffix}</span>
        )}
      </p>
    </div>
  )
}

/** Props of {@link WeekBar}. */
interface WeekBarProps {
  label: string
  done: number
  total: number
  date: string
  onOpen: () => void
}

/**
 * Renders one day of the weekly bar.
 *
 * @param props Day, its counts and the click handler.
 * @returns The bar element.
 */
function WeekBar({ label, done, total, date, onOpen }: WeekBarProps): React.JSX.Element {
  const ratio = total === 0 ? 0 : done / total
  // Scaled against the best day in the week, so a quiet week still shows shape. A fixed
  // ceiling would render a week of three tasks and a week of thirty identically.
  const height = ratio === 0 ? 4 : Math.max(8, Math.round(ratio * 48))

  return (
    <button
      type="button"
      data-testid="stats-week-bar"
      data-date={date}
      className="flex w-10 flex-col items-center gap-1"
      onClick={onOpen}
    >
      <span className="bg-primary/80 rounded-t" style={{ height: `${height}px`, width: '1.5rem' }} />
      <span className="text-muted-foreground text-[10px]">{label}</span>
      <span className="text-muted-foreground text-[10px] tabular-nums">{done}</span>
    </button>
  )
}

/**
 * Route component for `/stats/:date`.
 *
 * @returns The route element.
 */
export function StatsRoute(): React.JSX.Element {
  const params = useParams<{ date?: string }>()
  const taskDate = normalizeDateParam(params.date)

  return <StatsView taskDate={taskDate} />
}

export type { StatsSummaryDto }
