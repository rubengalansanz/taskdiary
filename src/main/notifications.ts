import { Notification } from 'electron'
import { minutesToClock, toLocalDateString } from './core/datetime'
import { dueReminders, type ReminderCandidate } from './core/reminders'
import type { TasksRepository } from './db/repositories/tasks-repo'

/**
 * OS notifications for tasks that have a time (Fase 6, S5).
 *
 * The main process drives this on a timer and reads the day straight from the repository,
 * instead of the renderer reporting what it happens to be looking at. That choice costs
 * nothing and buys two things: reminders keep working while the user is in the Week or the
 * statistics view, and the feature adds no IPC channel and no renderer code that could forget to
 * announce something.
 *
 * The decision of *which* tasks are due lives in `core/reminders` where it is tested. This file
 * only owns the parts that are genuinely Electron's: whether the window has focus, and showing
 * the notification.
 */

/** How often the day is re-examined. */
const TICK_MS = 30_000

/** What the reminder loop needs from the rest of the app. */
export interface ReminderDeps {
  /** Source of the day's tasks. */
  repository: TasksRepository
  /**
   * True when the app window has focus.
   *
   * A task on screen is not news. Notifying about something the user is looking at teaches them
   * to ignore the notifications, which costs more than the one they miss.
   */
  isFocused: () => boolean
  /** Called when the user clicks the notification. */
  onActivate?: () => void
}

/** State the loop carries between ticks. */
interface ReminderState {
  /** Tasks already announced, so none is announced twice. */
  announced: Set<string>
  /** The day {@link ReminderState.announced} belongs to. */
  announcedOn: string | null
}

/**
 * Turns a day's tasks into the shape the reminder rule reads.
 *
 * @param repository Source of the tasks.
 * @param date Local day, `YYYY-MM-DD`.
 * @returns One candidate per task.
 */
function readCandidates(repository: TasksRepository, date: string): ReminderCandidate[] {
  return repository.listByDate(date).map((task) => ({
    id: task.id,
    title: task.title,
    startMin: task.startMin,
    status: task.status
  }))
}

/**
 * Runs one pass of the reminder check.
 *
 * Exported for the tests that drive it without a timer and without Electron.
 *
 * @param state Carried across ticks.
 * @param deps What the loop needs from the app.
 * @param now The moment being judged. Defaults to the wall clock.
 * @returns How many notifications were shown.
 */
export function runReminderPass(
  state: ReminderState,
  deps: ReminderDeps,
  now = new Date()
): number {
  const date = toLocalDateString(now)

  // The set belongs to a day. Past midnight it would suppress today's tasks as "already
  // announced", which is worse than announcing nothing at all.
  if (state.announcedOn !== date) {
    state.announced.clear()
    state.announcedOn = date
  }

  const due = dueReminders({
    tasks: readCandidates(deps.repository, date),
    now: { date, minuteOfDay: now.getHours() * 60 + now.getMinutes() },
    alreadyNotified: state.announced
  })

  let shown = 0

  for (const task of due) {
    // Only a notification that was actually shown marks the task. If the window had focus the
    // user has already read it, and marking it would silently drop the reminder for the rest of
    // the grace window — including after they look away.
    if (deps.isFocused()) {
      continue
    }

    if (!Notification.isSupported()) {
      // Linux desktops without a notification daemon, and Windows builds without the platform
      // service. Nothing to do, and nothing worth failing the timer over.
      continue
    }

    const notification = new Notification({
      title: task.title,
      body: task.startMin === null ? '' : minutesToClock(task.startMin)
    })

    if (deps.onActivate !== undefined) {
      notification.on('click', deps.onActivate)
    }

    notification.show()
    state.announced.add(task.id)
    shown += 1
  }

  return shown
}

/**
 * Starts the reminder loop.
 *
 * The first pass runs immediately, so opening the app announces whatever is already due rather
 * than waiting half a minute to notice.
 *
 * @param deps What the loop needs from the app.
 * @returns A function that stops the loop.
 */
export function startTaskReminders(deps: ReminderDeps): () => void {
  const state: ReminderState = { announced: new Set(), announcedOn: null }

  runReminderPass(state, deps)

  const timer = setInterval(() => {
    runReminderPass(state, deps)
  }, TICK_MS)

  return (): void => {
    clearInterval(timer)
  }
}
