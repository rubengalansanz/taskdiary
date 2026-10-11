/**
 * Tag naming and `#tag` parsing, shared by the main process and the renderer.
 *
 * These are domain rules, so they live in the shared contract rather than in
 * `src/main/core/`: the renderer has to run the same parser before saving, and a renderer
 * that imported from `main/` would be reaching across the process boundary for something
 * that belongs to neither process in particular.
 *
 * Pure functions. No database, no Electron, no React.
 */

/** Longest accepted tag, in characters. */
export const MAX_TAG_LENGTH = 40

/** Shortest accepted tag. One character tags are almost always typos or punctuation. */
export const MIN_TAG_LENGTH = 2

/**
 * Placeholder that stands in for `ñ` while the diacritics are stripped.
 *
 * U+0000 never appears in user text, and unlike a letter it is untouched by NFD, by the
 * diacritic strip and by `toLowerCase`.
 */
const ENYE_SENTINEL = '\u0000'

/**
 * Strips diacritics and lowercases, collapsing runs of whitespace.
 *
 * NFD splits `é` into `e` plus a combining mark, so removing the marks is enough to make
 * Spanish and Portuguese comparable. Nothing is translated, and `ñ` is explicitly
 * protected: `\p{Diacritic}` also matches the combining tilde in `ñ`, so a plain strip
 * turns `año` into `ano` and makes two different words equal. It is parked behind a
 * sentinel before the strip and restored after.
 *
 * @param value Text to fold.
 * @returns The folded form.
 */
export function foldForSearch(value: string): string {
  return value
    .replace(/[ñÑ]/gu, ENYE_SENTINEL)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\u0000/gu, 'ñ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Normalises a tag name: no `#`, folded, no surrounding whitespace.
 *
 * @param value Raw tag as typed.
 * @returns The stored form.
 * @throws RangeError When the name is empty or out of bounds after normalisation.
 */
export function normalizeTagName(value: string): string {
  const trimmed = value.trim().replace(/^#+/u, '').trim()
  const folded = foldForSearch(trimmed).replace(/\s+/gu, '-')

  if (folded.length < MIN_TAG_LENGTH || folded.length > MAX_TAG_LENGTH) {
    throw new RangeError(
      `Tag «${value}» must be between ${MIN_TAG_LENGTH} and ${MAX_TAG_LENGTH} characters`
    )
  }

  return folded
}

/**
 * Reports whether a normalised tag is acceptable.
 *
 * Lets the UI react to a typed tag without catching an exception.
 *
 * @param value Raw tag as typed.
 * @returns True when {@link normalizeTagName} would accept it.
 */
export function isValidTagName(value: string): boolean {
  try {
    normalizeTagName(value)
    return true
  } catch {
    return false
  }
}

/** Result of scanning free text for `#tag` tokens. */
export interface ParsedTags {
  /** The distinct tags found, in the order they appeared. */
  tags: string[]
  /** The text with the accepted tag tokens removed. */
  text: string
}

/**
 * Finds `#tag` tokens in free text.
 *
 * Three rules, each one earned:
 *
 * - **A tag must contain a letter.** Otherwise "Revisar PR #412" files every issue
 *   reference as a tag and the tag list fills with numbers.
 * - **At least {@link MIN_TAG_LENGTH} characters.** `#a` is nearly always a typo.
 * - **Accepted tokens are stripped from the text.** A tag left written out in the notes
 *   is a tag the user can neither rename nor remove.
 *
 * Rejected tokens are left in the text untouched, so `#412` still reads as `#412`.
 *
 * @param value Free text.
 * @returns The tags found and the text with them removed.
 */
export function parseTagsFromText(value: string): ParsedTags {
  // Built with `new RegExp` because the length bound comes from the constants: a regex
  // literal cannot interpolate, and a second copy of the bound would be one more place
  // for the two to disagree.
  //
  // The lookbehind requires a word boundary before the `#`, so an email address or a URL
  // fragment is not read as a tag.
  const pattern = new RegExp(
    `(?:^|(?<=[\\s(]))#([\\p{L}\\p{N}_-]{${MIN_TAG_LENGTH - 1},${MAX_TAG_LENGTH}})`,
    'gu'
  )

  const tags: string[] = []
  // Rebuilt by walking the matches and copying the gaps between them. Appending only the
  // matches would drop every character that is not part of one.
  let text = ''
  let cursor = 0

  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0
    const token = match[0]
    const raw = match[1] ?? ''

    text += value.slice(cursor, start)

    const name = asTagName(raw)

    if (name === null) {
      // Not a tag: the text stays exactly as the user typed it.
      text += token
    } else if (!tags.includes(name)) {
      tags.push(name)
    }

    cursor = start + token.length
  }

  text += value.slice(cursor)

  return {
    tags,
    text: text.replace(/[ \t]{2,}/gu, ' ').trim()
  }
}

/**
 * Turns a captured token into a tag name, or `null` when it is not one.
 *
 * @param raw The text between `#` and the end of the token.
 * @returns The normalised name, or `null`.
 */
function asTagName(raw: string): string | null {
  if (!/\p{L}/u.test(raw)) {
    return null
  }

  try {
    return normalizeTagName(raw)
  } catch {
    return null
  }
}
