import { isAbsolute, join, posix, sep, win32 } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATABASE_FILE_NAME, resolveDatabasePath } from './database-path'

/**
 * An absolute user data directory.
 *
 * This used to be hard-coded as `C:/Users/dev/...`, which is why the suite was green on a
 * Windows laptop and red on CI: on a POSIX machine `C:` is not a root, so `join` produced
 * `C:/Users/dev/...` — a *relative* path with an odd first segment. The resolver was never
 * wrong; the fixture simply assumed the platform the test happened to run on.
 *
 * A leading forward slash rather than `resolve(sep, ...)` on purpose. `resolve` would
 * normalise this to `C:\home\...` on Windows — absolute there, relative under POSIX, and
 * the trap all over again. A literal `/` is absolute under *both* dialects, so this one
 * fixture works everywhere.
 */
const userDataPath = '/home/dev/AppData/Roaming/TaskDiary'

describe('DATABASE_FILE_NAME', () => {
  it('is the agreed on-disk file name', () => {
    expect(DATABASE_FILE_NAME).toBe('taskdiary.db')
  })
})

describe('the fixture itself', () => {
  it('is an absolute path under both path dialects, not just the host one', () => {
    // The bug this guards against was invisible on one machine and fatal on another: a suite
    // that is green locally and red in CI because its fixture assumed a platform.
    expect(win32.isAbsolute(userDataPath)).toBe(true)
    expect(posix.isAbsolute(userDataPath)).toBe(true)
  })
})

describe('resolveDatabasePath', () => {
  it('joins the default file name onto the user data directory', () => {
    expect(resolveDatabasePath(userDataPath)).toBe(join(userDataPath, 'taskdiary.db'))
  })

  it('accepts a custom file name override', () => {
    expect(resolveDatabasePath(userDataPath, 'scratch.db')).toBe(join(userDataPath, 'scratch.db'))
  })

  it('does not duplicate separators when the directory has a trailing separator', () => {
    const withTrailingSeparator = `${userDataPath}${sep}`
    const resolved = resolveDatabasePath(withTrailingSeparator)

    expect(resolved).toBe(join(userDataPath, 'taskdiary.db'))
    expect(resolved).not.toContain(`${sep}${sep}`)
  })

  it('resolves to an absolute path', () => {
    expect(isAbsolute(resolveDatabasePath(userDataPath))).toBe(true)
    expect(isAbsolute(resolveDatabasePath(`${userDataPath}${sep}`, 'nested.db'))).toBe(true)
  })

  it('keeps every resolution deterministic', () => {
    expect(resolveDatabasePath(userDataPath)).toBe(resolveDatabasePath(userDataPath))
  })
})
