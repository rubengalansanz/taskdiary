import { existsSync } from 'node:fs'

/**
 * Where a packaged resource really is (Fase 9, T1).
 *
 * `asarUnpack` moves a file OUT of the archive and onto the filesystem, under a sibling
 * `app.asar.unpacked` directory. Any code that resolves a path through `__dirname` therefore
 * points at a location that does not exist once the app is packaged, and the failure is quiet:
 * `nativeImage.createFromPath` returns an empty image rather than throwing, so the tray simply
 * does not appear and the app stays in the taskbar with no explanation.
 *
 * This bit the tray icon in every packaged build and was invisible until there was an artifact
 * to run — the same lesson as the `?asset` import before it, and the same reason the rule here
 * is "look for the file, do not guess which layout you are in".
 */

/** The archive itself. */
const ASAR = 'app.asar'

/** The directory `asarUnpack` writes into, sitting next to the archive. */
const UNPACKED = 'app.asar.unpacked'

/**
 * Points a path at the unpacked copy when that is where the file ended up.
 *
 * @param path The resolved path, which may point into the archive.
 * @param exists Existence check, injected so this stays testable without touching the disk.
 * @returns A path that exists, preferring the original when it already does.
 */
export function resolveUnpackedResource(
  path: string,
  exists: (candidate: string) => boolean = existsSync
): string {
  if (exists(path)) {
    return path
  }

  // Only a path that actually points into the archive can have an unpacked counterpart, and
  // the check has to skip one that is already unpacked or it would build a doubled name.
  if (!path.includes(ASAR) || path.includes(UNPACKED)) {
    return path
  }

  const candidate = path.replace(ASAR, UNPACKED)

  return exists(candidate) ? candidate : path
}
