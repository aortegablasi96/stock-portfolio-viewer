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
 * The Assistant's question box (M10, Story #284, DDR-0098; M11, Stories #309 and #310,
 * ADR-0011, DDR-0108).
 *
 * `lib/assistantAsk.test.ts` holds every state's wording and `lib/assistantContext.test.ts` holds
 * the grounding. What neither can reach is what this file is for: a real keystroke arriving at a
 * real window with a **textarea** in it, and a panel that has been hidden and shown again.
 *
 * The story names two accelerator facts as already true — `viewShortcutIndex` covers digits 1–9,
 * and `isTextEntry` already lists `TEXTAREA` — and asks for both to be **pinned rather than
 * assumed**, because a textarea in this app is new. That is the substance of this suite.
 *
 * Its own user-data directory: these tests need a store that starts empty, and the single-instance
 * lock is scoped to that directory (DDR-0025). The key passed in was never valid anywhere and no
 * question is ever asked, so nothing can reach OpenAI from here — what is under test is the
 * surface, the accelerators and the states, none of which sends anything.
 */

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-ask-'))}`],
    // Stated rather than inherited: without this the run would depend on whether the developer's
    // shell happened to export a key, which is a test that passes for a reason it does not declare.
    env: { ...process.env, OPENAI_API_KEY: 'sk-not-a-real-key-and-never-used' },
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/** The panel that is currently exposed — hidden panels are out of the accessibility tree. */
const view = (): ReturnType<Page['locator']> => page.locator('.tab-panel:not([hidden])')

/** The id of the element currently holding focus. */
const focusedId = (): Promise<string | undefined> => page.evaluate(() => document.activeElement?.id)

const questionBox = () => view().getByLabel('Your question')

/** The disclosure that holds the investor profile, folded above the conversation (Story #310). */
const profileTrigger = () => view().getByRole('button', { name: 'Your investor profile' })

test('Ctrl+6 reaches the Assistant from a focus outside the sidebar', async () => {
  await page.locator('#panel-portfolio').focus()
  await page.keyboard.press('Control+6')

  await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-assistant')
  // Focus lands on the destination row: a roving `tabindex` has just taken focusability off the
  // row being left, and the panel focus was standing in is now `hidden` (DDR-0083).
  expect(await focusedId()).toBe('tab-assistant')
  await expect(view().getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
})

test('the row is a full member of the tabs pattern, not a styled button', async () => {
  const tab = page.getByRole('tab', { name: /^Assistant/ })
  await expect(tab).toHaveAttribute('aria-controls', 'panel-assistant')
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  // `aria-controls` on the selected tab only — an unvisited tab has no panel to name.
  await expect(page.getByRole('tab', { name: /^Trades/ })).not.toHaveAttribute(
    'aria-controls',
    /.*/,
  )
  const panel = page.getByRole('tabpanel')
  await expect(panel).toHaveCount(1)
  await expect(panel).toHaveAttribute('id', 'panel-assistant')
})

/**
 * The whole of what Story #309 removed, pinned as an absence on the page it was removed from
 * (ADR-0011). A key is present, so there is no decision to take, no list to read, and no key panel
 * — the view is the conversation.
 */
test('puts nothing in front of the chat once there is a key', async () => {
  await expect(view().getByText('Ask about your portfolio')).toBeVisible()
  await expect(view().getByText('What would be sent')).toHaveCount(0)
  await expect(view().getByRole('button', { name: /Allow the assistant/ })).toHaveCount(0)
  await expect(view().getByLabel('OpenAI API key')).toHaveCount(0)
})

/**
 * The profile is on this page and folded shut (Story #310, DDR-0108). What the head row keeps
 * saying while it is shut is what the profile currently holds — nothing, on a fresh store — and
 * the form itself is `hidden`, which is what keeps its controls out of the tab order.
 */
test('carries the investor profile above the chat, collapsed', async () => {
  await expect(profileTrigger()).toHaveAttribute('aria-expanded', 'false')
  await expect(view().getByText(/^No profile set/)).toBeVisible()
  await expect(view().getByRole('button', { name: 'Dividend income' })).toBeHidden()
})

/**
 * With the key in place the *next* fact is the grounding, and on a fresh store nothing has been
 * imported, no gateway is running and no profile is set — so there is no context at all, and a
 * question would be answered from training data alone, which is the one thing ADR-0009 says an
 * answer must never quietly be. The state is named; it is not an error, and the box is not simply
 * absent (DDR-0022).
 */
test('with nothing to ground an answer in, says so instead of offering the box', async () => {
  await expect(view().getByText(/nothing for an answer to be grounded in/)).toBeVisible()
  await expect(questionBox()).toHaveCount(0)
})

/**
 * One source is enough. A profile is the owner's own policy and needs neither a gateway nor an
 * import, so stating one opens the box — and the gap that remains is reported beside it rather
 * than left for the owner to infer from an answer shaped by it.
 */
test('opens the box once there is something to ground an answer in', async () => {
  // Stated and saved without leaving the view, which is the merge's own criterion: a profile
  // written here reaches the grounding beside it with no restart and no trip through a second row.
  await profileTrigger().click()
  await expect(profileTrigger()).toHaveAttribute('aria-expanded', 'true')
  await view().getByRole('button', { name: 'Dividend income' }).click()
  await view().getByRole('button', { name: 'Save profile' }).click()
  await expect(view().getByText(/^Profile saved/)).toBeVisible()

  await expect(questionBox()).toBeVisible()
  await expect(view().getByText(/No Flex statements are imported/)).toBeVisible()
  await expect(view().getByText(/nothing for an answer to be grounded in/)).toHaveCount(0)
})

/**
 * The story's own criterion, and the reason this suite exists. `isTextEntry` lists `TEXTAREA`, so
 * both accelerators must decline while a question is being typed — a box that swallowed `Ctrl`+`4`
 * would make the app's navigation stop working wherever the owner happened to be writing.
 */
test.describe('the question box does not swallow the accelerators', () => {
  test.beforeEach(async () => {
    // A profile is what makes the box usable; it was set by the previous test.
    await page.getByRole('tab', { name: /^Assistant/ }).click()
  })

  test('a digit typed into the box does not change the view', async () => {
    await questionBox().focus()
    await page.keyboard.press('Control+4')

    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-assistant')
    expect(await focusedId()).not.toBe('tab-dividends')
  })

  test('Ctrl+Tab typed into the box does not rotate the view', async () => {
    await questionBox().focus()
    await page.keyboard.press('Control+Tab')

    await expect(page.getByRole('tab', { selected: true })).toHaveAttribute('id', 'tab-assistant')
  })
})

/**
 * Seven rows, then six: the rotation wraps over the list's length and nothing counts rows
 * (DDR-0090, DDR-0108). Run from the tablist rather than from the box, which is the previous
 * test's subject.
 */
test('Ctrl+Tab rotates through every row, wrapping at the end', async () => {
  await page.getByRole('tab', { name: 'Portfolio', exact: true }).click()

  const ids = ['portfolio']
  for (let step = 0; step < 6; step++) {
    await page.keyboard.press('Control+Tab')
    ids.push((await focusedId())?.replace('tab-', '') ?? '')
  }

  expect(ids).toEqual([
    'portfolio',
    'performance',
    'allocation',
    'dividends',
    'trades',
    'assistant',
    'portfolio',
  ])
})

test('Ctrl+Shift+Tab rotates the other way, into the Assistant off the top of the list', async () => {
  await page.getByRole('tab', { name: 'Portfolio', exact: true }).click()
  await page.keyboard.press('Control+Shift+Tab')
  expect(await focusedId()).toBe('tab-assistant')
})

/**
 * DDR-0027, which is what makes a conversation possible at all: the view mounts on first visit and
 * then hides rather than unmounting, so what is typed into the box survives a trip elsewhere. The
 * four analytics views get this for their reports; the Assistant gets it for a transcript.
 */
test('what is typed survives switching away and back', async () => {
  await page.getByRole('tab', { name: /^Assistant/ }).click()
  await questionBox().fill('Which sector am I most exposed to?')

  await page.getByRole('tab', { name: 'Allocation' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Allocation' })).toBeVisible()

  await page.getByRole('tab', { name: /^Assistant/ }).click()
  await expect(questionBox()).toHaveValue('Which sector am I most exposed to?')
})

/** Whitespace is not a question, so the action that would send one is not offered. */
test('will not send an empty question', async () => {
  await questionBox().fill('   ')
  await expect(view().getByRole('button', { name: 'Ask' })).toBeDisabled()

  await questionBox().fill('Am I balanced?')
  await expect(view().getByRole('button', { name: 'Ask' })).toBeEnabled()
})

/**
 * The merge's own criteria, and the half no text guard can reach (Story #310, DDR-0108): five
 * disclosures that do not coordinate, and a form that is hidden rather than unmounted — so what
 * has been typed into a section survives folding it away, and survives leaving the view, exactly
 * as the transcript above does (DDR-0027, DDR-0106).
 */
test('each profile section opens and closes on its own', async () => {
  await page.getByRole('tab', { name: /^Assistant/ }).click()
  const style = view().getByRole('button', { name: 'Investing style' })
  const limit = view().getByRole('button', { name: 'Single position size' })

  await expect(style).toHaveAttribute('aria-expanded', 'true')
  await expect(limit).toHaveAttribute('aria-expanded', 'true')

  await style.click()
  await expect(style).toHaveAttribute('aria-expanded', 'false')
  // Opening or closing one says nothing about its siblings: this is the disclosure pattern, not
  // an accordion.
  await expect(limit).toHaveAttribute('aria-expanded', 'true')
  await expect(view().getByRole('button', { name: 'Dividend income' })).toBeHidden()

  await style.click()
  await expect(view().getByRole('button', { name: 'Dividend income' })).toBeVisible()
})

test('an unsaved edit survives folding the section away, and leaving the view', async () => {
  const limit = view().getByRole('button', { name: 'Single position size' })
  await view().getByRole('button', { name: 'Add a limit' }).click()
  // A band, so a half-typed one is not a policy and Save stays unavailable until both ends are
  // stated — the rule `investor-profile.spec.ts` owns, relied on here to make the form dirty.
  await view().getByLabel('At least %').fill('0')
  await view().getByLabel('At most %').fill('12')
  await expect(view().getByRole('button', { name: 'Save profile' })).toBeEnabled()

  // Folded away and back: `hidden`, never unmounted, so nothing is discarded.
  await limit.click()
  await limit.click()
  await expect(view().getByLabel('At most %')).toHaveValue('12')

  await page.getByRole('tab', { name: 'Allocation' }).click()
  await page.getByRole('tab', { name: /^Assistant/ }).click()
  await expect(view().getByLabel('At most %')).toHaveValue('12')
  await expect(view().getByRole('button', { name: 'Save profile' })).toBeEnabled()

  // And the question typed into the box two tests ago is still there beside it.
  await expect(questionBox()).toHaveValue('Am I balanced?')
})

/**
 * The announcement half of the story's accessibility criterion. A live region added at the same
 * moment as its first content announces nothing, so the transcript has to already be in the
 * document before the first question is asked — which a text scan cannot see and this can.
 */
test('the transcript is a live region from the moment the box is usable', async () => {
  const transcript = view().locator('.assistant-turns')
  await expect(transcript).toHaveAttribute('aria-live', 'polite')
  await expect(transcript).toHaveAttribute('aria-atomic', 'false')
})

/**
 * The panel is `hidden` while another tab is selected, which is what takes four mounted-but-
 * invisible views out of the accessibility tree. A live region inside a hidden panel must go with
 * it, or a screen reader would announce an answer on a page the owner is not looking at.
 */
test('the live region goes out of the tree with its panel', async () => {
  await page.getByRole('tab', { name: 'Allocation' }).click()
  await expect(page.locator('#panel-assistant')).toHaveAttribute('hidden', '')
  await expect(page.locator('.tab-panel:not([hidden]) .assistant-turns')).toHaveCount(0)
})
