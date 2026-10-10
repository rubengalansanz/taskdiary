import type { ElectronAPI } from '@electron-toolkit/preload'
import type {
  TaskDiaryApi as TaskDiaryApiShape,
  TaskDiaryDbProbeResult as TaskDiaryDbProbeResultShape,
  TaskDiaryThemeApi as TaskDiaryThemeApiShape
} from '../shared/ipc'

/**
 * Declares the renderer-facing globals.
 *
 * The shapes themselves live in `src/shared/ipc.ts` so the main process and the
 * preload bridge import exactly the same definitions. This file only re-publishes
 * them as ambient globals, because the renderer must never import from `electron`
 * and therefore cannot import the contract module directly at runtime.
 */
declare global {
  /** Re-published as a global so renderer code can name the contract. */
  type TaskDiaryApi = TaskDiaryApiShape
  /** Re-published as a global so renderer code can name the probe payload. */
  type TaskDiaryDbProbeResult = TaskDiaryDbProbeResultShape
  /** Re-published as a global so renderer code can name the theme bridge. */
  type TaskDiaryThemeApi = TaskDiaryThemeApiShape

  interface Window {
    /** The only bridge the renderer gets, in any environment. */
    taskDiary: TaskDiaryApi
    /**
     * Generic `@electron-toolkit/preload` helpers. Exposed in development only, so
     * a production renderer has no generic Electron API at all.
     */
    electron?: ElectronAPI
  }
}

export type {
  TaskDiaryApiShape as TaskDiaryApi,
  TaskDiaryDbProbeResultShape as TaskDiaryDbProbeResult,
  TaskDiaryThemeApiShape as TaskDiaryThemeApi
}
