import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  // Launch the built app (electron-vite output) with an isolated, empty user-data
  // directory so the SQLite DB (and thus snapshot history) starts clean and the
  // run is deterministic. No Client Portal Gateway is running, so the app resolves
  // to its not_connected state and capture-on-open is skipped.
  const userDataDir = mkdtempSync(join(tmpdir(), 'spv-e2e-'))
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js'), `--user-data-dir=${userDataDir}`],
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
