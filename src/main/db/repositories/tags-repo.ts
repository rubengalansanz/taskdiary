import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { normalizeTagName } from '../../../shared/tags'

/**
 * Read and write access to `tags` and `task_tags`.
 *
 * Tag names are the user's own words, so the only rule is that the same word always means
 * the same tag: normalised on the way in, and never renamed behind the user's back.
 *
 * `ON DELETE CASCADE` on `task_tags` does the cleanup when a task goes away — but only
 * while `PRAGMA foreign_keys = ON`, which is a per-connection setting SQLite does not
 * persist. A handle opened through `openDatabase` has it on.
 */

/** A tag as the domain sees it. */
export interface Tag {
  /** UUID v4. */
  id: string
  /** Normalised name, without the leading `#`. */
  name: string
  /** Optional colour, `null` when unset. */
  color: string | null
}

/** A tag plus how many tasks carry it. */
export interface TagWithCount extends Tag {
  /** Tasks in the whole history carrying this tag. */
  taskCount: number
}

/** Shape of a `tags` row. */
interface TagRow {
  id: string
  name: string
  color: string | null
}

/** Shape of a joined `tags` + count row. */
interface TagCountRow extends TagRow {
  task_count: number
}

/**
 * A repository bound to one open database handle.
 */
export class TagsRepository {
  private readonly database: Database.Database

  constructor(database: Database.Database) {
    this.database = database
  }

  /**
   * Every tag in use, most used first.
   *
   * Tags no task carries any more are still returned, with a count of zero: silently
   * deleting them would make a tag the user stopped using come back as a duplicate later,
   * and would make the sidebar's list shift under them.
   *
   * @returns The tags, ordered by usage then alphabetically.
   */
  listAll(): TagWithCount[] {
    const rows = this.database
      .prepare(
        `SELECT t.id, t.name, t.color, COUNT(tt.task_id) AS task_count
           FROM tags t
           LEFT JOIN task_tags tt ON tt.tag_id = t.id
          GROUP BY t.id, t.name, t.color
          ORDER BY task_count DESC, t.name ASC`
      )
      .all() as TagCountRow[]

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      taskCount: row.task_count
    }))
  }

  /**
   * Finds a tag by its normalised name.
   *
   * @param name Name as typed; normalised here, so callers need not.
   * @returns The tag, or `null` when it does not exist.
   */
  findByName(name: string): Tag | null {
    const row = this.database
      .prepare('SELECT id, name, color FROM tags WHERE name = ?')
      .get(normalizeTagName(name)) as TagRow | undefined

    return row === undefined ? null : { id: row.id, name: row.name, color: row.color }
  }

  /**
   * Returns the tag with this name, creating it if it does not exist.
   *
   * Idempotent by name, which is what makes typing `#proyecto` twice in the same task
   * harmless. The insert is `OR IGNORE` followed by a re-read, so two writes racing on a
   * brand-new name cannot produce two rows: the second insert loses the unique index and
   * then reads the winner's row.
   *
   * @param name Name as typed.
   * @returns The tag.
   */
  findOrCreate(name: string): Tag {
    const normalized = normalizeTagName(name)

    this.database
      .prepare('INSERT OR IGNORE INTO tags (id, name, color) VALUES (?, ?, NULL)')
      .run(randomUUID(), normalized)

    const row = this.database
      .prepare('SELECT id, name, color FROM tags WHERE name = ?')
      .get(normalized) as TagRow

    return { id: row.id, name: row.name, color: row.color }
  }

  /**
   * The tags attached to one task.
   *
   * @param taskId Task UUID.
   * @returns Its tags, alphabetically.
   */
  listForTask(taskId: string): Tag[] {
    const rows = this.database
      .prepare(
        `SELECT t.id, t.name, t.color
           FROM tags t
           JOIN task_tags tt ON tt.tag_id = t.id
          WHERE tt.task_id = ?
          ORDER BY t.name ASC`
      )
      .all(taskId) as TagRow[]

    return rows.map((row) => ({ id: row.id, name: row.name, color: row.color }))
  }

  /**
   * Attaches a tag to a task, if it is not already attached.
   *
   * @param taskId Task UUID.
   * @param tagId Tag UUID.
   * @returns True when the link was created.
   */
  attach(taskId: string, tagId: string): boolean {
    const result = this.database
      .prepare('INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)')
      .run(taskId, tagId)

    return result.changes > 0
  }

  /**
   * Detaches a tag from a task. The tag itself survives, unused.
   *
   * @param taskId Task UUID.
   * @param tagId Tag UUID.
   * @returns True when a link was removed.
   */
  detach(taskId: string, tagId: string): boolean {
    const result = this.database
      .prepare('DELETE FROM task_tags WHERE task_id = ? AND tag_id = ?')
      .run(taskId, tagId)

    return result.changes > 0
  }

  /**
   * Replaces a task's tags with exactly the given set.
   *
   * Replace rather than add: the form submits the complete list the user sees, so a tag
   * the user deleted from the notes must actually leave the task.
   *
   * @param taskId Task UUID.
   * @param tagNames Tag names as typed; normalised and deduplicated here.
   */
  setForTask(taskId: string, tagNames: string[]): void {
    const wanted = new Map<string, Tag>()

    for (const name of tagNames) {
      const tag = this.findOrCreate(name)
      wanted.set(tag.id, tag)
    }

    this.detachAll(taskId)

    const attach = this.database.prepare(
      'INSERT OR IGNORE INTO task_tags (task_id, tag_id) VALUES (?, ?)'
    )

    for (const tagId of wanted.keys()) {
      attach.run(taskId, tagId)
    }
  }

  private detachAll(taskId: string): void {
    this.database.prepare('DELETE FROM task_tags WHERE task_id = ?').run(taskId)
  }
}
