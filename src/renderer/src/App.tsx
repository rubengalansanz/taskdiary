import { useEffect, useState } from 'react'
import { Button } from './components/ui/button'

/**
 * Phase 0 smoke screen.
 *
 * Proves the three foundation contracts are live: Tailwind and the theme tokens are
 * applied, `window.taskDiary` crosses the context bridge, and the main process owns
 * a working SQLite connection. Task UI starts in Fase 1.
 */

const CURRENT_VIEW = 'Phase 0 · Foundations'

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
    <div className="grid grid-cols-[9rem_1fr] gap-4 border-b border-border py-2 last:border-b-0">
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
          Offline-first desktop diary to log and review daily tasks
        </p>
      </header>

      <section className="bg-card text-card-foreground w-full max-w-2xl rounded-lg border p-6 shadow-sm">
        <h2 className="mb-4 text-lg font-medium">{CURRENT_VIEW}</h2>

        <Row label="View" value={CURRENT_VIEW} />
        <Row label="Theme" value={isDark ? 'dark' : 'light'} />

        {error !== null && <Row label="Bridge error" value={error} />}

        {probe === null && error === null && <Row label="Database" value="probing…" />}

        {probe !== null && (
          <>
            <Row label="Database" value={probe.ok ? 'opened' : 'failed'} />
            <Row label="Path" value={probe.path} />
            <Row label="SELECT 1" value={probe.ok ? '1' : (probe.error ?? 'no response')} />
            <Row label="SQLite" value={probe.sqliteVersion ?? 'unknown'} />
          </>
        )}
      </section>

      <footer className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled>
          Task UI arrives in Fase 1
        </Button>
        <span className="text-muted-foreground text-xs">Electron · React · SQLite · Tailwind</span>
      </footer>
    </main>
  )
}

export default App
