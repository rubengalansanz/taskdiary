import { useEffect, useState } from 'react'
import type { TaskDto, TaskStatusDto } from '../../../../shared/ipc'
import { elapsedSeconds, formatClock, formatDayShort, formatDuration } from '../../shared/lib/date'
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
  /** Shows the task's own date instead of its start time, for search results. */
  showDate: boolean
  /** Requests a status change; rejections surface as a message. */
  onStatusChange: (status: TaskStatusDto) => void
  /** Opens the edit form for this task. */
  onEdit: () => void
  /** Deletes this task. */
  onDelete: () => void
  /**
   * Makes the row draggable for manual ordering. Off while searching: a search spans
   * days, and an order only means something within one day.
   */
  draggable?: boolean
  /** Reports the start of a drag with this row's id. */
  onDragStart?: (taskId: string) => void
  /** Reports dragging over this row, so the list can show the landing spot. */
  onDragOverRow?: (taskId: string) => void
  /** Reports a drop onto this row. */
  onDropOnRow?: (taskId: string) => void
  /** Reports the end of a drag, for cleanup after a drop elsewhere — or none. */
  onDragEnd?: () => void
  /** True while this row is the one being dragged. */
  isDragging?: boolean
  /** True while the drop would land on this row. */
  isDropTarget?: boolean
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
  showDate,
  onStatusChange,
  onEdit,
  onDelete,
  draggable = false,
  onDragStart,
  onDragOverRow,
  onDropOnRow,
  onDragEnd,
  isDragging = false,
  isDropTarget = false
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
      //
      // No keyboard reorder: `Ctrl+Left/Right` already walks days, so a keyboard move
      // would fight navigation. Drag is pointer-only; screen-reader order follows the
      // stored manual order on the next read.
      draggable={draggable}
      onDragStart={(event) => {
        // Firefox refuses the drop without payload data; the id also travels in state.
        event.dataTransfer.setData('text/plain', task.id)
        event.dataTransfer.effectAllowed = 'move'
        onDragStart?.(task.id)
      }}
      onDragOver={(event) => {
        if (!draggable) {
          return
        }

        // Admitting the drop is what turns the cursor from forbidden to landing.
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        onDragOverRow?.(task.id)
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDropOnRow?.(task.id)
      }}
      onDragEnd={() => onDragEnd?.()}
      className={[
        'border-border flex items-center gap-3 rounded-md border px-3 py-2',
        task.status === 'cancelled' ? 'opacity-60' : '',
        task.status === 'done' ? 'text-muted-foreground' : '',
        isDragging ? 'opacity-50' : '',
        isDropTarget ? 'border-primary border-t-2' : ''
      ].join(' ')}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />

      <span className="text-muted-foreground w-24 shrink-0 font-mono text-xs tabular-nums">
        {showDate ? formatDayShort(task.taskDate) : formatClock(task.startMin)}
      </span>

      <span
        data-testid="task-row-title"
        className={`min-w-0 flex-1 truncate text-sm ${task.status === 'done' ? 'line-through' : ''}`}
      >
        {task.title}
      </span>

      {task.tags.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1 sm:flex">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              data-testid="task-tag"
              className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-xs"
            >
              #{tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-muted-foreground text-xs">+{task.tags.length - 3}</span>
          )}
        </span>
      )}

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
