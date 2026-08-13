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

/** Narrowest window the walk covers. Below this every view in the app is squeezed, not just this one. */
const NARROWEST_TESTED_PX = 800

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
  it('states the same width in app.css', () => {
    expect(CSS).toMatch(
      new RegExp(
        `@media \\(max-width: ${PERFORMANCE_GRID_BREAKPOINT_PX}px\\)\\s*\\{\\s*\\.performance-charts\\s*\\{\\s*grid-template-columns:\\s*1fr;`,
      ),
    )
  })

  /**
   * The reason it is 1200 and not a rounder 1280: a fresh install opens 1280px wide, and a
   * breakpoint at or above that would ship the grid to nobody who had not first resized.
   */
  it('sits below the default window width, so a fresh install opens on the grid', () => {
    expect(PERFORMANCE_GRID_BREAKPOINT_PX).toBeLessThan(WINDOW_DEFAULT_WIDTH)
    expect(gridColumns(WINDOW_DEFAULT_WIDTH)).toBe(2)
  })
})

describe('an axis label renders legibly at every width the grid is used at', () => {
  const widths = [
    PERFORMANCE_GRID_BREAKPOINT_PX + 1,
    WINDOW_DEFAULT_WIDTH,
    1366,
    1440,
    1536,
    1920,
    2560,
    3440,
  ]

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

  const stacked = [NARROWEST_TESTED_PX, 1024, 1100, PERFORMANCE_GRID_BREAKPOINT_PX]

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
   * Four charts on one screen only works if two rows fit a normal window. At the default 1280
   * these are 197px each; the old 4.5:1 in the same column would have given 122px, which is where
   * a 3% drawdown stops being a shape and becomes a wobble.
   */
  it('keeps a grid chart between 180 and 300 CSS px tall', () => {
    for (const viewport of [WINDOW_DEFAULT_WIDTH, 1536, 1920, 3440]) {
      const height = chartHeightPx(chartWidthPx(viewport))
      expect(height).toBeGreaterThan(180)
      expect(height).toBeLessThan(300)
    }
  })

  it('is taller than DDR-0018’s ratio would have made it in the same column', () => {
    const width = chartWidthPx(WINDOW_DEFAULT_WIDTH)
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

  it.each(CHARTS)('%s imports the shared plot', (chart) => {
    expect(source(chart)).toMatch(/from '\.\.\/\.\.\/lib\/chartGeometry'/)
  })

  it.each(CHARTS)('%s declares no geometry of its own', (chart) => {
    const code = source(chart)
    expect(code).not.toMatch(/^const W = \d/m)
    expect(code).not.toMatch(/^const H = \d/m)
    expect(code).not.toMatch(/^const PAD = \{/m)
  })

  /** `ColumnChart` and `PieChart` are not in this grid, and keep their own aspect (DDR-0018). */
  it('does not reach the charts outside the grid', () => {
    for (const chart of ['ColumnChart', 'PieChart']) {
      expect(source(chart)).not.toContain('chartGeometry')
    }
  })
})
