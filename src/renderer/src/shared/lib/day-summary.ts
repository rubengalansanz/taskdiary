import type { DaySummaryDto } from '../../../../shared/ipc'

/**
 * Reading a `DaySummaryDto` collection.
 *
 * Pure functions, no React. The three Fase 4 views are covered by the CDP smoke, which drives
 * the real renderer; what that smoke cannot cheaply assert is arithmetic, and arithmetic is
 * exactly where a view quietly goes wrong.
 */

/**
 * Counts the tasks a range of days holds.
 *
 * Not `byDate.size`. The summaries are keyed by day, so their count is how many *days* hold
 * work, and the sidebar renders this number next to the word "resultados" — passing the size
 * would tell a user a week of 35 tasks across 7 days contains 7 resultados.
 *
 * Cancelled tasks count here even though they are excluded from `total`: the balance and the
 * ring ask how much work a day held, and this asks how many rows are on screen. Those are
 * different questions and only one of them has an excuse to ignore a task.
 *
 * @param days The days to total.
 * @returns How many tasks they hold.
 */
export function countTasks(days: Iterable<DaySummaryDto>): number {
  let total = 0

  for (const day of days) {
    total += day.total + day.cancelled
  }

  return total
}

/**
 * Share of a day's tasks that are done, from 0 to 1.
 *
 * A day with no tasks returns 0 rather than dividing by zero. Callers check `total > 0`
 * before drawing anything, because a day nobody planned should show no ring at all — "0%"
 * about an empty day is a claim about work that was never on the board.
 *
 * @param day The day's aggregate.
 * @returns Completion ratio, always between 0 and 1.
 */
export function completionRatio(day: DaySummaryDto | undefined): number {
  if (day === undefined || day.total === 0) {
    return 0
  }

  return Math.min(1, day.done / day.total)
}

/**
 * Signed gap between estimated and real minutes.
 *
 * Positive means the day ran over its estimates. Unmeasured completions are deliberately not
 * folded in: `unmeasuredDone` days have no real duration at all, so any difference computed
 * against them would be invented, and the Week view shows "tiempo no medido" instead.
 *
 * @param day The day's aggregate.
 * @returns Minutes over (positive) or under (negative) the estimate, 0 when nothing is known.
 */
export function estimateDrift(day: DaySummaryDto | undefined): number {
  if (day === undefined || day.unmeasuredDone > 0) {
    return 0
  }

  return day.realMin - day.estimateMin
}