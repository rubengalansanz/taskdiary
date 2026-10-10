import Database from 'better-sqlite3'

/**
 * Pragmas applied to every connection TaskDiary opens.
 *
 * - `journal_mode = WAL` keeps readers non-blocking while a write is in flight.
 * - `foreign_keys = ON` makes SQLite enforce referential integrity, which is off
 *   by default in SQLite for backwards compatibility.
 */
export const DATABASE_PRAGMAS = ['journal_mode = WAL', 'foreign_keys = ON'] as const

/**
 * Opens the SQLite database at `filePath`.
 *
 * Takes a plain path on purpose: it never calls `app.getPath('userData')`, so this
 * module keeps the Phase 0 import boundary (only `node:*` and `better-sqlite3`) and
 * stays runnable from plain Node, outside Electron.
 *
 * @param filePath Absolute path of the database file; created when missing.
 * @returns The open database handle. The caller owns closing it.
 */
export function openDatabase(filePath: string): Database.Database {
  const database = new Database(filePath)

  for (const pragma of DATABASE_PRAGMAS) {
    database.pragma(pragma)
  }

  return database
}

/**
 * Runs the trivial `SELECT 1` round trip used as the Phase 0 acceptance check.
 *
 * @param database An open database handle.
 * @returns The integer value SQLite answered with; 1 on a healthy connection.
 * @throws Whatever better-sqlite3 throws when the handle is unusable.
 */
export function pingDatabase(database: Database.Database): number {
  const row = database.prepare('SELECT 1 AS value').get() as { value: number } | undefined

  return row?.value ?? 0
}

/**
 * Reads the SQLite library version of an open handle.
 *
 * @param database An open database handle.
 * @returns The reported SQLite version, or `unknown` when the row cannot be read.
 */
export function readSqliteVersion(database: Database.Database): string {
  const row = database.prepare('SELECT sqlite_version() AS version').get() as
    { version: string } | undefined

  return row?.version ?? 'unknown'
}
