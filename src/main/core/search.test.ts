import { describe, expect, it } from 'vitest'
import { buildLikePattern, buildSearchText, escapeLikePattern } from './search'

/**
 * The SQL-facing half of the search rules.
 *
 * Pure string functions, tested here rather than through the database; the queries that
 * consume them are exercised against real SQLite in `repositories/search-and-tags.test.ts`.
 */

describe('buildSearchText', () => {
  it('puts the title first, then the notes', () => {
    expect(buildSearchText('Informe', 'con detalle')).toBe('informe con detalle')
  })

  it('copes with null notes', () => {
    expect(buildSearchText('Informe', null)).toBe('informe')
  })

  it('folds accents but keeps ñ', () => {
    expect(buildSearchText('José Martínez', 'Año nuevo')).toBe('jose martinez año nuevo')
  })

  it('is searchable by either half', () => {
    const text = buildSearchText('Informe trimestral', 'revisar con Marta')

    expect(text).toContain('informe')
    expect(text).toContain('marta')
  })

  it('handles empty input', () => {
    expect(buildSearchText('', null)).toBe('')
  })
})

describe('escapeLikePattern', () => {
  it('escapes the wildcards LIKE would otherwise honour', () => {
    // Left unescaped, "100%" would match every row starting with "100".
    expect(escapeLikePattern('100%')).toBe('100\\%')
    expect(escapeLikePattern('a_b')).toBe('a\\_b')
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('informe')).toBe('informe')
  })
})

describe('buildLikePattern', () => {
  it('folds, escapes and wraps in wildcards', () => {
    expect(buildLikePattern('José')).toBe('%jose%')
    expect(buildLikePattern('100% real')).toBe('%100\\% real%')
    expect(buildLikePattern('año')).toBe('%año%')
  })
})
