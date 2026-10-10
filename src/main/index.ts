import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { resolveDatabasePath } from './core/database-path'
import { hasTable, openDatabase, pingDatabase, readSqliteVersion } from './db/database'
import { readSchemaVersion, runMigrations } from './db/migrate'
import { TasksRepository } from './db/repositories/tasks-repo'
import { registerTaskIpcHandlers } from './ipc/tasks'
import { IPC_CHANNELS, type TaskDiaryDbProbeResult } from '../shared/ipc'

/** Size of the Phase 0 window, in device-independent pixels. */
const WINDOW_WIDTH = 1100
const WINDOW_HEIGHT = 720

/**
 * Window and body background colours, used before any CSS is parsed so a dark-mode
 * user never sees a white flash on startup.
 */
const BACKGROUND_COLOR_LIGHT = '#fafafa'
const BACKGROUND_COLOR_DARK = '#0b0b0c'

/** Absolute path of the SQLite database, resolved once the app is ready. */
let databasePath = ''

/**
 * Probes the database and never throws.
 *
 * Error-to-payload translation belongs to the IPC layer, which keeps
 * `src/main/db/` free of any contract type and of any Electron import.
 */
function probeDatabaseAt(filePath: string): TaskDiaryDbProbeResult {
  let database: ReturnType<typeof openDatabase>

  try {
    database = openDatabase(filePath)
  } catch (error) {
    return { ok: false, path: filePath, error: describeError(error) }
  }

  try {
    const sqliteVersion = readSqliteVersion(database)

    if (pingDatabase(database) !== 1) {
      return { ok: false, path: filePath, sqliteVersion, error: 'SELECT 1 did not return 1' }
    }

    return {
      ok: true,
      path: filePath,
      sqliteVersion,
      schemaVersion: readSchemaVersion(database),
      hasTasksTable: hasTable(database, 'tasks')
    }
  } catch (error) {
    return { ok: false, path: filePath, error: describeError(error) }
  } finally {
    database.close()
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Only `https:` and `mailto:` may ever reach the user's browser or mail client. */
function isExternalUrlAllowed(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.dbProbe, (): TaskDiaryDbProbeResult => probeDatabaseAt(databasePath))

  ipcMain.handle(IPC_CHANNELS.themeIsDark, (): boolean => nativeTheme.shouldUseDarkColors)

  nativeTheme.on('updated', () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.themeChanged, nativeTheme.shouldUseDarkColors)
      }
    }
  })
}

/**
 * Menu commands, taken from the contract so both sides name the same strings.
 *
 * The accelerators live in the menu rather than only in the renderer because a menu
 * accelerator fires even when the focus is outside the page — in a dialog, or nowhere at
 * all. The items do not perform the work themselves: they send a message the renderer
 * interprets, which keeps every write behind the bridge.
 */
const MENU_CHANNEL = {
  newTask: IPC_CHANNELS.menuNewTask,
  today: IPC_CHANNELS.menuToday,
  previousDay: IPC_CHANNELS.menuPreviousDay,
  nextDay: IPC_CHANNELS.menuNextDay,
  completeSelected: IPC_CHANNELS.menuCompleteSelected
} as const

function sendMenuCommand(channel: string): void {
  const [window] = BrowserWindow.getAllWindows()

  if (window !== undefined && !window.isDestroyed()) {
    window.webContents.send(channel)
  }
}

function buildApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Archivo',
      submenu: [
        {
          label: 'Nueva tarea',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuCommand(MENU_CHANNEL.newTask)
        },
        { type: 'separator' },
        { role: is.dev ? 'reload' : 'forceReload' },
        { role: is.dev ? 'toggleDevTools' : 'togglefullscreen' },
        { type: 'separator' },
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        {
          label: 'Completar tarea seleccionada',
          accelerator: 'CmdOrCtrl+Return',
          click: () => sendMenuCommand(MENU_CHANNEL.completeSelected)
        },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ir',
      submenu: [
        {
          label: 'Día anterior',
          accelerator: 'CmdOrCtrl+Left',
          click: () => sendMenuCommand(MENU_CHANNEL.previousDay)
        },
        {
          label: 'Día siguiente',
          accelerator: 'CmdOrCtrl+Right',
          click: () => sendMenuCommand(MENU_CHANNEL.nextDay)
        },
        {
          label: 'Hoy',
          accelerator: 'CmdOrCtrl+T',
          click: () => sendMenuCommand(MENU_CHANNEL.today)
        }
      ]
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'resetZoom', label: 'Zoom original' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Pantalla completa' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): BrowserWindow {
  const backgroundColor = nativeTheme.shouldUseDarkColors
    ? BACKGROUND_COLOR_DARK
    : BACKGROUND_COLOR_LIGHT

  const mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    backgroundColor,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Phase 0 security rules, no exceptions: the renderer has no Node capability.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow.destroy()
  })

  // External links open in the user's browser; everything else is denied.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrlAllowed(url)) {
      void shell.openExternal(url)
    }

    return { action: 'deny' }
  })

  // The renderer may never navigate away from the app itself.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const currentUrl = mainWindow.webContents.getURL()

    if (url !== currentUrl) {
      event.preventDefault()
    }
  })

  // No device access at all: TaskDiary needs no camera, microphone or geolocation.
  mainWindow.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

// A second instance would fight over the same SQLite file: hand focus back instead.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [existingWindow] = BrowserWindow.getAllWindows()

    if (!existingWindow) {
      createWindow()
      return
    }

    if (existingWindow.isMinimized()) {
      existingWindow.restore()
    }

    existingWindow.focus()
  })

  void app.whenReady().then(() => {
    electronApp.setAppUserModelId('com.local.taskdiary')

    // Dev-only convenience: F12 / CmdOrCtrl+R shortcuts.
    app.on('browser-window-created', (_event, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    databasePath = resolveDatabasePath(app.getPath('userData'))
    const probe = probeDatabaseAt(databasePath)

    if (!probe.ok) {
      console.error(`[database] could not open ${probe.path}: ${probe.error}`)
      app.quit()
      return
    }

    console.log(`[database] ${probe.path} (SQLite ${probe.sqliteVersion}) SELECT 1 -> 1`)

    // The database stays open for the whole session: better-sqlite3 is synchronous, so
    // every repository call is a direct read or write with no connection pool to manage.
    // Migrations run once, before any channel is registered, so no handler can observe a
    // half-migrated schema.
    const database = openDatabase(databasePath)
    const report = runMigrations(database)

    if (report.applied.length > 0) {
      console.log(
        `[database] schema v${report.fromVersion} -> v${report.toVersion}: ${report.applied.join(', ')}`
      )
    }

    registerIpcHandlers()
    registerTaskIpcHandlers(new TasksRepository(database))

    buildApplicationMenu()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
