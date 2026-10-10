import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS, type TaskDiaryApi, type TaskDiaryDbProbeResult } from '../shared/ipc'

/**
 * Phase 0 preload bridge.
 *
 * Exposes exactly one global, `window.taskDiary`, as a closed contract: there is no
 * generic `ipcRenderer` passthrough, so the renderer can only call the functions
 * enumerated here.
 */

// Hard invariant from the Phase 0 security rules. Failing loudly at startup beats a
// renderer that silently loses its bridge.
if (!process.contextIsolated) {
  throw new Error('TaskDiary requires contextIsolation: true (see ADR-001).')
}

const theme = {
  isDark: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.themeIsDark),
  onChange: (callback: (isDark: boolean) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, isDark: boolean): void => {
      callback(isDark)
    }

    ipcRenderer.on(IPC_CHANNELS.themeChanged, listener)

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.themeChanged, listener)
    }
  }
}

const taskDiary: TaskDiaryApi = {
  db: {
    probe: (): Promise<TaskDiaryDbProbeResult> => ipcRenderer.invoke(IPC_CHANNELS.dbProbe)
  },
  theme
}

contextBridge.exposeInMainWorld('taskDiary', taskDiary)

// The generic Electron helpers stay development-only: a production renderer gets no
// generic Electron API at all. `process.env.NODE_ENV` is inlined by electron-vite and
// is safe in the CJS bundle a sandboxed preload is compiled to.
if (process.env['NODE_ENV'] === 'development') {
  contextBridge.exposeInMainWorld('electron', electronAPI)
}
