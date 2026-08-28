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
 * The consent gate (M10, Story #283, DDR-0097).
 *
 * `lib/assistantGate.test.ts` holds the wording and `services/assistant/*.test.ts` hold the rule
 * that nothing reaches the gateway without consent. What neither can reach is the pair of claims
 * that are only true of a running app: that the decision **survives the process ending**, and that
 * the disclosure is on screen *before* the owner can agree to it rather than behind the button
 * that agrees.
 *
 * Its own user-data directory, both because these tests need a store that starts empty and because
 * the single-instance lock is scoped to that directory (DDR-0025).
 */

function freshUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'spv-e2e-consent-'))
}

/**
 * Whether the launched app has an API key, **stated rather than inherited**.
 *
 * A built app reads `OPENAI_API_KEY` from the environment it was started in, so without this the
 * result would depend on whether the developer's shell happened to export one — a test that passes
 * for a reason it does not declare, and fails on someone else's machine. Both states are exercised
 * below precisely because the story's criterion is that the two blockers stay distinct.
 */
async function launch(
  userDataDir: string,
  apiKey = '',
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
    env: { ...process.env, OPENAI_API_KEY: apiKey },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('tab', { name: 'Assistant' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
  return { app, page }
}

/** The panel that is currently exposed — hidden panels are out of the accessibility tree. */
const view = (page: Page) => page.locator('.tab-panel:not([hidden])')

const allow = (page: Page) => view(page).getByRole('button', { name: /^Allow the assistant/ })

test.describe('within one launch', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    ;({ app, page } = await launch(freshUserDataDir()))
  })

  test.afterAll(async () => {
    await app?.close()
  })

  /**
   * The criterion, in the order it has to hold: the owner reads what would be sent **before** the
   * control that agrees to it, not after pressing it. A disclosure behind its own consent button
   * is not a disclosure.
   */
  test('shows what would be sent before offering to send it', async () => {
    await expect(view(page).getByText('What would be sent')).toBeVisible()
    await expect(view(page).getByText('Your question', { exact: true })).toBeVisible()
    await expect(view(page).getByText('How your portfolio is divided')).toBeVisible()
    await expect(allow(page)).toBeVisible()
  })

  /** The destination is named, not implied — and it says this is the only feature that does it. */
  test('names where the data goes', async () => {
    const destination = view(page).getByText('Where it goes:')
    await expect(destination).toBeVisible()
    await expect(view(page).getByText(/OpenAI, in the United States/)).toBeVisible()
  })

  /**
   * The distinction the story asks the disclosure to draw: a weight says nothing about how much
   * money is involved, and three of the five categories send no money at all.
   */
  test('says which categories involve amounts of money', async () => {
    await expect(view(page).getByText('Percentages only').first()).toBeVisible()
    await expect(view(page).getByText('Amounts of money').first()).toBeVisible()
  })

  test('reports that nothing is being sent until the decision is made', async () => {
    await expect(view(page).getByText('Not sending')).toBeVisible()
  })

  /** Refusing is the resting state, and it leaves every other view working. */
  test('leaves the rest of the app fully usable while consent is absent', async () => {
    await page.getByRole('tab', { name: 'Allocation' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Allocation' })).toBeVisible()

    await page.getByRole('tab', { name: 'Profile' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Investor profile' })).toBeVisible()

    await page.getByRole('tab', { name: 'Assistant' }).click()
    await expect(allow(page)).toBeVisible()
  })

  /**
   * Granting moves to the *next* blocker rather than to a working assistant, and says so. Without
   * a key in this run the panel names that fact — which is the acceptance criterion that the two
   * blockers stay distinct and the owner is told which applies.
   */
  test('names the next blocker after consent is given, rather than claiming to be ready', async () => {
    await allow(page).click()

    await expect(view(page).getByText('No OpenAI API key')).toBeVisible()
    await expect(view(page).getByText('OPENAI_API_KEY')).toBeVisible()
    await expect(view(page).getByText('Not sending')).toBeVisible()
    await expect(allow(page)).toHaveCount(0)
  })

  test('reports when the decision was made', async () => {
    await expect(view(page).getByText(/^You allowed this on /)).toBeVisible()
  })

  /** Withdrawing is the in-place confirm the app uses everywhere — no modal (DDR-0012). */
  test('withdraws in place, and returns to the decision', async () => {
    await view(page).getByRole('button', { name: 'Withdraw permission' }).click()
    await expect(view(page).getByText(/stops sending anything immediately/)).toBeVisible()

    await view(page).getByRole('button', { name: 'Yes, withdraw it' }).click()
    await expect(allow(page)).toBeVisible()
    await expect(view(page).getByText(/^You allowed this on /)).toHaveCount(0)
  })
})

/**
 * The half that only exists *between* launches. Like `window-state.spec.ts`, these start the app
 * more than once against a single user-data directory: the same SQLite file, and therefore the
 * same stored decision.
 */
test.describe('across launches', () => {
  test('the decision survives the process ending, in both directions', async () => {
    const userDataDir = freshUserDataDir()

    const first = await launch(userDataDir)
    await expect(allow(first.page)).toBeVisible()
    await allow(first.page).click()
    await expect(view(first.page).getByText(/^You allowed this on /)).toBeVisible()
    await first.app.close()

    const second = await launch(userDataDir)
    // Still allowed, and not asked again.
    await expect(view(second.page).getByText(/^You allowed this on /)).toBeVisible()
    await expect(allow(second.page)).toHaveCount(0)

    await view(second.page).getByRole('button', { name: 'Withdraw permission' }).click()
    await view(second.page).getByRole('button', { name: 'Yes, withdraw it' }).click()
    await expect(allow(second.page)).toBeVisible()
    await second.app.close()

    // A withdrawal is as durable as a grant: "said no" and "never asked" are the same state, and
    // both mean nothing may be sent.
    const third = await launch(userDataDir)
    await expect(allow(third.page)).toBeVisible()
    await expect(view(third.page).getByText(/^You allowed this on /)).toHaveCount(0)
    await third.app.close()
  })
})

/**
 * The fourth gate state, which needs a key to reach at all.
 *
 * No request is made here and none can be: this story ships no channel that reaches OpenAI. What
 * is being checked is that the panel stops naming blockers once there are none — the difference
 * between "allowed" and "allowed but still not able to run" is exactly the distinction the story
 * asks the two states to keep.
 */
test.describe('with a key present', () => {
  test('reports itself as allowed to run once both are in place', async () => {
    const { app, page } = await launch(freshUserDataDir(), 'sk-not-a-real-key-and-never-used')

    await expect(page.locator('.tab-panel:not([hidden])').getByText('No OpenAI API key')).toHaveCount(0)
    await expect(allow(page)).toBeVisible()

    await allow(page).click()
    await expect(view(page).getByText('The assistant is allowed to run')).toBeVisible()
    await expect(view(page).getByText('Allowed', { exact: true })).toBeVisible()
    await expect(view(page).getByRole('button', { name: 'Withdraw permission' })).toBeVisible()

    await app.close()
  })
})
