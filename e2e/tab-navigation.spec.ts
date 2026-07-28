import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * The tab shell's ARIA pattern and keyboard behaviour (Story #111).
 *
 * These assertions are about the DOM the tablist promises a screen reader, and about focus —
 * neither of which a Vitest unit test can reach, since the suite runs in Node with no jsdom
 * and no component may be rendered. Only the index arithmetic behind the arrow keys is unit
 * tested (`lib/tabKeyboard.test.ts`); everything the pattern actually *is* lives here.
 *
 * Its own app instance with its own user-data directory, both because these tests move the
 * shell off the Portfolio tab (which the main suite expects to be where it left it) and
 * because the single-instance lock is scoped to that directory (Story #107).
 */
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-tabs-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/** The id of the element currently holding focus — the only way to assert a roving tabindex. */
const focusedId = (): Promise<string | undefined> => page.evaluate(() => document.activeElement?.id)

test('the tablist is named and every tab is a tab', async () => {
  const tablist = page.getByRole('tablist', { name: 'Views' })
  await expect(tablist).toBeVisible()
  await expect(tablist.getByRole('tab')).toHaveText([
    'Portfolio',
    'Performance',
    'Allocation',
    'Dividends',
    'Trades',
  ])
})

test('the selected tab points at a panel that exists, and the panel points back', async () => {
  // The half-implemented version of this pattern announced a tablist and controlled nothing:
  // no tabpanel existed, so `aria-controls` had nothing to name.
  const selected = page.getByRole('tab', { selected: true })
  await expect(selected).toHaveText('Portfolio')
  await expect(selected).toHaveAttribute('aria-controls', 'panel-portfolio')

  const panel = page.getByRole('tabpanel')
  await expect(panel).toHaveCount(1)
  await expect(panel).toHaveAttribute('aria-labelledby', 'tab-portfolio')
  await expect(panel).toHaveAttribute('id', 'panel-portfolio')
})

test('the tablist is a single stop in the Tab order', async () => {
  // Roving tabindex: exactly one tab is reachable with Tab, and it is the selected one.
  const reachable = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
      label: tab.textContent,
      tabIndex: (tab as HTMLElement).tabIndex,
    })),
  )
  expect(reachable).toEqual([
    { label: 'Portfolio', tabIndex: 0 },
    { label: 'Performance', tabIndex: -1 },
    { label: 'Allocation', tabIndex: -1 },
    { label: 'Dividends', tabIndex: -1 },
    { label: 'Trades', tabIndex: -1 },
  ])
})

test('Tab from the selected tab moves into its panel, not along the other tabs', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).focus()
  await page.keyboard.press('Tab')
  expect(await focusedId()).toBe('panel-portfolio')
})

test('arrow keys move between tabs and select as they go', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).focus()

  await page.keyboard.press('ArrowRight')
  expect(await focusedId()).toBe('tab-performance')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Performance')
  // Selection and the visible panel never disagree — that is what automatic activation buys.
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'panel-performance')

  await page.keyboard.press('ArrowLeft')
  expect(await focusedId()).toBe('tab-portfolio')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Portfolio')
})

test('arrow keys wrap at both ends of the tablist', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).focus()

  // Left from the first tab lands on the last.
  await page.keyboard.press('ArrowLeft')
  expect(await focusedId()).toBe('tab-trades')

  // Right from the last tab comes back round to the first.
  await page.keyboard.press('ArrowRight')
  expect(await focusedId()).toBe('tab-portfolio')
})

test('Home and End jump to the first and last tabs', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).focus()

  await page.keyboard.press('End')
  expect(await focusedId()).toBe('tab-trades')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Trades')

  await page.keyboard.press('Home')
  expect(await focusedId()).toBe('tab-portfolio')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Portfolio')
})

test('only the selected panel is exposed, however many are mounted', async () => {
  // Every analytics tab has been visited by the arrow-key tests above, so four panels are in
  // the DOM. `hidden` keeps the other three out of the accessibility tree entirely.
  await page.getByRole('tab', { name: 'Allocation' }).click()
  expect(await page.locator('.tab-panel').count()).toBeGreaterThan(1)

  const panel = page.getByRole('tabpanel')
  await expect(panel).toHaveCount(1)
  await expect(panel).toHaveAttribute('id', 'panel-allocation')
  // And no stale `aria-controls` is left behind on the tabs that no longer own a visible panel.
  await expect(page.getByRole('tab', { name: 'Portfolio' })).not.toHaveAttribute(
    'aria-controls',
    /.*/,
  )
})

test('the active tab is marked by more than colour', async () => {
  await page.getByRole('tab', { name: 'Dividends' }).click()
  const marker = await page.evaluate(() => {
    const active = document.querySelector('.app-tab-active')
    if (!active) return null
    const after = getComputedStyle(active, '::after')
    return { content: after.content, height: after.height }
  })
  // A bar under the label: present on the active tab, absent on the others, and readable
  // without separating the accent hue from the muted grey.
  expect(marker?.content).not.toBe('none')
  expect(marker?.height).toBe('2px')
})
