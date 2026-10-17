import { useCallback, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Sidebar } from '../../shell/sidebar'
import { TitleBar } from '../../shell/title-bar'
import { TaskList } from '../tasks/task-list'
import { TaskForm, type TaskFormValues } from '../tasks/task-form'
import { useUiStore } from '../../stores/ui-store'
import { invalidateDate, useTasks } from '../../hooks/use-tasks'
import { invalidateSearches, invalidateTags, useSearch } from '../../hooks/use-search'
import { invalidateSummaries } from '../../hooks/use-day-summaries'
import { useCompleteSelected } from '../../hooks/use-shortcuts'
import { pathForView, type ViewMode } from '../../routes/view-mode'
import { normalizeDateParam } from '../../shared/lib/date'
import {
  createTask,
  deleteTask,
  setTaskStatus,
  reorderDay,
  TaskApiError,
  updateTask
} from '../../shared/api/tasks-api'
import type { TaskDto, TaskStatusDto } from '../../../../shared/ipc'

/**
 * Day view: the app's home screen.
 *
 * Wires the URL to the day, the day to its tasks, and the intents of the title bar and
 * the rows to the bridge. Every write invalidates the affected day in the cache, so
 * navigating back to a day that was edited shows the edit — the acceptance criterion
 * "crear → completar → navegar a ayer → la tarea aparece en el histórico".
 *
 * When a filter is active the list shows the search results instead of the day, which is
 * what makes the deliverable "filtrar y buscar en todo el histórico" reachable from the
 * screen the user already has open.
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

  const query = useUiStore((state) => state.searchQuery)
  const statusFilter = useUiStore((state) => state.statusFilter)
  const tagFilter = useUiStore((state) => state.tagFilter)

  const search = useSearch(query, statusFilter, tagFilter)

  const [actionError, setActionError] = useState<ActionError | null>(null)

  const isFiltering = query.trim().length > 0 || statusFilter.length > 0 || tagFilter.length > 0

  // Filters replace the day on screen, and the sidebar's counter reports the search total
  // while that is the case, so the number never mixes two populations.
  const visibleTasks = isFiltering ? search.tasks : tasks
  const isSearching = isFiltering && search.status !== 'ready'

  // Resolved against what is on screen, not against the day. With a filter active the list
  // holds results from other days, and looking them up in `tasks` would resolve to null:
  // the form would open blank, titled "Nueva tarea", and submitting it would overwrite the
  // task it thinks it is editing, because `editingTaskId` is still set.
  const editingTask: TaskDto | null =
    editingTaskId === null
      ? null
      : (visibleTasks?.find((task) => task.id === editingTaskId) ?? null)

  const handleNavigate = useCallback(
    (next: string): void => {
      setActionError(null)
      void navigate(`/day/${next}`)
    },
    [navigate]
  )

  const handleSelectView = useCallback(
    (view: ViewMode): void => {
      setActionError(null)
      void navigate(pathForView(view, taskDate))
    },
    [navigate, taskDate]
  )

  const handleStatusChange = useCallback(
    async (task: TaskDto, next: TaskStatusDto): Promise<void> => {
      setActionError(null)

      try {
        await setTaskStatus(task.id, next)
        invalidateDate(taskDate)
        invalidateSearches()
        invalidateSummaries()
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

  useCompleteSelected(
    useCallback(
      (taskId: string): void => {
        const target = visibleTasks?.find((task) => task.id === taskId)

        if (target === undefined || target.status === 'done' || target.status === 'cancelled') {
          return
        }

        void handleStatusChange(target, 'done')
      },
      [visibleTasks, handleStatusChange]
    )
  )

  const handleDelete = useCallback(
    async (task: TaskDto): Promise<void> => {
      setActionError(null)

      try {
        await deleteTask(task.id)
        invalidateDate(taskDate)
        invalidateSearches()
        invalidateTags()
        invalidateSummaries()
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

  const handleReorder = useCallback(
    async (orderedIds: string[]): Promise<void> => {
      setActionError(null)

      try {
        // The bridge returns the day as stored, but the cache owns what is on screen:
        // invalidate first so the refresh below cannot serve the pre-drop order.
        await reorderDay(taskDate, orderedIds)
        invalidateDate(taskDate)
        invalidateSearches()
        invalidateSummaries()
        refresh()
      } catch (cause) {
        // A refused order leaves the stored order untouched, so the refresh below
        // restores the pre-drop arrangement — the drag visibly undoes itself.
        setActionError({
          code: cause instanceof TaskApiError ? cause.code : 'UNKNOWN',
          message: cause instanceof Error ? cause.message : 'No se pudo reordenar el día.'
        })
        refresh()
      }
    },
    [taskDate, refresh]
  )

  const handleSubmit = useCallback(
    async (values: TaskFormValues): Promise<void> => {
      setActionError(null)

      if (editingTaskId !== null) {
        // The task being edited is no longer in the list — deleted, or filtered away
        // between opening the form and saving it. Updating a row we never read, with
        // whatever the form happens to hold, is a silent overwrite of real data.
        if (editingTask === null) {
          setActionError({
            code: 'TASK_NOT_FOUND',
            message:
              'La tarea que estaba editando ya no está en la lista. Cierre el formulario e inténtelo de nuevo.'
          })
          closeDialog()
          return
        }

        try {
          const updated = await updateTask({ id: editingTask.id, ...values })
          // The update may have moved the task to another day; both caches are now stale.
          invalidateDate(taskDate)
          invalidateDate(updated.taskDate)
          invalidateSearches()
          invalidateTags()
          invalidateSummaries()
          refresh()
        } catch (cause) {
          setActionError({
            code: cause instanceof TaskApiError ? cause.code : 'UNKNOWN',
            message: cause instanceof Error ? cause.message : 'No se pudo guardar la tarea.'
          })
        }

        return
      }

      try {
        await createTask({ ...values, taskDate })
        invalidateDate(taskDate)
        invalidateSearches()
        invalidateTags()
        invalidateSummaries()
        refresh()
      } catch (cause) {
        // Saving is the path that writes the most data and the one the user is most likely to
        // be refused by — the focus rule, validation, a task deleted from under the form. The
        // other two handlers say so on screen; this one used to fail silently, which reads to
        // the user as the form simply not working.
        setActionError({
          code: cause instanceof TaskApiError ? cause.code : 'UNKNOWN',
          message: cause instanceof Error ? cause.message : 'No se pudo guardar la tarea.'
        })
      }
    },
    [editingTaskId, editingTask, taskDate, refresh, closeDialog]
  )

  const visibleCount = useMemo(() => visibleTasks?.length ?? 0, [visibleTasks])

  if (needsUrlRepair) {
    return <Navigate to={`/day/${taskDate}`} replace />
  }

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        view="day"
        taskDate={taskDate}
        onNavigate={handleNavigate}
        onSelectView={handleSelectView}
        onImported={() => {
          invalidateDate(taskDate)
          invalidateSearches()
          invalidateTags()
          invalidateSummaries()
          refresh()
        }}
      />

      <div className="flex min-h-0 flex-1">
        <Sidebar visibleCount={visibleCount} />

        <div className="flex min-w-0 flex-1 flex-col">
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
            tasks={visibleTasks}
            isLoading={isSearching || (!isFiltering && status === 'loading')}
            error={error ?? (search.status === 'error' ? search.error : null)}
            searching={isFiltering}
            selectedTaskId={selectedTaskId}
            onStatusChange={(task, next) => void handleStatusChange(task, next)}
            onEdit={(task) => {
              selectTask(task.id)
              openDialog('edit', task.id)
            }}
            onDelete={(task) => void handleDelete(task)}
            // While filtering the list holds other days' tasks, where an order is
            // meaningless — the bridge would refuse it anyway.
            onReorder={isFiltering ? undefined : (ids) => void handleReorder(ids)}
          />
        </div>
      </div>

      <TaskForm
        // Remounting on open and on task change is what reseeds the form: a fresh mount
        // reads its initial state, instead of an effect clearing fields after the stale
        // ones have already painted.
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
