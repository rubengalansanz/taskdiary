import { useState } from 'react'
import { TaskRow } from './task-row'
import { resolveListSurface } from './list-surface'
import type { TaskDto, TaskStatusDto } from '../../../../shared/ipc'
import { formatDayHeading } from '../../shared/lib/date'

/**
 * The Day view: a vertical timeline of one day's tasks.
 *
 * Owns no data. It receives the tasks to show and the callbacks, so it can be rendered
 * without a database or a bridge — which is what makes it testable and what keeps the read
 * path in one place.
 */

/** Props of {@link TaskList}. */
export interface TaskListProps {
  /** Day being shown, as `YYYY-MM-DD`. */
  taskDate: string
  /**
   * Its tasks. Empty while the first read is in flight — which is *not* the same as a day with
   * no tasks, and the surface resolver is what keeps the two apart.
   */
  tasks: TaskDto[]
  /** True while a read is in flight. */
  isLoading: boolean
  /** True when the rows come from a search rather than from the day. */
  searching: boolean
  /** Failure message from the last read, or `null`. */
  error: string | null
  /**
   * Re-runs the failed read.
   *
   * A failure the user cannot retry is the dead end S4 exists to remove, so the error surface
   * offers this. Absent where there is nothing to re-run.
   */
  onRetry?: () => void
  /** Id of the selected row, target of Ctrl+Enter. */
  selectedTaskId: string | null
  /** Requests a status change. */
  onStatusChange: (task: TaskDto, status: TaskStatusDto) => void
  /** Opens the edit form. */
  onEdit: (task: TaskDto) => void
  /** Deletes a task. */
  onDelete: (task: TaskDto) => void
  /**
   * Persists a dropped order. Absent while searching: results span days and an order
   * only means something within one day, so rows are not draggable there.
   */
  onReorder?: (orderedIds: string[]) => void
}

/**
 * Renders the Day view.
 *
 * @param props Tasks and callbacks.
 * @returns The view element.
 */
export function TaskList({
  taskDate,
  tasks,
  isLoading,
  searching,
  error,
  onRetry,
  selectedTaskId,
  onStatusChange,
  onEdit,
  onDelete,
  onReorder
}: TaskListProps): React.JSX.Element {
  const total = tasks.length
  const done = tasks.filter((task) => task.status === 'done').length

  const surface = resolveListSurface({ isLoading, error, taskCount: total, searching })

  // Drag state lives here rather than in the rows: the drop target is a different row
  // from the dragged one, and only the list sees both.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const reorderable = onReorder !== undefined && !searching && total > 1

  function clearDrag(): void {
    setDraggedId(null)
    setOverId(null)
  }

  function handleDropOnRow(targetId: string): void {
    setOverId(null)

    if (draggedId === null || tasks === null || onReorder === undefined) {
      setDraggedId(null)
      return
    }

    const ids = tasks.map((task) => task.id)

    if (!ids.includes(targetId) || !ids.includes(draggedId)) {
      setDraggedId(null)
      return
    }

    // Drop lands before the target row. Filtering first keeps the math honest when the
    // dragged row came from above: indices after removal are the ones that count.
    const next = ids.filter((id) => id !== draggedId)

    next.splice(next.indexOf(targetId), 0, draggedId)
    setDraggedId(null)

    // A drop back onto its own spot is not a reorder and must not touch the database.
    if (next.join() === ids.join()) {
      return
    }

    onReorder(next)
  }

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {searching ? 'Resultados' : formatDayHeading(taskDate)}
        </h1>

        {!searching && total > 0 && (
          <p className="text-muted-foreground text-sm">
            {done} de {total} completadas
          </p>
        )}

        {searching && total > 0 && (
          <p className="text-muted-foreground text-sm">
            {total} {total === 1 ? 'tarea en el histórico' : 'tareas en el histórico'}
          </p>
        )}
      </header>

      {surface === 'error' && (
        <div
          role="alert"
          data-testid="task-list-error"
          className="border-destructive rounded-md border p-3"
        >
          <p className="text-destructive text-sm">{error}</p>

          {onRetry !== undefined && (
            <button
              type="button"
              data-testid="task-list-retry"
              onClick={onRetry}
              className="text-foreground mt-2 text-sm font-medium underline underline-offset-2"
            >
              Reintentar
            </button>
          )}
        </div>
      )}

      {surface === 'loading' && <TaskListSkeleton rows={searching ? 3 : 4} />}

      {surface === 'empty' && (
        <div className="border-border text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
          {searching ? (
            <>
              <p className="text-sm font-medium">Ninguna tarea coincide</p>
              <p className="text-xs">Pruebe con otras palabras o quite algún filtro.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">Todavía no hay tareas para este día</p>
              <p className="text-xs">
                Pulse <kbd className="bg-muted rounded px-1">Ctrl</kbd> +{' '}
                <kbd className="bg-muted rounded px-1">N</kbd> para crear la primera.
              </p>
            </>
          )}
        </div>
      )}

      {surface === 'rows' && (
        <ul className="space-y-1">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              // A search result may belong to another day, so it shows its date where the
              // day view would show nothing useful.
              showDate={searching}
              isSelected={task.id === selectedTaskId}
              onStatusChange={(status) => onStatusChange(task, status)}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task)}
              draggable={reorderable}
              isDragging={task.id === draggedId}
              isDropTarget={task.id === overId && task.id !== draggedId}
              onDragStart={setDraggedId}
              onDragOverRow={setOverId}
              onDropOnRow={handleDropOnRow}
              onDragEnd={clearDrag}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Placeholder rows shown while a day is being read.
 *
 * Shaped like the real rows on purpose: a centred "Cargando…" in a big empty panel reads as a
 * broken screen, while a stack of bars reads as content that has not arrived yet. The pulse is
 * CSS-only so the list never re-renders to animate itself, and `aria-hidden` keeps a screen
 * reader from announcing three hundred phantom tasks.
 *
 * @param props How many placeholder rows to draw.
 * @returns The skeleton element.
 */
function TaskListSkeleton({ rows }: { rows: number }): React.JSX.Element {
  return (
    <ul aria-hidden="true" data-testid="task-list-skeleton" className="space-y-1">
      {Array.from({ length: rows }, (_, index) => (
        <li
          key={index}
          className="border-border animate-pulse rounded-md border p-3"
          style={{ opacity: 1 - index * 0.18 }}
        >
          <div className="bg-muted h-3 w-2/5 rounded" />
          <div className="bg-muted mt-2 h-2 w-1/4 rounded" />
        </li>
      ))}
    </ul>
  )
}
