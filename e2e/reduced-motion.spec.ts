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

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * Reduced motion, honoured across the shell (Story #154, DDR-0044).
 *
 * `designTokens.test.ts` asserts the stylesheet's half of this — that every animation draws its
 * duration from a token and that one media query zeroes those tokens. What it cannot see is the
 * cascade actually resolving: whether the media query wins over the base `:root`, whether the
 * running app really is in the reduced-motion state the OS asked for, and whether the five views
 * are still usable once the transitions are gone. All three are only observable in a browser.
 *
 * Its own app instance with its own user-data directory, for the reason `tab-navigation.spec.ts`
 * gives: these tests move the shell off the Portfolio tab, and the single-instance lock is scoped
 * to that directory (Story #107).
 */
let app: ElectronApplication
let page: Page

const TABS = [
  'Portfolio',
  'Performance',
  'Allocation',
  'Dividends',
  'Trades',
  'Assistant',
  'Profile',
] as const

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-motion-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/** A duration token as the document actually resolves it. */
const duration = (name: string): Promise<string> =>
  page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name,
  )

/**
 * `transition-duration` as computed for a real rule, via a throwaway element wearing its class.
 *
 * Reading the token alone would prove the media query parsed, not that anything uses it. `.pie-slice`
 * is the app's most-animated rule and needs an imported statement to appear on screen, which the
 * e2e app deliberately does not have — but a class rule applies to whatever wears the class, so
 * borrowing it is enough to watch a token become a computed time.
 */
const computedMotion = (className: string, property: 'transition' | 'animation'): Promise<string> =>
  page.evaluate(([name, which]) => {
    const probe = document.createElement('div')
    probe.className = name!
    document.body.append(probe)
    const style = getComputedStyle(probe)
    const value = which === 'animation' ? style.animationDuration : style.transitionDuration
    probe.remove()
    return value
  }, [className, property] as const)

const transitionDuration = (className: string): Promise<string> =>
  computedMotion(className, 'transition')

const animationDuration = (className: string): Promise<string> =>
  computedMotion(className, 'animation')

test('the scale is live when no preference is stated', async () => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  expect(await duration('--duration-fast')).toBe('90ms')
  expect(await duration('--duration-base')).toBe('120ms')
  // Two transitioned properties, both at the fast step.
  expect(await transitionDuration('pie-slice')).toBe('0.09s, 0.09s')
})

test('asking for reduced motion zeroes every duration', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  // The whole mechanism: the media query redefines the scale, so nothing has to be listed.
  expect(await duration('--duration-fast')).toBe('0ms')
  expect(await duration('--duration-base')).toBe('0ms')
  expect(await transitionDuration('pie-slice')).toBe('0s, 0s')
})

test('every view is still reachable and still renders with reduced motion', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' })

  for (const label of TABS) {
    await page.getByRole('tab', { name: label }).click()
    // The accessible name, not the row's text: each row also draws the accelerator's digit
    // since Story #254, `aria-hidden` and therefore deliberately outside the name (DDR-0083).
    await expect(page.getByRole('tab', { selected: true })).toHaveAccessibleName(label)

    // The panel exists, is the selected tab's, and has something in it. No state is stranded
    // behind a transition that no longer runs.
    const panel = page.getByRole('tabpanel')
    await expect(panel).toHaveCount(1)
    await expect(panel).toBeVisible()
    await expect(panel).not.toBeEmpty()
  }
})

test('the three animations that used to escape are covered', async () => {
  // Before this story the stylesheet's one reduced-motion block named `.pie-slice` and nothing
  // else, so these three kept running. They need imported history to appear on screen, which the
  // e2e app deliberately has none of — but the cascade resolves for any element wearing the
  // class, which is where the guarantee actually lives.
  await page.emulateMedia({ reducedMotion: 'reduce' })

  expect(await transitionDuration('country-mark-slice'), 'the map country marks').toBe('0s')
  expect(await transitionDuration('classify-progress-bar'), 'the classify progress bar').toBe('0s')
  expect(await animationDuration('map-popup-shell'), 'the map popup entry').toBe('0s')
})
