import { useCallback, useState } from 'react'
import { exportDiary, importDiary, TaskApiError } from '../shared/api/tasks-api'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../components/ui/dropdown-menu'

/**
 * Import and export, behind one menu.
 *
 * These used to be four flat buttons in the title bar, and they were 558 of the bar's 1241
 * pixels — 44% of the toolbar spent on actions a user performs a handful of times a year.
 * That is not a width problem, it is an altitude problem: saving a copy of your diary does
 * not belong at the same level as the arrows that move you through it.
 *
 * Closing the dialog is a choice, not an error. Reporting "exportado" then would be a lie the
 * user has to disprove by opening the folder, so a cancelled dialog reports nothing.
 */

/** Props of {@link DataMenu}. */
export interface DataMenuProps {
  /** Called after a successful import, so the open view reloads what just changed. */
  onImported: () => void
}

/** One line of feedback, or none. */
type Notice = { tone: 'error' | 'info'; message: string } | null

/**
 * Renders the import and export controls.
 *
 * @param props Reload callback.
 * @returns The menu element.
 */
export function DataMenu({ onImported }: DataMenuProps): React.JSX.Element {
  // A boolean, not a union naming which operation is in flight. The native dialog is modal, so
  // the menu has already closed and the trigger is the only thing left to disable: there is no
  // screen on which to show *which* one is running, and no branch that would read it. A
  // five-value union described a distinction this component never made.
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)

  /**
   * Runs one dialog operation, keeping the menu honest about what happened.
   *
   * Takes `() => Promise<void>` rather than returning a value: a generic that inferred across
   * the call site lost the discriminated union on the way through, and `result.written` became
   * a type error on a perfectly good API.
   */
  const run = useCallback(async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setNotice(null)

    try {
      await work()
    } catch (cause: unknown) {
      setNotice({
        tone: 'error',
        message:
          cause instanceof TaskApiError ? cause.message : 'No se pudo completar la operación.'
      })
    } finally {
      setBusy(false)
    }
  }, [])

  const doExport = useCallback(
    (format: 'json' | 'markdown') =>
      void run(async () => {
        const result = await exportDiary({ format })

        setNotice(
          result.written
            ? { tone: 'info', message: `Se exportaron ${result.taskCount} tareas.` }
            : null
        )
      }),
    [run]
  )

  const doImport = useCallback(
    (format: 'json' | 'csv') =>
      void run(async () => {
        const result = await importDiary({ format })

        if (result.imported) {
          setNotice({ tone: 'info', message: `Se importaron ${result.taskCount} tareas.` })
          onImported()
        }
      }),
    [run, onImported]
  )

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            data-testid="data-menu-trigger"
            aria-label="Importar y exportar"
          >
            Datos ▾
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent>
          <DropdownMenuLabel>Exportar</DropdownMenuLabel>
          <DropdownMenuItem
            data-testid="data-export-json"
            disabled={busy}
            onSelect={() => doExport('json')}
          >
            Como JSON
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="data-export-markdown"
            disabled={busy}
            onSelect={() => doExport('markdown')}
          >
            Como Markdown
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          <DropdownMenuLabel>Importar</DropdownMenuLabel>
          <DropdownMenuItem
            data-testid="data-import-json"
            disabled={busy}
            onSelect={() => doImport('json')}
          >
            Desde JSON
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="data-import-csv"
            disabled={busy}
            onSelect={() => doImport('csv')}
          >
            Desde CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {notice !== null && (
        <span
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="data-notice"
          className={[
            // The notice must never be what pushes the bar over. It truncates and shrinks out
            // of the way instead: a message that widens the layout is a message that causes
            // the overflow it is reporting on.
            'min-w-0 truncate text-xs',
            notice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
          ].join(' ')}
          title={notice.message}
        >
          {notice.message}
        </span>
      )}
    </div>
  )
}
