import { app, type BrowserWindow, Menu, Tray, nativeImage } from 'electron'
import { activationFor } from './core/window-lifecycle'

/**
 * The tray icon and the "minimize goes away" behaviour (Fase 6, T6).
 *
 * Only installed when a tray could actually be created. That condition is the whole safety
 * argument here: a window that hides itself needs somewhere to be brought back from, and on a
 * Linux desktop without an indicator daemon `new Tray()` throws. Hiding the window anyway would
 * leave the user staring at their taskbar wondering where the app went, with no menu, no
 * shortcut and no way to return — the window would simply be gone.
 *
 * S6 says *minimize* hides, not *close*, so `window-all-closed` still quits. Quitting from the
 * tray menu is the deliberate way out of an app that no longer shows a window when you minimise.
 */

/** How the tray is built and what it does. */
export interface TrayOptions {
  /** Path to the icon file. */
  iconPath: string
  /** Brings the window forward. */
  onActivate: () => void
  /** Quits the app, from the tray menu. */
  onQuit: () => void
}

/**
 * Builds the tray icon.
 *
 * @param options Icon, activation and quit callbacks.
 * @returns The tray, or `null` when this system cannot show one.
 */
export function createAppTray(options: TrayOptions): Tray | null {
  const image = nativeImage.createFromPath(options.iconPath)

  if (image.isEmpty()) {
    console.warn(`[tray] icon not found at ${options.iconPath}; staying in the taskbar`)

    return null
  }

  let tray: Tray

  try {
    tray = new Tray(image)
  } catch (error) {
    // Linux desktops without libappindicator, and any environment where the platform refuses.
    // Staying in the taskbar is a worse app, not a broken one.
    console.warn(`[tray] unavailable: ${error instanceof Error ? error.message : String(error)}`)

    return null
  }

  // On macOS a tray image is a template: the system recolours it for light and dark menu bars,
  // and a full-colour PNG is left alone, which looks wrong in one of the two.
  if (process.platform === 'darwin') {
    image.setTemplateImage(true)
  }

  tray.setToolTip('TaskDiary')

  const refresh = (): void => {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Abrir TaskDiary',
          click: options.onActivate
        },
        { type: 'separator' },
        {
          label: 'Salir',
          click: options.onQuit
        }
      ])
    )
  }

  refresh()

  // A left click on Windows and Linux is a request to open, not a request for a menu. Without
  // this the icon does nothing but show a menu, which is not what anyone clicks it for.
  tray.on('click', options.onActivate)

  // macOS delivers the click on the tray object; Windows and Linux deliver it on the icon.
  tray.on('right-click', refresh)

  return tray
}

/**
 * Makes minimizing hide the window instead of minimizing it.
 *
 * Electron's `minimize` event can be prevented, and preventing it while hiding the window is
 * what turns minimise into "send it to the tray". Only call this once a tray exists.
 *
 * @param window The window to take over.
 */
export function hideOnMinimize(window: BrowserWindow): void {
  // Electron documents `event.preventDefault()` as the way to cancel a minimise, and its own
  // "minimise to tray" recipe calls it that way — but the 44.7 type declares the listener as
  // `() => void`, so the event it actually passes has no name in the types. The cast is that
  // gap and nothing wider.
  const cancellable = window.on.bind(window) as unknown as (
    event: 'minimize',
    listener: (event: Electron.Event) => void
  ) => unknown

  cancellable('minimize', (event): void => {
    event.preventDefault()
    window.hide()
  })
}

/**
 * Brings a window forward using the shared rule.
 *
 * Every caller in the app goes through here — the tray icon and the `second-instance` handler —
 * because once the window can be hidden, "restore if minimized" is no longer enough on its own.
 *
 * @param window The window, or `undefined` when the app has none.
 * @param onAbsent Called when there is no window to bring forward.
 */
export function activateWindow(window: BrowserWindow | undefined, onAbsent: () => void): void {
  if (window === undefined) {
    onAbsent()

    return
  }

  const action = activationFor({
    exists: true,
    // `isHidden()` lives on `App` in Electron 44, not on `BrowserWindow`. A window that was
    // hidden is not visible, so this is the same question asked the way the type allows.
    hidden: !window.isVisible(),
    minimized: window.isMinimized()
  })

  if (action === 'show' || action === 'show-then-restore') {
    window.show()
  }

  if (action === 'restore' || action === 'show-then-restore') {
    window.restore()
  }

  window.focus()
  app.focus({ steal: true })
}
