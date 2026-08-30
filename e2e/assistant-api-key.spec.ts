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
 * Setting the OpenAI key from inside the app (M10, Story #300, DDR-0105; reshaped by M11, Story
 * #309, ADR-0011).
 *
 * `lib/assistantKey.test.ts` holds the wording, `services/assistant/apiKeyService.test.ts` holds
 * what may be saved, and `repositories/assistant/aiGateway.test.ts` holds the precedence between
 * the two sources — at the wire, by reading the `Authorization` header a request actually carried.
 * What none of them can reach is the claim the story is really about: that a key typed into the
 * running app **reaches the assistant with no restart**, **survives the process ending**, and that
 * the field **is not offered again once there is a key** — three facts about a real SQLite file
 * and a real main process.
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
 * Whether the launched app has an environment key, **stated rather than inherited** — a rule this
 * spec depends on twice over: an inherited `OPENAI_API_KEY` from a developer's shell would silently
 * outrank every key saved below and turn the whole file into a test of the wrong branch.
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
const saveKey = (page: Page) => view(page).getByRole('button', { name: 'Save key' })

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
    await expect(view(page).getByRole('heading', { name: 'No OpenAI API key' })).toBeVisible()
    await expect(saveKey(page)).toBeDisabled()
  })

  /** Where the key is kept, and what that means, on the panel that asks for it. */
  test('says the store is local and unencrypted before taking a key', async () => {
    await expect(view(page).getByText(/unencrypted/)).toBeVisible()
  })

  /**
   * ADR-0011's sentence, in the app. Supplying the key **is** the authorization now, so the field
   * that takes it is the last place the owner is told that questions go to OpenAI — the consent
   * panel that used to say it at length is gone, and the record accepts that trade.
   */
  test('says on the field that asking sends the figures to OpenAI', async () => {
    await expect(view(page).getByText(/sent to OpenAI/)).toBeVisible()
  })

  /** A bad paste is named rather than stored, and what was typed is left there to be fixed. */
  test('names what is wrong with a paste instead of storing it', async () => {
    await keyField(page).fill('sk-two words')
    await saveKey(page).click()

    await expect(view(page).getByText(/Paste the key on its own/)).toBeVisible()
    await expect(keyField(page)).toHaveValue('sk-two words')
    // Nothing was stored, so the field is still the thing on the page.
    await expect(view(page).getByRole('heading', { name: 'No OpenAI API key' })).toBeVisible()
  })

  /**
   * The story's two criteria in one act: **no restart**, and **the field goes away**. The panel
   * that named a blocker a moment ago is not replaced by a panel reporting success — it is not
   * there at all, and the page is the chat (ADR-0011).
   */
  test('takes a key and puts the field away, without a restart', async () => {
    await keyField(page).fill(SAVED_KEY)
    await saveKey(page).click()

    await expect(view(page).getByRole('heading', { name: 'No OpenAI API key' })).toHaveCount(0)
    await expect(keyField(page)).toHaveCount(0)
    await expect(view(page).getByText('Ask about your portfolio')).toBeVisible()
  })

  /**
   * **Never displayed back.** Nothing repopulates the field, because nothing can: no channel
   * returns a key or a fragment of one. Asserted against the whole page rather than the field
   * alone — a "your key ends in …" hint elsewhere would pass a narrower check.
   */
  test('never shows the key again, anywhere on the page', async () => {
    await expect(page.locator('body')).not.toContainText(SAVED_KEY)
    await expect(page.locator('body')).not.toContainText(SAVED_KEY.slice(-8))
  })

  /**
   * The whole of what #309 removed, pinned as an absence: no decision to make, no list to read,
   * and no control that takes a key back out.
   */
  test('asks for no decision and offers no way to remove the key', async () => {
    await expect(view(page).getByText('What would be sent')).toHaveCount(0)
    await expect(view(page).getByRole('button', { name: /Allow the assistant/ })).toHaveCount(0)
    await expect(view(page).getByRole('button', { name: /^(Remove|Withdraw)/ })).toHaveCount(0)
  })
})

/**
 * The half that only exists *between* launches: the same user-data directory, the same SQLite
 * file, and therefore the same stored key.
 */
test.describe('across launches', () => {
  test('the key survives the process ending, and the field stays away', async () => {
    const userDataDir = freshUserDataDir()

    const first = await launch(userDataDir)
    await keyField(first.page).fill(SAVED_KEY)
    await saveKey(first.page).click()
    await expect(keyField(first.page)).toHaveCount(0)
    await first.app.close()

    const second = await launch(userDataDir)
    await expect(keyField(second.page)).toHaveCount(0)
    await expect(view(second.page).getByText('Ask about your portfolio')).toBeVisible()
    await second.app.close()
  })

  /**
   * The precedence rule, on screen — and the one state where the app still says anything about a
   * key that is present.
   *
   * The owner saved a key, then set `OPENAI_API_KEY` in their environment. Theirs is kept and is
   * not the one that will be spent. An app that reported nothing here would be running on a key
   * the owner has no reason to know about, which is the failure a stated order exists to prevent
   * (DDR-0105). It says so and offers nothing to press: removing a key is not something this app
   * does (ADR-0011).
   */
  test('says the environment wins over the key saved here, and offers nothing to do about it', async () => {
    const userDataDir = freshUserDataDir()

    const first = await launch(userDataDir)
    await keyField(first.page).fill(SAVED_KEY)
    await saveKey(first.page).click()
    await expect(keyField(first.page)).toHaveCount(0)
    await first.app.close()

    const second = await launch(userDataDir, 'sk-from-the-environment-0002')
    await expect(
      view(second.page).getByRole('heading', { name: 'Using a key from your environment' }),
    ).toBeVisible()
    await expect(view(second.page).getByText(/Your saved key is kept and is not being used/)).toBeVisible()
    await expect(keyField(second.page)).toHaveCount(0)
    await expect(view(second.page).getByRole('button', { name: 'Remove key' })).toHaveCount(0)
    await second.app.close()
  })
})

/**
 * The state a developer's clone rests in: a key in `.env` or the shell, nothing saved in the app.
 * There is nothing for the owner to do, so there is nothing on the page but the chat.
 */
test.describe('with a key in the environment and none saved', () => {
  test('draws no key surface at all', async () => {
    const { app, page } = await launch(freshUserDataDir(), 'sk-from-the-environment-0003')

    await expect(keyField(page)).toHaveCount(0)
    await expect(view(page).getByRole('heading', { name: /key/i })).toHaveCount(0)
    await expect(view(page).getByText('Ask about your portfolio')).toBeVisible()

    await app.close()
  })
})
