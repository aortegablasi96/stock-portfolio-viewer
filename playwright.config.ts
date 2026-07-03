import { defineConfig } from '@playwright/test'

// Electron end-to-end tests. These launch the built app (out/main/index.js) and
// drive the real renderer, so they run serially and headless-friendly in CI.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: 0,
  timeout: 30_000,
  reporter: [['list']],
})
