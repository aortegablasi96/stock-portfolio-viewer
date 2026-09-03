import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * The one page header every view opens with (Story #185, DDR-0058).
 *
 * Everything asserted here is composition — which elements a view renders, in what order, with
 * what heading level — and none of it is reachable from Vitest, which runs in Node with no jsdom
 * and may not render a component (DDR-0029). The unit tests cover the two things that *are* pure:
 * the wording (`lib/pageHeader.test.ts`) and the guard that no view re-declares the header
 * (`lib/analyticsShell.test.ts`). What the header actually looks like in a document lives here.
 *
 * The load these tests run against is the honest one for a fresh install: no gateway, and nothing
 * imported. That is not a limitation but the point — three of the four analytics branches are
 * unloaded states, and the story's sharpest criterion is that a view which failed to load still
 * says which view it is.
 *
 * Its own app instance with its own user-data directory, for the same two reasons
 * `tab-navigation.spec.ts` gives: these tests leave the shell off the Portfolio tab, and the
 * single-instance lock is scoped to that directory (Story #107).
 */
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-header-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/**
 * The views, and the title each one's header carries.
 *
 * **Five, not six.** The Assistant had a row here — it named no data source, because it has none,
 * and `OWNER_SOURCE` ("Set by you") said so in the slot the others use for provenance (DDR-0094).
 * Story #343 took the Figma design's Assistant, which has no page header at all, so the row and
 * the constant are both gone (DDR-0115 amendment 1). DDR-0094's rule is amended with an exception
 * rather than withdrawn: on that one view the *column* says whose standard it is, in an eyebrow, a
 * title and an intro paragraph, which is more than a three-word slot could. It still holds for the
 * five below, which do have a source to name — and this spec is now exactly those five.
 */
const VIEWS = [
  { tab: 'Portfolio', title: 'Portfolio', source: 'Live from Interactive Brokers' },
  { tab: 'Performance', title: 'Performance', source: 'From imported Flex Query data' },
  { tab: 'Allocation', title: 'Allocation', source: 'From imported Flex Query data' },
  { tab: 'Dividends', title: 'Dividends', source: 'From imported Flex Query data' },
  { tab: 'Trades', title: 'Trades & realized gains', source: 'From imported Flex Query data' },
] as const

/** The header of whichever panel is currently exposed. Hidden panels are out of the tree. */
const header = () => page.locator('.tab-panel:not([hidden]) .page-header')

test('every view opens with the same header, naming itself and its source', async () => {
  for (const view of VIEWS) {
    await page.getByRole('tab', { name: view.tab }).click()
    // One header, not two: the Portfolio panel also holds the Flex import card, and the four
    // analytics panels used to be wrapped in a page of their own on top of the shell's.
    await expect(header()).toHaveCount(1)
    await expect(header().locator('h1')).toHaveText(view.title)
    await expect(header().getByText(view.source)).toBeVisible()
  }
})

/**
 * The criterion the previous test cannot distinguish, because it passes trivially on a loaded
 * view. Nothing has been imported in this run, so all four analytics views resolve to their
 * needs-import state — the branch with no report at all — and the title still has to be there.
 */
test('the title survives a branch with no report', async () => {
  // The four analytics views only — Portfolio holds one header over all five of its own states.
  for (const view of VIEWS.slice(1)) {
    await page.getByRole('tab', { name: view.tab }).click()
    await expect(page.locator('.tab-panel:not([hidden])').getByText('No imported data yet')).toBeVisible()
    await expect(header().locator('h1')).toHaveText(view.title)
  }
})

/**
 * The reading time is a live region, which is what lets a screen reader hear a refresh finish
 * without the figures shifting under it (Story #109). It renders where there is a reading to
 * report: on Portfolio, which holds one header over all five of its own states, and on a loaded
 * analytics view. An unloaded analytics view carries no status row, and deliberately no Refresh
 * either — its recovery action sits inside the panel explaining why it has nothing (DDR-0038).
 */
test('the reading time keeps its role, and the unloaded states carry no second action', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).click()
  await expect(header().locator('.view-updated')).toHaveAttribute('role', 'status')
  // Portfolio's primary action, in the header rather than below it.
  await expect(header().getByRole('button', { name: 'Capture now' })).toBeVisible()

  await page.getByRole('tab', { name: 'Performance' }).click()
  await expect(header().locator('.view-updated')).toHaveCount(0)
  await expect(header().getByRole('button')).toHaveCount(0)
})

/**
 * Heading levels. The title bar is the app's banner and carries the app name as a `<span>`, not a
 * heading (Story #163), so the view title is the document's `<h1>` and everything a view draws
 * inside it — card titles, state-panel headings — is an `<h2>`. Exactly one `<h1>` is exposed at
 * a time however many views are mounted, because a hidden panel is out of the accessibility tree.
 */
test('exactly one h1 is exposed, and it is the view title', async () => {
  for (const view of VIEWS) {
    await page.getByRole('tab', { name: view.tab }).click()
    const headings = page.getByRole('heading', { level: 1 })
    await expect(headings).toHaveCount(1)
    await expect(headings).toHaveText(view.title)
  }
})

/**
 * The eyebrow is gone (Story #185). The prototype prints the app's name in accent caps above
 * every page title; the title bar and the sidebar's brand tile already carry it, so keeping it
 * would name the app three times per screen and the view once.
 */
test('the app names itself twice, not five times', async () => {
  await page.getByRole('tab', { name: 'Allocation' }).click()
  await expect(page.getByText('Stock Portfolio Viewer')).toHaveCount(2)
  await expect(header().getByText('Stock Portfolio Viewer')).toHaveCount(0)
})
