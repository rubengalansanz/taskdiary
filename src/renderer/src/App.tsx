import { useEffect, useState } from 'react'
import { Button } from './components/ui/button'

/**
 * Phase 1 smoke screen.
 *
 * There is no task UI yet — `TaskList`, `TaskForm` and `TitleBar` are Fase 2. What this
 * screen does is show, live, that the whole foundation is real rather than declared:
 * the theme tokens are applied, `window.taskDiary` crosses the context bridge, and the
 * main process owns a migrated SQLite database with a real `tasks` table.
 *
 * Copy is Spanish because that is what the user reads (ADR-015); identifiers and
 * comments stay English.
 */

const CURRENT_PHASE = 'Fase 1 · Datos'

function useDbProbe(): { probe: TaskDiaryDbProbeResult | null; error: string | null } {
  const [probe, setProbe] = useState<TaskDiaryDbProbeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    window.taskDiary.db
      .probe()
      .then((result) => {
        if (!cancelled) setProbe(result)
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause))
      })

    return () => {
      cancelled = true
    }
  }, [])

  return { probe, error }
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[11rem_1fr] gap-4 border-b border-border py-2 last:border-b-0">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-mono text-sm break-all">{value}</span>
    </div>
  )
}

function App(): React.JSX.Element {
  const isDark = document.documentElement.classList.contains('dark')
  const { probe, error } = useDbProbe()

  return (
    <main className="bg-background text-foreground flex min-h-full flex-col items-center justify-center gap-8 px-8 py-12">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">TaskDiary</h1>
        <p className="text-muted-foreground text-sm">
          Diario de tareas offline: registre y revise su día
        </p>
      </header>

      <section className="bg-card text-card-foreground w-full max-w-2xl rounded-lg border p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium">{CURRENT_PHASE}</h2>

        <Row label="Vista" value={CURRENT_PHASE} />
        <Row label="Tema" value={isDark ? 'oscuro' : 'claro'} />

        {error !== null && <Row label="Error del puente" value={error} />}

        {probe === null && error === null && <Row label="Base de datos" value="comprobando…" />}

        {probe !== null && (
          <>
            <Row label="Base de datos" value={probe.ok ? 'abierta' : 'fallida'} />
            <Row label="Ruta" value={probe.path} />
            <Row label="SELECT 1" value={probe.ok ? '1' : (probe.error ?? 'sin respuesta')} />
            <Row label="SQLite" value={probe.sqliteVersion ?? 'desconocida'} />
            <Row label="Esquema (v)" value={String(probe.schemaVersion ?? 0)} />
            <Row
              label="Tabla tasks"
              value={probe.hasTasksTable === true ? 'creada' : 'NO EXISTE'}
            />
          </>
        )}
      </section>

      <section className="bg-card text-card-foreground w-full max-w-2xl rounded-lg border p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium">Puente IPC</h2>
        <Row label="window.taskDiary" value={typeof window.taskDiary} />
        <Row label="window.taskDiary.tasks" value={typeof window.taskDiary?.tasks} />
        <Row
          label="Canales"
          value="task:list · task:create · task:update · task:delete · task:setStatus"
        />
      </section>

      <footer className="flex flex-col items-center gap-3">
        <Button variant="outline" size="sm" disabled>
          La interfaz de tareas llega en la Fase 2
        </Button>
        <span className="text-muted-foreground text-xs">Electron · React · SQLite · Tailwind</span>
      </footer>
    </main>
  )
}

export default App
