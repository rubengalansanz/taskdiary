import { describe, expect, it } from 'vitest'
import { describeUpdateFailure, platformSupportsUpdates, updateBlockedBy } from './updater'

/**
 * The updater's rules (Fase 9, T4).
 *
 * `electron-updater` has been installed since Phase 0 and never wired, so these are the first
 * tests anything about updates has. They are cheap on purpose: the value is in the rules being
 * written down, not in exercising a library.
 */

describe('updateBlockedBy', () => {
  it('runs in a packaged build on a platform that can install', () => {
    expect(updateBlockedBy({ packaged: true, platformSupported: true })).toBeNull()
  })

  it('does nothing from a source checkout', () => {
    // Without this, every `npm run dev` hits the network looking for a release of a version
    // that was never published.
    expect(updateBlockedBy({ packaged: false, platformSupported: true })).toBe('idle')
  })

  it('reports an unupdatable platform as unsupported rather than silently doing nothing', () => {
    expect(updateBlockedBy({ packaged: true, platformSupported: false })).toBe('unsupported')
  })

  it('treats a source checkout as idle even on an unupdatable platform', () => {
    // Development wins over platform: nothing should be reported before the app is packaged.
    expect(updateBlockedBy({ packaged: false, platformSupported: false })).toBe('idle')
  })
})

describe('platformSupportsUpdates', () => {
  it('supports Windows and macOS', () => {
    expect(platformSupportsUpdates('win32')).toBe(true)
    expect(platformSupportsUpdates('darwin')).toBe(true)
  })

  it('does not support Linux', () => {
    // An AppImage is updated by replacing the file, which the app cannot do while running from
    // inside that file.
    expect(platformSupportsUpdates('linux')).toBe(false)
  })
})

describe('describeUpdateFailure', () => {
  it('explains a missing feed as the first run rather than as a failure', () => {
    expect(describeUpdateFailure('HttpError: 404 Not Found for latest.yml')).toContain(
      'No hay ninguna versión publicada'
    )
  })

  it('names an unsigned artifact as the cause, because no setting fixes it', () => {
    expect(describeUpdateFailure('Signature verification failed: unsigned app')).toContain(
      'no está firmada'
    )
  })

  it('recognises a network failure by its lower-level cause', () => {
    expect(describeUpdateFailure('getaddrinfo ENOTFOUND github.com')).toContain(
      'No se pudo contactar con GitHub'
    )
  })

  it('reports a checksum mismatch as a discarded download', () => {
    expect(describeUpdateFailure('checksum mismatch, file is corrupted')).toContain(
      'se ha descartado'
    )
  })

  it('falls back to something honest rather than leaking the raw message', () => {
    const fallback = describeUpdateFailure('ENOSPC: no space left on device')

    expect(fallback).toBe('No se pudo comprobar si hay actualizaciones.')
    // Not "contains no long words" — the fallback is a Spanish sentence and matches that
    // anyway. What must not survive is the message the updater actually produced.
    expect(fallback).not.toContain('ENOSPC')
    expect(fallback).not.toMatch(/\b(device|error|failed|space)\b/i)
  })
})
