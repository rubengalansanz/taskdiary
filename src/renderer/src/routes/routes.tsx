import { Navigate, Route, Routes } from 'react-router-dom'
import { DayRoute } from '../features/tasks/day-view'
import { WeekRoute } from '../features/tasks/week-view'
import { MonthRoute } from '../features/tasks/month-view'
import { HeatmapRoute } from '../features/tasks/heatmap-view'
import { today } from '../shared/lib/date'

/**
 * Route table.
 *
 * The selected day lives in the path — `#/day/2026-10-10` — not in a store. A day is
 * something a user might want to come back to, so it has to be addressable; and the
 * system back button walking the days is the cheapest possible "retroceder en el tiempo",
 * which is the product's stated reason for existing.
 *
 * Fase 4 widened that to the view itself. `/week/2026-10-10` and `/day/2026-10-10` are the
 * same date in two readings, so the route answers both questions at once and the store cannot
 * hold a second, disagreeing opinion about which one is on screen.
 *
 * Zustand keeps what is genuinely transient: which modal is open, what the user typed. The
 * command bindings live in `hooks/use-shortcuts.ts` so this module exports components
 * only, which is what keeps React Fast Refresh working in development.
 */

/**
 * Renders the routed application.
 *
 * @returns The routes element.
 */
export function AppRoutes(): React.JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Navigate to={`/day/${today()}`} replace />} />
      <Route path="/day/:date" element={<DayRoute />} />
      <Route path="/week/:date" element={<WeekRoute />} />
      <Route path="/month/:date" element={<MonthRoute />} />
      {/* The heatmap is anchored to today and has no date in its path: §10.2 defines it as the
          last 26 weeks, so a `:date` segment here would promise a range it cannot honour. */}
      <Route path="/heatmap" element={<HeatmapRoute />} />
      {/* A hand-typed or stale URL repairs to the day view rather than rendering a blank
          shell. Navigation is not a place where a typo deserves a dead end. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}