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
import { RANGE_OPTIONS } from '../src/renderer/src/lib/dateRange'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * The time-range presets grew from five to six with YTD (Story #256, DDR-0085), and six is the
 * number this spec exists for. `.toggle-group` is `flex-wrap: wrap` and `.range-bar` wraps too, so
 * the group has no width it refuses to fit into — it just silently becomes two rows, which pushes
 * everything below it down and puts `Custom` under `1M` where nothing names it as a preset.
 *
 * Nothing in Node can see that. Vitest runs with no jsdom (see CLAUDE.md), so a unit test can
 * assert the list has six entries and never learn how wide they draw.
 *
 * The measurement is taken at the window's **own** minimum width, read back from the live
 * `BrowserWindow` rather than written here as a literal: `windowStateService` declares it
 * (`WINDOW_MIN_WIDTH`) but cannot be imported into a Playwright process, because it reaches
 * `metaRepository` and therefore `better-sqlite3`, which only loads inside Electron. Asking the
 * window is the better source anyway — it is the minimum actually being enforced, so lowering the
 * constant re-runs this test at the new floor instead of leaving a stale number behind. The
 * sidebar stays expanded, which is the narrowest the content column ever gets.
 *
 * The three views that carry a `RangeFilter` all need imported Flex history to render one, and the
 * e2e app deliberately has none. So the group is a **probe** wearing its real classes, appended to
 * a real `<main class="dashboard">` — the Portfolio view's, which renders with no gateway and
 * nothing imported, and which is the same `--content-max` column at the same `--content-pad` that
 * the analytics views lay out in. The labels come from `RANGE_OPTIONS` itself, so a preset renamed
 * to something longer is measured as it will actually draw.
 *
 * Its own app instance with its own user-data directory, for the reason `tab-navigation.spec.ts`
 * gives: the single-instance lock is scoped to that directory (Story #107).
 */
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-range-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  // Portfolio is the view whose `.dashboard` renders with nothing imported, and it is selected at
  // launch; clicking it is what makes that a fact of the test rather than of the default.
  await page.getByRole('tab', { name: 'Portfolio' }).click()
  await expect(page.locator('.tab-panel:not([hidden]) main.dashboard')).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

/** Shrink the window to the minimum it will accept, and report the width it settled on. */
const resizeToMinimum = async (): Promise<number> => {
  const width = await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!
    const [minWidth] = win.getMinimumSize()
    const bounds = win.getBounds()
    // Below the minimum on purpose: the window clamps, so what comes back is the floor itself
    // rather than a number this file chose.
    win.setBounds({ ...bounds, x: 0, y: 0, width: minWidth })
    return win.getBounds().width
  })
  // The renderer lays out on the resize event, not on the call returning. The tolerance covers
  // the window frame's own chrome, which `innerWidth` does not include.
  await page.waitForFunction((w) => Math.abs(window.innerWidth - w) < 40, width, { timeout: 5000 })
  return width
}

/** Every preset's box, plus how many distinct rows they landed on. */
type GroupBox = { count: number; rows: number; groupWidth: number; available: number }

const presetBox = (labels: readonly string[]): Promise<GroupBox> =>
  page.evaluate((names) => {
    const host = document.querySelector('.tab-panel:not([hidden]) main.dashboard')
    if (!host) throw new Error('no dashboard to measure in')

    const bar = document.createElement('div')
    bar.className = 'range-bar'
    const group = document.createElement('div')
    group.className = 'toggle-group'
    group.setAttribute('role', 'group')
    for (const name of names) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'toggle-item toggle-item-single'
      button.textContent = name
      group.append(button)
    }
    bar.append(group)
    host.append(bar)

    const items = [...group.children].map((element) => element.getBoundingClientRect())
    // Distinct `top` values: a wrapped group puts its later items on a second baseline. Rounded,
    // because sub-pixel layout on a fractional device scale factor makes two tops on one row
    // differ in the hundredths.
    const rows = new Set(items.map((rect) => Math.round(rect.top))).size
    const box: GroupBox = {
      count: items.length,
      rows,
      groupWidth: group.getBoundingClientRect().width,
      available: host.getBoundingClientRect().width,
    }

    bar.remove()
    return box
  }, labels)

const LABELS = RANGE_OPTIONS.map((option) => option.label)

test('six presets fit on one line at the narrowest supported width', async () => {
  await resizeToMinimum()
  const box = await presetBox(LABELS)

  expect(box.count).toBe(6)
  expect(box.rows).toBe(1)
  expect(box.groupWidth).toBeLessThanOrEqual(box.available)
})

test('the group would still fit a seventh preset before it wrapped', async () => {
  await resizeToMinimum()
  // Headroom, not a second assertion of the same thing: the point of the first test is that six
  // fit *today*, and the point of this one is that they do so with room to spare rather than by
  // a pixel — so the next story to touch this list learns it has none before it ships two rows.
  const box = await presetBox([...LABELS, 'Custom'])

  expect(box.rows).toBe(1)
})

test('a wrapped group is what this spec would actually catch', async () => {
  await resizeToMinimum()
  // The negative control. Without it a passing suite proves only that `rows` is hard to move —
  // and `rows` is derived from a rounded `top`, which is exactly the kind of measurement that
  // reports 1 for everything if it is wrong.
  const box = await presetBox(LABELS.map((label) => `${label} ${'wide'.repeat(12)}`))

  expect(box.rows).toBeGreaterThan(1)
})
