import { Navigate, Route, Routes } from 'react-router-dom'
import { DayRoute } from '../features/tasks/day-view'
import { today } from '../shared/lib/date'

/**
 * Route table.
 *
 * The selected day lives in the path — `#/day/2026-10-10` — not in a store. A day is
 * something a user might want to come back to, so it has to be addressable; and the
 * system back button walking the days is the cheapest possible "retroceder en el tiempo",
 * which is the product's stated reason for existing.
 *
 * Zustand keeps what is genuinely transient: which view is active, which modal is open.
 * The command bindings live in `hooks/use-shortcuts.ts` so this module exports components
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
      {/* A hand-typed or stale URL repairs to the day view rather than rendering a blank
          shell. Navigation is not a place where a typo deserves a dead end. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
