import { beforeEach, describe, expect, it } from 'vitest'
import { openInMemoryDatabase } from './database'
import { runMigrations } from './migrate'
import { LIST_BY_DATE_SQL, LIST_BY_RANGE_SQL, SUMMARIZE_RANGE_SQL } from './repositories/tasks-repo'
import type Database from 'better-sqlite3'

/**
 * What SQLite actually does with the three statements every navigation runs (Fase 7, S2).
 *
 * The plan asked for a review of the queries with `EXPLAIN QUERY PLAN`. A review nobody reads
 * again rots, so this pins the result as a test: the statements are imported from the repository
 * rather than copied, because a copied statement is green on the day it stops being the one the
 * app runs.
 *
 * What each assertion is protecting, and what it is deliberately not:
 *
 * - The day and range reads must seek by index. They are on the path of every click in the app.
 * - The aggregate read must stay COVERING and free of a temp sort. That is the one that earns
 *   the Week, Month and Heatmap views their Fase 4 promise — days counted in SQL, never task
 *   rows loaded to count them in JavaScript — so it is the one most worth protecting.
 * - The search statements are pinned too, but for the opposite reason: they *do* scan, and that
 *   is correct. A substring match cannot seek a B-tree. The test records the shape so that a
 *   future change to the pattern builder shows up as a diff in this file, where the reasoning is,
 *   instead of silently becoming slower.
 */

/** A row SQLite's query planner emits. */
interface PlanRow {
  detail: string
}

/** Days of history to seed: enough that a scan is visibly different from a seek. */
const SEEDED_DAYS = 60

/** Tasks per day, which is what a heavy day looks like for one person. */
const TASKS_PER_DAY = 50

/** One calendar day, `offset` days into the past. */
function dayFrom(offset: number): string {
  const day = new Date(Date.UTC(2026, 0, 1))
  day.setUTCDate(day.getUTCDate() - offset)
  return day.toISOString().slice(0, 10)
}

/**
 * Runs `EXPLAIN QUERY PLAN` and joins the steps into one readable string.
 *
 * @param database An open database with the schema applied.
 * @param sql The statement, with `?` placeholders.
 * @param parameters Values bound exactly as the repository binds them.
 * @returns Every plan step, newline separated.
 */
function planFor(database: Database.Database, sql: string, ...parameters: unknown[]): string {
  return (database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters) as PlanRow[])
    .map((row) => row.detail)
    .join('\n')
}

describe('query plans', () => {
  let database: Database.Database

  beforeEach(() => {
    database = openInMemoryDatabase()
    runMigrations(database)

    const insert = database.prepare(
      `INSERT INTO tasks (id, title, task_date, status, search_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )

    for (let day = 0; day < SEEDED_DAYS; day++) {
      const date = dayFrom(day)

      for (let index = 0; index < TASKS_PER_DAY; index++) {
        insert.run(
          `${date}-${index}`,
          `Tarea ${index}`,
          date,
          'done',
          `tarea ${index}`,
          `${date}T09:00:00Z`,
          `${date}T09:00:00Z`
        )
      }
    }
  })

  it('seeks by index for one day instead of scanning the table', () => {
    const plan = planFor(database, LIST_BY_DATE_SQL, dayFrom(3))

    expect(plan).toContain('SEARCH tasks USING INDEX idx_tasks_day_order')
    expect(plan).not.toMatch(/\bSCAN tasks\b(?! USING)/)
  })

  it('seeks by index across a day range', () => {
    const plan = planFor(database, LIST_BY_RANGE_SQL, dayFrom(30), dayFrom(0))

    expect(plan).toMatch(/SEARCH tasks USING (?:COVERING )?INDEX idx_tasks_(?:date|day_order)/)
    expect(plan).not.toMatch(/\bSCAN tasks\b(?! USING)/)
  })

  it('aggregates a range by index, with no temporary sort', () => {
    const plan = planFor(database, SUMMARIZE_RANGE_SQL, dayFrom(30), dayFrom(0))

    expect(plan).toMatch(/SEARCH tasks USING (?:COVERING )?INDEX idx_tasks_date/)

    // This is the property worth protecting. `GROUP BY task_date ORDER BY task_date` is the
    // same order `idx_tasks_date` already delivers, so SQLite groups straight off the index
    // and never materialises a temp b-tree. Lose it and a 26-week heatmap sorts every row it
    // just read.
    expect(plan).not.toContain('TEMP B-TREE')

    // It is deliberately *not* covering. A covering index would have to carry `estimate_min`,
    // `started_at` and `completed_at` alongside `task_date` and `status`, and that is a wide
    // index to maintain on every insert and every status change — to save a table lookup on an
    // aggregate that reads every matching row anyway. At this size that trade buys nothing.
    // If a real workload ever makes it worth it, this is the assertion to revisit, not a
    // comment to add.
  })

  it('documents that the substring search scans, because it must', () => {
    const like = "%' OR 1=1 --%"
    const plan = planFor(
      database,
      `SELECT COUNT(*) AS total FROM tasks WHERE search_text LIKE ? ESCAPE '\\'`,
      like
    )

    // Not an oversight being tolerated: `LIKE '%…%'` has no anchor for a B-tree to seek to, so
    // a scan is the correct plan and the only way out would be a full-text index, which this
    // app does not need at its size. What this pins is that it stays a *covering* scan — if the
    // pattern builder ever changes shape, the row lookups come back and the reasoning belongs
    // in a new decision rather than in a silent slowdown.
    expect(plan).toMatch(/SCAN tasks USING COVERING INDEX/)
  })
})
