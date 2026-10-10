import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer/src'),
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/main/**/*.test.ts', 'src/renderer/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/main/core/**', 'src/main/db/**', 'src/renderer/src/shared/lib/**'],
      reporter: ['text', 'lcov']
    }
  }
})
