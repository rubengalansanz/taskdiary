import { TaskRow } from './task-row'
import type { TaskDto, TaskStatusDto } from '../../../../shared/ipc'
import { formatDayHeading } from '../../shared/lib/date'

/**
 * The Day view: a vertical timeline of one day's tasks.
 *
 * Owns no data. It receives the day's tasks and the callbacks, so it can be rendered
 * without a database or a bridge — which is what makes it testable and what keeps the
 * read path in one place.
 */

/** Props of {@link TaskList}. */
export interface TaskListProps {
  /** Day being shown, as `YYYY-MM-DD`. */
  taskDate: string
  /** Its tasks, or `null` while the first read is in flight. */
  tasks: TaskDto[] | null
  /** True while a read is in flight. */
  isLoading: boolean
  /** Failure message from the last read, or `null`. */
  error: string | null
  /** Id of the selected row, target of Ctrl+Enter. */
  selectedTaskId: string | null
  /** Requests a status change. */
  onStatusChange: (task: TaskDto, status: TaskStatusDto) => void
  /** Opens the edit form. */
  onEdit: (task: TaskDto) => void
  /** Deletes a task. */
  onDelete: (task: TaskDto) => void
}

/**
 * Renders the Day view.
 *
 * @param props Day, tasks and callbacks.
 * @returns The view element.
 */
export function TaskList({
  taskDate,
  tasks,
  isLoading,
  error,
  selectedTaskId,
  onStatusChange,
  onEdit,
  onDelete
}: TaskListProps): React.JSX.Element {
  const total = tasks?.length ?? 0
  const done = tasks?.filter((task) => task.status === 'done').length ?? 0

  return (
    <section className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{formatDayHeading(taskDate)}</h1>
        {total > 0 && (
          <p className="text-muted-foreground text-sm">
            {done} de {total} completadas
          </p>
        )}
      </header>

      {error !== null && (
        <p
          role="alert"
          className="text-destructive border-destructive rounded-md border p-3 text-sm"
        >
          {error}
        </p>
      )}

      {tasks === null && isLoading && (
        <p className="text-muted-foreground text-sm">Cargando tareas…</p>
      )}

      {tasks !== null && tasks.length === 0 && <EmptyState />}

      {tasks !== null && tasks.length > 0 && (
        <ul className="space-y-1">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              onStatusChange={(status) => onStatusChange(task, status)}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task)}
            />
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * Shown when the day has no tasks.
 *
 * Says what to do rather than apologising for an empty state: this app's whole reason to
 * exist is the friction of writing a task down.
 *
 * @returns The empty state element.
 */
function EmptyState(): React.JSX.Element {
  return (
    <div className="border-border text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed p-10 text-center">
      <p className="text-sm font-medium">Todavía no hay tareas para este día</p>
      <p className="text-xs">
        Pulse <kbd className="bg-muted rounded px-1">Ctrl</kbd> +{' '}
        <kbd className="bg-muted rounded px-1">N</kbd> para crear la primera.
      </p>
    </div>
  )
}
