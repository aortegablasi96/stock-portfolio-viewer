import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * The tab shell's ARIA pattern and keyboard behaviour (Story #111), now vertical (Story #182).
 *
 * The tablist moved from a horizontal strip under the title bar into the sidebar. Two things in
 * this file genuinely change with it — the orientation it announces, and Left/Right becoming
 * Up/Down — and nothing else may: the attributes, the roving `tabindex`, the single Tab stop, the
 * automatic activation and the one-exposed-panel rule are what stand between the rotation and a
 * silently broken keyboard path (DDR-0029, DDR-0055).
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

test('the tablist is named, vertical, and every tab is a tab', async () => {
  const tablist = page.getByRole('tablist', { name: 'Views' })
  await expect(tablist).toBeVisible()
  // The axis is part of the promise: a reader who is told "vertical" reaches for Up/Down, and
  // the test below is what makes sure those are the keys that answer.
  await expect(tablist).toHaveAttribute('aria-orientation', 'vertical')
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

  await page.keyboard.press('ArrowDown')
  expect(await focusedId()).toBe('tab-performance')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Performance')
  // Selection and the visible panel never disagree — that is what automatic activation buys.
  await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'panel-performance')

  await page.keyboard.press('ArrowUp')
  expect(await focusedId()).toBe('tab-portfolio')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Portfolio')
})

test('arrow keys wrap at both ends of the tablist', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).focus()

  // Up from the first tab lands on the last.
  await page.keyboard.press('ArrowUp')
  expect(await focusedId()).toBe('tab-trades')

  // Down from the last tab comes back round to the first.
  await page.keyboard.press('ArrowDown')
  expect(await focusedId()).toBe('tab-portfolio')
})

test('the cross-axis arrows are left to the panel', async () => {
  // A vertical tablist owns one axis. Answering to Left/Right as well would make the announced
  // orientation a half-truth, and would take a key from whatever the focused view does with it.
  await page.getByRole('tab', { name: 'Portfolio' }).focus()

  await page.keyboard.press('ArrowRight')
  expect(await focusedId()).toBe('tab-portfolio')
  await page.keyboard.press('ArrowLeft')
  expect(await focusedId()).toBe('tab-portfolio')
  await expect(page.getByRole('tab', { selected: true })).toHaveText('Portfolio')
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
    const resting = document.querySelector('.app-tab:not(.app-tab-active)')
    if (!active || !resting) return null
    const after = getComputedStyle(active, '::after')
    return {
      content: after.content,
      width: after.width,
      weight: getComputedStyle(active).fontWeight,
      restingWeight: getComputedStyle(resting).fontWeight,
    }
  })
  // A bar down the row's leading edge: present on the active row, absent on the others, and
  // readable without separating the accent hue from the muted grey. It was 2px high under a
  // label before the tablist rotated (Story #182); it is 3px wide beside one now.
  expect(marker?.content).not.toBe('none')
  expect(marker?.width).toBe('3px')
  // And the weight step the horizontal strip had no room for, since its tabs were already 600.
  expect(Number(marker?.weight)).toBeGreaterThan(Number(marker?.restingWeight))
})

test('hovering the selected row does not repaint it as unselected', async () => {
  // A cascade question, so it can only be asked in a real browser. `:hover` is a pseudo-class and
  // therefore counts as a class, so `.app-tab:hover` out-specifies `.app-tab-active` no matter
  // which is written first — and a pointer resting on the current view would tell the reader the
  // app has no current view. `.app-tab:hover:not(.app-tab-active)` is what prevents it.
  const active = page.getByRole('tab', { name: 'Dividends' })
  await active.click()
  const resting = await active.evaluate((el) => getComputedStyle(el).color)
  await active.hover()
  await expect(active).toHaveCSS('color', resting)
})

test('the content column reflows beside the sidebar rather than scrolling the page sideways', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).click()
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector('.app-sidebar')
    const content = document.querySelector('.app-content')
    if (!sidebar || !content) return null
    return {
      sidebar: sidebar.getBoundingClientRect().width,
      content: content.getBoundingClientRect().width,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
    }
  })
  expect(layout?.sidebar).toBe(220)
  // The two columns fill the window between them, and nothing overflows it sideways.
  expect((layout?.sidebar ?? 0) + (layout?.content ?? 0)).toBeCloseTo(layout?.viewportWidth ?? 0, 0)
  expect(layout?.documentWidth).toBeLessThanOrEqual(layout?.viewportWidth ?? 0)
})
