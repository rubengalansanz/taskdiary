import { describe, expect, it } from 'vitest'
import { REMINDER_GRACE_MINUTES, dueReminders } from './reminders'
import type { ReminderCandidate } from './reminders'

/**
 * Which tasks deserve an OS notification right now (Fase 6, S5).
 *
 * The main process asks this on a timer rather than being told what to say, so the rules live
 * here where they can be pinned. What makes it more than a filter is the grace window: an app
 * that opens at 23:00 should not announce the 09:00 task, and one that opens at 09:05 should not
 * stay silent about it either.
 */

/** A task as the reminder pass sees it. */
function candidate(overrides: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: 'task-1',
    title: 'Preparar informe',
    startMin: 9 * 60,
    status: 'pending',
    ...overrides
  }
}

/** A clock reading, as the main process computes it. */
function at(hour: number, minute = 0): { date: string; minuteOfDay: number } {
  return { date: '2026-10-17', minuteOfDay: hour * 60 + minute }
}

describe('dueReminders', () => {
  it('announces a task whose time has arrived', () => {
    expect(dueReminders({ tasks: [candidate()], now: at(9), alreadyNotified: new Set() })).toEqual([
      candidate()
    ])
  })

  it('says nothing about a task with no time', () => {
    // An unscheduled task has no moment to remind anyone of. "Task with a time" is the whole
    // condition S5 names.
    const tasks = [candidate({ startMin: null })]

    expect(dueReminders({ tasks, now: at(23), alreadyNotified: new Set() })).toEqual([])
  })

  it('says nothing before the time arrives', () => {
    expect(
      dueReminders({ tasks: [candidate()], now: at(8, 59), alreadyNotified: new Set() })
    ).toEqual([])
  })

  it('still announces shortly after the time, for an app that was closed', () => {
    // The common case: the laptop was asleep at 09:00 and wakes at 09:10. Staying quiet would
    // make reminders depend on the app happening to be open.
    expect(
      dueReminders({ tasks: [candidate()], now: at(9, 10), alreadyNotified: new Set() }).length
    ).toBe(1)
  })

  it('stops announcing once the grace window has passed', () => {
    // Without this, opening the app late at night greets the user with every task of the day.
    expect(
      dueReminders({
        tasks: [candidate()],
        now: at(9 + REMINDER_GRACE_MINUTES / 60 + 1),
        alreadyNotified: new Set()
      })
    ).toEqual([])
  })

  it('never announces the same task twice', () => {
    const tasks = [candidate()]

    expect(dueReminders({ tasks, now: at(9), alreadyNotified: new Set() }).length).toBe(1)
    expect(dueReminders({ tasks, now: at(9), alreadyNotified: new Set([tasks[0].id]) })).toEqual([])
  })

  it('says nothing about a task that is already done', () => {
    expect(
      dueReminders({
        tasks: [candidate({ status: 'done' })],
        now: at(9),
        alreadyNotified: new Set()
      })
    ).toEqual([])
  })

  it('says nothing about a cancelled task', () => {
    // Cancelling records that nothing is going to happen; reminding about it would be noise.
    expect(
      dueReminders({
        tasks: [candidate({ status: 'cancelled' })],
        now: at(9),
        alreadyNotified: new Set()
      })
    ).toEqual([])
  })

  it('still announces a task that is in progress', () => {
    expect(
      dueReminders({
        tasks: [candidate({ status: 'in_progress' })],
        now: at(9),
        alreadyNotified: new Set()
      })
    ).toEqual([candidate({ status: 'in_progress' })])
  })

  it('returns several tasks at once, in the order they were given', () => {
    const tasks = [
      candidate({ id: 'b', startMin: 9 * 60 }),
      candidate({ id: 'a', startMin: 9 * 60 })
    ]

    expect(
      dueReminders({ tasks, now: at(9, 30), alreadyNotified: new Set() }).map((t) => t.id)
    ).toEqual(['b', 'a'])
  })

  it('has a grace window long enough to survive a sleep, and short enough to be quiet', () => {
    expect(REMINDER_GRACE_MINUTES).toBeGreaterThanOrEqual(15)
    expect(REMINDER_GRACE_MINUTES).toBeLessThanOrEqual(120)
  })
})
