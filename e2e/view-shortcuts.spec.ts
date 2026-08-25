import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * The view accelerator: `Ctrl` and a view's own digit, from anywhere (Story #254, DDR-0083).
 *
 * Beside `tab-navigation.spec.ts` rather than inside it, and the reason is the assertion this file
 * exists for. The accelerator's whole claim is that it selects *exactly* its destination — that the
 * views it passes over are neither selected nor mounted, unlike arrowing, which activates every row
 * it crosses (DDR-0027, DDR-0029). That is only provable against an app whose analytics views have
 * never been visited, and every test in the neighbouring file leaves four of them mounted. So this
 * suite gets its own instance, its own user-data directory, and an order that spends the untouched
 * state on the first test.
 *
 * None of it is reachable from Vitest: the suite runs in Node with no jsdom, and what is under test
 * here is a real keystroke arriving at a real window and moving real focus. Only the two predicates
 * behind it — which combination is the accelerator, and when it must keep its hands off — are unit
 * tested (`lib/viewShortcut.test.ts`).
 */
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-keys-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/** The id of the element currently holding focus — the only way to assert where a jump landed. */
const focusedId = (): Promise<string | undefined> => page.evaluate(() => document.activeElement?.id)

test('jumps from a focus outside the sidebar, mounting only the destination', async () => {
  // Focus inside the Portfolio panel: outside the tablist, outside the sidebar entirely, and in
  // the panel that is about to be replaced — which is the position the story is about.
  await page.locator('#panel-portfolio').focus()
  expect(await focusedId()).toBe('panel-portfolio')

  // Ctrl+5 is Trades: the far end of the list, four rows away.
  await page.keyboard.press('Control+5')

  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-trades')
  // Exactly its destination. Arrowing there would have selected and mounted Performance,
  // Allocation and Dividends on the way; none of the three exists.
  await expect(page.locator('.tab-panel')).toHaveCount(1)
  await expect(page.locator('#panel-trades')).toHaveCount(1)
  for (const id of ['panel-performance', 'panel-allocation', 'panel-dividends']) {
    await expect(page.locator(`#${id}`)).toHaveCount(0)
  }
})

test('focus lands on the destination row, not on whatever the DOM was left holding', async () => {
  // A roving `tabindex` takes focusability off the row being left, and a `hidden` ancestor blurs
  // its contents to <body> — so a jump that moved nothing would cost the reader their place.
  await page.locator('#panel-trades').focus()
  await page.keyboard.press('Control+2')
  expect(await focusedId()).toBe('tab-performance')

  // And the pattern is intact around it: one exposed panel, `aria-controls` on the selected tab
  // alone, and the roving tabindex re-seated on the row that now holds focus.
  const panel = page.getByRole('tabpanel')
  await expect(panel).toHaveCount(1)
  await expect(panel).toHaveAttribute('id', 'panel-performance')
  await expect(page.getByRole('tab', { name: 'Performance' })).toHaveAttribute(
    'aria-controls',
    'panel-performance',
  )
  await expect(page.getByRole('tab', { name: 'Trades' })).not.toHaveAttribute('aria-controls', /.*/)
  const reachable = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((tab) => (tab as HTMLElement).tabIndex),
  )
  expect(reachable).toEqual([-1, 0, -1, -1, -1])
})

test('the key belongs to the control while text is being entered', async () => {
  // The display-currency `<select>` is a `Field` (DDR-0035) and sits in the sidebar itself, so
  // this is the accelerator declining a keystroke it could easily have taken.
  await page.locator('.app-currency select').focus()
  await page.keyboard.press('Control+4')

  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-performance')
  expect(await focusedId()).not.toBe('tab-dividends')
})

test('the tablist keeps its own keys, and does not answer to the accelerator’s', async () => {
  // A click rather than `.focus()`, and it settles two things this test needs and does not mean
  // to be about. The tablist arrows move from the *selected* tab, so focusing a row without
  // selecting it would ask a different question; and the previous test leaves focus inside the
  // currency field, where the accelerator declines to fire — correctly, and to this test's
  // surprise the first time it was run.
  await page.getByRole('tab', { name: 'Portfolio', exact: true }).click()
  expect(await focusedId()).toBe('tab-portfolio')

  // Arrowing still moves and activates as it goes — the pattern is extended, not replaced.
  await page.keyboard.press('ArrowDown')
  expect(await focusedId()).toBe('tab-performance')

  // And from inside the tablist the accelerator still works, rather than being shadowed by it.
  await page.keyboard.press('Control+1')
  expect(await focusedId()).toBe('tab-portfolio')
  await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName('Portfolio')
})

test('a digit past the last view selects nothing', async () => {
  await page.getByRole('tab', { name: 'Portfolio', exact: true }).click()
  await page.keyboard.press('Control+9')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-portfolio')
  expect(await focusedId()).toBe('tab-portfolio')
})

test('the binding is on screen and in the accessibility tree, and is neither the row’s name', async () => {
  const rows = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].map((tab) => ({
      shortcut: tab.getAttribute('aria-keyshortcuts'),
      title: tab.getAttribute('title'),
      label: tab.querySelector('.app-tab-label')?.textContent,
    })),
  )
  // Written once, in the row's tooltip — the only place the binding appears on screen. The digits
  // were drawn beside each name for one round and withdrawn (DDR-0083); nothing renders one now.
  expect(rows.map((r) => r.title)).toEqual([
    'Portfolio (Ctrl+1)',
    'Performance (Ctrl+2)',
    'Allocation (Ctrl+3)',
    'Dividends (Ctrl+4)',
    'Trades (Ctrl+5)',
  ])
  expect(rows.map((r) => r.shortcut)).toEqual([
    'Control+1 Meta+1',
    'Control+2 Meta+2',
    'Control+3 Meta+3',
    'Control+4 Meta+4',
    'Control+5 Meta+5',
  ])
  await expect(page.locator('.app-tab-key')).toHaveCount(0)

  // And neither statement is the row's name: a `title` is only consulted for an accessible name
  // when an element has no content to take one from, and the label is content.
  for (const { label } of rows) {
    await expect(page.getByRole('tab', { name: label!, exact: true })).toHaveCount(1)
  }
})

test('the collapsed rail keeps the tooltip, and the accelerator with it', async () => {
  await page.getByRole('button', { name: 'Collapse sidebar' }).click()

  // The label is clipped rather than removed, so the row is still named by its own text — and the
  // tooltip, which is now the reader's only visible text on the rail, states the name and the key.
  const portfolio = page.getByRole('tab', { name: 'Portfolio', exact: true })
  await expect(portfolio).toHaveCount(1)
  await expect(portfolio).toHaveAttribute('title', 'Portfolio (Ctrl+1)')
  await expect(portfolio).toHaveAttribute('aria-keyshortcuts', 'Control+1 Meta+1')

  // And it still switches view from the rail.
  await page.locator('#panel-portfolio').focus()
  await page.keyboard.press('Control+3')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-allocation')

  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await expect(page.locator('.app-sidebar')).toHaveCSS('width', '220px')
})

/**
 * The rotation: `Ctrl`+`Tab` to the next view, `Ctrl`+`Shift`+`Tab` to the previous (Story #259,
 * DDR-0090).
 *
 * Here rather than in a file of its own, because it shares the listener, the text-entry guard and
 * the landing spot with the accelerator above — and because the one assertion that needed a
 * pristine app (the first test in this file) has already been spent. What is only provable here is
 * everything about a real `Tab` arriving at a real window: that the app takes it, that
 * `preventDefault` holds the focus move, and that plain `Tab` still hands off to the panel.
 */
/** The role of the element currently holding focus, for asserting that focus left the tablist. */
const focusedRole = (): Promise<string | null | undefined> =>
  page.evaluate(() => document.activeElement?.getAttribute('role'))

test('steps to the next view and back to the previous', async () => {
  await page.getByRole('tab', { name: 'Portfolio', exact: true }).click()

  await page.keyboard.press('Control+Tab')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-performance')

  await page.keyboard.press('Control+Tab')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-allocation')

  await page.keyboard.press('Control+Shift+Tab')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-performance')
})

test('wraps at both ends of the list', async () => {
  // Down off the bottom lands on the first view, up off the top on the last — the tablist's own
  // wrapping rule, reached through the same `stepIndex`.
  await page.keyboard.press('Control+5')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-trades')
  await page.keyboard.press('Control+Tab')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-portfolio')

  await page.keyboard.press('Control+Shift+Tab')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-trades')
})

test('rotates without moving focus as a side effect, and leaves plain Tab alone', async () => {
  // From inside the panel that is about to be hidden — the position the whole binding is about.
  await page.getByRole('tab', { name: 'Portfolio', exact: true }).click()
  await page.locator('#panel-portfolio').focus()
  expect(await focusedId()).toBe('panel-portfolio')

  // The default focus move is suppressed, so focus lands where DDR-0083 puts it: the destination
  // row. Without `preventDefault` this would be the next focusable element inside the panel.
  await page.keyboard.press('Control+Tab')
  expect(await focusedId()).toBe('tab-performance')
  await page.keyboard.press('Control+Shift+Tab')
  expect(await focusedId()).toBe('tab-portfolio')

  // And only for those two. Plain Tab still hands off out of the tablist to the next control in
  // the sidebar — the currency field, since the order is toggle → tabs → currency → panel
  // (DDR-0068) — which is the single-stop move the roving `tabindex` exists to make possible
  // (DDR-0029). The selection does not change, and neither does it on the way back out.
  //
  // The field's id is read rather than written: `Field` generates it with `useId()` (DDR-0035).
  const currencyId = await page.locator('.app-currency select').getAttribute('id')
  expect(currencyId).toBeTruthy()
  await page.keyboard.press('Tab')
  expect(await focusedId()).toBe(currencyId)
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-portfolio')

  await page.getByRole('tab', { name: 'Portfolio', exact: true }).focus()
  await page.keyboard.press('Shift+Tab')
  expect(await focusedRole()).not.toBe('tab')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-portfolio')
})

test('the rotation belongs to the control while text is being entered', async () => {
  // The Epic's standing rule (DDR-0035), and it bites harder here than it does for a digit: inside
  // the currency `<select>`, `Ctrl`+`Tab` is the browser's again, so the view does not change.
  await page.getByRole('tab', { name: 'Portfolio', exact: true }).click()
  await page.locator('.app-currency select').focus()
  await page.keyboard.press('Control+Tab')
  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-portfolio')
})

test('the rotation is disclosed on the list, not on any row, and is not the list’s name', async () => {
  // A binding with no destination has no row to hang a tooltip on, so it hangs on the label that
  // names the whole list — the same mechanism as the rows', one level up.
  await expect(page.locator('.app-nav-label')).toHaveAttribute(
    'title',
    'Ctrl+Tab next view, Ctrl+Shift+Tab previous',
  )
  await expect(page.getByRole('tablist')).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+Tab Control+Shift+Tab',
  )

  // The label is the tablist's `aria-labelledby` target, so the tooltip could have become its
  // name. It does not: an element with content is named by its content.
  await expect(page.getByRole('tablist')).toHaveAccessibleName('Views')

  // And the rows still carry their own digit, unchanged — one disclosure per binding, each at the
  // scope of what it states.
  await expect(page.getByRole('tab', { name: 'Trades' })).toHaveAttribute(
    'aria-keyshortcuts',
    'Control+5 Meta+5',
  )
})
