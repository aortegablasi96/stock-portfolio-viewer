import { describe, it, expect } from 'vitest'
import {
  COLUMN_BAND_UNITS,
  COLUMN_PLOT_FLOOR,
  bandIndexAt,
  columnDomain,
  columnPlot,
  stackedTooltipRows,
  type ColumnDatum,
} from './column'
import { INK_NEGATIVE, INK_POSITIVE, tooltipLayout } from './chartTooltip'

function col(lower: number, upper: number): ColumnDatum {
  return { lower, upper }
}

/** Ticks must be evenly spaced, low → high, and include a zero baseline. */
function assertEvenAndZeroed(ticks: number[]): void {
  expect(ticks).toContain(0)
  expect([...ticks].sort((a, b) => a - b)).toEqual(ticks)
  const steps: number[] = []
  for (let i = 1; i < ticks.length; i++) steps.push(ticks[i]! - ticks[i - 1]!)
  for (const s of steps) expect(s).toBeCloseTo(steps[0]!, 6)
}

describe('columnDomain', () => {
  it('spans 0 → a round top for an all-positive history, evenly stepped', () => {
    // Gross = lower + upper: 30 and 100.
    const domain = columnDomain([col(20, 10), col(80, 20)])

    expect(domain.bottom).toBe(0)
    expect(domain.top).toBe(100)
    expect(domain.ticks).toEqual([0, 50, 100])
    assertEvenAndZeroed(domain.ticks)
  })

  it('extends below zero, on a round even step, when a net (lower) value is negative', () => {
    // Second month: withholding (30) exceeds the dividend (10), so net = -20 (Story #49).
    // Largest gross is 40 + 10 = 50; the axis rounds out to a uniform ±step grid around zero.
    const domain = columnDomain([col(40, 10), col(-20, 30)])

    expect(domain.bottom).toBe(-20)
    expect(domain.top).toBe(60)
    expect(domain.ticks).toEqual([-20, 0, 20, 40, 60])
    assertEvenAndZeroed(domain.ticks)
  })

  it('keeps a labelled zero between the negative and positive extremes', () => {
    const domain = columnDomain([col(-15, 5), col(60, 40)])

    expect(domain.ticks).toEqual([-50, 0, 50, 100])
    assertEvenAndZeroed(domain.ticks)
  })

  it('never lets an all-negative history push the top above zero, and avoids a duplicate 0', () => {
    // Pure withholding months with no dividend: gross is 0, nets are negative. The old coarse
    // grid produced a degenerate [-25, 0, 0]; the axis now steps evenly up to a single zero.
    const domain = columnDomain([col(-10, 0), col(-25, 0)])

    expect(domain.top).toBe(0)
    expect(domain.bottom).toBe(-30)
    expect(domain.ticks).toEqual([-30, -20, -10, 0])
    assertEvenAndZeroed(domain.ticks)
  })

  it('handles a single column', () => {
    expect(columnDomain([col(10, 5)])).toEqual({ top: 15, bottom: 0, ticks: [0, 5, 10, 15] })
  })

  it('collapses to a single 0 tick for no columns', () => {
    expect(columnDomain([])).toEqual({ top: 0, bottom: 0, ticks: [0] })
  })

  it('collapses to a single 0 tick when every column is zero', () => {
    expect(columnDomain([col(0, 0), col(0, 0)])).toEqual({ top: 0, bottom: 0, ticks: [0] })
  })
})

/**
 * The daily-return chart's hover target. The plot below is the real one: `PERFORMANCE_PLOT` is
 * 500 wide with `pad.left` 64 and `pad.right` 16, leaving 420 units of bands.
 */
describe('bandIndexAt', () => {
  const LEFT = 64
  const PLOT_W = 420

  it('splits the plot into one band per point, left to right', () => {
    // Four bands of 105 units each: [64,169) [169,274) [274,379) [379,484).
    expect(bandIndexAt(64, LEFT, PLOT_W, 4)).toBe(0)
    expect(bandIndexAt(200, LEFT, PLOT_W, 4)).toBe(1)
    expect(bandIndexAt(280, LEFT, PLOT_W, 4)).toBe(2)
    expect(bandIndexAt(483, LEFT, PLOT_W, 4)).toBe(3)
  })

  it('puts a band boundary in the band to its right, so no x belongs to two days', () => {
    expect(bandIndexAt(168.9, LEFT, PLOT_W, 4)).toBe(0)
    expect(bandIndexAt(169, LEFT, PLOT_W, 4)).toBe(1)
  })

  it('clamps into the plot rather than blanking out over the axis padding', () => {
    // The left pad is the currency label's allowance, not a gap between days: a readout that
    // vanished there would flicker along the whole edge of the chart.
    expect(bandIndexAt(0, LEFT, PLOT_W, 4)).toBe(0)
    expect(bandIndexAt(-500, LEFT, PLOT_W, 4)).toBe(0)
    expect(bandIndexAt(500, LEFT, PLOT_W, 4)).toBe(3)
  })

  it('resolves a day at real density, where the bar itself is a hairline', () => {
    // 191 trading days across 420 units: a band is 2.2 units wide and the bar inside it is
    // thinner still (DDR-0049), which is exactly why the band is the hit target.
    expect(bandIndexAt(LEFT + 0.5, LEFT, PLOT_W, 191)).toBe(0)
    expect(bandIndexAt(LEFT + PLOT_W / 2, LEFT, PLOT_W, 191)).toBe(95)
    expect(bandIndexAt(LEFT + PLOT_W - 0.5, LEFT, PLOT_W, 191)).toBe(190)
  })

  it('always lands on a real index for any x, so the readout cannot read off the end', () => {
    for (let x = -50; x <= 550; x += 7) {
      const i = bandIndexAt(x, LEFT, PLOT_W, 191)
      expect(i).not.toBeNull()
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(191)
    }
  })

  it('has no band to hit in an empty series or a collapsed plot', () => {
    expect(bandIndexAt(100, LEFT, PLOT_W, 0)).toBeNull()
    expect(bandIndexAt(100, LEFT, 0, 4)).toBeNull()
  })

  it('finds the single band of a one-point series wherever the pointer is', () => {
    expect(bandIndexAt(LEFT, LEFT, PLOT_W, 1)).toBe(0)
    expect(bandIndexAt(LEFT + PLOT_W, LEFT, PLOT_W, 1)).toBe(0)
  })
})

/**
 * The stacked chart's own plot, and the hover card drawn inside it (Story #236, DDR-0077).
 *
 * The card was the last native `<title>` in the app. What no test can see about the move is where
 * the card lands, because Vitest has no jsdom and nothing here renders the `<g>` (DDR-0029) — so
 * what is checked is the arithmetic, at **both ends of the history**: a few months, where the plot
 * sits on its floor, and several years, where it is three times as wide.
 */
describe('columnPlot', () => {
  it('sits on its floor until the columns need more room than the floor holds', () => {
    // Twelve months is 672 units of bands inside an 80-unit text allowance — well under 1080.
    expect(columnPlot(12).width).toBe(COLUMN_PLOT_FLOOR)
    expect(columnPlot(1).width).toBe(COLUMN_PLOT_FLOOR)
  })

  it('widens by one band per column once past it, and never shortens', () => {
    const years = columnPlot(60)
    expect(years.width).toBe(80 + 60 * COLUMN_BAND_UNITS)
    expect(years.width).toBeGreaterThan(COLUMN_PLOT_FLOOR)
    // The height is fixed, which is the whole of the widening trap: a unit buys less of the screen
    // at a long history, and every mark in the plot pays that equally (DDR-0018).
    expect(years.height).toBe(columnPlot(12).height)
  })

  it('keeps a band exactly one column wide at any length', () => {
    for (const count of [1, 12, 24, 60, 240]) {
      const { width, pad } = columnPlot(count)
      const band = (width - pad.left - pad.right) / count
      expect(band).toBeGreaterThanOrEqual(count > 17 ? COLUMN_BAND_UNITS : 0)
    }
    expect((columnPlot(60).width - 80) / 60).toBe(COLUMN_BAND_UNITS)
  })
})

describe('the hover card inside a widening plot', () => {
  const ROWS = [
    { label: 'Gross', value: '€1,234.56' },
    { label: 'Withholding tax', value: '€123.45' },
    { label: 'Net', value: '€1,111.11' },
  ]

  /**
   * The card is the same size in `viewBox` units at both ends, and that is the answer to the trap
   * rather than an omission: it therefore holds the same relationship to the 11-unit axis labels
   * beside it whatever the history's length, and shrinks on screen only because the whole chart
   * does. A card sized in page pixels would do the opposite — grow against the plot until it
   * covered the columns it was reporting on.
   */
  it('is drawn at one size in the chart’s own units, at a few months and at several years', () => {
    const months = columnPlot(12)
    const years = columnPlot(60)
    const near = tooltipLayout(months.pad.left + 40, 'Jul 2026', ROWS, months)
    const far = tooltipLayout(years.pad.left + 40, 'Jul 2026', ROWS, years)

    expect(far.width).toBe(near.width)
    expect(far.height).toBe(near.height)
    // Which means it is a *smaller share* of the plot at the long end, never a larger one.
    expect(far.width / years.width).toBeLessThan(near.width / months.width)
  })

  it('never leaves the plot, at any anchor and at either end', () => {
    for (const count of [4, 12, 24, 60, 240]) {
      const plot = columnPlot(count)
      const right = plot.width - plot.pad.right
      for (let anchorX = plot.pad.left; anchorX <= right; anchorX += Math.max(7, count)) {
        const box = tooltipLayout(anchorX, 'December 2026', ROWS, plot)
        expect(box.x, `${count} columns at ${anchorX}`).toBeGreaterThanOrEqual(plot.pad.left)
        expect(box.x + box.width).toBeLessThanOrEqual(right)
        expect(box.y).toBe(plot.pad.top)
        expect(box.y + box.height).toBeLessThan(plot.height - plot.pad.bottom)
      }
    }
  })

  /**
   * The floor is a floor on the *card*, not on the plot, so a four-month history — the narrowest
   * plot there is — still has room for it several times over. The failure this catches is a card
   * that fits the twelve-month chart the story was reviewed against and clips on a new import.
   */
  it('fits inside the narrowest plot the chart draws', () => {
    const plot = columnPlot(1)
    const box = tooltipLayout(plot.pad.left, 'December 2026', ROWS, plot)
    expect(box.width).toBeLessThan(plot.width - plot.pad.left - plot.pad.right)
  })
})

describe('stackedTooltipRows', () => {
  const c = (v: number): string => `€${v.toFixed(2)}`
  const LABELS = { total: 'Gross', upper: 'Withholding tax', lower: 'Net' }

  it('reports the column top-down: what was declared, what was taken, what landed', () => {
    const rows = stackedTooltipRows(col(80, 20), LABELS, c)
    expect(rows.map((r) => r.label)).toEqual(['Gross', 'Withholding tax', 'Net'])
    // Gross is the column's height — the sum, never a fourth figure carried alongside it.
    expect(rows.map((r) => r.value)).toEqual(['€100.00', '€20.00', '€80.00'])
  })

  /** A row that does not exist is absent, not zero — and the card shrinks to fit. */
  it('drops the withholding row for a month with nothing withheld', () => {
    const rows = stackedTooltipRows(col(80, 0), LABELS, c)
    expect(rows.map((r) => r.label)).toEqual(['Gross', 'Net'])
    expect(rows.some((r) => r.value === '€0.00')).toBe(false)
  })

  /**
   * The month the chart cannot draw. Where withholding outweighs the dividends the upper segment
   * is not stacked at all, so the card is the only place that figure appears — dropping it with
   * the segment is the regression this asserts against.
   */
  it('still reports the withholding of a negative month, and a gross of exactly zero', () => {
    const rows = stackedTooltipRows(col(-6.02, 6.02), LABELS, c)
    expect(rows.map((r) => r.label)).toEqual(['Gross', 'Withholding tax', 'Net'])
    expect(rows[0]!.value).toBe('€0.00')
    expect(rows[1]!.value).toBe('€6.02')
  })

  it('tones the net by its sign, and a flat month not at all', () => {
    expect(stackedTooltipRows(col(80, 20), LABELS, c).at(-1)!.ink).toBe(INK_POSITIVE)
    expect(stackedTooltipRows(col(-6, 6), LABELS, c).at(-1)!.ink).toBe(INK_NEGATIVE)
    expect(stackedTooltipRows(col(0, 0), LABELS, c).at(-1)!.ink).toBeUndefined()
  })

  /**
   * Only the signed row is toned. Withholding is a deduction by construction, so a loss tone there
   * restates the label rather than adding a channel — DDR-0065's reasoning for the untoned trade
   * side, arriving at the same answer from the other direction.
   */
  it('leaves gross and withholding untoned', () => {
    const rows = stackedTooltipRows(col(-6, 6), LABELS, c)
    expect(rows[0]!.ink).toBeUndefined()
    expect(rows[1]!.ink).toBeUndefined()
  })

  it('omits the total row for a chart with no total worth naming', () => {
    const rows = stackedTooltipRows(col(80, 20), { upper: 'Tax', lower: 'Net' }, c)
    expect(rows.map((r) => r.label)).toEqual(['Tax', 'Net'])
  })
})
