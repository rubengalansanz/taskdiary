import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC_CHANNELS,
  isMenuCommand,
  MENU_COMMAND_CHANNELS,
  type IpcChannel,
  type TaskDiaryApi,
  type TagListResultDto,
  type TaskDiaryDbProbeResult
} from '../shared/ipc'

/**
 * Preload bridge.
 *
 * Exposes exactly one global, `window.taskDiary`, as a closed contract: there is no
 * generic `ipcRenderer` passthrough, so the renderer can only call the functions
 * enumerated here.
 */

// Hard invariant from the security rules. Failing loudly at startup beats a renderer
// that silently loses its bridge.
if (!process.contextIsolated) {
  throw new Error('TaskDiary requires contextIsolation: true (see ADR-001).')
}

/**
 * Invokes a channel and asserts the shape of its response.
 *
 * `ipcRenderer.invoke` is typed as `Promise<any>` because Electron cannot know the
 * contract. Every call site therefore names the response type explicitly, so the
 * annotation is written at the boundary rather than inferred from `any`.
 */
function invoke<TResponse>(channel: IpcChannel, request?: unknown): Promise<TResponse> {
  return ipcRenderer.invoke(channel, request) as Promise<TResponse>
}

/** Serialises the `IpcRendererEvent` argument Electron passes to listeners. */
function onThemeChanged(callback: (isDark: boolean) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, isDark: boolean): void => {
    callback(isDark)
  }

  ipcRenderer.on(IPC_CHANNELS.themeChanged, listener)

  return (): void => {
    ipcRenderer.removeListener(IPC_CHANNELS.themeChanged, listener)
  }
}

const theme: TaskDiaryApi['theme'] = {
  isDark: (): Promise<boolean> => invoke<boolean>(IPC_CHANNELS.themeIsDark),
  onChange: onThemeChanged
}

const tasks: TaskDiaryApi['tasks'] = {
  list: (request) => invoke(IPC_CHANNELS.taskList, request),
  listRange: (request) => invoke(IPC_CHANNELS.taskListRange, request),
  create: (request) => invoke(IPC_CHANNELS.taskCreate, request),
  update: (request) => invoke(IPC_CHANNELS.taskUpdate, request),
  delete: (request) => invoke(IPC_CHANNELS.taskDelete, request),
  setStatus: (request) => invoke(IPC_CHANNELS.taskSetStatus, request),
  search: (request) => invoke(IPC_CHANNELS.taskSearch, request)
}

/** Tag channels, grouped separately because they carry no payload. */
const tagApi: TaskDiaryApi['tags'] = {
  list: (): Promise<TagListResultDto> => invoke(IPC_CHANNELS.tagList)
}

const menu: TaskDiaryApi['menu'] = {
  onCommand: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, command: unknown): void => {
      // The preload cannot know in advance what the main process will send on this
      // channel, so it validates instead of forwarding whatever arrives.
      if (isMenuCommand(command)) {
        callback(command)
      }
    }

    for (const channel of MENU_COMMAND_CHANNELS) {
      ipcRenderer.on(channel, listener)
    }

    return (): void => {
      for (const channel of MENU_COMMAND_CHANNELS) {
        ipcRenderer.removeListener(channel, listener)
      }
    }
  }
}

const taskDiary: TaskDiaryApi = {
  db: {
    probe: (): Promise<TaskDiaryDbProbeResult> =>
      invoke<TaskDiaryDbProbeResult>(IPC_CHANNELS.dbProbe)
  },
  tasks,
  tags: tagApi,
  menu,
  theme
}

contextBridge.exposeInMainWorld('taskDiary', taskDiary)

// The generic Electron helpers stay development-only: a production renderer gets no
// generic Electron API at all. `process.env.NODE_ENV` is inlined by electron-vite and is
// safe in the CJS bundle a sandboxed preload is compiled to.
if (process.env['NODE_ENV'] === 'development') {
  contextBridge.exposeInMainWorld('electron', electronAPI)
}
