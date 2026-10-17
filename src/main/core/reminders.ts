import type { TaskStatusDto } from '../../shared/ipc'

/**
 * Which tasks deserve an OS notification right now (Fase 6, S5).
 *
 * The main process asks this on its own timer rather than being told what to announce, so it
 * keeps working while the user is looking at another view — and it needs no IPC channel and no
 * cooperation from the renderer to stay correct.
 *
 * Only the decision lives here. Whether a notification is worth showing at all also depends on
 * whether the window has focus, and that is Electron's business, not this module's.
 */

/**
 * How long after its time a task may still be announced, in minutes.
 *
 * The window exists for the laptop that was asleep at 09:00 and woke at 09:10: without it, a
 * reminder would silently depend on the app happening to be open at the right minute. It also
 * caps the other failure — opening the app at 23:00 must not greet the user with every task of
 * the day — so it has to be short enough that a late open does not become a backlog.
 */
export const REMINDER_GRACE_MINUTES = 60

/** The little a reminder needs to know about a task. */
export interface ReminderCandidate {
  /** Task UUID, used to remember that it was already announced. */
  id: string
  /** What the notification says. */
  title: string
  /** Minutes since midnight the task starts, or `null` when it has no time. */
  startMin: number | null
  /** Where the task stands. */
  status: TaskStatusDto
}

/** The clock reading the decision is made against. */
export interface ReminderClock {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
  /** Minutes since local midnight. */
  minuteOfDay: number
}

/** Everything `dueReminders` needs to answer. */
export interface DueRemindersInput {
  /** The day's tasks, as read from the database. */
  tasks: readonly ReminderCandidate[]
  /** What the clock says. */
  now: ReminderClock
  /** Ids already announced, so a task is never announced twice. */
  alreadyNotified: ReadonlySet<string>
}

/**
 * Picks the tasks to announce now.
 *
 * Order of the rules is deliberate. "No time" and "already handled" come before the clock so a
 * task that could never fire does not drag an out-of-window time into the comparison, and
 * `done`/`cancelled` are excluded because a finished or abandoned task is not something anyone
 * needs to be told about — the domain already made `done` terminal, and this honours that.
 *
 * @param input The day's tasks, the clock, and what has already been announced.
 * @returns The tasks to announce, in the order they were given.
 */
export function dueReminders(input: DueRemindersInput): ReminderCandidate[] {
  const { tasks, now, alreadyNotified } = input

  return tasks.filter((task) => {
    if (task.startMin === null) {
      return false
    }

    if (alreadyNotified.has(task.id)) {
      return false
    }

    if (task.status === 'done' || task.status === 'cancelled') {
      return false
    }

    const elapsed = now.minuteOfDay - task.startMin

    // Negative means the time has not come yet. Past the grace window the moment is gone, and
    // announcing it then is noise about something the user already knows.
    return elapsed >= 0 && elapsed <= REMINDER_GRACE_MINUTES
  })
}
