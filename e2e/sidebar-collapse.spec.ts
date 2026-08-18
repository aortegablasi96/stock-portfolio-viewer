import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

/**
 * Collapsing the sidebar to its icon rail (Story #184, DDR-0057).
 *
 * Everything here needs a real browser and most of it needs a real *launch*: a computed width, an
 * accessible name computed from clipped text, a `title` that is present in one state and absent in
 * the other, and a preference that has to survive the process ending. None of that is reachable
 * from Vitest, which runs in Node with no jsdom (DDR-0029) — `lib/sidebarCollapse.test.ts` guards
 * the decisions, and this guards the behaviour.
 *
 * Its own user-data directory, both because the persistence tests need a store that starts empty
 * and because the single-instance lock is scoped to that directory (DDR-0025).
 */

/** A user-data directory of its own, so a run starts with nothing remembered. */
function freshUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'spv-e2e-sidebar-'))
}

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

const sidebarWidth = (page: Page): Promise<number> =>
  page.evaluate(() => document.querySelector('.app-sidebar')!.getBoundingClientRect().width)

/** The toggle, by the name it carries in whichever state the sidebar is in. */
const toggle = (page: Page, collapsed: boolean) =>
  page.getByRole('button', { name: collapsed ? 'Expand sidebar' : 'Collapse sidebar' })

test.describe('within one launch', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    ;({ app, page } = await launch(freshUserDataDir()))
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('collapses and expands from a single, visible, labelled control', async () => {
    // A fresh install opens expanded: the rail is the compact form of something the reader
    // already knows, and the labelled column is how they learn the five glyphs.
    await expect(toggle(page, false)).toBeVisible()
    expect(await sidebarWidth(page)).toBe(220)
    await expect(toggle(page, false)).toHaveAttribute('aria-expanded', 'true')

    await toggle(page, false).click()
    await expect.poll(() => sidebarWidth(page)).toBe(56)

    // The same control, in the same place, now offering the way back — not a second button.
    await expect(toggle(page, true)).toBeVisible()
    await expect(toggle(page, true)).toHaveAttribute('aria-expanded', 'false')
    expect(await page.getByRole('button', { name: /sidebar$/ }).count()).toBe(1)

    await toggle(page, true).click()
    await expect.poll(() => sidebarWidth(page)).toBe(220)
  })

  test('every nav row keeps its accessible name on the rail', async () => {
    await toggle(page, false).click()
    await expect.poll(() => sidebarWidth(page)).toBe(56)

    // The names are computed from the tabs' own text, which is clipped rather than removed. If it
    // were `display: none` these five lookups would find nothing, and `title` would be doing work
    // it is not allowed to do.
    for (const name of ['Portfolio', 'Performance', 'Allocation', 'Dividends', 'Trades']) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    }
    // The tooltip is an addition, and only while the label is invisible.
    await expect(page.getByRole('tab', { name: 'Performance' })).toHaveAttribute(
      'title',
      'Performance',
    )

    // And the currency select is still named by its own label, which is clipped the same way.
    await expect(page.getByLabel('Display currency')).toBeVisible()

    await toggle(page, true).click()
    await expect.poll(() => sidebarWidth(page)).toBe(220)
    await expect(page.getByRole('tab', { name: 'Performance' })).not.toHaveAttribute('title', /.*/)
  })

  test('selecting a view while collapsed does not force the sidebar back open', async () => {
    await toggle(page, false).click()
    await expect.poll(() => sidebarWidth(page)).toBe(56)

    // The prototype re-expands on every nav click, which defeats the point of collapsing.
    await page.getByRole('tab', { name: 'Allocation' }).click()
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Allocation')
    expect(await sidebarWidth(page)).toBe(56)

    // Nor does the keyboard path, which selects as it moves (automatic activation, DDR-0029).
    await page.getByRole('tab', { name: 'Allocation' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('tab', { selected: true })).toHaveText('Dividends')
    expect(await sidebarWidth(page)).toBe(56)

    await page.getByRole('tab', { name: 'Portfolio' }).click()
    await toggle(page, true).click()
    await expect.poll(() => sidebarWidth(page)).toBe(220)
  })

  test('the tabs pattern behaves identically in both states', async () => {
    for (const collapsed of [false, true]) {
      if (collapsed) await toggle(page, false).click()
      await expect.poll(() => sidebarWidth(page)).toBe(collapsed ? 56 : 220)

      await page.getByRole('tab', { name: 'Portfolio' }).click()
      const roving = await page.evaluate(() =>
        [...document.querySelectorAll('[role="tab"]')].map((tab) => (tab as HTMLElement).tabIndex),
      )
      expect(roving).toEqual([0, -1, -1, -1, -1])

      await page.getByRole('tab', { name: 'Portfolio' }).focus()
      await page.keyboard.press('ArrowDown')
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('tab-performance')
      await expect(page.getByRole('tabpanel')).toHaveAttribute('id', 'panel-performance')

      await page.keyboard.press('End')
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('tab-trades')
      await page.keyboard.press('Home')
      expect(await page.evaluate(() => document.activeElement?.id)).toBe('tab-portfolio')
    }
    await toggle(page, true).click()
    await expect.poll(() => sidebarWidth(page)).toBe(220)
  })

  test('the content column reflows in both states, with no horizontal page scroll', async () => {
    for (const collapsed of [false, true]) {
      if (collapsed) await toggle(page, false).click()
      await expect.poll(() => sidebarWidth(page)).toBe(collapsed ? 56 : 220)

      const layout = await page.evaluate(() => ({
        sidebar: document.querySelector('.app-sidebar')!.getBoundingClientRect().width,
        content: document.querySelector('.app-content')!.getBoundingClientRect().width,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: document.documentElement.clientWidth,
      }))
      // The two columns fill the window between them, and nothing overflows it sideways.
      expect(layout.sidebar + layout.content).toBeCloseTo(layout.viewportWidth, 0)
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth)
    }
    await toggle(page, true).click()
    await expect.poll(() => sidebarWidth(page)).toBe(220)
  })

  test('the frameless shell still drags, and its controls stay reachable', async () => {
    await toggle(page, false).click()
    await expect.poll(() => sidebarWidth(page)).toBe(56)

    // The bar spans the window above the sidebar, so the drag region is the same width in both
    // states — the whole reason the corner was settled this way (DDR-0011, DDR-0057).
    const chrome = await page.evaluate(() => {
      const drag = document.querySelector('.titlebar-drag') as HTMLElement
      return {
        dragRegion: getComputedStyle(drag).getPropertyValue('-webkit-app-region'),
        dragWidth: drag.getBoundingClientRect().width,
        barWidth: document.querySelector('.titlebar')!.getBoundingClientRect().width,
        viewportWidth: document.documentElement.clientWidth,
      }
    })
    expect(chrome.dragRegion).toBe('drag')
    expect(chrome.barWidth).toBeCloseTo(chrome.viewportWidth, 0)
    expect(chrome.dragWidth).toBeGreaterThan(chrome.viewportWidth / 2)

    for (const name of ['Minimize', 'Close']) {
      await expect(page.getByRole('button', { name })).toBeVisible()
    }

    await toggle(page, true).click()
    await expect.poll(() => sidebarWidth(page)).toBe(220)
  })
})

/**
 * The half that only exists *between* launches. Like `window-state.spec.ts`, these start the app
 * more than once against a single user-data directory — the same SQLite file, and therefore the
 * same remembered state.
 */
test.describe('across launches', () => {
  test('remembers the collapse, and the expansion after it', async () => {
    const userDataDir = freshUserDataDir()

    const first = await launch(userDataDir)
    expect(await sidebarWidth(first.page)).toBe(220)
    await toggle(first.page, false).click()
    await expect.poll(() => sidebarWidth(first.page)).toBe(56)
    await first.app.close()

    const second = await launch(userDataDir)
    // Applied on arrival rather than animated to: the width is already the rail's, and the
    // transition is armed a frame later so a launch never replays yesterday's decision.
    await expect.poll(() => sidebarWidth(second.page)).toBe(56)
    await expect(toggle(second.page, true)).toBeVisible()
    await toggle(second.page, true).click()
    await expect.poll(() => sidebarWidth(second.page)).toBe(220)
    await second.app.close()

    // Expanded is a stored value too, not just the absence of a stored one.
    const third = await launch(userDataDir)
    await expect.poll(() => sidebarWidth(third.page)).toBe(220)
    await expect(toggle(third.page, false)).toBeVisible()
    await third.app.close()
  })
})
