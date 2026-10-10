import Database from 'better-sqlite3'

/**
 * Pragmas applied to every connection TaskDiary opens.
 *
 * - `journal_mode = WAL` keeps readers non-blocking while a write is in flight. It is
 *   persistent: SQLite stores it in the database header, so setting it on every open is
 *   belt and braces for `:memory:` databases, where it cannot be persisted.
 * - `foreign_keys = ON` makes SQLite enforce referential integrity, which is off by
 *   default in SQLite for backwards compatibility. It is per-connection and NOT
 *   persistent — a connection opened without it silently disables `ON DELETE CASCADE`.
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
 * Opens an in-memory database with the TaskDiary pragmas applied.
 *
 * The test entry point. `:memory:` runs real SQL through the same `better-sqlite3`
 * binding the app uses — no mocked database layer, no `ELECTRON_RUN_AS_NODE` (ADR-011).
 *
 * @returns A fresh, migrated-in-process database handle. The caller owns closing it.
 */
export function openInMemoryDatabase(): Database.Database {
  return openDatabase(':memory:')
}

/**
 * Runs `work` inside a SQLite transaction, rolling back if it throws.
 *
 * `better-sqlite3` already provides `database.transaction(fn)`. This wrapper exists for
 * one reason: typing. The built-in returns the function unchanged, which loses the
 * "returns T, rolls back on throw" contract that callers need to reason about, and it
 * re-prepares the statement on every call.
 *
 * @param database An open database handle.
 * @param work Unit of work. Its return value is passed through.
 * @returns Whatever `work` returned.
 * @throws Re-throws whatever `work` threw, after rolling back.
 */
export function transaction<T>(database: Database.Database, work: () => T): T {
  return database.transaction(work)()
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

/**
 * Reports whether a table exists in the current schema.
 *
 * @param database An open database handle.
 * @param tableName Table to look for.
 * @returns True when the table is present.
 */
export function hasTable(database: Database.Database, tableName: string): boolean {
  const row = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name: string } | undefined

  return row !== undefined
}
