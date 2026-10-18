import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Keeps only the native prebuilds the target can actually load (Fase 9, T1).
 *
 * better-sqlite3 ships one prebuilt `.node` per platform under `prebuilds/`, and its loader
 * resolves the one matching the running binary at require time. `asarUnpack` puts all of them on
 * disk because it is told to unpack the directory, not the file it needs — 27 MB across eight
 * platforms, of which exactly one is ever loaded.
 *
 * electron-builder passes `context.electronPlatformName` and `context.arch`, so the decision is
 * made from what is being built rather than from whatever the host happens to be running. That
 * distinction is the whole point: pruning by `process.platform` would produce a broken artifact
 * the moment anyone cross-builds.
 */

/**
 * Platform token in the prebuild filename, per electron-builder's `electronPlatformName`.
 *
 * @type {Record<string, string>}
 */
const PLATFORM_TOKEN = Object.freeze({
  win32: 'win32',
  darwin: 'darwin',
  linux: 'linux'
})

/**
 * Removes the prebuilds that do not belong to the platform being packaged.
 *
 * musl builds are kept alongside glibc ones on Linux: the two are indistinguishable at
 * packaging time and a statically linked musl user gets a working app instead of a crash.
 *
 * @param {import('app-builder-lib').BeforePackContext} context electron-builder's `afterPack` context.
 * @returns {Promise<void>} Resolves once the foreign binaries are gone.
 */
export default async function pruneForeignPrebuilds(context) {
  const platform = PLATFORM_TOKEN[context.electronPlatformName]

  if (platform === undefined) {
    return
  }

  const prebuildsDir = join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'prebuilds'
  )

  let entries

  try {
    entries = readdirSync(prebuildsDir)
  } catch {
    // No unpacked prebuilds: nothing was unpacked, so there is nothing to prune.
    return
  }

  for (const entry of entries) {
    const isForAnotherPlatform = !entry.startsWith(`${platform}-`)

    // Only same-platform, different-architecture binaries are dropped. A foreign `.node` that
    // does not carry the platform prefix is left alone rather than guessed at.
    if (entry.endsWith('.node') && isForAnotherPlatform && entry.includes('-')) {
      rmSync(join(prebuildsDir, entry), { force: true })
    }
  }

  // better-sqlite3 also ships the C++ that builds it: the SQLite amalgamation under `deps/`,
  // the native sources under `src/`, and the gyp files that tie them together. None of it is
  // loaded at runtime — N-API loads a prebuilt binary or nothing — and all of it is ~9 MB in an
  // installer aimed at a 100 MB budget.
  const packageRoot = join(prebuildsDir, '..')

  for (const entry of ['deps', 'src', 'binding.gyp', 'build']) {
    rmSync(join(packageRoot, entry), { recursive: true, force: true })
  }
}
