/**
 * The migration list, bundled into the binary.
 *
 * Every `.sql` file under `migrations/` is imported with Vite's `?raw` suffix and listed
 * here in ascending order. Two consequences worth stating explicitly:
 *
 * 1. The SQL travels inside `out/main/index.js`. `electron-vite` bundles the main
 *    process into a single file, so reading migrations from disk at runtime would mean
 *    shipping the directory alongside the bundle and resolving paths relative to it —
 *    which is exactly the kind of thing that breaks under `asar: true` in Fase 9.
 * 2. Vitest transforms the same import, so `:memory:` tests execute the real DDL
 *    instead of a mocked copy. There is one source of truth and no drift.
 *
 * The directory stays a plain, reviewable folder in the repo; only *how* it reaches the
 * runtime changes.
 *
 * Rule §2.8: a published migration is never edited. Adding behaviour means adding
 * `0002_*.sql`.
 */

import migration0001 from '../../../migrations/0001_init.sql?raw'
import migration0002 from '../../../migrations/0002_started_at.sql?raw'
import migration0003 from '../../../migrations/0003_search_text.sql?raw'
import migration0004 from '../../../migrations/0004_series_id.sql?raw'
import migration0005 from '../../../migrations/0005_sort_order.sql?raw'

/** One numbered schema migration. */
export interface Migration {
  /** Stable identifier, e.g. `0001_init`. Never reused. */
  readonly id: string
  /** The SQL executed inside the migration transaction. */
  readonly sql: string
}

/**
 * All migrations in ascending order.
 *
 * The array index + 1 is the resulting `PRAGMA user_version`, so the list order *is* the
 * schema version. Appending is safe; reordering or removing an entry is not.
 */
export const MIGRATIONS: readonly Migration[] = [
  { id: '0001_init', sql: migration0001 },
  { id: '0002_started_at', sql: migration0002 },
  { id: '0003_search_text', sql: migration0003 },
  { id: '0004_series_id', sql: migration0004 },
  { id: '0005_sort_order', sql: migration0005 }
]

/**
 * Schema version this build expects.
 *
 * @returns The number of migrations bundled in this build.
 */
export function latestSchemaVersion(): number {
  return MIGRATIONS.length
}
