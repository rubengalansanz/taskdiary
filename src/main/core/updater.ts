/**
 * What the updater is allowed to do, decided without touching Electron (Fase 9, T4).
 *
 * `electron-updater` is the one dependency of this app that has been installed since Phase 0 and
 * never wired: `grep autoUpdater src/` matched nothing for weeks. Everything it decides belongs
 * here rather than in the wiring, because the rules are the interesting part and they are the
 * part worth a test.
 *
 * The rule that shapes all the others: **this app does not download anything on its own.** A
 * diary is the one application where an update arriving uninvited is a bad trade — the user may
 * be mid-task, and the download competes with the database for the disk. So auto-download stays
 * off, the check is user-triggered, and nothing is written outside `userData`.
 */

/** Where the updater is in its lifecycle, as the renderer sees it. */
export type UpdateState =
  'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'unsupported' | 'error'

/** What the wiring is told about the environment it landed in. */
export interface UpdateContext {
  /** False while running from source, where there is no release to update to. */
  packaged: boolean
  /** True when the platform cannot install updates at all. */
  platformSupported: boolean
}

/**
 * Whether the updater may run here, and why not when it may not.
 *
 * Development is the answer that matters: without it, every run from source would hit the
 * network looking for a release of a version that was never published, and the check would
 * either hang or report a phantom failure to someone who is trying to work.
 *
 * @param context Packaged flag and platform support.
 * @returns `null` to proceed, or the state to report instead.
 */
export function updateBlockedBy(context: UpdateContext): 'unsupported' | 'idle' | null {
  if (!context.packaged) {
    return 'idle'
  }

  return context.platformSupported ? null : 'unsupported'
}

/**
 * Linux AppImage updates cannot be installed by `electron-updater`.
 *
 * An AppImage is updated by replacing the file itself, which the app cannot do while running
 * from inside that file. electron-updater reports it as an unsupported feature rather than
 * throwing, and the honest thing is to say so instead of showing a check that can never finish.
 *
 * @param platform The `process.platform` value.
 * @returns True when updates can be installed on this platform.
 */
export function platformSupportsUpdates(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/**
 * Turns an updater failure into something worth showing a user.
 *
 * The raw messages are English, aimed at a developer, and several of them mean the same thing
 * to someone who just wants their diary to open: the feed is missing, the artifact is unsigned,
 * or the network is down. The UI is Spanish (ADR-015), so the translation belongs here rather
 * than in whichever component happens to render it first.
 *
 * @param message The error as the updater reported it.
 * @returns A Spanish sentence naming what went wrong.
 */
export function describeUpdateFailure(message: string): string {
  const text = message.toLowerCase()

  if (text.includes('latest') && (text.includes('404') || text.includes('not found'))) {
    return 'No hay ninguna versión publicada todavía. Es normal en la primera ejecución.'
  }

  if (text.includes('signature') || text.includes('unsigned') || text.includes('certificate')) {
    return 'La versión publicada no está firmada, así que no se puede instalar automáticamente.'
  }

  if (text.includes('enotfound') || text.includes('getaddrinfo') || text.includes('network')) {
    return 'No se pudo contactar con GitHub. Se volverá a comprobar más tarde.'
  }

  if (text.includes('checksum') || text.includes('corrupt')) {
    return 'La descarga no coincide con lo publicado y se ha descartado.'
  }

  return 'No se pudo comprobar si hay actualizaciones.'
}
