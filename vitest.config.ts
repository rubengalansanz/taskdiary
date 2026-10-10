import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/core/**', 'src/main/db/**'],
      reporter: ['text', 'lcov']
    }
  }
})
