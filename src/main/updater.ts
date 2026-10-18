import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import {
  describeUpdateFailure,
  platformSupportsUpdates,
  updateBlockedBy,
  type UpdateState
} from './core/updater'
import { IPC_CHANNELS, type UpdateStatusDto } from '../shared/ipc'

/**
 * The wiring around electron-updater (Fase 9, T4).
 *
 * The package has been installed since Phase 0 and never imported. What it does not get to do
 * on its own is the interesting part:
 *
 * - It does not download anything without being asked. `autoDownload` stays off and the check
 *   is user-triggered, because a diary is the one app where an update arriving uninvited can
 *   interrupt work the user is in the middle of.
 * - It does nothing at all outside a packaged build. From source there is no release to find,
 *   and a check that hits the network looking for one reports a phantom failure.
 * - It does not run on Linux, where an AppImage can only be updated by replacing the file it is
 *   running from.
 *
 * The lifecycle listeners live here rather than in a renderer component because the download and
 * the restart belong to the main process; the renderer only ever hears about them.
 */

/**
 * The version of the update on offer, kept between events.
 *
 * `download-progress` does not carry one — its `ProgressInfo` has no `version` — so the only
 * way to tell the renderer which download is progressing is to remember what `update-available`
 * announced.
 */
let offeredVersion: string | null = null

/** Pushes the current state to every live window. */
function publish(state: UpdateState, version: string | null, message: string | null): void {
  const status: UpdateStatusDto = { state, version, message }

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.appUpdateStatus, status)
    }
  }
}

/** True when this build and machine may check for updates at all. */
function blocked(): 'idle' | 'unsupported' | null {
  return updateBlockedBy({
    packaged: app.isPackaged,
    platformSupported: platformSupportsUpdates(process.platform)
  })
}

/**
 * Wires the updater and registers its IPC channels.
 *
 * Safe to call once from `whenReady`: it installs listeners, registers the channels, and
 * announces the state this environment starts in — so the renderer never sits at `idle` waiting
 * for an event that will not come.
 */
export function startAppUpdater(): void {
  const block = blocked()

  if (block !== null) {
    // Still register the channels: the renderer asks and gets an honest `false` rather than an
    // unhandled rejection from a channel nobody registered.
    ipcMain.handle(IPC_CHANNELS.appUpdateCheck, () => false)
    ipcMain.handle(IPC_CHANNELS.appUpdateInstall, () => false)
    publish(
      block,
      null,
      block === 'unsupported'
        ? 'Las actualizaciones automáticas no están disponibles en esta plataforma.'
        : null
    )

    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    offeredVersion = null
    publish('checking', null, null)
  })
  autoUpdater.on('update-available', (info) => {
    offeredVersion = info.version
    publish('available', info.version, `Hay una versión nueva: ${info.version}.`)
  })
  autoUpdater.on('update-not-available', () =>
    publish('idle', null, 'Ya está en la última versión.')
  )
  autoUpdater.on('download-progress', (progress) =>
    publish('downloading', offeredVersion, `Descargando ${Math.round(progress.percent)} %.`)
  )
  autoUpdater.on('update-downloaded', (info) =>
    publish(
      'downloaded',
      info.version,
      `La versión ${info.version} está lista. Se instalará al cerrar la aplicación.`
    )
  )
  autoUpdater.on('error', (error) =>
    publish(
      'error',
      null,
      describeUpdateFailure(error instanceof Error ? error.message : String(error))
    )
  )

  ipcMain.handle(IPC_CHANNELS.appUpdateCheck, async () => {
    try {
      await autoUpdater.checkForUpdates()

      return true
    } catch (error) {
      publish(
        'error',
        null,
        describeUpdateFailure(error instanceof Error ? error.message : String(error))
      )

      return false
    }
  })

  ipcMain.handle(IPC_CHANNELS.appUpdateInstall, () => {
    // `quitAndInstall` takes over the process, so it is only safe to offer once a download has
    // actually finished. Calling it earlier restarts the app into the same version.
    if (!autoUpdater.isUpdaterActive()) {
      return false
    }

    setImmediate(() => autoUpdater.quitAndInstall())

    return true
  })

  publish('idle', null, null)
}
