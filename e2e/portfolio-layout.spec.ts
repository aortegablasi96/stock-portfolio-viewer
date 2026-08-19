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

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * The Portfolio view's composition (Story #189).
 *
 * What `lib/portfolioLayout.test.ts` cannot see, for the reason every spec in this directory
 * exists: Vitest runs in Node with no jsdom, so a text guard can prove the rail is *rendered*
 * outside the gateway branches and not that it is *visible* beside a not_connected panel, and it
 * can prove a media query exists and not that the page stops scrolling sideways at 1280px.
 *
 * Its own app instance with its own user-data directory, following `tab-navigation.spec.ts`: the
 * single-instance lock is scoped to that directory (Story #107, DDR-0025), and this file resizes
 * the window, which the main suite would not expect to find done to it.
 *
 * No Client Portal Gateway is running here, which is the case worth testing rather than a
 * limitation: the view resolves to `not_connected`, and the whole point of the rail's placement is
 * that the import path survives that.
 */
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-portfolio-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { name: 'Data sources' })).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

test('lays out as header, KPI tiles, the table/rail pair, then the stored statements', async () => {
  const dashboard = page.locator('main.dashboard')
  const order = [
    dashboard.locator('.page-header'),
    dashboard.locator('.stat-row'),
    dashboard.locator('.dashboard-columns'),
    dashboard.getByRole('heading', { name: 'Stored statements' }),
    dashboard.getByRole('heading', { name: 'History' }),
  ]

  // Vertical position rather than DOM order: a grid or a flex `order` can put a section somewhere
  // its markup does not, and what the story specifies is what the owner sees down the page.
  const tops: number[] = []
  for (const section of order) {
    // The balances row is absent while the gateway is down — this run has none — so a section
    // that is legitimately not on screen is skipped rather than asserted into existence.
    if ((await section.count()) === 0) continue
    const box = await section.first().boundingBox()
    if (box) tops.push(box.y)
  }

  expect(tops.length).toBeGreaterThanOrEqual(4)
  expect([...tops].sort((a, b) => a - b)).toEqual(tops)
})

test('keeps the snapshot history reachable, below the stored statements', async () => {
  // The prototype draws no snapshot section at all. Deleting a capability is not the Epic's
  // business, so it is still here — and it is here in a stated place, not wherever it landed.
  const history = page.getByRole('heading', { name: 'History' })
  await expect(history).toBeVisible()
  await expect(page.getByText('No snapshots captured yet', { exact: false })).toBeVisible()

  const stored = await page.getByRole('heading', { name: 'Stored statements' }).boundingBox()
  const snapshots = await history.boundingBox()
  expect(snapshots!.y).toBeGreaterThan(stored!.y)
})

test('the rail sits beside the table, not under it, at the default window size', async () => {
  const railBox = (await page.locator('.col-side').boundingBox())!
  const mainBox = (await page.locator('.col-main').boundingBox())!

  // Beside: the rail starts to the right of where the main column ends.
  expect(railBox.x).toBeGreaterThanOrEqual(mainBox.x + mainBox.width)
  // And it is the rail the redesign specifies, not a fraction that grew with the window.
  expect(Math.round(railBox.width)).toBe(260)
})

test('offers the import while the gateway is down, which is when it is most useful', async () => {
  // Imported Flex history is local and has never needed IBKR. The live read failed in this run —
  // that panel is on screen — and the rail is beside it, fully usable.
  await expect(page.getByText('Not connected to Interactive Brokers')).toBeVisible()
  await expect(page.locator('.col-side').getByRole('button', { name: 'Import statements…' })).toBeEnabled()
  await expect(page.locator('.col-side').getByRole('button', { name: 'Clear statements' })).toBeEnabled()
})

test('Clear statements confirms in place — no modal, and no native dialog', async () => {
  // DDR-0012 over ADR-0006's sanctioned reset. A `window.confirm` would block the renderer and
  // never resolve without a handler, so this test would time out rather than fail loudly; the
  // handler below turns that into an assertion.
  let nativeDialogs = 0
  page.on('dialog', (dialog) => {
    nativeDialogs += 1
    void dialog.dismiss()
  })

  await page.getByRole('button', { name: 'Clear statements' }).click()
  await expect(
    page.getByText('This permanently removes all imported Flex statement data', { exact: false }),
  ).toBeVisible()
  // In place: the warning is inside the rail's card, not in a layer over the page.
  await expect(page.locator('.col-side .confirm-action')).toBeVisible()
  await expect(page.locator('[role="dialog"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('button', { name: 'Clear statements' })).toBeVisible()
  expect(nativeDialogs).toBe(0)
})

test('the page does not scroll sideways at the default window size', async () => {
  // The criterion the story states, at the size the window opens on (DDR-0028's default) with the
  // sidebar expanded. A rail that overflowed would push the whole shell.
  await page.setViewportSize({ width: 1280, height: 800 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('the rail drops below the table rather than squeezing it on a narrow window', async () => {
  await page.setViewportSize({ width: 1000, height: 800 })
  // Give the grid a frame to reflow before measuring.
  await expect(page.locator('.col-side')).toBeVisible()

  const railBox = (await page.locator('.col-side').boundingBox())!
  const mainBox = (await page.locator('.col-main').boundingBox())!

  // Under, not beside — and the table has the full column rather than a squeezed share of it.
  expect(railBox.y).toBeGreaterThanOrEqual(mainBox.y + mainBox.height)
  expect(railBox.x).toBeCloseTo(mainBox.x, 0)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
