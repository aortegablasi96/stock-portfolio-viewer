import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests target services (pure business logic) in a Node environment, with
// repositories and other collaborators mocked. E2E lives under e2e/ and is run
// by Playwright, not Vitest.
export default defineConfig({
  resolve: {
    alias: {
      '@main': resolve('src/main'),
      '@renderer': resolve('src/renderer/src'),
      '@services': resolve('src/services'),
      '@repositories': resolve('src/repositories'),
      '@db': resolve('src/db'),
      '@shared': resolve('src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'out/**', 'release/**', 'e2e/**'],
  },
})
