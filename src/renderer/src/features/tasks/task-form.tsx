import { useRef, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import { formatClock, parseClock } from '../../shared/lib/date'
import { createTaskRequestSchema, type TaskDto } from '../../../../shared/ipc'

/**
 * Create/edit dialog.
 *
 * One component for both operations: the fields are the same, and a second form would be a
 * second place for the time validation to drift.
 *
 * Form state is seeded by `useState` initialisers, not reset by an effect. The parent
 * remounts this component with a `key` that changes when the dialog opens or the edited
 * task changes, which is what makes reopening after a cancel show a blank form — and does
 * it in one render instead of a second one after an effect has already painted the stale
 * values.
 */

/** Props of {@link TaskForm}. */
export interface TaskFormProps {
  /** Whether the dialog is open. */
  open: boolean
  /** Task being edited, or `null` when creating. */
  task: TaskDto | null
  /** Day the task belongs to, as `YYYY-MM-DD`. */
  taskDate: string
  /** Closes the dialog without saving. */
  onClose: () => void
  /**
   * Persists the task.
   * @param values Fields the user entered.
   * @returns A promise that resolves once the write completed.
   */
  onSubmit: (values: TaskFormValues) => Promise<void>
}

/** Fields the form collects. */
export interface TaskFormValues {
  title: string
  notes: string | null
  startMin: number | null
  endMin: number | null
  estimateMin: number | null
}

/** Seeds the clock field from a minute-of-day value. */
function toClockInput(minutes: number | null | undefined): string {
  return minutes === null || minutes === undefined ? '' : formatClock(minutes)
}

/**
 * Renders the dialog.
 *
 * @param props Open state, task and submit handler.
 * @returns The dialog element.
 */
export function TaskForm({
  open,
  task,
  taskDate,
  onClose,
  onSubmit
}: TaskFormProps): React.JSX.Element {
  const [title, setTitle] = useState(task?.title ?? '')
  const [notes, setNotes] = useState(task?.notes ?? '')
  const [startClock, setStartClock] = useState(toClockInput(task?.startMin))
  const [endClock, setEndClock] = useState(toClockInput(task?.endMin))
  const [estimate, setEstimate] = useState(
    task?.estimateMin === null || task?.estimateMin === undefined ? '' : String(task.estimateMin)
  )
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setError(null)

    const startMin = parseClock(startClock)
    const endMin = parseClock(endClock)

    const estimateMin = estimate.trim() === '' ? null : Number(estimate)

    // The very schema the main process enforces, run here before the round trip. Same
    // rules, same messages: the user sees the rejection immediately, and the two layers
    // cannot drift because they are the same function. The main process still validates —
    // this is about saving a wait, not about trusting the renderer.
    const candidate = {
      title,
      notes: notes.trim() === '' ? null : notes,
      taskDate,
      startMin,
      endMin,
      estimateMin
    }

    const parsed = createTaskRequestSchema.safeParse(candidate)

    if (!parsed.success) {
      const first = parsed.error.issues[0]
      const field = first?.path.join('.') ?? 'payload'

      setError(first?.message ?? 'Los datos no son válidos.')
      setFieldError(field)
      return
    }

    setFieldError(null)
    setIsSaving(true)

    try {
      await onSubmit({
        title: title.trim(),
        notes: notes.trim() === '' ? null : notes,
        startMin,
        endMin,
        estimateMin
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la tarea.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        showCloseButton={false}
        // Radix focuses the first focusable element on open; the title is it, so the
        // caret lands where the user is about to type.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          titleRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{task === null ? 'Nueva tarea' : 'Editar tarea'}</DialogTitle>
          <DialogDescription>
            {task === null ? `Se añadirá al ${taskDate}.` : `Creada el ${task.taskDate}.`}
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
          <div className="space-y-2">
            <Label htmlFor="task-title">Título</Label>
            <Input
              id="task-title"
              ref={titleRef}
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="¿Qué hay que hacer?"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-notes">Notas</Label>
            <Textarea
              id="task-notes"
              value={notes}
              rows={3}
              maxLength={20_000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Opcional"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="task-start">Inicio</Label>
              <Input
                id="task-start"
                value={startClock}
                placeholder="09:00"
                inputMode="numeric"
                onChange={(event) => setStartClock(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-end">Fin</Label>
              <Input
                id="task-end"
                value={endClock}
                placeholder="10:30"
                inputMode="numeric"
                onChange={(event) => setEndClock(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-estimate">Estimado (min)</Label>
              <Input
                id="task-estimate"
                value={estimate}
                placeholder="60"
                inputMode="numeric"
                onChange={(event) => setEstimate(event.target.value)}
              />
            </div>
          </div>

          {error !== null && (
            <p
              role="alert"
              data-field={fieldError ?? undefined}
              className="text-destructive text-sm"
            >
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
