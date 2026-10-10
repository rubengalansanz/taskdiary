import { useCallback, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { TitleBar } from '../../shell/title-bar'
import { TaskList } from '../tasks/task-list'
import { TaskForm, type TaskFormValues } from '../tasks/task-form'
import { useUiStore } from '../../stores/ui-store'
import { invalidateDate, useTasks } from '../../hooks/use-tasks'
import {
  createTask,
  deleteTask,
  setTaskStatus,
  TaskApiError,
  updateTask
} from '../../shared/api/tasks-api'
import { normalizeDateParam } from '../../shared/lib/date'
import { useCompleteSelected } from '../../hooks/use-shortcuts'
import type { TaskDto, TaskStatusDto } from '../../../../shared/ipc'

/**
 * Day view: the app's home screen.
 *
 * Wires the URL to the day, the day to its tasks, and the intents of the title bar and
 * the rows to the bridge. Every write invalidates the affected day in the cache, so
 * navigating back to a day that was edited shows the edit — the acceptance criterion
 * "crear → completar → navegar a ayer → la tarea aparece en el histórico".
 */

/** Why the last action failed, shown above the list. */
interface ActionError {
  /** Stable code, so the UI can react to specific rejections. */
  code: string
  /** Message to show. */
  message: string
}

/**
 * Renders the day for the `:date` route parameter.
 *
 * @returns The day view element.
 */
export function DayRoute(): React.JSX.Element {
  const params = useParams<{ date?: string }>()
  const navigate = useNavigate()

  // A malformed segment repairs to today instead of rendering a dead end: typing a URL
  // by hand is not a place where a typo deserves an error page.
  const taskDate = normalizeDateParam(params.date)

  // Whether to rewrite the URL, decided here and acted on after every hook below. An
  // early `return <Navigate/>` would skip them, and React requires the same hooks in the
  // same order on every render — the render would break the moment the param went from
  // valid to malformed.
  const needsUrlRepair = params.date !== taskDate

  const { tasks, status, error, refresh } = useTasks(taskDate)

  const dialog = useUiStore((state) => state.dialog)
  const editingTaskId = useUiStore((state) => state.editingTaskId)
  const openDialog = useUiStore((state) => state.openDialog)
  const closeDialog = useUiStore((state) => state.closeDialog)
  const selectedTaskId = useUiStore((state) => state.selectedTaskId)
  const selectTask = useUiStore((state) => state.selectTask)

  const [actionError, setActionError] = useState<ActionError | null>(null)

  const editingTask: TaskDto | null =
    editingTaskId === null ? null : (tasks?.find((task) => task.id === editingTaskId) ?? null)

  const handleNavigate = useCallback(
    (next: string): void => {
      setActionError(null)
      void navigate(`/day/${next}`)
    },
    [navigate]
  )

  const handleStatusChange = useCallback(
    async (task: TaskDto, next: TaskStatusDto): Promise<void> => {
      setActionError(null)

      try {
        await setTaskStatus(task.id, next)
        invalidateDate(taskDate)
        refresh()
      } catch (cause) {
        // The focus rule lives in the main process, so this is where "you already have a
        // task running" becomes something the user can read.
        setActionError({
          code: cause instanceof TaskApiError ? cause.code : 'UNKNOWN',
          message: cause instanceof Error ? cause.message : 'No se pudo cambiar el estado.'
        })
      }
    },
    [taskDate, refresh]
  )

  const handleDelete = useCallback(
    async (task: TaskDto): Promise<void> => {
      setActionError(null)

      try {
        await deleteTask(task.id)
        invalidateDate(taskDate)
        refresh()
      } catch (cause) {
        setActionError({
          code: cause instanceof TaskApiError ? cause.code : 'UNKNOWN',
          message: cause instanceof Error ? cause.message : 'No se pudo eliminar la tarea.'
        })
      }
    },
    [taskDate, refresh]
  )

  // Ctrl+Enter and the menu's "Completar tarea seleccionada" both land here. This is the
  // view that owns the write and the error surface, so the command stops here.
  useCompleteSelected(
    useCallback(
      (taskId: string): void => {
        const target = tasks?.find((task) => task.id === taskId)

        if (target === undefined || target.status === 'done' || target.status === 'cancelled') {
          return
        }

        void handleStatusChange(target, 'done')
      },
      [tasks, handleStatusChange]
    )
  )

  const handleSubmit = useCallback(
    async (values: TaskFormValues): Promise<void> => {
      setActionError(null)

      if (editingTaskId !== null) {
        const updated = await updateTask({ id: editingTaskId, ...values })
        // The update may have moved the task to another day; both caches are now stale.
        invalidateDate(taskDate)
        invalidateDate(updated.taskDate)
        refresh()
        return
      }

      await createTask({ ...values, taskDate })
      invalidateDate(taskDate)
      refresh()
    },
    [editingTaskId, taskDate, refresh]
  )

  // The URL is rewritten to match what is rendered. Leaving `#/day/ayer` in the address
  // bar would show today's tasks under a URL that lies about which day they are, and every
  // later copy of that link would repeat the mistake.
  if (needsUrlRepair) {
    return <Navigate to={`/day/${taskDate}`} replace />
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar taskDate={taskDate} onNavigate={handleNavigate} />

      {actionError !== null && (
        <p
          role="alert"
          data-testid="action-error"
          className="text-destructive border-destructive mx-4 mt-3 rounded-md border p-2 text-sm"
        >
          {actionError.message}
        </p>
      )}

      <TaskList
        taskDate={taskDate}
        tasks={tasks}
        isLoading={status === 'loading'}
        error={error}
        selectedTaskId={selectedTaskId}
        onStatusChange={(task, next) => void handleStatusChange(task, next)}
        onEdit={(task) => {
          selectTask(task.id)
          openDialog('edit', task.id)
        }}
        onDelete={(task) => void handleDelete(task)}
      />

      <TaskForm
        // Remounting on open and on task change is what reseeds the form: a fresh
        // mount reads its initial state, instead of an effect clearing fields after
        // the stale ones have already painted.
        key={dialog === null ? 'closed' : `${dialog}:${editingTaskId ?? 'new'}`}
        open={dialog !== null}
        task={editingTask}
        taskDate={taskDate}
        onClose={closeDialog}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
