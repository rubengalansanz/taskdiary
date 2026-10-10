import { isAbsolute, join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATABASE_FILE_NAME, resolveDatabasePath } from './database-path'

const userDataPath = join('C:', 'Users', 'dev', 'AppData', 'Roaming', 'TaskDiary')

describe('DATABASE_FILE_NAME', () => {
  it('is the agreed on-disk file name', () => {
    expect(DATABASE_FILE_NAME).toBe('taskdiary.db')
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
