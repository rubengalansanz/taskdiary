import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Path aliases shared by the three build targets.
 *
 * `@main` is intentionally available in the renderer config too so a mistyped
 * import fails at build time with a clear resolution error instead of silently
 * dragging main-process code into the renderer bundle.
 */
const alias = {
  '@': resolve('src/renderer/src'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer/src'),
  '@shared': resolve('src/shared')
}

/**
 * `better-sqlite3` is a native N-API addon: it must stay an external `require`
 * resolved from `node_modules` at runtime, never bundled.
 */
const nativeExternal = ['better-sqlite3']

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        external: nativeExternal
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      // A sandboxed preload can only `require` Electron's built-in whitelist; any
      // externalised `node_modules` import throws `module not found` and the whole
      // bridge silently fails to load. Bundle every dependency here instead.
      // `electron` itself stays external (electron-vite always keeps it so).
      externalizeDeps: false
    }
  },
  renderer: {
    // Required so the packaged app resolves its assets from `file://` instead of `/`.
    base: './',
    resolve: { alias },
    plugins: [react(), tailwindcss()]
  }
})
