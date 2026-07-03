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

test('main window renders the placeholder React view', async () => {
  await expect(page.locator('.app-shell')).toBeVisible()
  await expect(page.locator('h1')).toHaveText('Foundation ready')
})

test('window has the expected title', async () => {
  expect(await page.title()).toBe('Stock Portfolio Viewer')
})

test('the typed IPC bridge is exposed on window.api', async () => {
  const hasPing = await page.evaluate(() => typeof window.api?.ping === 'function')
  expect(hasPing).toBe(true)
})
