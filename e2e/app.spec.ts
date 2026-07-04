import { join } from 'node:path'
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
  // Launch the built app (electron-vite output). Not packaged, no dev server, so
  // main loads the built renderer from out/renderer/index.html.
  app = await electron.launch({
    args: [join(__dirname, '..', 'out', 'main', 'index.js')],
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

test('exposes the typed portfolio channel on window.api', async () => {
  const hasChannel = await page.evaluate(
    () => typeof window.api?.getPortfolioOverview === 'function',
  )
  expect(hasChannel).toBe(true)
})
