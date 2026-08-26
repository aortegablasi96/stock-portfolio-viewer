import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatCurrency, formatSignedPercent } from './format'
import { MAX_SERIES_TICKS, seriesDomain } from './column'
import {
  AXIS_LABEL_ADVANCE_UNITS,
  AXIS_LABEL_BUDGET_CHARS,
  AXIS_LABEL_GAP_UNITS,
  AXIS_LABEL_UNITS,
  GRID_CONTENT_BREAKPOINT_PX,
  PERFORMANCE_FRAME,
  PERFORMANCE_PLOTS,
  axisGutterUnits,
  type AxisLabelKind,
  PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX,
  SIDEBAR_COLLAPSED_PX,
  MAX_GRID_AXIS_LABEL_PX,
  MAX_STACKED_AXIS_LABEL_PX,
  MIN_AXIS_LABEL_PX,
  PERFORMANCE_GRID_BREAKPOINT_PX,
  PERFORMANCE_PLOT,
  axisLabelPx,
  chartHeightPx,
  chartWidthPx,
  gridColumns,
} from './chartGeometry'

/**
 * The Performance grid's geometry (Story #172, DDR-0051).
 *
 * The acceptance criterion this file exists for is "axis labels stay legible at the narrower
 * column, rather than the existing ratios being reused unchanged" — a claim about rendered
 * pixels, which nothing in a Node-only suite can see (DDR-0029). So it is *derived* instead: the
 * width maths mirrors the tokens the layout is built from, this file checks the mirror against
 * `app.css`, and then walks the layout from the collapse breakpoint out to `--content-max`.
 *
 * That is what makes the ratio a checked decision rather than a comment. Widen the column, change
 * a padding token, or re-pick the `viewBox`, and the walk fails with the label size it would have
 * produced.
 */

const CSS = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/** The default window width, from `windowStateService`. The renderer may not import `@services`. */
const WINDOW_DEFAULT_WIDTH = 1280

/* Three of `chartGeometry`'s private mirrors, restated for the assertions below. Each is read
   back out of `app.css` by the "mirrored layout tokens" block, so restating them here cannot
   drift from the stylesheet without that block failing first. */
const SIDEBAR_WIDTH = 220 /* --sidebar-width */
const GRID_GAP_PX = 24 /* --space-7 */
const CARD_PAD_PX = 20 /* --space-6, one side */

/**
 * Narrowest window the walk covers. Below this every view in the app is squeezed, not just this
 * one.
 *
 * 1020, up from 800, and it is the same floor: Story #182 put a fixed 220px sidebar beside the
 * content (DDR-0055), so a window has to be 220px wider to leave the content what it had. The
 * number is the old one plus the sidebar rather than the narrowest width that happens to pass —
 * tuning it to the pass/fail edge would turn a stated floor into a fitted one.
 */
const NARROWEST_TESTED_PX = 1020

function rootToken(name: string): string {
  const match = CSS.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, 'm'))
  if (!match?.[1]) throw new Error(`${name} is not declared in app.css`)
  return match[1].trim()
}

describe('the plot geometry', () => {
  /**
   * The two numbers DDR-0051 chose. Pinned because they are the decision: the width halves so a
   * unit keeps its size in the half-width column, and the ratio shortens so the plot keeps its
   * height. Carrying DDR-0018's 4.5:1 into a half column would have done both by halves.
   */
  it('is 500×180 — shorter than DDR-0018’s 4.5:1, because the column halved', () => {
    expect(PERFORMANCE_PLOT.width).toBe(500)
    expect(PERFORMANCE_PLOT.height).toBe(180)
    expect(PERFORMANCE_PLOT.width / PERFORMANCE_PLOT.height).toBeCloseTo(2.78, 2)
  })

  /**
   * The padding is an allowance for text, not a fraction of the plot, and the axis label did not
   * get shorter when the chart did. Shrinking it in proportion to the width is one plausible
   * mistake; the other is the one Story #190 found in the running app, where the allowance had
   * simply never been checked against a label.
   */
  it('keeps DDR-0018’s padding, because it is sized by the label rather than by the plot', () => {
    expect(PERFORMANCE_PLOTS.currency.pad).toEqual({ top: 16, right: 16, bottom: 28, left: 80 })
    expect(PERFORMANCE_PLOT.pad).toEqual(PERFORMANCE_PLOTS.currency.pad)
  })

  /**
   * The gutter differs by axis kind and **nothing else does** (Story #269).
   *
   * This is the property that keeps DDR-0051's grid a grid: one `viewBox`, one height, one right
   * edge. A second pad edge appearing in this diff would mean two charts in a row plotting the
   * same dates in differently shaped plots, which is what sharing the geometry exists to prevent.
   */
  it('varies the gutter by axis kind and leaves every other edge alone', () => {
    const kinds = Object.values(PERFORMANCE_PLOTS)
    for (const plot of kinds) {
      expect(plot.width).toBe(PERFORMANCE_FRAME.width)
      expect(plot.height).toBe(PERFORMANCE_FRAME.height)
      expect({ top: plot.pad.top, right: plot.pad.right, bottom: plot.pad.bottom }).toEqual({
        top: 16,
        right: 16,
        bottom: 28,
      })
    }
    // ...and the gutters genuinely differ, or the story changed nothing.
    expect(PERFORMANCE_PLOTS.percent.pad.left).toBeLessThan(PERFORMANCE_PLOTS.currency.pad.left)
  })

  /**
   * The y-axis gutter, checked against the label it exists for rather than restated — now once
   * per kind of label (Story #269).
   *
   * `left: 64` held eight characters and every value chart in this grid labels its axis with ten
   * (`€68,517.70`, `€80,000.00`), so the widest ticks began at x = −7.8 and the root `<svg>`
   * clipped their currency symbol — invisibly, because an SVG has no layout engine to complain
   * to. Nothing in the suite could see it, which is exactly why the arithmetic is here: the
   * assertion is that a label of the budgeted width **starts inside the viewBox**, so a wider
   * figure fails a test rather than losing its €.
   *
   * The upper bound is the half Story #269 was filed for, and it is the half nothing can report:
   * a gutter with more than one glyph of slack never clips, it just quietly costs the plot the
   * width. One budget standing in for four charts passed this assertion for the two charts it was
   * measured against and failed it by four characters on the two it was not.
   */
  it.each(['currency', 'percent'] as const)(
    'leaves a %s y-axis label its whole width, and no more',
    (kind) => {
      const label = AXIS_LABEL_BUDGET_CHARS[kind] * AXIS_LABEL_ADVANCE_UNITS
      // The charts anchor a tick at `pad.left - 8`, `text-anchor="end"`, so it grows leftward.
      const startsAt = PERFORMANCE_PLOTS[kind].pad.left - AXIS_LABEL_GAP_UNITS - label
      expect(startsAt).toBeGreaterThanOrEqual(0)
      // And not so generous that the gutter is buying slack the plot pays for.
      expect(startsAt).toBeLessThan(AXIS_LABEL_ADVANCE_UNITS)
    },
  )

  /** The derivation is the gutter — neither number is written down anywhere else. */
  it('derives each gutter from its budget rather than stating it', () => {
    expect(PERFORMANCE_PLOTS.currency.pad.left).toBe(
      axisGutterUnits(AXIS_LABEL_BUDGET_CHARS.currency),
    )
    expect(PERFORMANCE_PLOTS.percent.pad.left).toBe(
      axisGutterUnits(AXIS_LABEL_BUDGET_CHARS.percent),
    )
    // A wider budget can only ever buy a wider gutter; the derivation is monotonic, so widening
    // `AXIS_LABEL_BUDGET_CHARS` can never narrow the plot's allowance by accident.
    expect(axisGutterUnits(12)).toBeGreaterThan(axisGutterUnits(11))
  })

  /**
   * The advance is a measurement, not a guess, and the two things it is measured from are in
   * `app.css`. Read back here for the same reason the layout tokens below are: a number mirrored
   * out of the stylesheet is a number that will disagree with it.
   */
  it('mirrors the face and the size the advance was measured at', () => {
    expect(CSS).toMatch(/--font-figure:\s*'JetBrains Mono'/)
    expect(CSS).toMatch(/--tracking-figure:\s*-0\.02em/)
    // 0.6em advance − 0.02em tracking, at 11 units — 6.38, rounded up.
    expect(AXIS_LABEL_ADVANCE_UNITS).toBeGreaterThanOrEqual((0.6 - 0.02) * AXIS_LABEL_UNITS)
    expect(AXIS_LABEL_ADVANCE_UNITS).toBeLessThan(0.6 * AXIS_LABEL_UNITS)
  })

  /** The gutter the module derives is the gutter the three charts actually anchor against. */
  it('is the gap every chart draws its ticks with', () => {
    for (const chart of ['LineChart', 'BarChart', 'StackedAreaChart']) {
      const source = readFileSync(
        new URL(`../components/charts/${chart}.tsx`, import.meta.url),
        'utf8',
      )
      expect(source).toContain(`x={PAD.left - ${AXIS_LABEL_GAP_UNITS}}`)
    }
  })

  it('leaves a usable plot after the padding', () => {
    const { width, height, pad } = PERFORMANCE_PLOT
    expect(width - pad.left - pad.right).toBeGreaterThan(400)
    expect(height - pad.top - pad.bottom).toBeGreaterThan(130)
  })
})

/**
 * The relationship Story #269 exists to hold: **a chart's gutter is sized from the labels that
 * chart draws.**
 *
 * The number was right and the relationship was not. Story #190 derived `pad.left` from a
 * character budget and checked the derivation, which is what caught a clipped `€` — but the
 * budget it derived from was one global, and by then two of the four charts in the grid labelled
 * their axis in percent. A single number cannot be sized from four different sets of labels, and
 * the half of that it got wrong is the half nothing reports: too much gutter never clips.
 *
 * So the guard is on the pairing rather than on either number. It runs the app's own formatters
 * — not a transcription of them — over the ticks each axis is actually asked to render, and
 * fails if what comes out is wider than the budget that chart's gutter was derived from. Change
 * a formatter's decimals, point a chart at the other formatter, or forget the `axis` beside it,
 * and this is where it lands.
 */
describe('every chart’s gutter is sized from the labels that chart draws', () => {
  /* Real ticks, from the ranges these charts plot. Currency runs from a zero baseline out past
     `€250,000.00`; percent covers a flat day, a daily move, a rebased window and a cumulative
     return that has run away with itself. `formatCurrency`/`formatSignedPercent` are the very
     functions `PerformanceView` hands the charts. */
  const LABELS: Record<AxisLabelKind, readonly string[]> = {
    currency: [0, 1234.5, 68_517.7, 80_000, 250_000].map((v) => formatCurrency(v, 'EUR')),
    percent: [0, -1.23, 7.5, -16.14, 123.45, 999.99, -999.99].map(formatSignedPercent),
  }

  const widest = (labels: readonly string[]): number => Math.max(...labels.map((l) => l.length))

  it.each(['currency', 'percent'] as const)('a %s axis draws nothing wider than its budget', (kind) => {
    expect(widest(LABELS[kind])).toBeLessThanOrEqual(AXIS_LABEL_BUDGET_CHARS[kind])
  })

  /**
   * Both budgets bind, and where they stop is stated rather than discovered. A budget nothing
   * reaches is a budget nobody has measured — which is how eleven characters came to stand in
   * for `+16.14%`.
   */
  it('stops where the module says it stops', () => {
    expect(formatSignedPercent(1000).length).toBeGreaterThan(AXIS_LABEL_BUDGET_CHARS.percent)
    expect(formatCurrency(1_000_000, 'EUR').length).toBeGreaterThan(
      AXIS_LABEL_BUDGET_CHARS.currency,
    )
  })

  /**
   * The defect itself, as arithmetic. Eleven characters of gutter behind an eight-character
   * budget leaves more than one glyph of slack, which is the bound the per-kind assertion above
   * applies — so the old shared gutter fails the story's own test on the two percentage charts.
   */
  it('fails the percentage charts if they are put back on the currency gutter', () => {
    const slack =
      PERFORMANCE_PLOTS.currency.pad.left -
      AXIS_LABEL_GAP_UNITS -
      AXIS_LABEL_BUDGET_CHARS.percent * AXIS_LABEL_ADVANCE_UNITS
    expect(slack).toBeGreaterThan(AXIS_LABEL_ADVANCE_UNITS)
  })

  const chartCode = (chart: string): string =>
    readFileSync(new URL(`../components/charts/${chart}.tsx`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  /** Two of the three plot one kind of figure and nothing else, so their kind is not a prop. */
  it('pins the daily-return bars to the percentage gutter', () => {
    expect(chartCode('BarChart')).toContain('PERFORMANCE_PLOTS.percent')
  })

  it('pins the composition stack to the currency gutter', () => {
    expect(chartCode('StackedAreaChart')).toContain('PERFORMANCE_PLOTS.currency')
  })

  /** And the one that draws both takes its kind from the caller, never from a default. */
  it('lets LineChart take its kind from the caller, with no kind of its own', () => {
    const code = chartCode('LineChart')
    expect(code).toContain('PERFORMANCE_PLOTS[axis]')
    expect(code).not.toContain('PERFORMANCE_PLOTS.currency')
    expect(code).not.toContain('PERFORMANCE_PLOTS.percent')
    // A default would hand a new caller the currency gutter silently — the failure mode with no
    // symptom. The prop is required, so `axis` may not carry one.
    expect(code).not.toMatch(/axis\s*=\s*['"]/)
  })

  /**
   * The pairing at the call site, which is the only place the two facts meet: `LineChart` is
   * handed a formatter *and* an axis, and nothing but this can see whether they agree.
   */
  it('states an axis beside every formatter the view hands a LineChart', () => {
    const view = readFileSync(
      new URL('../components/analytics/PerformanceView.tsx', import.meta.url),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    const elements = view.match(/<LineChart[\s\S]*?\/>/g) ?? []
    expect(elements).toHaveLength(2)
    for (const element of elements) {
      const kind = element.match(/axis="(currency|percent)"/)?.[1]
      // `c` is the view's base-currency formatter; the other curve takes `formatSignedPercent`.
      expect(kind).toBe(element.includes('formatValue={c}') ? 'currency' : 'percent')
    }
  })
})

/**
 * The largest portfolio whose **rounded** value axis still fits the currency gutter, in base
 * currency (Story #270).
 *
 * Not a limit the app enforces — a statement of where the axis starts clipping, kept beside the
 * tests that check both sides of it. At €800,000 the step is €200,000 and the top tick lands on
 * the series maximum exactly; one euro past it the step becomes €500,000 and the top rounds to
 * `€1,000,000.00`, two characters wider than `AXIS_LABEL_BUDGET_CHARS.currency` holds.
 */
const CURRENCY_DOMAIN_CEILING = 800_000

/**
 * The grid reads across its rows, so its four value axes are **one rule** (Story #270).
 *
 * `LineChart` was the quadrant that never adopted it. Its ticks were the window's own extremes and
 * their midpoint, which is evenly spaced and arbitrarily levelled — `€0.00 / €34,258.85 /
 * €68,517.70` beside a composition stack already labelled `€0 … €80,000`, plotting the same NAV.
 * Two charts in one grid, drawn against the same quantity, disagreeing about where a gridline
 * goes.
 *
 * What this file can add to `column.test.ts`'s maths is the half that only exists once the domain
 * is drawn: how many gridlines a 136-unit plot can be asked to hold, and how wide the labels
 * beside them are allowed to get now that the top tick is a **rounded** figure rather than one the
 * series contains.
 */
describe('one value-axis rule across the grid', () => {
  const chartSource = (chart: string): string =>
    readFileSync(new URL(`../components/charts/${chart}.tsx`, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  it('takes every grid chart’s value axis from lib/column', () => {
    expect(chartSource('LineChart')).toContain('seriesDomain(')
    expect(chartSource('BarChart')).toContain('seriesDomain(')
    // The stack's domain is `lib/composition`'s, which delegates to the same module — the chart
    // is handed a `ColumnDomain` and reads `domain.ticks` off it.
    expect(chartSource('StackedAreaChart')).toContain('domain.ticks')
    expect(
      readFileSync(new URL('./composition.ts', import.meta.url), 'utf8'),
    ).toContain('columnDomain(')
  })

  /**
   * Comments are stripped first, and here that is load-bearing rather than habitual: both charts
   * *quote* the expression they replaced, so a scan run over the raw text would fail on the prose
   * explaining why the code is gone (DDR-0075's trap, from the other side).
   */
  it('leaves no chart computing a tick of its own beside it', () => {
    for (const chart of ['LineChart', 'BarChart', 'StackedAreaChart']) {
      const code = chartSource(chart)
      expect(code).not.toMatch(/spanV\s*\/\s*2/)
      expect(code).not.toMatch(/const ticks\s*=\s*\[/)
    }
  })

  /* The plot the gridlines are laid down in. Only `pad.left` varies by axis kind (DDR-0091), so
     the vertical measure is the same for all four charts. */
  const plotHeightUnits =
    PERFORMANCE_FRAME.height - PERFORMANCE_PLOTS.percent.pad.top - PERFORMANCE_PLOTS.percent.pad.bottom
  const gapUnits = plotHeightUnits / (MAX_SERIES_TICKS - 1)

  it('keeps the tightest possible gridline spacing clear of the label between them', () => {
    // Two label-heights apart at the worst domain the rule can produce. A step fine enough to
    // divide any range exactly is the eleven-gridline trade DDR-0081 refused; this is the number
    // that says the round-step rule never approaches it.
    expect(gapUnits).toBeGreaterThan(2 * AXIS_LABEL_UNITS)
  })

  it('holds that spacing on screen at the narrowest column the grid draws', () => {
    // One pixel past the breakpoint is the narrowest a chart is ever drawn in two columns; below
    // it the grid collapses and every chart doubles in width.
    const width = chartWidthPx(PERFORMANCE_GRID_BREAKPOINT_PX + 1)
    const gapPx = (gapUnits * width) / PERFORMANCE_FRAME.width

    expect(gapPx).toBeGreaterThan(2 * axisLabelPx(width))
    expect(gapPx).toBeGreaterThan(2 * MIN_AXIS_LABEL_PX)
  })

  /**
   * **The top tick is no longer a figure the series contains**, and that is the one thing this
   * story hands the gutter to worry about. Rounding outward means the label beside the top
   * gridline can be an order of magnitude wider than anything plotted — `€900,000` of portfolio
   * draws a `€1,000,000.00` tick — so the currency budget has to be measured against the *domain*
   * rather than against the data, and where it stops is stated rather than discovered.
   */
  it('fits the currency gutter for every portfolio up to the ceiling it states', () => {
    for (const max of [1_000, 68_517.7, 250_000, 400_000, CURRENCY_DOMAIN_CEILING]) {
      const labels = seriesDomain([0, max]).ticks.map((t) => formatCurrency(t, 'EUR'))
      expect(Math.max(...labels.map((l) => l.length))).toBeLessThanOrEqual(
        AXIS_LABEL_BUDGET_CHARS.currency,
      )
    }
  })

  it('states where the rounded top outgrows that gutter', () => {
    // Past the ceiling the step jumps to 500,000 and the top rounds to a seven-figure tick, which
    // is thirteen characters against a budget of eleven. The bound DDR-0091 recorded at €1M
    // therefore arrives at €800,000 of *series* — the same clip, reached sooner, and the honest
    // place to widen it is still `AXIS_LABEL_BUDGET_CHARS`.
    const top = seriesDomain([0, CURRENCY_DOMAIN_CEILING + 1]).top
    expect(formatCurrency(top, 'EUR').length).toBeGreaterThan(AXIS_LABEL_BUDGET_CHARS.currency)
  })
})

describe('the mirrored layout tokens still match app.css', () => {
  /**
   * `chartWidthPx` computes in numbers because Node has no layout engine, so every token it
   * mirrors is a number that could quietly disagree with the stylesheet. Each is read back here.
   * This is the same instinct as `designTokens.test.ts`: a test whose subject is the CSS.
   */
  it('mirrors the content measure', () => {
    expect(rootToken('--content-max')).toBe('110rem') // 1760px
    expect(rootToken('--content-pad')).toBe('2rem') // 32px
  })

  it('mirrors the grid gap and the card padding', () => {
    expect(rootToken('--space-7')).toBe('1.5rem') // 24px, the grid gap
    expect(rootToken('--surface-pad-md')).toBe('var(--space-6)')
    expect(rootToken('--space-6')).toBe('1.25rem') // 20px, the card padding
  })

  /**
   * The sidebar is the newest term in the width maths and the easiest to forget (Story #182).
   * It is not part of the content measure — it sits beside it — so it comes off the viewport
   * before `--content-max` caps anything, and a change to it moves every chart in the grid.
   */
  it('mirrors the sidebar the content column now sits beside', () => {
    expect(rootToken('--sidebar-width')).toBe('220px')
  })

  /** And the width it takes when collapsed, which is the other half of the same term (#184). */
  it('mirrors the collapsed rail', () => {
    expect(rootToken('--sidebar-width-collapsed')).toBe('56px')
    expect(SIDEBAR_COLLAPSED_PX).toBe(56)
  })

  it('mirrors the axis label size, which is a viewBox unit and not a type step', () => {
    expect(CSS).toMatch(/\.chart-axis-label\s*\{[^}]*font-size:\s*11px/)
    expect(AXIS_LABEL_UNITS).toBe(11)
  })
})

describe('the grid collapses where the labels would stop being legible', () => {
  it('is two columns above the breakpoint and one at or below it', () => {
    expect(gridColumns(PERFORMANCE_GRID_BREAKPOINT_PX + 1)).toBe(2)
    expect(gridColumns(PERFORMANCE_GRID_BREAKPOINT_PX)).toBe(1)
  })

  /**
   * The stated width is in the stylesheet too, and CSS cannot read this module. A breakpoint
   * moved in one file and not the other is the drift this catches.
   */
  it('states the same viewport width in app.css', () => {
    expect(CSS).toMatch(
      new RegExp(
        `@media \\(max-width: ${PERFORMANCE_GRID_BREAKPOINT_PX}px\\)\\s*\\{\\s*\\.performance-charts\\s*\\{\\s*grid-template-columns:\\s*1fr;`,
      ),
    )
  })

  /**
   * The threshold is the **content column**, and since Story #182 the column is the window minus
   * the sidebar (DDR-0055). The breakpoint is therefore stated in viewport pixels but chosen in
   * column pixels, and this is where the two are reconciled.
   */
  it('is the same 1200px column, measured from a window that now carries a sidebar', () => {
    expect(PERFORMANCE_GRID_BREAKPOINT_PX - SIDEBAR_WIDTH).toBe(1200)
  })

  /**
   * The property DDR-0051 had and this layout cannot keep, recorded rather than deleted.
   *
   * 1200px sat below the 1280px default window on purpose, so a fresh install opened on the grid.
   * With 220px of that window spent on the sidebar there is no breakpoint that does both: at
   * 1280px a half column is 438px, which renders a 9.7px axis label — under the floor. So the
   * default window opens on the **stack**, and the assertion is that this is a legibility
   * decision rather than an accident: the stacked chart at 1280px is comfortably inside the band.
   */
  it('now opens a default window on the stack, because a half column there is illegible', () => {
    expect(PERFORMANCE_GRID_BREAKPOINT_PX).toBeGreaterThan(WINDOW_DEFAULT_WIDTH)
    expect(gridColumns(WINDOW_DEFAULT_WIDTH)).toBe(1)

    // Not a concession: two columns at the default window would be below the floor...
    const halfColumn = (chartWidthPx(WINDOW_DEFAULT_WIDTH) - GRID_GAP_PX) / 2 - CARD_PAD_PX
    expect(axisLabelPx(halfColumn)).toBeLessThan(MIN_AXIS_LABEL_PX)
    // ...while the one column the reader actually gets is well inside it.
    expect(axisLabelPx(chartWidthPx(WINDOW_DEFAULT_WIDTH))).toBeGreaterThan(MIN_AXIS_LABEL_PX)
  })
})

/**
 * The rail (Story #184). The grid collapses on the **column** it is given, not on the window, so
 * a sidebar that can be 220px or 56px wide is a threshold that has to move with it — and the
 * whole point of deriving both from one content width is that neither can be tuned on its own.
 */
describe('collapsing the sidebar moves the breakpoint, not the floor', () => {
  it('is the same 1200px column, measured past a 56px rail instead of a 220px column', () => {
    expect(PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX - SIDEBAR_COLLAPSED_PX).toBe(
      GRID_CONTENT_BREAKPOINT_PX,
    )
    expect(PERFORMANCE_GRID_BREAKPOINT_PX - SIDEBAR_WIDTH).toBe(GRID_CONTENT_BREAKPOINT_PX)
    // The rail hands back exactly what it stopped taking; nothing else moved.
    expect(PERFORMANCE_GRID_BREAKPOINT_PX - PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX).toBe(
      SIDEBAR_WIDTH - SIDEBAR_COLLAPSED_PX,
    )
  })

  it('states the same viewport width in app.css, scoped to the collapsed shell', () => {
    // Whitespace-flattened rather than matched with a hand-escaped regex: the assertion is that
    // the stylesheet states this breakpoint, and the number is the only part worth being precise
    // about. CSS cannot read this module, so a threshold moved in one file and not the other is
    // exactly the drift this catches.
    const flat = CSS.replace(/\s+/g, ' ')
    expect(flat).toContain(
      `@media (min-width: ${PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX + 1}px) ` +
        '{ .app-collapsed .performance-charts { grid-template-columns: repeat(2,',
    )
  })

  it('is two columns above the collapsed breakpoint and one at or below it', () => {
    expect(
      gridColumns(PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX + 1, SIDEBAR_COLLAPSED_PX),
    ).toBe(2)
    expect(gridColumns(PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX, SIDEBAR_COLLAPSED_PX)).toBe(1)
  })

  /**
   * The property DDR-0051 had, #182 spent, and this story hands back — recorded as an assertion
   * because it is the reader-facing point of collapsing at all. The same default window that
   * opens Performance stacked with the column open opens it on the grid with the rail closed,
   * and both are the legibility floor answering rather than a preference.
   */
  it('gives a default window its 2×2 grid back, on the floor’s terms', () => {
    expect(gridColumns(WINDOW_DEFAULT_WIDTH)).toBe(1)
    expect(gridColumns(WINDOW_DEFAULT_WIDTH, SIDEBAR_COLLAPSED_PX)).toBe(2)

    const half = chartWidthPx(WINDOW_DEFAULT_WIDTH, SIDEBAR_COLLAPSED_PX)
    expect(axisLabelPx(half)).toBeGreaterThanOrEqual(MIN_AXIS_LABEL_PX)
    expect(axisLabelPx(half)).toBeLessThanOrEqual(MAX_GRID_AXIS_LABEL_PX)
  })

  const collapsedGrid = [
    PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX + 1,
    WINDOW_DEFAULT_WIDTH,
    1366,
    1440,
    1920,
    3440,
  ]

  it.each(collapsedGrid)('two columns on the rail at %ipx keep the label inside the band', (viewport) => {
    const label = axisLabelPx(chartWidthPx(viewport, SIDEBAR_COLLAPSED_PX))
    expect(gridColumns(viewport, SIDEBAR_COLLAPSED_PX)).toBe(2)
    expect(label).toBeGreaterThanOrEqual(MIN_AXIS_LABEL_PX)
    expect(label).toBeLessThanOrEqual(MAX_GRID_AXIS_LABEL_PX)
  })

  it.each([NARROWEST_TESTED_PX, 1100, PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX])(
    'one column on the rail at %ipx stays legible, if larger',
    (viewport) => {
      const label = axisLabelPx(chartWidthPx(viewport, SIDEBAR_COLLAPSED_PX))
      expect(gridColumns(viewport, SIDEBAR_COLLAPSED_PX)).toBe(1)
      expect(label).toBeGreaterThanOrEqual(MIN_AXIS_LABEL_PX)
      expect(label).toBeLessThanOrEqual(MAX_STACKED_AXIS_LABEL_PX)
    },
  )

  /** A wider chart in the same window, at every width — the rail cannot cost the grid anything. */
  it('never leaves a chart narrower than the same window with the column open', () => {
    for (const viewport of [1020, WINDOW_DEFAULT_WIDTH, 1440, 1920, 3440]) {
      expect(chartWidthPx(viewport, SIDEBAR_COLLAPSED_PX)).toBeGreaterThanOrEqual(
        // Above the cap both are the same chart; below it the rail is strictly wider.
        Math.min(chartWidthPx(viewport), chartWidthPx(viewport, SIDEBAR_COLLAPSED_PX)),
      )
    }
  })
})

describe('an axis label renders legibly at every width the grid is used at', () => {
  // 1280 and 1366 left this list in Story #182: with a 220px sidebar they are stacked widths now,
  // and they moved into `stacked` below rather than being dropped.
  const widths = [PERFORMANCE_GRID_BREAKPOINT_PX + 1, 1440, 1536, 1920, 2560, 3440]

  it.each(widths)('two columns at %ipx keep the label inside the band', (viewport) => {
    const label = axisLabelPx(chartWidthPx(viewport))
    expect(gridColumns(viewport)).toBe(2)
    expect(label).toBeGreaterThanOrEqual(MIN_AXIS_LABEL_PX)
    expect(label).toBeLessThanOrEqual(MAX_GRID_AXIS_LABEL_PX)
  })

  /**
   * The half-column at the breakpoint is the binding case — the whole reason the `viewBox`
   * narrowed. Reusing DDR-0018's 1080-unit width here would have put the label at 5.2px.
   */
  it('is the narrowest column that decides the ratio', () => {
    const narrowest = chartWidthPx(PERFORMANCE_GRID_BREAKPOINT_PX + 1)
    expect(axisLabelPx(narrowest)).toBeGreaterThanOrEqual(MIN_AXIS_LABEL_PX)
    expect((AXIS_LABEL_UNITS * narrowest) / 1080).toBeLessThan(6)
  })

  const stacked = [
    NARROWEST_TESTED_PX,
    1100,
    WINDOW_DEFAULT_WIDTH,
    1366,
    PERFORMANCE_GRID_BREAKPOINT_PX,
  ]

  /**
   * Collapsing doubles the chart's width, so it doubles the label — a `viewBox` has no way to
   * decline. Bounded rather than fixed: an oversized label is still legible, and capping the
   * chart's width instead is what DDR-0018 rejected as reading like a rendering bug.
   */
  it.each(stacked)('one column at %ipx stays legible, if larger', (viewport) => {
    const label = axisLabelPx(chartWidthPx(viewport))
    expect(gridColumns(viewport)).toBe(1)
    expect(label).toBeGreaterThanOrEqual(MIN_AXIS_LABEL_PX)
    expect(label).toBeLessThanOrEqual(MAX_STACKED_AXIS_LABEL_PX)
  })
})

describe('the height that follows from the ratio', () => {
  /**
   * Four charts on one screen only works if two rows fit the window that shows them. The widths
   * are the grid's own, which since Story #182 start just above the breakpoint rather than at the
   * default window: the old 4.5:1 in the same column would give 117px, which is where a 3%
   * drawdown stops being a shape and becomes a wobble.
   */
  it('keeps a grid chart between 180 and 300 CSS px tall', () => {
    for (const viewport of [PERFORMANCE_GRID_BREAKPOINT_PX + 1, 1536, 1920, 3440]) {
      const height = chartHeightPx(chartWidthPx(viewport))
      expect(height).toBeGreaterThan(180)
      expect(height).toBeLessThan(300)
    }
  })

  it('is taller than DDR-0018’s ratio would have made it in the same column', () => {
    const width = chartWidthPx(PERFORMANCE_GRID_BREAKPOINT_PX + 1)
    expect(chartHeightPx(width)).toBeGreaterThan((width * 240) / 1080)
  })
})

/**
 * The three charts in the grid share one geometry rather than each declaring its own. They held
 * three byte-identical copies of `const W = 1080` before this story, which is exactly how a set of
 * charts that must agree stops agreeing — the switcher hid it, a grid would not.
 */
describe('the grid’s charts take their geometry from here', () => {
  const CHARTS = ['LineChart', 'BarChart', 'StackedAreaChart']

  const source = (chart: string): string =>
    readFileSync(new URL(`../components/charts/${chart}.tsx`, import.meta.url), 'utf8')

  /**
   * The same source with its comments removed, for the assertions that scan for markup.
   *
   * These charts explain themselves in prose, and the prose names the very tags being searched
   * for: `StackedAreaChart`'s header says it emits "a bare `<svg>`" and that a `<figcaption>`
   * used to sit under the plot. A raw scan therefore finds three `<svg` in a file with one, and
   * finds `<figcaption` in the file that just removed it — passing or failing on the commentary
   * alone. This is the trap DDR-0042 records for `app.css` and DDR-0047 for `CountryMap`; the
   * `//` rule is whole-line only, so a URL in code is not eaten.
   */
  const code = (chart: string): string =>
    source(chart)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

  it.each(CHARTS)('%s imports the shared plot', (chart) => {
    expect(source(chart)).toMatch(/from '\.\.\/\.\.\/lib\/chartGeometry'/)
  })

  it.each(CHARTS)('%s declares no geometry of its own', (chart) => {
    expect(code(chart)).not.toMatch(/^const W = \d/m)
    expect(code(chart)).not.toMatch(/^const H = \d/m)
    expect(code(chart)).not.toMatch(/^const PAD = \{/m)
  })

  /** `ColumnChart` and `PieChart` are not in this grid, and keep their own aspect (DDR-0018). */
  it('does not reach the charts outside the grid', () => {
    for (const chart of ['ColumnChart', 'PieChart']) {
      expect(source(chart)).not.toContain('chartGeometry')
    }
  })

  /**
   * Sharing a `viewBox` makes the three *plots* the same size. It does not make the three *cards*
   * the same size, and that is what a reader sees: `StackedAreaChart` wrapped its plot in a
   * `<figure>` with a `<figcaption>` legend under it, which made the composition card taller than
   * the two beside it. The legend moved into the card header instead (DDR-0052), so all three
   * charts now emit a bare `<svg>` — and nothing else in the suite would notice if one grew a
   * wrapper back.
   */
  it.each(CHARTS)('%s emits a bare svg, with nothing under the plot to change its height', (chart) => {
    expect(code(chart)).not.toMatch(/<figure/)
    expect(code(chart)).not.toMatch(/<figcaption/)
  })

  it('renders the same chart element in every quadrant of the grid', () => {
    // Each chart declares exactly one root `<svg`, carrying the shared viewBox. A second one
    // would be a nested plot, and a nested plot is a second set of dimensions.
    for (const chart of CHARTS) {
      expect(code(chart).match(/<svg\b/g)).toHaveLength(1)
      expect(code(chart)).toMatch(/viewBox=\{`0 0 \$\{W\} \$\{H\}`\}/)
    }
  })
})

/**
 * The four cards themselves. The charts being identical is only half of "the same dimensions" —
 * the card around each one has to be too, and that is decided by the header rather than the plot.
 */
describe('the four cards in the grid are built the same way', () => {
  /** Comment-stripped, for the same reason the chart scans above are. */
  const VIEW = readFileSync(
    new URL('../components/analytics/PerformanceView.tsx', import.meta.url),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

  it('routes every chart through one ChartCard, four times', () => {
    expect(VIEW.match(/<ChartCard\b/g)).toHaveLength(4)
  })

  /**
   * `ChartCard` is the only place a header is declared, so all four are the same height by
   * construction — including the three with nothing to put at the right of it. A card spelling
   * out its own `CardTitle` would be the drift this catches.
   */
  it('declares the header once, inside ChartCard', () => {
    expect(VIEW.match(/<CardHeader\b/g)).toHaveLength(1)
    expect(VIEW.match(/<CardTitle>\{title\}<\/CardTitle>/g)).toHaveLength(1)
  })

  /** The header must not wrap: a wrapped legend puts back the height its move removed. */
  it('pins the single-line header against app.css', () => {
    expect(VIEW).toContain('className="chart-card-header"')
    expect(CSS).toMatch(/\.chart-card-header\s*\{[^}]*flex-wrap:\s*nowrap/)
  })
})
