import { useCallback, useState } from 'react'
import { exportDiary, importDiary, TaskApiError } from '../shared/api/tasks-api'
import { Button } from '../components/ui/button'

/**
 * Import and export controls.
 *
 * Four buttons rather than a settings screen, because the plan puts backup in Ajustes and
 * this phase does not ship one. They live in the title bar so the diary can be taken
 * somewhere before anything else happens to the disk.
 *
 * Neither button can name a file. Each opens the native dialog, and each reports what
 * actually happened — including "you closed the dialog", which is not a failure and must not
 * be dressed as one.
 */

/** Props of {@link DataMenu}. */
export interface DataMenuProps {
  /** Called after a successful import, so the open view reloads what just changed. */
  onImported: () => void
}

/** One line of feedback, or none. */
type Notice = { tone: 'error' | 'info'; message: string } | null

/** Which operation holds the buttons, or none. */
type BusyState = 'export-json' | 'export-markdown' | 'import-json' | 'import-csv' | null

/**
 * Renders the import and export controls.
 *
 * @param props Reload callback.
 * @returns The controls element.
 */
export function DataMenu({ onImported }: DataMenuProps): React.JSX.Element {
  const [busy, setBusy] = useState<BusyState>(null)
  const [notice, setNotice] = useState<Notice>(null)

  /**
   * Runs one dialog operation, keeping the buttons disabled and the notice honest.
   *
   * Takes `() => Promise<void>` rather than returning a value: a generic that inferred across
   * the call site lost the discriminated union on the way through, and `result.written` became
   * a type error on a perfectly good API.
   */
  const run = useCallback(async (what: BusyState, work: () => Promise<void>): Promise<void> => {
    setBusy(what)
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
      setBusy(null)
    }
  }, [])

  const doExport = useCallback(
    (format: 'json' | 'markdown') =>
      void run(`export-${format}`, async () => {
        const result = await exportDiary({ format })

        // Closing the dialog is a choice, not an error. Saying "exportado" then would be a
        // lie the user has to disprove by opening the folder.
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
      void run(`import-${format}`, async () => {
        const result = await importDiary({ format })

        if (result.imported) {
          setNotice({
            tone: 'info',
            message: `Se importaron ${result.taskCount} tareas.`
          })
          onImported()
        }

      }),
    [run, onImported]
  )

  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => doExport('json')}
        aria-label="Exportar a JSON"
      >
        Exportar JSON
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => doExport('markdown')}
        aria-label="Exportar a Markdown"
      >
        Markdown
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => doImport('json')}
        aria-label="Importar desde JSON"
      >
        Importar JSON
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy !== null}
        onClick={() => doImport('csv')}
        aria-label="Importar desde CSV"
      >
        Importar CSV
      </Button>

      {notice !== null && (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          data-testid="data-notice"
          className={[
            'max-w-96 truncate px-2 py-1 text-xs',
            notice.tone === 'error' ? 'text-destructive' : 'text-muted-foreground'
          ].join(' ')}
          title={notice.message}
        >
          {notice.message}
        </p>
      )}
    </div>
  )
}
