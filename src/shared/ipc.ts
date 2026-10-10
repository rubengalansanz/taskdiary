/**
 * The closed IPC contract between the main process, the preload bridge and the
 * renderer.
 *
 * This module is deliberately dependency-free (no Electron, no Node built-ins) so
 * all three build targets can import it: main and preload import the channel
 * values, the renderer imports nothing because the ambient `window.taskDiary`
 * declaration in `src/preload/index.d.ts` re-exports these shapes as globals.
 */

/** Channel names used by the Phase 0 bridge. */
export const IPC_CHANNELS = {
  /** `invoke`: run the database probe and return its result. */
  dbProbe: 'taskdiary:db:probe',
  /** `invoke`: read the current OS theme preference. */
  themeIsDark: 'taskdiary:theme:is-dark',
  /** `send`: main pushes theme changes to the renderer. */
  themeChanged: 'taskdiary:theme:changed'
} as const

/** Result of the Phase 0 database probe. */
export interface TaskDiaryDbProbeResult {
  /** True when the database opened and `SELECT 1` answered with 1. */
  ok: boolean
  /** SQLite library version reported by the open handle, when available. */
  sqliteVersion?: string
  /** Absolute path of the probed database file. */
  path: string
  /** Human readable failure reason when `ok` is false. */
  error?: string
}

/** Light/dark theme bridge backed by Electron's `nativeTheme`. */
export interface TaskDiaryThemeApi {
  /** Resolves the current OS theme preference. */
  isDark(): Promise<boolean>
  /**
   * Subscribes to theme changes.
   * @param callback Invoked with the new value whenever the OS theme changes.
   * @returns An unsubscribe function.
   */
  onChange(callback: (isDark: boolean) => void): () => void
}

/** The single API exposed to the renderer through `contextBridge`. */
export interface TaskDiaryApi {
  /** Phase 0 database diagnostics. */
  db: {
    probe(): Promise<TaskDiaryDbProbeResult>
  }
  /** Light/dark theme bridge. */
  theme: TaskDiaryThemeApi
}
