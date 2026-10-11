/**
 * Text normalisation for the SQL search path.
 *
 * The renderer and the task form share the tag rules in `src/shared/tags.ts`; this module
 * holds the parts only the main process needs, because they exist to shape SQL — folding
 * the text into the column the query matches, and escaping the wildcards that would
 * otherwise change the meaning of what the user typed.
 *
 * Pure functions, no database and no Electron.
 */

import { foldForSearch } from '../../shared/tags'

/**
 * Builds the text stored in `tasks.search_text`.
 *
 * Title first, then notes: when both match, SQL `LIKE` gives no ordering guarantee, and
 * this way the stored form reads in the order a human would read it while debugging a row.
 *
 * @param title Task title.
 * @param notes Task notes, or `null`.
 * @returns The folded concatenation.
 */
export function buildSearchText(title: string, notes: string | null): string {
  return foldForSearch([title, notes ?? ''].filter((part) => part.length > 0).join(' '))
}

/**
 * Escapes the wildcards `LIKE` would otherwise interpret.
 *
 * A user searching for `100%` must not match every row containing `100`. Without this,
 * the query silently becomes something the user never typed.
 *
 * @param value Raw search text.
 * @returns The text, safe to place inside a `LIKE` pattern.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/gu, (character) => `\\${character}`)
}

/**
 * Builds the `LIKE` pattern for a substring search.
 *
 * @param value Raw search text.
 * @returns A pattern wrapped in `%`.
 */
export function buildLikePattern(value: string): string {
  return `%${escapeLikePattern(foldForSearch(value))}%`
}
