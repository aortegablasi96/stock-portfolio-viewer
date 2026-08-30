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
 * The investor profile (M10, Story #280, DDR-0094; M11, Story #310, DDR-0108).
 *
 * `lib/investorProfile.test.ts` pins the form's rules and
 * `services/profile/investorProfileService.test.ts` pins storage over a mocked repository. What
 * neither can reach is the pair of claims that are only true of a running app: that the profile
 * **survives the process ending** — the acceptance criterion, and one no mock can evidence — and
 * that a form the owner is typing into behaves like one, Save enabling and disabling as the rules
 * say it should.
 *
 * Since Story #310 it drives the **merged view**: the profile is a disclosure folded above the
 * conversation on the Assistant page rather than a row of its own, so every test here reaches it
 * by opening that disclosure. Nothing else about the form moved, which is the point — the story
 * changed where the five sections are drawn and not one thing about what they store.
 *
 * Its own user-data directory, both because these tests need a store that starts empty and
 * because the single-instance lock is scoped to that directory (DDR-0025).
 */

function freshUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'spv-e2e-profile-'))
}

async function launch(userDataDir: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.getByRole('tab', { name: 'Assistant' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
  // Closed on arrival, and closed again on every launch: the disclosure is uncontrolled and holds
  // its state for the life of the component, not in `app_meta` (DDR-0106). Opening it is how a
  // reader reaches the form, so it is how these tests do.
  await page.getByRole('button', { name: 'Your investor profile' }).click()
  return { app, page }
}

/** The panel that is currently exposed — hidden panels are out of the accessibility tree. */
const view = (page: Page) => page.locator('.tab-panel:not([hidden])')

const save = (page: Page) => view(page).getByRole('button', { name: 'Save profile' })

/** The nth row of a dimension's card, by the heading the card carries. */
const card = (page: Page, heading: string) =>
  view(page).locator('section').filter({ has: page.getByRole('heading', { name: heading }) })

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
   * The page states what it is and where its content comes from. The provenance line is the one
   * that matters: it names no data source, because neither half of this page has one — the profile
   * is the owner's own policy statement, and the conversation below it talks about that statement
   * (ADR-0009, DDR-0108).
   */
  test('sits on a page sourced to the owner rather than to a reading', async () => {
    await expect(view(page).locator('.page-header .source-note')).toHaveText('Set by you')
    // One header for the merged view, not two: the profile brought neither a `<main>` nor an
    // `<h1>` with it.
    await expect(view(page).locator('.page-header')).toHaveCount(1)
    await expect(view(page).getByText('No profile set')).toBeVisible()
  })

  /** A fresh install has nothing to save, so the action that would store nothing is unavailable. */
  test('offers nothing to save until something is stated', async () => {
    await expect(save(page)).toBeDisabled()
  })

  /**
   * A partial profile is valid: no category is mandatory, so a profile of one style tag and
   * nothing else is a profile the app must store.
   */
  test('a style tag alone is enough to save', async () => {
    await view(page).getByRole('button', { name: 'Dividend income' }).click()
    await expect(view(page).getByRole('button', { name: 'Dividend income' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(save(page)).toBeEnabled()

    await save(page).click()
    await expect(view(page).getByText('Profile saved.')).toBeVisible()
    // Saved is the resting state again: there is nothing left that differs from what is stored.
    await expect(save(page)).toBeDisabled()
    await expect(view(page).getByText('1 style tag · 0 targets')).toBeVisible()
  })

  /**
   * The boundary's rule, reaching the owner as a sentence under the row it belongs to rather than
   * as a verdict on the document. Save stays unavailable while it stands.
   *
   * The currency is **typed**, and that is the point: nothing has been imported in this run, so
   * the app knows of no currency at all — and the owner must still be able to state a policy for
   * one they intend to hold. A `<select>` of held terms could express neither (DDR-0094).
   */
  test('an inverted range is refused at the row, and blocks the save', async () => {
    const currency = card(page, 'Currency exposure')
    await currency.getByRole('button', { name: 'Add target' }).click()

    await currency.getByLabel('At least %').fill('60')
    await currency.getByLabel('At most %').fill('40')
    await expect(currency.getByText('Choose a currency.')).toBeVisible()

    await currency.getByLabel('Currency', { exact: true }).fill('CHF')
    await expect(currency.getByText('The minimum must not be above the maximum.')).toBeVisible()
    await expect(save(page)).toBeDisabled()

    // Corrected in place: the fault was the range, and fixing it clears both the message and the
    // block on saving.
    await currency.getByLabel('At most %').fill('80')
    await expect(currency.getByText('The minimum must not be above the maximum.')).toHaveCount(0)
    await expect(save(page)).toBeEnabled()
  })

  /** An added row the owner changes their mind about costs nothing and stores nothing. */
  test('an unwanted row is removed rather than saved', async () => {
    const currency = card(page, 'Currency exposure')
    await currency.getByRole('button', { name: 'Remove the CHF target' }).click()
    await expect(currency.getByText('No currency targets — no policy stated here.')).toBeVisible()
    await expect(save(page)).toBeDisabled()
  })

  /**
   * The concentration ceiling. It is a *band* so that all four targets share one shape, one
   * validator and one control; an owner who cares only about the ceiling leaves the minimum at 0.
   */
  test('the position limit is a band, and a half-typed one is not a policy', async () => {
    const limit = card(page, 'Single position size')
    await limit.getByRole('button', { name: 'Add a limit' }).click()

    await limit.getByLabel('At most %').fill('8')
    await expect(limit.getByText('Enter a minimum and a maximum.')).toBeVisible()
    await expect(save(page)).toBeDisabled()

    await limit.getByLabel('At least %').fill('0')
    await expect(limit.getByText('Enter a minimum and a maximum.')).toHaveCount(0)
    await expect(save(page)).toBeEnabled()

    await save(page).click()
    await expect(view(page).getByText('1 style tag · 1 target')).toBeVisible()
  })

  /** Discard puts the form back on what is stored, without a round trip through the database. */
  test('discarding returns the form to what was stored', async () => {
    const limit = card(page, 'Single position size')
    await limit.getByLabel('At most %').fill('25')
    await expect(save(page)).toBeEnabled()

    await view(page).getByRole('button', { name: 'Discard changes' }).click()
    await expect(limit.getByLabel('At most %')).toHaveValue('8')
    await expect(save(page)).toBeDisabled()
  })
})

/**
 * The half that only exists *between* launches — the acceptance criterion no mocked repository
 * can evidence. Like `window-state.spec.ts`, these start the app more than once against a single
 * user-data directory: the same SQLite file, and therefore the same stored profile.
 */
test.describe('across launches', () => {
  test('the profile survives the process ending, and clearing survives it too', async () => {
    const userDataDir = freshUserDataDir()

    const first = await launch(userDataDir)
    await view(first.page).getByRole('button', { name: 'Mature large-cap' }).click()
    const limit = card(first.page, 'Single position size')
    await limit.getByRole('button', { name: 'Add a limit' }).click()
    await limit.getByLabel('At least %').fill('1')
    await limit.getByLabel('At most %').fill('7.5')
    await save(first.page).click()
    await expect(view(first.page).getByText('1 style tag · 1 target')).toBeVisible()
    await first.app.close()

    const second = await launch(userDataDir)
    await expect(view(second.page).getByText('1 style tag · 1 target')).toBeVisible()
    await expect(
      view(second.page).getByRole('button', { name: 'Mature large-cap' }),
    ).toHaveAttribute('aria-pressed', 'true')
    // The figures come back exactly as typed — 7.5 is not rounded and not reformatted, or seeding
    // the form from a profile would look like an edit the owner did not make.
    await expect(card(second.page, 'Single position size').getByLabel('At most %')).toHaveValue(
      '7.5',
    )
    // Nothing is offered to save, because nothing differs from what was restored.
    await expect(save(second.page)).toBeDisabled()

    // Cleared in place, the way every destructive action in the app confirms (DDR-0012).
    await view(second.page).getByRole('button', { name: 'Clear profile' }).click()
    await view(second.page).getByRole('button', { name: 'Yes, clear my profile' }).click()
    await expect(view(second.page).getByText('Profile cleared.')).toBeVisible()
    await expect(view(second.page).getByText('No profile set')).toBeVisible()
    await second.app.close()

    const third = await launch(userDataDir)
    await expect(view(third.page).getByText('No profile set')).toBeVisible()
    await expect(save(third.page)).toBeDisabled()
    await third.app.close()
  })
})
