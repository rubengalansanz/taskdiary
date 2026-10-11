import { describe, expect, it } from 'vitest'
import { VIEW_LABELS, VIEW_MODES, pathForView, viewFromPath, type ViewMode } from './view-mode'

/**
 * Addressing a view.
 *
 * Fase 4 moved the active view out of the UI store and into the path, because two answers to
 * "which view is this?" is one too many. These tests pin the mapping both ways: a path has to
 * name a view the app actually has, and switching views has to keep the user on the same day
 * instead of throwing them back to today.
 */

describe('viewFromPath', () => {
  it('recognises every view the app has', () => {
    const cases: ReadonlyArray<[string, ViewMode]> = [
      ['/day/2026-10-10', 'day'],
      ['/week/2026-10-10', 'week'],
      ['/month/2026-10-10', 'month'],
      ['/heatmap', 'heatmap']
    ]

    for (const [path, expected] of cases) {
      expect(viewFromPath(path)).toBe(expected)
    }
  })

  it('ignores a leading slash and extra segments', () => {
    expect(viewFromPath('week/2026-10-10')).toBe('week')
    expect(viewFromPath('/week/2026-10-10/extra')).toBe('week')
  })

  it('returns null for a path that names no view', () => {
    expect(viewFromPath('/')).toBeNull()
    expect(viewFromPath('/calendar/2026-10-10')).toBeNull()
  })
})

describe('pathForView', () => {
  it('carries the date for the views that are anchored on one', () => {
    expect(pathForView('day', '2026-10-10')).toBe('/day/2026-10-10')
    expect(pathForView('week', '2026-10-10')).toBe('/week/2026-10-10')
    expect(pathForView('month', '2026-10-10')).toBe('/month/2026-10-10')
  })

  it('drops the date for the heatmap, which has none', () => {
    expect(pathForView('heatmap', '2026-10-10')).toBe('/heatmap')
  })

  it('round-trips every view back to itself', () => {
    for (const mode of VIEW_MODES) {
      expect(viewFromPath(pathForView(mode, '2026-10-10'))).toBe(mode)
    }
  })
})

describe('the view switcher', () => {
  it('keeps the day when the view changes', () => {
    // Switching from the day view to the week view of 2026-10-07 must land on the week
    // containing that date, not on the current week. Dropping the date here would silently
    // move the user forward in time every time they changed reading.
    expect(pathForView('week', '2026-10-07')).toBe('/week/2026-10-07')
  })

  it('labels every view in Spanish', () => {
    for (const mode of VIEW_MODES) {
      expect(VIEW_LABELS[mode]).toBeTruthy()
    }
    expect(VIEW_LABELS.day).toBe('Día')
    expect(VIEW_LABELS.week).toBe('Semana')
    expect(VIEW_LABELS.month).toBe('Mes')
  })
})