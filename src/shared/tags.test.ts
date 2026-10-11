import { describe, expect, it } from 'vitest'
import {
  foldForSearch,
  isValidTagName,
  MAX_TAG_LENGTH,
  normalizeTagName,
  parseTagsFromText
} from './tags'

/**
 * Tag naming and `#tag` parsing.
 *
 * These rules run twice — once in the form before saving, once in the main process — so
 * they are pinned here rather than only through the database.
 */

describe('foldForSearch', () => {
  it('removes accents', () => {
    expect(foldForSearch('José')).toBe('jose')
    expect(foldForSearch('Martínez')).toBe('martinez')
    expect(foldForSearch('Introducción práctica')).toBe('introduccion practica')
  })

  it('lowercases', () => {
    expect(foldForSearch('INFORME')).toBe('informe')
    expect(foldForSearch('Informe Trimestral')).toBe('informe trimestral')
  })

  it('keeps ñ as ñ, because folding it would merge two different words', () => {
    // `ñ` decomposes to `n` + a combining tilde, and the tilde matches \p{Diacritic}.
    // A plain strip turns "año" into "ano".
    expect(foldForSearch('año')).toBe('año')
    expect(foldForSearch('NIÑO')).toBe('niño')
    expect(foldForSearch('español')).toBe('español')
    expect(foldForSearch('año')).not.toBe('ano')
  })

  it('collapses whitespace and trims', () => {
    expect(foldForSearch('  dos   espacios  ')).toBe('dos espacios')
    expect(foldForSearch('tab\tnueva')).toBe('tab nueva')
  })

  it('handles an empty string', () => {
    expect(foldForSearch('')).toBe('')
  })
})

describe('normalizeTagName', () => {
  it('strips the leading hash', () => {
    expect(normalizeTagName('#proyecto')).toBe('proyecto')
    expect(normalizeTagName('##proyecto')).toBe('proyecto')
  })

  it('folds case and accents', () => {
    expect(normalizeTagName('#Proyecto')).toBe('proyecto')
    expect(normalizeTagName('#PROYECTO')).toBe('proyecto')
    expect(normalizeTagName('#Año')).toBe('año')
  })

  it('turns inner spaces into hyphens', () => {
    expect(normalizeTagName('idea nueva')).toBe('idea-nueva')
  })

  it('rejects a tag that is too short or too long', () => {
    expect(() => normalizeTagName('#')).toThrow(RangeError)
    expect(() => normalizeTagName('#a')).toThrow(RangeError)
    expect(() => normalizeTagName('x'.repeat(MAX_TAG_LENGTH + 1))).toThrow(RangeError)
  })
})

describe('isValidTagName', () => {
  it('answers without throwing', () => {
    expect(isValidTagName('#proyecto')).toBe(true)
    expect(isValidTagName('#a')).toBe(false)
    expect(isValidTagName('')).toBe(false)
  })
})

describe('parseTagsFromText', () => {
  it('finds tags and strips them from the text', () => {
    const result = parseTagsFromText('Informe trimestral #proyecto #rutina')

    expect(result.tags).toEqual(['proyecto', 'rutina'])
    expect(result.text).toBe('Informe trimestral')
  })

  it('leaves a numeric token in the text, because #412 is an issue reference', () => {
    const result = parseTagsFromText('Revisar PR #412')

    expect(result.tags).toEqual([])
    expect(result.text).toBe('Revisar PR #412')
  })

  it('leaves a too-short token in the text', () => {
    const result = parseTagsFromText('un #a suelto')

    expect(result.tags).toEqual([])
    expect(result.text).toBe('un #a suelto')
  })

  it('collapses case variants into one tag', () => {
    const result = parseTagsFromText('uno #Proyecto y otro #proyecto')

    expect(result.tags).toEqual(['proyecto'])
  })

  it('keeps accents in tag names', () => {
    expect(parseTagsFromText('fiesta #año-nuevo').tags).toEqual(['año-nuevo'])
  })

  it('does not read an email address as a tag', () => {
    const result = parseTagsFromText('escribir a user@host luego')

    expect(result.tags).toEqual([])
    expect(result.text).toBe('escribir a user@host luego')
  })

  it('returns the text untouched when it has no tags', () => {
    const original = 'José Martínez revisó el presupuesto'

    expect(parseTagsFromText(original)).toEqual({ tags: [], text: original })
  })

  it('handles a tag at the very start and at the very end', () => {
    expect(parseTagsFromText('#inicio del día').tags).toEqual(['inicio'])
    expect(parseTagsFromText('final del día #fin').tags).toEqual(['fin'])
  })

  it('strips only the accepted tokens, keeping the rejected ones in place', () => {
    const result = parseTagsFromText('ver #412 y #real')

    expect(result.tags).toEqual(['real'])
    expect(result.text).toBe('ver #412 y')
  })

  it('does not treat a hashtag inside a word as a tag', () => {
    const result = parseTagsFromText('marcador#no-es-etiqueta aqui')

    expect(result.tags).toEqual([])
  })

  it('does not lose text that follows the last tag', () => {
    const result = parseTagsFromText('antes #etiqueta después del todo')

    expect(result.tags).toEqual(['etiqueta'])
    expect(result.text).toBe('antes después del todo')
  })
})
