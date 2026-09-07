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
    /*
     * The bound every test runs under, declared rather than inherited (Bug #362).
     *
     * 5,000ms is vitest's own default, so this changes no behaviour today. What it changes is that
     * the constant governing all 2,551 tests is now a number this repo chose. Bug #358 was exactly
     * a default that was right for a handful of call sites and silently wrong for the rest, and
     * Bug #360 was a test losing to this one without anybody having picked it.
     *
     * The headroom is measured, not assumed: timed idle and again under four CPU spinners on eight
     * logical cores, the slowest test in the suite lands at 1,267ms — a 3.9x margin. It is also the
     * safest, being ~1,250ms of deliberate wall-clock waiting on the whole-question deadline, which
     * does not compete for CPU and measured x1.0 scaling under that load. Everything else sits at
     * 5.8x or better. Moving this number needs a fresh measurement, and warm: a cold run attributes
     * transform and import time to the first test in each file and reads several times too high.
     *
     * A test that genuinely needs longer declares it at the call site, as the three stall cases in
     * `ibkrGateway.test.ts` do — where a bound is what the test asserts, it belongs beside the
     * assertion, never here.
     */
    testTimeout: 5_000,
  },
})
