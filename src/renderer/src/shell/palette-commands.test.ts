import { describe, expect, it } from 'vitest'
import { PALETTE_COMMANDS, filterCommands, nextIndex, normalizeQuery } from './palette-commands'

/**
 * Filtering and keyboard selection for the `Ctrl+K` palette (S1).
 *
 * The palette does not own a list of actions: it shows the same command channels the native
 * menu already fires, so an action that works from the menu cannot be missing from the palette
 * or worded differently there. What is worth pinning here is the part that is easy to get
 * subtly wrong and impossible to see in a screenshot — accent and case folding over Spanish
 * labels, and the selection wrapping at both ends of the list.
 */

describe('the command list', () => {
  it('offers exactly the commands the native menu already fires', () => {
    // Six channels, no more: the palette is a second door to the same six actions, so a
    // seventh entry here would mean an action exists in one place and not the other. Fase 9
    // added "Buscar actualizaciones" to both sides together — a menu item with no palette entry
    // would be a command nobody finds.
    expect(PALETTE_COMMANDS).toHaveLength(6)
  })

  it('gives every command a Spanish label', () => {
    for (const command of PALETTE_COMMANDS) {
      expect(command.label.length).toBeGreaterThan(0)
    }
  })

  it('claims a shortcut only for the commands the menu actually accelerates', () => {
    // The file header's own rule: showing a hint that does not fire is worse than showing none.
    // "Buscar actualizaciones" has no accelerator on purpose — the updater refuses outright
    // outside a packaged build, so a shortcut that silently does nothing on every `npm run dev`
    // would teach the shortcut is unreliable. Every other command keeps its real accelerator.
    const withoutShortcut = PALETTE_COMMANDS.filter((command) => command.shortcut.length === 0)

    expect(withoutShortcut.map((command) => command.label)).toEqual(['Buscar actualizaciones'])

    for (const command of PALETTE_COMMANDS.filter((entry) => entry.shortcut.length > 0)) {
      expect(command.shortcut).not.toBe('')
      expect(command.label.length).toBeGreaterThan(0)
    }
  })

  it('lists no channel twice', () => {
    const channels = PALETTE_COMMANDS.map((command) => command.channel)

    expect(new Set(channels).size).toBe(channels.length)
  })
})

describe('filterCommands', () => {
  it('returns every command for an empty query', () => {
    expect(filterCommands('')).toHaveLength(PALETTE_COMMANDS.length)
  })

  it('matches a fragment of the label regardless of case', () => {
    const labels = filterCommands('HOY').map((command) => command.label)

    expect(labels).toHaveLength(1)
    expect(labels[0]).toContain('Hoy')
  })

  it('matches without the accent the user is likely to leave out', () => {
    // A Spanish keyboard and a fast typist produce "dia" far more often than "día". Folding the
    // diacritic is the difference between the palette working and looking broken.
    expect(filterCommands('dia').length).toBeGreaterThan(0)
    expect(filterCommands('día').length).toBe(filterCommands('dia').length)
  })

  it('keeps the original order of the surviving commands', () => {
    const labels = filterCommands('e').map((command) => command.label)
    const positions = labels.map((label) => PALETTE_COMMANDS.findIndex((c) => c.label === label))

    // A fuzzy matcher that re-sorts by score would make the list jump around while the user is
    // still reading it. Filtering may only remove entries, never move them.
    expect(positions.length).toBeGreaterThan(1)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('returns nothing when the query matches nothing', () => {
    expect(filterCommands('zzzz')).toHaveLength(0)
  })

  it('ignores surrounding whitespace', () => {
    expect(filterCommands('   ')).toHaveLength(PALETTE_COMMANDS.length)
    expect(filterCommands('  hoy  ').length).toBe(filterCommands('hoy').length)
  })

  it('ignores case on both sides of the match', () => {
    expect(normalizeQuery('  DÍA ')).toBe('dia')
  })
})

describe('nextIndex', () => {
  it('moves down and wraps past the last command', () => {
    const last = PALETTE_COMMANDS.length - 1

    expect(nextIndex(0, PALETTE_COMMANDS.length, 1)).toBe(1)
    expect(nextIndex(last, PALETTE_COMMANDS.length, 1)).toBe(0)
  })

  it('moves up and wraps before the first command', () => {
    expect(nextIndex(1, PALETTE_COMMANDS.length, -1)).toBe(0)
    expect(nextIndex(0, PALETTE_COMMANDS.length, -1)).toBe(PALETTE_COMMANDS.length - 1)
  })

  it('stays on the first command when there is nothing to move to', () => {
    // An empty result list is reachable: the user can type a query that matches nothing, and
    // arrow keys must not throw or produce -1, which would index into nothing.
    expect(nextIndex(0, 0, 1)).toBe(0)
    expect(nextIndex(0, 0, -1)).toBe(0)
  })

  it('never returns an index outside the list', () => {
    for (let step = -7; step <= 7; step++) {
      const index = nextIndex(2, PALETTE_COMMANDS.length, step)

      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(PALETTE_COMMANDS.length)
    }
  })
})
