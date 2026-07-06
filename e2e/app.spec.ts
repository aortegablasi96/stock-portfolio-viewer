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
