import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDaySummaries } from '../../hooks/use-day-summaries'
import { pathForView, type ViewMode } from '../../routes/view-mode'
import { TitleBar } from '../../shell/title-bar'
import { Sidebar } from '../../shell/sidebar'
import { heatmapRange, today } from '../../shared/lib/date'
import type { DaySummaryDto } from '../../../../shared/ipc'

/**
 * Activity heatmap: the last 26 weeks as a GitHub-style grid.
 *
 * This is the view the phase's acceptance criterion is about. It draws 182 cells, and it
 * draws them from `GROUP BY task_date` — one grouped query for the whole grid, never the tasks
 * behind it. `useDaySummaries` is what makes that possible: the view asks for a range and gets
 * back one number per day, so the cost of the screen is the size of the range and not the size
 * of the diary.
 *
 * §10.2 gives three states: green for completed, amber for pending, grey for no record. A task
 * in progress is pending work, so it is amber; a cancelled task was never work, so it does not
 * light a cell at all.
 */

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const

/** Intensity buckets, so 3 completions and 40 do not both render as one flat block. */
const GREEN_STEPS = ['bg-emerald-900/30', 'bg-emerald-700/50', 'bg-emerald-600/70', 'bg-emerald-500'] as const
const AMBER_STEPS = [
  'bg-amber-900/30',
  'bg-amber-800/50',
  'bg-amber-700/70',
  'bg-amber-500/90'
] as const

/** Props of {@link HeatmapView}. */
export interface HeatmapViewProps {
  /** Day the grid is anchored on; its week is the last row. */
  taskDate: string
}

/**
 * Renders the heatmap.
 *
 * @param props Anchor day.
 * @returns The view element.
 */
export function HeatmapView({ taskDate }: HeatmapViewProps): React.JSX.Element {
  const navigate = useNavigate()
  const [hovered, setHovered] = useState<{ date: string; summary: DaySummaryDto | undefined } | null>(
    null
  )

  const days = useMemo(() => heatmapRange(taskDate), [taskDate])
  const { byDate } = useDaySummaries(days[0], days[days.length - 1])

  const handleSelectView = useCallback(
    (view: ViewMode): void => {
      void navigate(pathForView(view, taskDate))
    },
    [navigate, taskDate]
  )

  // The heatmap is anchored to today and has no date to move, so the arrows are disabled and
  // this callback never fires. It exists because the title bar's contract is one navigation
  // function for every view.
  const handleNavigate = useCallback((): void => {}, [])

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        view="heatmap"
        taskDate={taskDate}
        onNavigate={handleNavigate}
        onSelectView={handleSelectView}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar visibleCount={byDate.size} />

        <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
          <p className="text-muted-foreground text-sm">
            Últimas 26 semanas · del {days[0]} al {days[days.length - 1]}
          </p>

          <div className="flex gap-2">
            <div className="text-muted-foreground flex flex-col justify-around py-0.5 text-[10px]">
              {WEEKDAY_LABELS.map((label, index) => (
                <span key={label} className={index % 2 === 0 ? 'h-3' : 'invisible'}>
                  {label}
                </span>
              ))}
            </div>

            <div
              data-testid="heatmap-grid"
              className="grid gap-1"
              style={{ gridTemplateRows: 'repeat(7, 0.75rem)', gridAutoFlow: 'column' }}
              onMouseLeave={() => setHovered(null)}
            >
              {days.map((date) => (
                <HeatCell
                  key={date}
                  date={date}
                  summary={byDate.get(date)}
                  isToday={date === today()}
                  onHover={() => setHovered({ date, summary: byDate.get(date) })}
                  onOpen={() => void navigate(pathForView('day', date))}
                />
              ))}
            </div>
          </div>

          {hovered !== null && <Tooltip date={hovered.date} summary={hovered.summary} />}

          <Legend />
        </div>
      </div>
    </div>
  )
}

/** Props of {@link HeatCell}. */
interface HeatCellProps {
  date: string
  summary: DaySummaryDto | undefined
  isToday: boolean
  onHover: () => void
  onOpen: () => void
}

/**
 * Renders one day of the grid.
 *
 * A button, because it navigates. The tooltip is not a `title` attribute: the browser's own
 * tooltip cannot be styled, disappears before it can be read, and cannot say anything about
 * the balance of a day.
 *
 * @param props Day, its aggregate, and the hover and click handlers.
 * @returns The cell element.
 */
function HeatCell({
  date,
  summary,
  isToday,
  onHover,
  onOpen
}: HeatCellProps): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid="heatmap-cell"
      data-date={date}
      data-state={heatState(summary)}
      aria-label={`${date}: ${describeDay(summary)}`}
      className={[
        'h-3 w-3 rounded-[2px] border border-transparent transition-colors',
        cellColor(summary),
        isToday ? 'ring-primary ring-2' : ''
      ].join(' ')}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onOpen}
    />
  )
}

/**
 * Classifies a day for the grid.
 *
 * @param summary The day's aggregate, or `undefined` when it has not loaded.
 * @returns `done`, `pending` or `empty`.
 */
function heatState(summary: DaySummaryDto | undefined): 'done' | 'pending' | 'empty' {
  if (summary === undefined || summary.total === 0) {
    return 'empty'
  }

  return summary.done > 0 ? 'done' : 'pending'
}

/**
 * Picks the colour of a cell.
 *
 * Intensity steps with the count so a busy week reads differently from a quiet one; without it
 * a streak of single-completion days looks identical to a streak of full ones.
 *
 * @param summary The day's aggregate.
 * @returns A Tailwind background class.
 */
function cellColor(summary: DaySummaryDto | undefined): string {
  const state = heatState(summary)

  if (state === 'empty') {
    return 'bg-muted'
  }

  const steps = state === 'done' ? GREEN_STEPS : AMBER_STEPS
  const count = state === 'done' ? summary?.done ?? 0 : summary?.total ?? 0
  const bucket = count <= 1 ? 0 : count <= 3 ? 1 : count <= 6 ? 2 : 3

  return steps[bucket]
}

/** Props of {@link Tooltip}. */
interface TooltipProps {
  date: string
  summary: DaySummaryDto | undefined
}

/**
 * Renders the detail of the hovered day.
 *
 * @param props Day and its aggregate.
 * @returns The tooltip element.
 */
function Tooltip({ date, summary }: TooltipProps): React.JSX.Element {
  return (
    <p
      data-testid="heatmap-tooltip"
      className="border-border bg-background w-fit rounded-md border px-3 py-2 text-sm shadow-sm"
    >
      <span className="font-medium">{date}</span>
      <span className="text-muted-foreground"> · {describeDay(summary)}</span>
    </p>
  )
}

/**
 * Describes a day in words, for the tooltip and the accessible name.
 *
 * @param summary The day's aggregate.
 * @returns A short Spanish sentence.
 */
function describeDay(summary: DaySummaryDto | undefined): string {
  if (summary === undefined) {
    return 'sin registro'
  }

  const parts: string[] = [`${summary.done} completadas`, `${summary.total} en total`]

  if (summary.inProgress > 0) {
    parts.push(`${summary.inProgress} en curso`)
  }

  if (summary.unmeasuredDone > 0) {
    parts.push('tiempo no medido')
  }

  return parts.join(' · ')
}

/**
 * Renders the colour key.
 *
 * @returns The legend element.
 */
function Legend(): React.JSX.Element {
  return (
    <div className="text-muted-foreground flex items-center gap-3 text-xs">
      <span className="flex items-center gap-1">
        <span className="bg-muted inline-block h-3 w-3 rounded-[2px]" /> Sin registro
      </span>
      <span className="flex items-center gap-1">
        <span className="bg-amber-500/90 inline-block h-3 w-3 rounded-[2px]" /> Pendientes
      </span>
      <span className="flex items-center gap-1">
        <span className="bg-emerald-500 inline-block h-3 w-3 rounded-[2px]" /> Completadas
      </span>
    </div>
  )
}

/** Route component for `/heatmap`. */
export function HeatmapRoute(): React.JSX.Element {
  return <HeatmapView taskDate={today()} />
}