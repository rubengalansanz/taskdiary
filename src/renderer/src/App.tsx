import { HashRouter } from 'react-router-dom'
import { AppRoutes } from './routes/routes'
import { useGlobalShortcuts } from './hooks/use-shortcuts'
import { CommandPalette } from './shell/command-palette'

/**
 * Application shell.
 *
 * `HashRouter`, not `BrowserRouter`: the packaged app is served from `file://`, where
 * path-based history has no server to resolve `/day/2026-10-10`. A hash keeps the day
 * addressable and the back button working without a server that will never exist.
 */

/**
 * Mounts the shortcuts and renders the routes.
 *
 * @returns The application element.
 */
function Shell(): React.JSX.Element {
  useGlobalShortcuts()

  // Sibling of the routes, not inside them: `Ctrl+K` has to work from the day, the week and the
  // stats view alike, and a palette mounted on one route would be missing from the others.
  return (
    <>
      <AppRoutes />
      <CommandPalette />
    </>
  )
}

/**
 * Renders the whole application.
 *
 * @returns The root element.
 */
function App(): React.JSX.Element {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  )
}

export default App
