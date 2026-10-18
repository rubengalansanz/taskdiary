import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC_CHANNELS,
  isMenuCommand,
  MENU_COMMAND_CHANNELS,
  type IpcChannel,
  type TaskDiaryApi,
  type TagListResultDto,
  type TaskDiaryDbProbeResult,
  type UpdateStatusDto
} from '../shared/ipc'

/** The updater states the bridge forwards. Mirrors `updateStateSchema` in the contract. */
const UPDATE_STATES = [
  'idle',
  'checking',
  'available',
  'downloading',
  'downloaded',
  'unsupported',
  'error'
] as const

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
  summaryRange: (request) => invoke(IPC_CHANNELS.taskSummaryRange, request),
  create: (request) => invoke(IPC_CHANNELS.taskCreate, request),
  update: (request) => invoke(IPC_CHANNELS.taskUpdate, request),
  delete: (request) => invoke(IPC_CHANNELS.taskDelete, request),
  undo: (request) => invoke(IPC_CHANNELS.taskUndo, request),
  setStatus: (request) => invoke(IPC_CHANNELS.taskSetStatus, request),
  reorder: (request) => invoke(IPC_CHANNELS.taskReorder, request),
  search: (request) => invoke(IPC_CHANNELS.taskSearch, request)
}

/** Tag channels, grouped separately because they carry no payload. */
const tagApi: TaskDiaryApi['tags'] = {
  list: (): Promise<TagListResultDto> => invoke(IPC_CHANNELS.tagList)
}

/**
 * Whether a value from main is an updater status (Fase 9).
 *
 * A shape check rather than the Zod schema from the contract: the preload runs in its own
 * context and pulling the validators across would evaluate them there. This mirrors what
 * `isMenuCommand` already does for the menu channel.
 *
 * @param value Whatever arrived on the channel.
 * @returns True when it names a state and carries the two fields the renderer reads.
 */
function isUpdateStatus(value: unknown): value is UpdateStatusDto {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>

  return (
    typeof candidate.state === 'string' &&
    UPDATE_STATES.includes(candidate.state as (typeof UPDATE_STATES)[number]) &&
    (typeof candidate.version === 'string' || candidate.version === null) &&
    (typeof candidate.message === 'string' || candidate.message === null)
  )
}

/** Updater lifecycle pushed from main (Fase 9). */
const appApi: TaskDiaryApi['app'] = {
  check: (): Promise<boolean> => invoke(IPC_CHANNELS.appUpdateCheck),
  install: (): Promise<boolean> => invoke(IPC_CHANNELS.appUpdateInstall),
  onStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown): void => {
      // Same rule as the menu bridge: the preload cannot know in advance what main will send,
      // so it validates instead of forwarding whatever arrives.
      if (isUpdateStatus(status)) {
        callback(status)
      }
    }

    ipcRenderer.on(IPC_CHANNELS.appUpdateStatus, listener)

    return (): void => {
      ipcRenderer.removeListener(IPC_CHANNELS.appUpdateStatus, listener)
    }
  }
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

const stats: TaskDiaryApi['stats'] = {
  summary: (request) => invoke(IPC_CHANNELS.statsSummary, request)
}

const data: TaskDiaryApi['data'] = {
  export: (request) => invoke(IPC_CHANNELS.dataExport, request),
  import: (request) => invoke(IPC_CHANNELS.dataImport, request)
}

const taskDiary: TaskDiaryApi = {
  db: {
    probe: (): Promise<TaskDiaryDbProbeResult> =>
      invoke<TaskDiaryDbProbeResult>(IPC_CHANNELS.dbProbe)
  },
  tasks,
  app: appApi,
  data,
  stats,
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
