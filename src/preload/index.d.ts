import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AppErrorDto as AppErrorDtoShape,
  CreateTaskRequest as CreateTaskRequestShape,
  DeleteTaskRequest as DeleteTaskRequestShape,
  ListTaskRangeRequest as ListTaskRangeRequestShape,
  ListTasksRequest as ListTasksRequestShape,
  RruleFreqDto as RruleFreqDtoShape,
  TaskApi as TaskApiShape,
  TaskDiaryApi as TaskDiaryApiShape,
  TaskDiaryDbProbeResult as TaskDiaryDbProbeResultShape,
  TaskDiaryThemeApi as TaskDiaryThemeApiShape,
  TaskDto as TaskDtoShape,
  TaskListResultDto as TaskListResultDtoShape,
  TaskResultDto as TaskResultDtoShape,
  TaskStatusDto as TaskStatusDtoShape,
  UpdateTaskRequest as UpdateTaskRequestShape,
  DeleteTaskResultDto as DeleteTaskResultDtoShape
} from '../shared/ipc'

/**
 * Declares the renderer-facing globals.
 *
 * The shapes themselves live in `src/shared/ipc.ts` so the main process and the preload
 * bridge import exactly the same definitions. This file only re-publishes them as
 * ambient globals, because the renderer must never import from `electron` and therefore
 * cannot import the contract module directly at runtime.
 */
declare global {
  /** Re-published as a global so renderer code can name the contract. */
  type TaskDiaryApi = TaskDiaryApiShape
  /** Re-published as a global so renderer code can name the probe payload. */
  type TaskDiaryDbProbeResult = TaskDiaryDbProbeResultShape
  /** Re-published as a global so renderer code can name the theme bridge. */
  type TaskDiaryThemeApi = TaskDiaryThemeApiShape
  /** Re-published as a global so renderer code can name the task CRUD surface. */
  type TaskApi = TaskApiShape
  /** Re-published as a global so renderer code can name a task. */
  type TaskDto = TaskDtoShape
  /** Re-published as a global so renderer code can name a task status. */
  type TaskStatusDto = TaskStatusDtoShape
  /** Re-published as a global so renderer code can name a recurrence frequency. */
  type RruleFreqDto = RruleFreqDtoShape
  /** Re-published as a global so renderer code can name a failed operation. */
  type AppErrorDto = AppErrorDtoShape
  /** Re-published as a global so renderer code can name a single-task result. */
  type TaskResultDto = TaskResultDtoShape
  /** Re-published as a global so renderer code can name a task-list result. */
  type TaskListResultDto = TaskListResultDtoShape
  /** Re-published as a global so renderer code can name a delete result. */
  type DeleteTaskResultDto = DeleteTaskResultDtoShape
  /** Re-published as a global so renderer code can name request payloads. */
  type ListTasksRequest = ListTasksRequestShape
  /** Re-published as a global so renderer code can name request payloads. */
  type ListTaskRangeRequest = ListTaskRangeRequestShape
  /** Re-published as a global so renderer code can name request payloads. */
  type CreateTaskRequest = CreateTaskRequestShape
  /** Re-published as a global so renderer code can name request payloads. */
  type UpdateTaskRequest = UpdateTaskRequestShape
  /** Re-published as a global so renderer code can name request payloads. */
  type DeleteTaskRequest = DeleteTaskRequestShape

  interface Window {
    /** The only bridge the renderer gets, in any environment. */
    taskDiary: TaskDiaryApi
    /**
     * Generic `@electron-toolkit/preload` helpers. Exposed in development only, so a
     * production renderer has no generic Electron API at all.
     */
    electron?: ElectronAPI
  }
}

export type {
  AppErrorDtoShape as AppErrorDto,
  CreateTaskRequestShape as CreateTaskRequest,
  DeleteTaskRequestShape as DeleteTaskRequest,
  DeleteTaskResultDtoShape as DeleteTaskResultDto,
  ListTaskRangeRequestShape as ListTaskRangeRequest,
  ListTasksRequestShape as ListTasksRequest,
  RruleFreqDtoShape as RruleFreqDto,
  TaskApiShape as TaskApi,
  TaskDiaryApiShape as TaskDiaryApi,
  TaskDiaryDbProbeResultShape as TaskDiaryDbProbeResult,
  TaskDiaryThemeApiShape as TaskDiaryThemeApi,
  TaskDtoShape as TaskDto,
  TaskListResultDtoShape as TaskListResultDto,
  TaskResultDtoShape as TaskResultDto,
  TaskStatusDtoShape as TaskStatusDto,
  UpdateTaskRequestShape as UpdateTaskRequest
}
