import { useEffect, useState } from 'react'
import type { StatsSummaryDto } from '../../../shared/ipc'

/**
 * The Statistics payload.
 *
 * Deliberately not an external store like `use-tasks.ts` or `use-day-summaries.ts`. Those
 * cache many keys and are read by many components at once; this is one number set for one
 * screen, replaced wholesale on every visit. A store with one slot and one reader amortises
 * nothing, and the ADR-017 machinery would be paid for in comprehensibility for nothing.
 *
 * `useState` rather than a subscription because the value changes exactly when the component
 * showing it mounts, and never underneath it.
 */

/** What the screen is doing right now. */
export interface UseStatsResult {
  stats: StatsSummaryDto | undefined
  isLoading: boolean
  error: string | null
}

/** One reading, tagged with the day it belongs to. */
interface Reading {
  taskDate: string
  stats: StatsSummaryDto | undefined
  error: string | null
  /** False once the read for `taskDate` has settled. */
  settled: boolean
}

/**
 * Reads the Statistics payload for a day.
 *
 * The pending state is *derived during render* rather than set inside the effect. Writing
 * `setIsLoading(true)` at the top of an effect is the obvious way to do this and it costs a
 * second render every time the day changes: the component renders with the old day settled,
 * the effect immediately invalidates it, and everything renders again. Comparing the day the
 * reading belongs to against the day being asked about answers the same question with no
 * extra pass.
 *
 * @param taskDate Day to anchor the numbers on.
 * @returns The payload, loading state and any error.
 */
export function useStats(taskDate: string): UseStatsResult {
  const [reading, setReading] = useState<Reading>({
    taskDate,
    stats: undefined,
    error: null,
    settled: false
  })

  useEffect(() => {
    let live = true

    void window.taskDiary.stats
      .summary({ taskDate })
      .then((result) => {
        // A result that arrives after the user navigated belongs to a day nobody is looking
        // at. Setting state then would show one day's numbers under another's heading.
        if (!live) {
          return
        }

        setReading({
          taskDate,
          stats: result.ok ? result.stats : undefined,
          error: result.ok ? null : result.error.message,
          settled: true
        })
      })
      .catch((cause: unknown) => {
        if (live) {
          setReading({
            taskDate,
            stats: undefined,
            error: cause instanceof Error ? cause.message : 'No se pudieron cargar las estadísticas.',
            settled: true
          })
        }
      })

    return () => {
      live = false
    }
  }, [taskDate])

  // A reading taken for another day is stale, and reading it as settled would show yesterday's
  // streak under today's heading until the new one lands.
  const isForThisDay = reading.taskDate === taskDate

  return {
    stats: isForThisDay ? reading.stats : undefined,
    isLoading: !isForThisDay || !reading.settled,
    error: isForThisDay ? reading.error : null
  }
}
