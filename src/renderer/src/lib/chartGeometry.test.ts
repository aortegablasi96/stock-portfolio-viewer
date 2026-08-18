import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  AXIS_LABEL_UNITS,
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
   * The padding is an allowance for text, not a fraction of the plot: `left: 64` is what a
   * formatted currency label occupies at 11 units, and that did not change when the chart did.
   * Shrinking it in proportion to the width is the plausible mistake this pins against.
   */
  it('keeps DDR-0018’s padding, because it is sized by the label rather than by the plot', () => {
    expect(PERFORMANCE_PLOT.pad).toEqual({ top: 16, right: 16, bottom: 28, left: 64 })
    expect(PERFORMANCE_PLOT.pad.left).toBeGreaterThan(AXIS_LABEL_UNITS * 5)
  })

  it('leaves a usable plot after the padding', () => {
    const { width, height, pad } = PERFORMANCE_PLOT
    expect(width - pad.left - pad.right).toBeGreaterThan(400)
    expect(height - pad.top - pad.bottom).toBeGreaterThan(130)
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
