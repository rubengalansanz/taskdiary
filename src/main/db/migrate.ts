import type Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

/** Outcome of a migration run, reported by the main process at startup. */
export interface MigrationReport {
  /** Schema version before the run, as stored in `PRAGMA user_version`. */
  fromVersion: number
  /** Schema version after the run. */
  toVersion: number
  /** Ids of the migrations executed, in the order they ran. */
  applied: string[]
}

/**
 * Reads the schema version recorded in the database.
 *
 * `PRAGMA user_version` is a 32-bit signed integer stored in the database header, which
 * is exactly what plan §15.3 asks for: the database carries its own version and needs no
 * `schema_migrations` table.
 *
 * @param database An open database handle.
 * @returns The stored schema version; 0 when the database has never been migrated.
 */
export function readSchemaVersion(database: Database.Database): number {
  const rows = database.pragma('user_version') as { user_version: number }[]

  return rows[0]?.user_version ?? 0
}

/**
 * Writes the schema version into the database header.
 *
 * Must be called inside the same transaction as the migration it describes, so a crash
 * between the DDL and the version bump cannot leave a half-applied schema claiming to be
 * fully migrated.
 *
 * @param database An open database handle.
 * @param version The new schema version.
 */
function writeSchemaVersion(database: Database.Database, version: number): void {
  // `user_version` takes a literal, not a bound parameter — SQLite does not allow
  // placeholders in PRAGMA. The value is an integer this module computes, never input.
  database.pragma(`user_version = ${version}`)
}

/**
 * Applies every migration newer than the database's current version.
 *
 * Each migration runs inside its own transaction together with the `user_version` bump.
 * SQLite's DDL is transactional, so a failing migration rolls back both the statements
 * and the version — the next start retries it from a clean state instead of skipping it.
 *
 * One transaction per migration rather than one for the whole backlog: each committed
 * step survives a later failure, and a big catch-up applies in bounded units.
 *
 * @param database An open database handle, already carrying the TaskDiary pragmas.
 * @returns What was applied, for logging at startup.
 * @throws Whatever better-sqlite3 throws if a migration fails; the database is left at
 *   the last successfully applied version.
 */
export function runMigrations(database: Database.Database): MigrationReport {
  const fromVersion = readSchemaVersion(database)
  const pending = MIGRATIONS.filter((_, index) => index >= fromVersion)
  const applied: string[] = []

  const applyOne = database.transaction((version: number, sql: string, id: string) => {
    database.exec(sql)
    writeSchemaVersion(database, version)
    applied.push(id)
  })

  for (const [offset, migration] of pending.entries()) {
    // Array index + 1 is the schema version: appending to MIGRATIONS is the only
    // supported way to bump it.
    applyOne(fromVersion + offset + 1, migration.sql, migration.id)
  }

  return {
    fromVersion,
    toVersion: readSchemaVersion(database),
    applied
  }
}
