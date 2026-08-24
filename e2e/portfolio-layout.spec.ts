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
 * The Portfolio view's composition (Story #189, re-stated by Story #266).
 *
 * What `lib/portfolioLayout.test.ts` cannot see, for the reason every spec in this directory
 * exists: Vitest runs in Node with no jsdom, so a text guard can prove the store's row is
 * *rendered* outside the gateway branches and not that it is *visible* under a not_connected
 * panel, and it can prove a media query exists and not that the page stops scrolling sideways at
 * 1280px. Story #266 adds the one measurement its own width was chosen for — that the card's two
 * controls really do fit on one line — which is a rendered advance and nothing a comment can
 * promise.
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

test('lays out as header, KPI tiles, the live read, then the store’s row', async () => {
  const dashboard = page.locator('main.dashboard')
  const order = [
    dashboard.locator('.page-header'),
    dashboard.locator('.stat-row'),
    dashboard.locator('.state-panel'),
    dashboard.locator('.dashboard-sources'),
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

test('the live read takes the page’s full width, with nothing beside it', async () => {
  // Story #266. No gateway here, so the full-width thing is the not_connected panel rather than
  // the holdings table — which is the same measurement: the rail is gone, so whatever the live
  // read produced reaches both edges of the content column.
  const dashboard = (await page.locator('main.dashboard').boundingBox())!
  const panel = (await page.locator('.state-panel').first().boundingBox())!

  // Within the dashboard's own 2rem padding either side, and no 260px column taken off the right.
  expect(Math.round(panel.width)).toBe(Math.round(dashboard.width) - 64)
  await expect(page.locator('.col-side')).toHaveCount(0)
})

test('pairs the stored statements with the data sources in one top-aligned row', async () => {
  const statements = (await page.locator('.dashboard-sources > *').first().boundingBox())!
  const card = (await page.locator('.dashboard-sources > *').last().boundingBox())!

  // Beside, not under: the card starts to the right of where the statements column ends.
  expect(card.x).toBeGreaterThanOrEqual(statements.x + statements.width)
  // Top-aligned, so the two read as one band rather than as a card floating beside a table.
  expect(card.y).toBeCloseTo(statements.y, 0)
  // And the card is the fixed track, not a fraction that grew with the window.
  expect(Math.round(card.width)).toBe(416)
})

test('stands the two import controls side by side, on one line', async () => {
  // The width the card is given exists for this. Story #189 stacked them because a 260px rail
  // has no "beside"; a measured pair of tops is the only thing that can prove 400px does.
  const importBtn = (await page.getByRole('button', { name: 'Import statements…' }).boundingBox())!
  const clearBtn = (await page.getByRole('button', { name: 'Clear statements' }).boundingBox())!

  expect(clearBtn.y).toBeCloseTo(importBtn.y, 0)
  expect(clearBtn.x).toBeGreaterThan(importBtn.x + importBtn.width - 1)
})

test('offers the import while the gateway is down, which is when it is most useful', async () => {
  // Imported Flex history is local and has never needed IBKR. The live read failed in this run —
  // that panel is on screen — and the row below it is fully usable.
  await expect(page.getByText('Not connected to Interactive Brokers')).toBeVisible()
  const row = page.locator('.dashboard-sources')
  await expect(row.getByRole('button', { name: 'Import statements…' })).toBeEnabled()
  await expect(row.getByRole('button', { name: 'Clear statements' })).toBeEnabled()
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
  // In place: the warning is inside the data-sources card, not in a layer over the page.
  await expect(page.locator('.dashboard-sources .confirm-action')).toBeVisible()
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

test('the row stacks rather than squeezing the statements on a narrow window', async () => {
  await page.setViewportSize({ width: 1000, height: 800 })
  // Give the grid a frame to reflow before measuring.
  await expect(page.locator('.dashboard-sources')).toBeVisible()

  const statements = (await page.locator('.dashboard-sources > *').first().boundingBox())!
  const card = (await page.locator('.dashboard-sources > *').last().boundingBox())!

  // Under, not beside — and each half has the full column rather than a squeezed share of it.
  expect(card.y).toBeGreaterThanOrEqual(statements.y + statements.height)
  expect(card.x).toBeCloseTo(statements.x, 0)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('and holds at the narrowest window the app can be made', async () => {
  // The width that used to bind was the pair's: a 560px table beside a 260px rail. This page has
  // neither, so the question moved — the row stacked long before this size, and what is left to
  // check is that two cards with a floor each still fit the window's own minimum. Read off the
  // live `BrowserWindow` rather than written as a literal, the way `range-presets.spec.ts` does:
  // `windowStateService` cannot be imported here, since it reaches `better-sqlite3`.
  const [minWidth, minHeight] = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.getMinimumSize(),
  )

  await page.setViewportSize({ width: minWidth, height: minHeight })
  await expect(page.locator('.dashboard-sources')).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  // Both controls are still reachable rather than clipped out of the card.
  await expect(page.getByRole('button', { name: 'Import statements…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clear statements' })).toBeVisible()
})
