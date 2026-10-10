import { useEffect, useState } from 'react'
import type { TaskDto, TaskStatusDto } from '../../../../shared/ipc'
import { elapsedSeconds, formatClock, formatDuration } from '../../shared/lib/date'
import { Button } from '../../components/ui/button'

/**
 * One row in the Day view.
 *
 * Shows the four lifecycle states, a live stopwatch for the running task, and the actions
 * that move it between them. Every status change goes through the bridge, so the focus
 * rule is enforced in the main process: a second task cannot be started from the UI even
 * if this component is wrong.
 */

/** Tailwind classes for the status dot, by status. */
const STATUS_STYLE: Readonly<Record<TaskStatusDto, { dot: string; label: string }>> = {
  pending: { dot: 'bg-amber-500', label: 'Pendiente' },
  in_progress: { dot: 'bg-blue-500', label: 'En curso' },
  done: { dot: 'bg-green-600', label: 'Hecho' },
  cancelled: { dot: 'bg-neutral-400', label: 'Cancelada' }
}

/** Props of {@link TaskRow}. */
export interface TaskRowProps {
  /** The task to render. */
  task: TaskDto
  /** Whether this row holds keyboard focus. */
  isSelected: boolean
  /** Requests a status change; rejections surface as a message. */
  onStatusChange: (status: TaskStatusDto) => void
  /** Opens the edit form for this task. */
  onEdit: () => void
  /** Deletes this task. */
  onDelete: () => void
}

/**
 * Renders a single task row.
 *
 * @param props Task and callbacks.
 * @returns The row element.
 */
export function TaskRow({
  task,
  isSelected,
  onStatusChange,
  onEdit,
  onDelete
}: TaskRowProps): React.JSX.Element {
  const style = STATUS_STYLE[task.status]
  const running = task.status === 'in_progress'

  return (
    <li
      data-testid="task-row"
      data-task-id={task.id}
      data-status={task.status}
      // Not focusable on its own: a `tabIndex={0}` row with no handler is a keyboard trap
      // that announces itself as a control and does nothing. Selection happens through
      // the buttons inside the row, which are already reachable and named.
      className={[
        'border-border flex items-center gap-3 rounded-md border px-3 py-2',
        task.status === 'cancelled' ? 'opacity-60' : '',
        task.status === 'done' ? 'text-muted-foreground' : ''
      ].join(' ')}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />

      <span className="text-muted-foreground w-12 shrink-0 font-mono text-xs tabular-nums">
        {formatClock(task.startMin)}
      </span>

      <span
        className={`min-w-0 flex-1 truncate text-sm ${task.status === 'done' ? 'line-through' : ''}`}
      >
        {task.title}
      </span>

      {running && <Stopwatch startedAt={task.startedAt} />}

      <span className="sr-only">{style.label}</span>

      <div className="flex shrink-0 items-center gap-1">
        {task.status !== 'done' && task.status !== 'cancelled' && (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={running}
              aria-label={`Marcar «${task.title}» como en curso`}
              onClick={() => onStatusChange('in_progress')}
            >
              ▶
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Completar «${task.title}»`}
              onClick={() => onStatusChange('done')}
            >
              ✓
            </Button>
          </>
        )}

        <Button variant="ghost" size="sm" aria-label={`Editar «${task.title}»`} onClick={onEdit}>
          ✎
        </Button>

        <Button
          variant="ghost"
          size="sm"
          aria-label={`Eliminar «${task.title}»`}
          onClick={onDelete}
        >
          🗑
        </Button>
      </div>

      {isSelected && <span className="sr-only">seleccionada</span>}
    </li>
  )
}

/** Props of {@link Stopwatch}. */
interface StopwatchProps {
  /** Instant work started, ISO-8601, or `null` when it predates the column. */
  startedAt: string | null
}

/**
 * Live elapsed time for the running task.
 *
 * Ticks once a second. The seconds column is the point: without it a running timer would
 * look frozen between minute boundaries, which reads as broken rather than as accurate.
 *
 * @param props Start instant.
 * @returns The elapsed time element.
 */
function Stopwatch({ startedAt }: StopwatchProps): React.JSX.Element | null {
  const [, setTick] = useState(0)

  useEffect(() => {
    if (startedAt === null) {
      return undefined
    }

    const timer = setInterval(() => setTick((value) => value + 1), 1000)

    return (): void => {
      clearInterval(timer)
    }
  }, [startedAt])

  // A row that was already running before `started_at` existed has no honest start time.
  // Showing 0:00 would be a nicer lie than the truth.
  if (startedAt === null) {
    return <span className="text-muted-foreground font-mono text-xs tabular-nums">—</span>
  }

  return (
    <span
      data-testid="stopwatch"
      className="text-blue-600 dark:text-blue-400 font-mono text-xs tabular-nums"
    >
      {formatDuration(elapsedSeconds(startedAt))}
    </span>
  )
}
