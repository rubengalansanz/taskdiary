import { addDays } from './date-arith'

/**
 * Reading a history of days into the numbers the Statistics view shows.
 *
 * Pure functions over dates that already hold work. The counting happens in SQL and this file
 * interprets it, which is the same split Fase 4 settled on: the database answers "how many",
 * a tested function answers "so what".
 *
 * There is no `completed_min` column and this phase does not add one, for the same reason
 * Fase 4 did not: the real duration of a completed task is `completed_at - started_at`, and
 * both are already stored (ADR-023).
 */

/**
 * How many consecutive days, counting back from today, hold a completed task.
 *
 * Measured backwards from `today`, and that is the entire design. A user who has not finished
 * anything *yet today* has not lost their streak — the day is not over. Counting back from
 * the last completed day instead would report zero every morning until the first task of the
 * day was closed, which makes the one number people open this screen for useless for exactly
 * the hours they most want to look at it.
 *
 * @param completed Days that hold at least one completed task.
 * @param today The day to count back from.
 * @returns Length of the run ending today or yesterday.
 */
export function currentStreak(completed: ReadonlySet<string>, today: string): number {
  let cursor = completed.has(today) ? today : addDays(today, -1)
  let length = 0

  while (completed.has(cursor)) {
    length += 1
    cursor = addDays(cursor, -1)
  }

  return length
}

/**
 * The longest run of consecutive completed days anywhere in the history.
 *
 * Walks the set in date order, so a caller that hands it an unordered collection still gets
 * the right answer — day strings sort correctly lexicographically, which is the same property
 * the rest of the codebase relies on.
 *
 * @param completed Days that hold at least one completed task.
 * @returns Length of the longest run.
 */
export function longestStreak(completed: ReadonlySet<string>): number {
  const ordered = [...completed].sort()
  let best = 0
  let run = 0
  let previous: string | null = null

  for (const day of ordered) {
    run = previous !== null && addDays(previous, 1) === day ? run + 1 : 1
    previous = day

    if (run > best) {
      best = run
    }
  }

  return best
}

/**
 * Share of the estimated time that was actually spent.
 *
 * Zero when nothing was estimated, and that is a deliberate zero rather than "no rate": a
 * day of tasks nobody estimated has nothing to be compliant *with*. Any other sentinel would
 * have to be special-cased at every call site, and the UI would end up rendering a rate the
 * user can act on for a day that carries no information.
 *
 * Values above 1 are real and meant: running over an estimate is what the Week view's balance
 * is for, and clamping here would hide exactly the number this screen exists to show.
 *
 * @param estimateMin Minutes estimated, summed.
 * @param realMin Minutes actually spent.
 * @returns The ratio, always ≥ 0.
 */
export function complianceRatio(estimateMin: number, realMin: number): number {
  if (estimateMin <= 0) {
    return 0
  }

  return Math.max(0, realMin / estimateMin)
}

/** What the repository counts, before the streaks are worked out. */
export interface StatsTotals {
  /** The day "today's" numbers and the current streak are anchored on. */
  today: string
  /** Completed tasks across the whole history. */
  totalDone: number
  /** Tasks currently running. */
  totalInProgress: number
  /** Sum of every estimate. */
  estimateMin: number
  /** Minutes actually spent, from the two timestamps the stopwatch writes. */
  realMin: number
  /** Completed tasks with no measurable duration, excluded from `realMin`. */
  unmeasuredDone: number
  /** Monday of the current week. */
  weekFrom: string
  /** Tasks completed this week. */
  weekDone: number
  /** Days of the week elapsed, counting today. Never zero. */
  weekDaysElapsed: number
  /** Every day in the history holding at least one completed task. */
  completedDays: string[]
}
