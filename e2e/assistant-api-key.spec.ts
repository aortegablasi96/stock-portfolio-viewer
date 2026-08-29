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
 * Setting the OpenAI key from inside the app (M10, Story #300, DDR-0105).
 *
 * `lib/assistantKey.test.ts` holds the wording, `services/assistant/apiKeyService.test.ts` holds
 * what may be saved, and `repositories/assistant/aiGateway.test.ts` holds the precedence between
 * the two sources — at the wire, by reading the `Authorization` header a request actually carried.
 * What none of them can reach is the claim the story is really about: that a key typed into the
 * running app **reaches the assistant with no restart**, **survives the process ending**, and
 * **can be taken back out again** — three facts about a real SQLite file and a real main process.
 *
 * **No question is ever asked here, and none can be.** Saving a key opens no socket; the one
 * channel that reaches OpenAI is `assistant:ask`, and nothing below presses that button. The keys
 * pasted in are strings that were never valid anywhere.
 *
 * Its own user-data directory, both because these tests need a store that starts empty and because
 * the single-instance lock is scoped to that directory (DDR-0025).
 */

function freshUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'spv-e2e-api-key-'))
}

/**
 * Whether the launched app has an environment key, **stated rather than inherited** — the rule
 * `assistant-consent.spec.ts` sets, and one this spec depends on twice over: an inherited
 * `OPENAI_API_KEY` from a developer's shell would silently outrank every key saved below and turn
 * the whole file into a test of the wrong branch.
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

const keyField = (page: Page) => view(page).getByLabel('OpenAI API key')
const saveKey = (page: Page) => view(page).getByRole('button', { name: /^(Save|Replace) key$/ })

const SAVED_KEY = 'sk-e2e-never-valid-anywhere-0001'

test.describe('a key set from inside the app', () => {
  let app: ElectronApplication
  let page: Page

  test.beforeAll(async () => {
    ;({ app, page } = await launch(freshUserDataDir()))
  })

  test.afterAll(async () => {
    await app?.close()
  })

  test('offers a key field with no key anywhere, and refuses to send an empty one', async () => {
    await expect(view(page).getByRole('heading', { name: 'No API key' })).toBeVisible()
    await expect(view(page).getByText('No key', { exact: true })).toBeVisible()
    await expect(saveKey(page)).toBeDisabled()
  })

  /** Where the key is kept, and what that means, on the panel that asks for it. */
  test('says the store is local and unencrypted before taking a key', async () => {
    await expect(view(page).getByText(/unencrypted/)).toBeVisible()
  })

  /**
   * The story's first criterion, and the one `.env` could not satisfy: **no restart**. The panel
   * goes from naming a blocker to reporting the assistant ready inside the same process.
   */
  test('takes a key and reports the assistant ready, without a restart', async () => {
    await keyField(page).fill(SAVED_KEY)
    await saveKey(page).click()

    await expect(view(page).getByRole('heading', { name: 'Using the key you saved here' })).toBeVisible()
    await expect(view(page).getByText('Key set', { exact: true })).toBeVisible()
    await expect(view(page).getByRole('heading', { name: 'No OpenAI API key' })).toHaveCount(0)
  })

  /**
   * **Never displayed back in full.** The field is emptied on save and nothing repopulates it,
   * because nothing can: no channel returns a key or a fragment of one. Asserted against the whole
   * page rather than the field alone — a "your key ends in …" hint elsewhere on the panel would
   * pass a narrower check.
   */
  test('never shows the key again, anywhere on the page', async () => {
    await expect(keyField(page)).toHaveValue('')
    await expect(page.locator('body')).not.toContainText(SAVED_KEY)
    await expect(page.locator('body')).not.toContainText(SAVED_KEY.slice(-8))
  })

  /**
   * The criterion in its own words: *the assistant reports itself ready*, in the same process that
   * had no key a moment ago. The gate above the key panel is the thing that says it, and it is the
   * one place in the app where both blockers being clear is a single sentence.
   *
   * Consent is granted here and no question is ever asked — that button is never pressed, and the
   * key saved above was never valid anywhere.
   */
  test('the gate above reports the assistant allowed to run, in the same process', async () => {
    await view(page).getByRole('button', { name: /^Allow the assistant/ }).click()

    await expect(view(page).getByText('The assistant is allowed to run')).toBeVisible()
    await expect(view(page).getByText('Allowed', { exact: true })).toBeVisible()
  })

  /** A bad paste is named rather than stored, and what was typed is left there to be fixed. */
  test('names what is wrong with a paste instead of storing it', async () => {
    await keyField(page).fill('sk-two words')
    await saveKey(page).click()

    await expect(view(page).getByText(/Paste the key on its own/)).toBeVisible()
    await expect(keyField(page)).toHaveValue('sk-two words')
    // Still the previously saved key: a refused paste replaces nothing.
    await expect(view(page).getByRole('heading', { name: 'Using the key you saved here' })).toBeVisible()

    await keyField(page).fill('')
  })
})

/**
 * The half that only exists *between* launches. Like `assistant-consent.spec.ts`, these start the
 * app more than once against one user-data directory: the same SQLite file, and therefore the same
 * stored key.
 */
test.describe('across launches', () => {
  test('the key survives the process ending, and can be taken back out', async () => {
    const userDataDir = freshUserDataDir()

    const first = await launch(userDataDir)
    await keyField(first.page).fill(SAVED_KEY)
    await saveKey(first.page).click()
    await expect(
      view(first.page).getByRole('heading', { name: 'Using the key you saved here' }),
    ).toBeVisible()
    await first.app.close()

    const second = await launch(userDataDir)
    await expect(
      view(second.page).getByRole('heading', { name: 'Using the key you saved here' }),
    ).toBeVisible()
    await expect(keyField(second.page)).toHaveValue('')

    // Removing is the in-place confirm the app uses everywhere — no modal (DDR-0012).
    await view(second.page).getByRole('button', { name: 'Remove key' }).click()
    await view(second.page).getByRole('button', { name: 'Yes, remove it' }).click()
    await expect(view(second.page).getByRole('heading', { name: 'No API key' })).toBeVisible()
    await second.app.close()

    // A removal is as durable as a save, and returns the assistant to the state a fresh clone
    // rests in rather than to a key that is merely blank.
    const third = await launch(userDataDir)
    await expect(view(third.page).getByRole('heading', { name: 'No API key' })).toBeVisible()
    await expect(view(third.page).getByText('No key', { exact: true })).toBeVisible()
    await third.app.close()
  })
})

/**
 * The precedence rule, on screen.
 *
 * This is the state that would otherwise be silent: the owner has saved a key, the environment
 * also supplies one, and the environment's is the one that will be spent. An app that simply
 * reported itself ready would be telling the truth about the wrong key.
 */
test.describe('with a key in the environment as well', () => {
  test('says the environment wins, and that the saved key is kept and unused', async () => {
    const { app, page } = await launch(freshUserDataDir(), 'sk-from-the-environment-0002')

    await expect(
      view(page).getByRole('heading', { name: 'Using a key from your environment' }),
    ).toBeVisible()
    await expect(view(page).getByText(/takes precedence over a key saved here/)).toBeVisible()
    // Nothing is stored yet, so there is nothing to remove.
    await expect(view(page).getByRole('button', { name: 'Remove key' })).toHaveCount(0)

    await keyField(page).fill(SAVED_KEY)
    await saveKey(page).click()

    // Saved, and said out loud that it is not the one in use.
    await expect(view(page).getByText(/Your saved key is kept and is not being used/)).toBeVisible()
    await expect(view(page).getByRole('button', { name: 'Remove key' })).toBeVisible()

    await app.close()
  })
})
