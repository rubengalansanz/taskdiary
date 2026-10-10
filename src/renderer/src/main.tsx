import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const DARK_CLASS = 'dark'

/**
 * Light/dark theme bridge for the renderer.
 *
 * The renderer has no Electron access: every value comes from the main process
 * through `window.taskDiary.theme`, which is backed by `nativeTheme`.
 */
function applyTheme(isDark: boolean): void {
  document.documentElement.classList.toggle(DARK_CLASS, isDark)
}

/**
 * Reads the current OS theme and applies it to `<html>`.
 *
 * Runs before the first React render so the very first painted frame already uses
 * the right colours instead of flashing light and repainting. The window
 * background colour set by the main process covers the remaining gap.
 */
async function syncThemeBeforeRender(): Promise<void> {
  try {
    applyTheme(await window.taskDiary.theme.isDark())
  } catch (error) {
    // A missing bridge must not stop the app from rendering; the window background
    // colour already prevents a white flash in that case.
    console.error('[theme] could not read the initial theme', error)
  }
}

void syncThemeBeforeRender().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>
  )

  window.taskDiary.theme.onChange(applyTheme)
})
