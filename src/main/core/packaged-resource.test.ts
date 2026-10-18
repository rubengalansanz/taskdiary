import { describe, expect, it } from 'vitest'
import { resolveUnpackedResource } from './packaged-resource'

/**
 * The packaged-build path bug (Fase 9, T1).
 *
 * A tray icon that silently fails to load only happens in a packaged build, so the only test
 * that can catch it is one that reproduces the packaged layout as data. `asarUnpack` puts a file
 * at `app.asar.unpacked/resources/icon.png`; code that joins from `__dirname` asks for
 * `app.asar/resources/icon.png`, which is not there.
 */
const PACKAGED = '/Applications/TaskDiary.app/Contents/Resources/app.asar/resources/icon.png'
const UNPACKED =
  '/Applications/TaskDiary.app/Contents/Resources/app.asar.unpacked/resources/icon.png'
const DEVELOPMENT = 'E:/repo/taskdiary/out/main/resources/icon.png'

describe('resolveUnpackedResource', () => {
  it('redirects to the unpacked copy when the archive path is missing', () => {
    const exists = (candidate: string): boolean => candidate === UNPACKED

    expect(resolveUnpackedResource(PACKAGED, exists)).toBe(UNPACKED)
  })

  it('leaves a path that exists alone', () => {
    const exists = (): boolean => true

    expect(resolveUnpackedResource(PACKAGED, exists)).toBe(PACKAGED)
  })

  it('leaves a development path alone, because it has no unpacked counterpart', () => {
    const exists = (candidate: string): boolean => candidate === DEVELOPMENT

    expect(resolveUnpackedResource(DEVELOPMENT, exists)).toBe(DEVELOPMENT)
  })

  it('never doubles the suffix on a path that is already unpacked', () => {
    const exists = (): boolean => true

    expect(resolveUnpackedResource(UNPACKED, exists)).toBe(UNPACKED)
  })

  it('returns the original when neither location has the file', () => {
    const exists = (): boolean => false

    // Nothing to fall back to, so the caller gets the path it asked for and its own error
    // message keeps naming the location that was tried.
    expect(resolveUnpackedResource(PACKAGED, exists)).toBe(PACKAGED)
  })
})
