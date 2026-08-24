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
 * The chart card carries no rule between its title and its plot (Story #255, DDR-0084).
 *
 * `lib/cardVariants.test.ts` asserts the stylesheet's half — that the rule exists, gives back the
 * strip's three declarations, and is written at a specificity that cannot lose. What it cannot see
 * is the cascade resolving, and that is the whole risk here: `.card-header` and `.chart-card-header`
 * are both one class, so the un-ruling wins on *specificity* only because both are named. A text
 * guard passes off the source either way — the failure class DDR-0075 records, and DDR-0059's
 * source-order trap, which this repo has shipped once.
 *
 * The four Performance charts and the Dividends income chart need imported Flex history to appear,
 * which the e2e app deliberately has none of. So the chart header is read off a **probe** wearing
 * its classes inside a real `.card`, the way `reduced-motion.spec.ts` reads a `.pie-slice`: a class
 * rule applies to whatever wears the class, and the cascade is what is under test. The other half
 * — that a card which is *not* a chart card still draws its strip — is read off a real one, the
 * Portfolio view's "Data sources", which renders with no gateway and nothing imported.
 *
 * Its own app instance with its own user-data directory, for the reason `tab-navigation.spec.ts`
 * gives: the single-instance lock is scoped to that directory (Story #107).
 */
let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-chartcard-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

/** The box a header resolves to, plus whether it stayed on one line. */
type HeaderBox = {
  borderBottomWidth: string
  borderBottomStyle: string
  margin: [string, string, string, string]
  padding: [string, string, string, string]
  flexWrap: string
  /** The header's own height, and its title's — equal wherever the row did not wrap. */
  height: number
  titleHeight: number
}

/**
 * Builds a card off screen, hangs a header on it wearing `className`, and reads the box back.
 *
 * Inside a real `.card.card-md`, because the strip's margin is `--card-pad` negated and a custom
 * property resolves where it is declared — a header measured outside a card would report the
 * negative margin as nothing. The title is long and the key beside it is real, so a header that
 * could wrap would.
 */
const headerBox = (className: string): Promise<HeaderBox> =>
  page.evaluate((name) => {
    const card = document.createElement('div')
    card.className = 'card card-default card-md'
    card.style.position = 'absolute'
    card.style.left = '-9999px'
    card.style.width = '360px'

    const header = document.createElement('div')
    header.className = name
    const title = document.createElement('h2')
    title.className = 'card-title'
    title.textContent = 'Composition over time in the display currency'
    const key = document.createElement('div')
    key.className = 'chart-legend chart-legend-header'
    key.textContent = 'Stocks Options Cash Accruals'
    header.append(title, key)

    const body = document.createElement('div')
    body.className = 'card-content'
    body.textContent = 'plot'

    card.append(header, body)
    document.body.append(card)

    const style = getComputedStyle(header)
    const box: HeaderBox = {
      borderBottomWidth: style.borderBottomWidth,
      borderBottomStyle: style.borderBottomStyle,
      margin: [style.marginTop, style.marginRight, style.marginBottom, style.marginLeft],
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      flexWrap: style.flexWrap,
      height: header.getBoundingClientRect().height,
      titleHeight: title.getBoundingClientRect().height,
    }

    card.remove()
    return box
  }, className)

const CHART_HEADER = 'card-header card-header-center chart-card-header'
const PLAIN_HEADER = 'card-header card-header-center'

test('a chart card draws no rule between its title and its plot', async () => {
  const chart = await headerBox(CHART_HEADER)

  // Parsed, not compared as a string: a 1px hairline resolves to the device's own snapped width
  // (0.8px on a 1.25 scale factor), so a literal '1px' would pass or fail by monitor. Zero is zero.
  expect(parseFloat(chart.borderBottomWidth)).toBe(0)
  expect(chart.borderBottomStyle).toBe('none')
})

test('the chart header gives the strip’s geometry back, not only its line', async () => {
  const chart = await headerBox(CHART_HEADER)

  // No bleed out to the card's edges, and no re-applied inset: the header is a plain row inside
  // the card's own padding. The one number it states is the gap down to the plot.
  expect(chart.margin).toEqual(['0px', '0px', '16px', '0px'])
  expect(chart.padding).toEqual(['0px', '0px', '0px', '0px'])
})

test('the chart header is still exactly one line tall, key and all', async () => {
  const chart = await headerBox(CHART_HEADER)

  // The row that must not wrap (DDR-0052): with no padding left, the header is its tallest child,
  // and the title is the tallest thing in it. A wrapped row would be two title-heights or more.
  expect(chart.flexWrap).toBe('nowrap')
  expect(chart.titleHeight).toBeGreaterThan(0)
  expect(chart.height).toBeCloseTo(chart.titleHeight, 0)
})

test('a card that is not a chart card keeps the ruled strip', async () => {
  const plain = await headerBox(PLAIN_HEADER)

  expect(parseFloat(plain.borderBottomWidth)).toBeGreaterThan(0)
  expect(plain.borderBottomStyle).toBe('solid')
  // Bled out to both edges by negating `--card-pad` (20px at the medium size) and re-applied.
  expect(plain.margin).toEqual(['-20px', '-20px', '20px', '-20px'])
  expect(plain.padding).toEqual(['16px', '20px', '16px', '20px'])
})

test('a real card outside the charts still draws its rule on screen', async () => {
  await page.getByRole('tab', { name: 'Portfolio' }).click()

  // "Data sources" states its title as a bare `CardTitle` — the strip's second selector — and
  // renders with no gateway and nothing imported, which is exactly this app's state.
  const title = page.locator('.tab-panel:not([hidden]) #flex-sources-heading')
  await expect(title).toBeVisible()

  const rule = await title.evaluate((element) => {
    const style = getComputedStyle(element)
    return { width: parseFloat(style.borderBottomWidth), style: style.borderBottomStyle }
  })

  expect(rule.style).toBe('solid')
  expect(rule.width).toBeGreaterThan(0)
})
