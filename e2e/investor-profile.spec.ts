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
  await expect(page.getByRole('heading', { level: 1, name: 'AI Assistant' })).toBeVisible()
  // Open on arrival since Story #343: the profile is the view's left column now, and the column
  // is the disclosure (DDR-0115). There is nothing to unfold before the form is reachable, which
  // is why the click that used to be here is gone rather than re-pointed at the new toggle.
  return { app, page }
}

/** The panel that is currently exposed — hidden panels are out of the accessibility tree. */
const view = (page: Page) => page.locator('.tab-panel:not([hidden])')

/**
 * Save, which since Story #347 says which of its two states it is in rather than only being
 * disabled: `Save profile` while there is something to store, and `Saved` once there is not. Both
 * are the same control in the same place — the head of the column, where it is in reach whatever
 * is being edited three sections down — so the locator matches either name and the tests below
 * assert the name they expect.
 */
const save = (page: Page) => view(page).getByRole('button', { name: /^Save profile$|^Saved$/ })

/** The nth row of a dimension's card, by the heading the card carries. */
const card = (page: Page, heading: string) =>
  view(page).locator('section').filter({ has: page.getByRole('heading', { name: heading }) })

/**
 * Four of the five sections arrive closed (Story #347), so a test that types into one opens it
 * first. The add control does not need this — it is in the disclosure's `action` slot beside the
 * trigger, never inside the panel (DDR-0106) — but the fields it creates do.
 */
const open = async (page: Page, heading: string): Promise<void> => {
  const trigger = view(page).getByRole('button', { name: heading, exact: true })
  if ((await trigger.getAttribute('aria-expanded')) === 'false') await trigger.click()
}

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
   * The page states what it is and whose standard it holds. It did that in a `PageHeader` whose
   * provenance line read *"Set by you"* — the one value naming no data source, because neither
   * half of this page has one (ADR-0009, DDR-0094, DDR-0108).
   *
   * Story #343 took the Figma design's Assistant, which has no page header at all, so the header
   * and `OWNER_SOURCE` are both gone (DDR-0115 amendment 1). The claim is not withdrawn, it moved:
   * the **column** says it now, in an eyebrow, its own title and an intro paragraph that states in
   * full sentences what three words in a slot could only gesture at. This asserts that — and that
   * the profile still brings no second `<main>` or `<h1>` of its own, which is the half of the
   * original that was really about the merge.
   */
  test('says whose standard it holds in the column, not in a provenance slot', async () => {
    await expect(view(page).locator('.page-header')).toHaveCount(0)
    await expect(view(page).getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(view(page).getByRole('heading', { level: 2, name: 'Investor Profile' })).toBeVisible()
    await expect(view(page).getByText(/^Your own policy for how this portfolio should be invested/)).toBeVisible()
    // Since Story #347 the count is a pill beside the title, and it is a **count**: a profile
    // stating nothing is not an incomplete one, it is a portfolio the owner has taken no view on,
    // which the app answers from its own published baseline (ADR-0009, ADR-0012, DDR-0109).
    await expect(view(page).getByText('0 style tags')).toBeVisible()
  })

  /**
   * A fresh install has nothing to save, and Save says so rather than only being unavailable
   * (Story #347). `Saved` is the resting state's own answer to "did that land".
   */
  test('offers nothing to save until something is stated', async () => {
    await expect(save(page)).toBeDisabled()
    await expect(save(page)).toHaveAccessibleName('Saved')
    // Nothing to discard either, so the control that would undo nothing is absent rather than
    // disabled — a Discard on screen says there is something to discard.
    await expect(view(page).getByRole('button', { name: 'Discard' })).toHaveCount(0)
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
    await expect(save(page)).toHaveAccessibleName('Save profile')
    await expect(view(page).getByRole('button', { name: 'Discard' })).toBeVisible()

    await save(page).click()
    await expect(view(page).getByText('Profile saved.')).toBeVisible()
    // Saved is the resting state again: there is nothing left that differs from what is stored.
    await expect(save(page)).toBeDisabled()
    await expect(save(page)).toHaveAccessibleName('Saved')
    await expect(view(page).getByText('1 style tag')).toBeVisible()
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
    await open(page, 'Currency exposure')

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
    await limit.getByRole('button', { name: 'Add limit' }).click()
    await open(page, 'Single position size')

    await limit.getByLabel('At most %').fill('8')
    await expect(limit.getByText('Enter a minimum and a maximum.')).toBeVisible()
    await expect(save(page)).toBeDisabled()

    await limit.getByLabel('At least %').fill('0')
    await expect(limit.getByText('Enter a minimum and a maximum.')).toHaveCount(0)
    await expect(save(page)).toBeEnabled()

    await save(page).click()
    await expect(save(page)).toHaveAccessibleName('Saved')
  })

  /** Discard puts the form back on what is stored, without a round trip through the database. */
  test('discarding returns the form to what was stored', async () => {
    const limit = card(page, 'Single position size')
    await limit.getByLabel('At most %').fill('25')
    await expect(save(page)).toBeEnabled()

    await view(page).getByRole('button', { name: 'Discard' }).click()
    await expect(limit.getByLabel('At most %')).toHaveValue('8')
    await expect(save(page)).toBeDisabled()
    // And Discard goes with the change it would have undone.
    await expect(view(page).getByRole('button', { name: 'Discard' })).toHaveCount(0)
  })

  /**
   * The head is the point of Story #347: Save, Discard and the notice stay in reach while a target
   * three sections down is edited, and the notice **moves with the buttons** rather than staying
   * behind. A live region the press cannot reach is a press whose answer is never read — the
   * finding Story #310 put both inside the panel for (DDR-0106).
   */
  test('keeps Save and its answer in view while a section far down is edited', async () => {
    await open(page, 'Asset-class weight')
    const assets = card(page, 'Asset-class weight')
    await assets.getByRole('button', { name: 'Add target' }).click()
    await assets.getByLabel('Asset class', { exact: true }).fill('STK')
    await assets.getByLabel('At least %').fill('50')
    await assets.getByLabel('At most %').fill('90')

    // In view without scrolling back for it: the head does not move when the sections do.
    await expect(save(page)).toBeInViewport()
    await save(page).click()
    await expect(view(page).getByText('Profile saved.')).toBeVisible()
    await expect(view(page).locator('.profile-notice')).toBeInViewport()

    // Put the store back where the tests below expect it.
    await assets.getByRole('button', { name: 'Remove the STK target' }).click()
    await save(page).click()
    await expect(save(page)).toHaveAccessibleName('Saved')
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
    await limit.getByRole('button', { name: 'Add limit' }).click()
    await open(first.page, 'Single position size')
    await limit.getByLabel('At least %').fill('1')
    await limit.getByLabel('At most %').fill('7.5')
    await save(first.page).click()
    await expect(view(first.page).getByText('1 style tag')).toBeVisible()
    await first.app.close()

    const second = await launch(userDataDir)
    await expect(view(second.page).getByText('1 style tag')).toBeVisible()
    await expect(
      view(second.page).getByRole('button', { name: 'Mature large-cap' }),
    ).toHaveAttribute('aria-pressed', 'true')
    // The figures come back exactly as typed — 7.5 is not rounded and not reformatted, or seeding
    // the form from a profile would look like an edit the owner did not make.
    await open(second.page, 'Single position size')
    await expect(card(second.page, 'Single position size').getByLabel('At most %')).toHaveValue(
      '7.5',
    )
    // Nothing is offered to save, because nothing differs from what was restored.
    await expect(save(second.page)).toBeDisabled()
    await expect(save(second.page)).toHaveAccessibleName('Saved')

    // Cleared in place, the way every destructive action in the app confirms (DDR-0012). The
    // design draws no confirm on Clear *chat* because a transcript is session state; a profile is
    // stored, so this one stays exactly where it was and only its frame changed (DDR-0115
    // amendment 5, Story #347).
    await view(second.page).getByRole('button', { name: 'Clear profile' }).click()
    await view(second.page).getByRole('button', { name: 'Yes, clear my profile' }).click()
    await expect(view(second.page).getByText('Profile cleared.')).toBeVisible()
    await expect(view(second.page).getByText('0 style tags')).toBeVisible()
    await second.app.close()

    const third = await launch(userDataDir)
    await expect(view(third.page).getByText('0 style tags')).toBeVisible()
    await expect(save(third.page)).toBeDisabled()
    await third.app.close()
  })
})
