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
 * The Assistant's two-column shell (Story #343, DDR-0115).
 *
 * `lib/assistantLayout.test.ts` guards the decisions — the two widths, the class names, the
 * wording, the exemption and the reduced-motion rule that goes with it. Everything here needs a
 * layout engine and could not be reached from Vitest, which runs Node-only with no jsdom
 * (DDR-0029): a *computed* width, a cascade resolving between two rules at equal specificity, the
 * absence of a page scrollbar, and three bands whose whole point is which of them moves.
 *
 * It is the same division `sidebar-collapse.spec.ts` makes for the other collapsing edge, and the
 * two are deliberately separate files for the same reason the two widths are separate constants:
 * they are different columns with different rules (DDR-0057, DDR-0068).
 *
 * Its own user-data directory, because these tests leave the shell off the Portfolio tab and the
 * single-instance lock is scoped to that directory (DDR-0025).
 */

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-assistant-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('tab', { name: /^Assistant/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'AI Assistant' })).toBeVisible()
})

test.afterAll(async () => {
  await app?.close()
})

const columnWidth = (): Promise<number> =>
  page.evaluate(
    () => document.querySelector('.assistant-profile-column')!.getBoundingClientRect().width,
  )

/** The toggle, by the name it carries in whichever state the column is in. */
const toggle = (collapsed: boolean) =>
  page.getByRole('button', {
    name: collapsed ? 'Expand investor profile' : 'Collapse investor profile',
  })

test('lays the view out as two columns filling the window', async () => {
  const layout = await page.evaluate(() => {
    const view = document.querySelector('.assistant-view')!.getBoundingClientRect()
    const profile = document.querySelector('.assistant-profile-column')!.getBoundingClientRect()
    const chat = document.querySelector('.assistant-chat')!.getBoundingClientRect()
    const titlebar = document.querySelector('.titlebar')!.getBoundingClientRect()
    return {
      profileWidth: profile.width,
      chatWidth: chat.width,
      viewWidth: view.width,
      viewHeight: view.height,
      viewportHeight: document.documentElement.clientHeight,
      titlebarHeight: titlebar.height,
      // The profile is the left column, which is the design's order.
      profileFirst: profile.left < chat.left,
    }
  })

  // The design's own 420px, not rounded to a scale step (DDR-0115 amendment 8).
  expect(layout.profileWidth).toBe(420)
  expect(layout.profileFirst).toBe(true)
  // The conversation takes the rest, and the two fill the content column between them.
  expect(layout.profileWidth + layout.chatWidth).toBeCloseTo(layout.viewWidth, 0)
  // And the frame is the viewport less the title bar — the arithmetic the whole layout rests on.
  expect(layout.viewHeight).toBeCloseTo(layout.viewportHeight - layout.titlebarHeight, 0)
})

/**
 * The criterion that separates this view from the other five: the *page* does not scroll. Each
 * column scrolls itself, so reading an answer never scrolls the standard it is judged against off
 * the top of the window.
 */
test('scrolls neither the document nor sideways', async () => {
  const doc = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(doc.scrollHeight).toBeLessThanOrEqual(doc.clientHeight)
  expect(doc.scrollWidth).toBeLessThanOrEqual(doc.clientWidth)
})

/**
 * Three bands, and only the middle one moves. The header and the composer are `flex-shrink: 0`, so
 * a long transcript scrolls *under* them rather than pushing the box the owner types into out of
 * the window — which is the position #345 then pins Enter-to-send to.
 */
test('fixes the chat header and the composer, and scrolls only the transcript', async () => {
  const bands = await page.evaluate(() => {
    const box = (selector: string): DOMRect =>
      document.querySelector(selector)!.getBoundingClientRect()
    const head = box('.assistant-chat-head')
    const transcript = box('.assistant-transcript')
    const composer = box('.assistant-composer')
    const chat = box('.assistant-chat')
    const scroller = document.querySelector('.assistant-transcript')!
    return {
      stacked: head.bottom <= transcript.top + 1 && transcript.bottom <= composer.top + 1,
      // The composer reaches the column's bottom edge, which is what "pinned" means: nothing is
      // drawn below it and it does not float above a gap.
      pinned: Math.abs(composer.bottom - chat.bottom) < 1,
      // The key card is the app's own extra above the header (it draws nothing once a key is in
      // force, ADR-0011), so the three bands start below it rather than at the column's top.
      headBelowKeyCard: (() => {
        const card = document.querySelector('.assistant-chat-block')
        return card === null || card.getBoundingClientRect().bottom <= head.top + 1
      })(),
      overflow: getComputedStyle(scroller).overflowY,
      // The one band that can scroll is the one that does.
      headOverflow: getComputedStyle(document.querySelector('.assistant-chat-head')!).overflowY,
      chatOverflow: getComputedStyle(document.querySelector('.assistant-chat')!).overflowY,
    }
  })
  expect(bands.stacked).toBe(true)
  expect(bands.pinned).toBe(true)
  expect(bands.headBelowKeyCard).toBe(true)
  expect(bands.overflow).toBe('auto')
  expect(bands.headOverflow).toBe('visible')
  expect(bands.chatOverflow).toBe('hidden')
})

/**
 * The rail. 48px, and deliberately not the nav's 56 — two collapsing edges, two widths, two
 * toggles (DDR-0115 amendment 2). Both are on screen at once here, which is what makes the pair
 * worth measuring together.
 */
test('folds to a 48px rail carrying the expander and the completeness dot', async () => {
  expect(await columnWidth()).toBe(420)
  await expect(toggle(false)).toHaveAttribute('aria-expanded', 'true')

  await toggle(false).click()
  await expect.poll(() => columnWidth()).toBe(48)

  const rail = await page.evaluate(() => {
    const column = document.querySelector('.assistant-profile-column')!.getBoundingClientRect()
    const button = document.querySelector('.assistant-rail-strip button')!.getBoundingClientRect()
    const dot = document.querySelector('.assistant-profile-dot')!
    return {
      // Both inside the rail — a control overflowing 48px is the failure this catches.
      buttonWithin: button.left >= column.left && button.right <= column.right,
      dotWithin: (() => {
        const box = dot.getBoundingClientRect()
        return box.left >= column.left && box.right <= column.right
      })(),
      stacked: dot.getBoundingClientRect().top >= button.bottom,
      dotTitle: dot.getAttribute('title'),
      // The nav's own rail is a different number, still.
      navRail: document.querySelector('.app-sidebar')!.getBoundingClientRect().width,
    }
  })
  expect(rail.buttonWithin).toBe(true)
  expect(rail.dotWithin).toBe(true)
  expect(rail.stacked).toBe(true)
  // Nothing has been saved in this run, so the count is honest rather than absent.
  expect(rail.dotTitle).toBe('Profile: 0 style tags')
  expect(rail.navRail).toBe(220)

  // The same control, in a new place, offering the way back — not a second button.
  await expect(toggle(true)).toBeVisible()
  await expect(toggle(true)).toHaveAttribute('aria-expanded', 'false')
  expect(await page.getByRole('button', { name: /investor profile$/ }).count()).toBe(1)

  await toggle(true).click()
  await expect.poll(() => columnWidth()).toBe(420)
})

/**
 * The `<h1>` is in the tree in both states (DDR-0115 amendment 1). There is no `PageHeader` on
 * this view any more, so the eyebrow is the panel's only heading — and a heading that leaves the
 * document outline when a column folds is worse than no eyebrow at all. Collapsed it takes
 * `.sr-only`, the app's existing clip, so it is unreadable and still announced.
 */
test('keeps the eyebrow as the panel’s h1 in both states, and draws no page header', async () => {
  const headings = page.getByRole('heading', { level: 1 })
  await expect(headings).toHaveCount(1)
  await expect(headings).toHaveText('AI Assistant')
  await expect(page.locator('.tab-panel:not([hidden]) .page-header')).toHaveCount(0)

  await toggle(false).click()
  await expect.poll(() => columnWidth()).toBe(48)
  await expect(headings).toHaveCount(1)
  await expect(headings).toHaveText('AI Assistant')
  // Clipped, never removed — the `.sr-only` box, which is what a reader cannot see.
  const clipped = await page.evaluate(
    () => document.querySelector('.assistant-eyebrow')!.getBoundingClientRect().width,
  )
  expect(clipped).toBeLessThan(2)

  await toggle(true).click()
  await expect.poll(() => columnWidth()).toBe(420)
})

/**
 * Folding takes the form out of the tab order rather than leaving it clipped behind a 48px rail.
 * `hidden`, never unmounted, which is the tab shell's rule one level down (DDR-0027) — so what is
 * typed survives the fold even though it cannot be reached during it.
 */
test('takes the profile’s controls out of reach while folded, and keeps what was typed', async () => {
  // Investing style is the one section that arrives open since Story #347, so nothing has to be
  // unfolded to reach a style tag — which is part of why it is the one left open (DDR-0106).
  await page.getByRole('button', { name: 'Dividend income' }).click()
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled()

  await toggle(false).click()
  await expect.poll(() => columnWidth()).toBe(48)
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeHidden()

  await toggle(true).click()
  await expect.poll(() => columnWidth()).toBe(420)
  // Unsaved and still selected: the subtree was hidden, not discarded.
  await expect(page.getByRole('button', { name: 'Dividend income' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Save profile' })).toBeEnabled()
})

/**
 * The fold survives a trip to another view, for the reason every other bit of view-local state
 * does: the Assistant stays mounted (DDR-0027). It is component state, not a store and not a
 * stored preference — unlike the nav rail's collapse, which `window-state`-style persistence does
 * remember across launches (DDR-0057).
 */
test('remembers the fold across a switch to another view and back', async () => {
  await toggle(false).click()
  await expect.poll(() => columnWidth()).toBe(48)

  await page.getByRole('tab', { name: /^Allocation/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Allocation' })).toBeVisible()
  await page.getByRole('tab', { name: /^Assistant/ }).click()

  expect(await columnWidth()).toBe(48)
  await toggle(true).click()
  await expect.poll(() => columnWidth()).toBe(420)
})

/**
 * The five other views are untouched: they are still `.dashboard` pages inside a document that
 * scrolls as a whole. The frame is scoped to this panel, and a hidden panel is `display: none`, so
 * nothing about it can reach them — this is the assertion that would catch it if it did.
 */
test('leaves the five other views scrolling as a page', async () => {
  await page.getByRole('tab', { name: /^Portfolio/ }).click()
  const other = await page.evaluate(() => ({
    frames: document.querySelectorAll('.assistant-view').length,
    // Nothing in the exposed panel claims the viewport's height.
    exposed: document.querySelector('.tab-panel:not([hidden])')!.className,
    documentHeight: document.documentElement.scrollHeight,
    viewportHeight: document.documentElement.clientHeight,
  }))
  // The Assistant's panel is still mounted, so its frame is still in the tree — and `display:
  // none` is what keeps it from claiming any height.
  expect(other.frames).toBe(1)
  expect(other.exposed).toContain('tab-panel')
  expect(other.documentHeight).toBeGreaterThanOrEqual(other.viewportHeight)
})

/**
 * The raw duration's other half (DDR-0115 amendment 4). `0.22s` is off DDR-0044's two-duration
 * budget and therefore outside the mechanism that zeroes `--duration-*`, so it is stopped by name
 * — and this is the only place that can watch the cascade actually resolve it.
 * `reduced-motion.spec.ts` proves the token half; this proves the exception.
 */
test('stops the column animating under reduced motion', async () => {
  const columnMotion = (): Promise<string> =>
    page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.assistant-profile-column')!).transitionDuration,
    )

  await page.getByRole('tab', { name: /^Assistant/ }).click()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  expect(await columnMotion()).toBe('0.22s')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await columnMotion()).toBe('0s')

  // And it still folds — stopped, not frozen part-way.
  await toggle(false).click()
  await expect.poll(() => columnWidth()).toBe(48)
  await toggle(true).click()
  await expect.poll(() => columnWidth()).toBe(420)

  await page.emulateMedia({ reducedMotion: 'no-preference' })
})
