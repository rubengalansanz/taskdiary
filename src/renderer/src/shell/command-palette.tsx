import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog'
import { useRunCommand } from '../hooks/use-shortcuts'
import { useUiStore } from '../stores/ui-store'
import { filterCommands, nextIndex } from './palette-commands'

/**
 * The `Ctrl+K` command palette (S1).
 *
 * It is a second door to the five commands the native menu already fires, not a second list of
 * actions: choosing an entry calls the shared `useRunCommand`, so "Día anterior" here and in the
 * menu run the same code. What this component owns is only the palette's own behaviour —
 * filtering, the highlighted row, and closing without navigating.
 *
 * Deliberately thin. Everything worth testing lives in `./palette-commands`, which imports no
 * React and runs under `environment: 'node'`; this file is the part vitest cannot reach.
 */

/**
 * Renders the palette.
 *
 * Mounted once by the shell, outside the routes: the palette is reachable from every view, so
 * tying it to a route would hide it on the others.
 *
 * @returns The palette element.
 */
export function CommandPalette(): React.JSX.Element {
  const paletteOpen = useUiStore((state) => state.paletteOpen)
  const closePalette = useUiStore((state) => state.closePalette)
  const runCommand = useRunCommand()

  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => filterCommands(query), [query])

  // `DialogContent` traps focus, but the field has to be *in* it before the trap starts, or the
  // user would have to Tab to the one control the palette exists for.
  useEffect(() => {
    if (paletteOpen) {
      inputRef.current?.focus()
    }
  }, [paletteOpen])

  function reset(): void {
    setQuery('')
    setHighlighted(0)
  }

  function choose(command: { channel: string } | undefined): void {
    if (command === undefined) {
      return
    }

    // Close before running: "completar seleccionada" may open the edit form, and leaving the
    // palette up underneath would leave two modals stacked.
    closePalette()
    reset()
    runCommand(command.channel)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlighted((current) => nextIndex(current, matches.length, 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlighted((current) => nextIndex(current, matches.length, -1))
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      choose(matches[highlighted])
    }
  }

  return (
    <Dialog
      open={paletteOpen}
      onOpenChange={(open): void => {
        if (!open) {
          closePalette()
          reset()
        }
      }}
    >
      <DialogContent
        className="p-0"
        data-testid="command-palette"
        onOpenAutoFocus={(event): void => {
          event.preventDefault()
          inputRef.current?.focus()
        }}
      >
        <DialogTitle className="sr-only">Paleta de comandos</DialogTitle>
        <DialogDescription className="sr-only">
          Buscá una acción y ejecutala con Enter.
        </DialogDescription>

        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Buscá una acción…"
          aria-label="Buscar acción"
          data-testid="command-palette-input"
          onChange={(event): void => {
            // A fresh query has to start at the top: carrying the previous highlight over would
            // leave the first Enter firing a command the user never looked at. Resetting here
            // rather than in an effect keeps it to the keystroke that caused it.
            setQuery(event.target.value)
            setHighlighted(0)
          }}
          onKeyDown={onKeyDown}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm outline-none"
        />

        <ul role="listbox" aria-label="Acciones" className="max-h-72 overflow-y-auto py-1">
          {matches.map((command, index) => (
            <li key={command.channel}>
              <button
                type="button"
                role="option"
                aria-selected={index === highlighted}
                data-testid={`command-palette-item-${command.channel}`}
                onMouseEnter={(): void => {
                  setHighlighted(index)
                }}
                onClick={(): void => {
                  choose(command)
                }}
                className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${
                  index === highlighted ? 'bg-accent text-accent-foreground' : ''
                }`}
              >
                <span>{command.label}</span>
                <span className="text-xs text-muted-foreground">{command.shortcut}</span>
              </button>
            </li>
          ))}

          {matches.length === 0 && (
            <li data-testid="command-palette-empty" className="px-4 py-6 text-center text-sm">
              Ninguna acción coincide
            </li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
