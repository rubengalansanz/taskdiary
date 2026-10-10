import { join } from 'node:path'

/**
 * On-disk name of the TaskDiary SQLite database.
 *
 * Kept next to the resolver so the main process, the smoke screen and any future
 * backup/export tooling agree on a single file name.
 */
export const DATABASE_FILE_NAME = 'taskdiary.db'

/**
 * Resolves the absolute path of the SQLite database inside the user data directory.
 *
 * Pure by design: it takes the directory as a string instead of calling
 * `app.getPath('userData')`, so this module stays free of any Electron import and
 * is unit-testable in plain Node.
 *
 * @param userDataPath Absolute user data directory handed over by the main process.
 * @param fileName Optional override, mainly used by tests and temporary databases.
 * @returns The absolute path of the database file.
 */
export function resolveDatabasePath(
  userDataPath: string,
  fileName: string = DATABASE_FILE_NAME
): string {
  return join(userDataPath, fileName)
}
