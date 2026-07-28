import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { spawn } from 'node:child_process'
import electronBinary from 'electron'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

// Outside Electron, the `electron` package resolves to the path of its binary.
const electronPath = electronBinary as unknown as string
const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

let app: ElectronApplication
let page: Page
let userDataDir: string

test.beforeAll(async () => {
  // Launch the built app (electron-vite output) with an isolated, empty user-data
  // directory so the SQLite DB (and thus snapshot history) starts clean and the
  // run is deterministic. No Client Portal Gateway is running, so the app resolves
  // to its not_connected state and capture-on-open is skipped.
  userDataDir = mkdtempSync(join(tmpdir(), 'spv-e2e-'))
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('window has the expected title', async () => {
  expect(await page.title()).toBe('Stock Portfolio Viewer')
})

test('renders the portfolio dashboard', async () => {
  await expect(page.locator('h1')).toHaveText('Portfolio')
})

test('shows the not-connected state when no IBKR gateway is running', async () => {
  // The test environment has no Client Portal Gateway, so the overview fetch fails
  // to connect and the dashboard resolves to its not_connected state (ADR-0004).
  await expect(page.getByText('Not connected to Interactive Brokers')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
})

test('renders the snapshot history section, empty on a fresh database', async () => {
  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible()
  await expect(page.getByText('No snapshots captured yet', { exact: false })).toBeVisible()
})

test('manual capture reports not-connected when the gateway is unavailable', async () => {
  await page.getByRole('button', { name: 'Capture now' }).click()
  // captureNow -> IbkrNotConnectedError -> not_connected variant -> inline status.
  await expect(page.getByText('Not connected — connect to capture a snapshot.')).toBeVisible()
  // No snapshot was written, so history stays empty.
  await expect(page.getByText('No snapshots captured yet', { exact: false })).toBeVisible()
})

test('exposes the typed portfolio and snapshot channels on window.api', async () => {
  const channels = await page.evaluate(() => ({
    overview: typeof window.api?.getPortfolioOverview === 'function',
    capture: typeof window.api?.captureSnapshot === 'function',
    list: typeof window.api?.listSnapshots === 'function',
  }))
  expect(channels).toEqual({ overview: true, capture: true, list: true })
})

test('exposes the classification channel and its progress subscription (Story #105)', async () => {
  // The progress event is a subscription like `onSnapshotCaptured`: it must hand back an
  // unsubscribe function, or the Allocation view leaks a listener on every unmount.
  const bridge = await page.evaluate(() => {
    const unsubscribe = window.api?.onClassifyProgress(() => {})
    const isFunction = typeof unsubscribe === 'function'
    if (isFunction) unsubscribe()
    return { classify: typeof window.api?.classifyInstruments === 'function', unsubscribe: isFunction }
  })
  expect(bridge).toEqual({ classify: true, unsubscribe: true })
})

test('renders the custom frameless title bar with window controls (Story #42)', async () => {
  // The window runs frameless (main sets `frame: false`); the in-app title bar replaces
  // the OS chrome with the app title and the three window controls.
  await expect(page.locator('.titlebar-title')).toHaveText('Stock Portfolio Viewer')
  await expect(page.getByRole('button', { name: 'Minimize' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Maximize' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible()
})

test('exposes the typed window-control channels on window.api (Story #42)', async () => {
  const channels = await page.evaluate(() => ({
    minimize: typeof window.api?.minimizeWindow === 'function',
    toggleMaximize: typeof window.api?.toggleMaximizeWindow === 'function',
    close: typeof window.api?.closeWindow === 'function',
    isMaximized: typeof window.api?.isWindowMaximized === 'function',
    onMaximizeChanged: typeof window.api?.onWindowMaximizeChanged === 'function',
  }))
  expect(channels).toEqual({
    minimize: true,
    toggleMaximize: true,
    close: true,
    isMaximized: true,
    onMaximizeChanged: true,
  })
})

test('maximize control toggles the window and updates the control label (Story #42)', async () => {
  // Start restored; the button offers "Maximize".
  const maximize = page.getByRole('button', { name: 'Maximize' })
  await expect(maximize).toBeVisible()
  await maximize.click()
  // The main process reports the change back over IPC, so the control now offers "Restore".
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible()
  // Restore returns to the maximizable state, leaving the app in its original chrome.
  await page.getByRole('button', { name: 'Restore' }).click()
  await expect(page.getByRole('button', { name: 'Maximize' })).toBeVisible()
})

test('exposes the typed clear channels on window.api (Story #43)', async () => {
  const channels = await page.evaluate(() => ({
    clearStatements: typeof window.api?.clearStatements === 'function',
    clearHistory: typeof window.api?.clearHistory === 'function',
  }))
  expect(channels).toEqual({ clearStatements: true, clearHistory: true })
})

test('Clear history control is hidden when there is no snapshot history (Story #43)', async () => {
  // Fresh DB + no gateway, so nothing has been captured — there is nothing to clear.
  await expect(page.getByRole('button', { name: 'Clear history' })).toHaveCount(0)
})

test.describe('a gateway that stalls instead of refusing (Story #104)', () => {
  // The failure this story is about can't be produced by simply having no gateway: the app
  // needs one that *accepts* the connection and then goes quiet. So this block runs its own
  // app instance pointed at a local stand-in that never answers, on a short bound. It gets its
  // own user-data directory, which is also what lets it start at all alongside the suite's
  // first app — the single-instance lock is scoped to that directory (Story #107).
  let stalled: ElectronApplication
  let stalledPage: Page
  let gateway: Server

  test.beforeAll(async () => {
    gateway = createServer(() => {
      /* accept the request and never respond */
    })
    await new Promise<void>((resolve) => gateway.listen(5099, '127.0.0.1', resolve))

    const stallUserDataDir = mkdtempSync(join(tmpdir(), 'spv-e2e-stall-'))
    stalled = await electron.launch({
      args: [mainEntry, `--user-data-dir=${stallUserDataDir}`],
      env: {
        ...process.env,
        IBKR_GATEWAY_URL: 'http://127.0.0.1:5099',
        // Short enough to keep the test quick, long enough to be a real wait, not an instant fail.
        IBKR_GATEWAY_TIMEOUT_MS: '2000',
      },
    })
    stalledPage = await stalled.firstWindow()
    await stalledPage.waitForLoadState('domcontentloaded')
  })

  test.afterAll(async () => {
    await stalled?.close()
    gateway?.closeAllConnections()
    await new Promise<void>((resolve) => gateway?.close(() => resolve()))
  })

  test('resolves to the not-responding state instead of loading forever', async () => {
    // Before the bound this stayed on "Loading your portfolio…" indefinitely.
    await expect(stalledPage.getByText('Interactive Brokers isn’t responding')).toBeVisible({
      timeout: 15_000,
    })
    await expect(stalledPage.getByText('Loading your portfolio…')).toHaveCount(0)
  })

  test('offers Retry, and keeps it distinct from the not-connected state', async () => {
    await expect(stalledPage.getByRole('button', { name: 'Retry' })).toBeVisible()
    // The gateway is reachable — saying "not connected" here would send the owner to the
    // wrong fix, so that panel must not appear.
    await expect(stalledPage.getByText('Not connected to Interactive Brokers')).toHaveCount(0)
  })

  test('manual capture reports the stall rather than hanging on the button', async () => {
    await stalledPage.getByRole('button', { name: 'Capture now' }).click()
    await expect(
      stalledPage.getByText('Interactive Brokers didn’t respond in time — try again.'),
    ).toBeVisible({ timeout: 15_000 })
    // Nothing half-formed was written.
    await expect(stalledPage.getByText('No snapshots captured yet', { exact: false })).toBeVisible()
  })
})

test('lists the stored Flex statements on launch, with an empty state before any import (Story #108)', async () => {
  // The panel reads the store itself, so it renders without an import having happened —
  // that is the whole point of the story. This run's user-data dir is fresh, so the
  // store is empty and the empty state is what must appear (not a blank panel).
  await expect(page.getByRole('heading', { name: 'Stored statements' })).toBeVisible()
  await expect(page.getByText('No statements imported yet', { exact: false })).toBeVisible()
})

test('Clear statements confirms in place, then reports nothing to clear on an empty store (Story #43)', async () => {
  // Arm the destructive action: the button expands into an explicit warning + confirm/cancel.
  await page.getByRole('button', { name: 'Clear statements' }).click()
  await expect(page.getByText('This permanently removes all imported Flex statement data', { exact: false })).toBeVisible()

  // Cancel backs out without deleting anything and restores the resting trigger.
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Clear statements' })).toBeVisible()

  // Re-arm and confirm. The store is empty (nothing imported), so the reset removes nothing.
  await page.getByRole('button', { name: 'Clear statements' }).click()
  await page.getByRole('button', { name: 'Yes, clear all statements' }).click()
  await expect(page.getByText('No imported statements to clear.')).toBeVisible()
})

test('a second launch against the same user data exits instead of opening a window (Story #107)', async () => {
  // Two processes on one SQLite file is the single concurrency case that can actually reach
  // the owner's data, so the second launch has to lose. Spawned raw rather than through
  // Playwright's Electron launcher: the process under test is expected to quit before it is
  // ever ready, which is precisely what that launcher waits for.
  expect(app.windows()).toHaveLength(1)

  const second = spawn(electronPath, [mainEntry, `--user-data-dir=${userDataDir}`], {
    stdio: 'ignore',
  })
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    second.once('exit', resolve)
    second.once('error', reject)
  })

  // Quit, not crashed — it asked for the lock, lost, and stood down.
  expect(exitCode).toBe(0)
  // Exiting before `whenReady` is what keeps it away from migrations, capture-on-open and the
  // database; the observable half is that it never opened a window of its own.
  expect(app.windows()).toHaveLength(1)
  // The instance that already held the lock is untouched and still driving its renderer.
  await expect(page.locator('h1')).toHaveText('Portfolio')
})

// Kept last in the file: once an analytics tab has been opened it stays in the DOM, so the
// page carries more than one `h1` from here on — which is exactly what this test asserts, and
// what would make the earlier single-`h1` locators ambiguous if it ran before them.
test('an analytics tab stays mounted after switching away, and comes back without reloading (Story #109)', async () => {
  // A CSS locator rather than a role: a hidden panel is out of the accessibility tree by
  // design, so `getByRole` would report it as gone — which is the very thing under test.
  const panels = page.locator('.tab-panel')
  await expect(panels).toHaveCount(0)

  await page.getByRole('tab', { name: 'Performance' }).click()
  await expect(panels).toHaveCount(1)
  await expect(panels.locator('h1')).toHaveText('Performance')
  // No import has happened in this run, so the view resolves to its needs-import state.
  await expect(page.getByText('No imported data yet')).toBeVisible()

  // Back to Portfolio: the analytics panel is hidden, not destroyed.
  await page.getByRole('tab', { name: 'Portfolio' }).click()
  await expect(panels).toHaveCount(1)
  await expect(panels).toBeHidden()

  // Returning shows the same panel again, with no "Loading performance…" in between —
  // the component never unmounted, so it never re-entered its loading phase.
  await page.getByRole('tab', { name: 'Performance' }).click()
  await expect(panels).toBeVisible()
  await expect(page.getByText('Loading performance…')).toHaveCount(0)

  // A second analytics tab adds its own panel and leaves the first one in place.
  await page.getByRole('tab', { name: 'Dividends' }).click()
  await expect(panels).toHaveCount(2)

  // Leave the shell on the Portfolio tab, as the rest of the suite expects it.
  await page.getByRole('tab', { name: 'Portfolio' }).click()
})
