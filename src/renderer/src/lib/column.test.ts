import { describe, it, expect } from 'vitest'
import {
  COLUMN_BAND_UNITS,
  axisTicks,
  COLUMN_MONTH_PX,
  COLUMN_PLOT_MIN_ASPECT,
  COLUMN_PLOT_PAD,
  COLUMN_UNIT_PX,
  bandIndexAt,
  columnAxisLabelPx,
  columnDomain,
  columnPlot,
  columnPlotWidthPx,
  pairedDomain,
  pairedTooltipRows,
  type ColumnDatum,
  type PairedDatum,
} from './column'
import {
  AXIS_LABEL_ADVANCE_UNITS,
  AXIS_LABEL_UNITS,
  MIN_AXIS_LABEL_PX,
} from './chartGeometry'
import { INK_NEGATIVE, INK_POSITIVE, tooltipLayout, type TooltipRow } from './chartTooltip'

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
 * The paired chart's plot, its pixel width, and the hover card drawn inside it
 * (Stories #236, #241; DDR-0077, DDR-0078).
 *
 * Nothing here can be observed — Vitest runs in Node with no jsdom, so nothing renders the `<svg>`
 * and measures it (DDR-0029). What can be checked is the arithmetic, and after #241 the arithmetic
 * is the whole decision: a month is worth a fixed number of pixels, so what has to hold is that
 * **a mark renders the same size at any history length**, checked at both ends.
 */
describe('columnPlot', () => {
  /**
   * The floor is an **aspect**, not a column count, and the reason is the card's *height*: the
   * `<svg>` keeps its ratio when it stretches to fill a wider card, so a short history in a narrow
   * plot is a tall card. A twelve-month floor was tried and rendered the same thirteen bars at
   * 376px instead of 282px.
   */
  it('floors on its aspect, so a short history is not a tall card or a row of slabs', () => {
    const floor = columnPlot(1)
    expect(floor.width / floor.height).toBe(COLUMN_PLOT_MIN_ASPECT)
    expect(columnPlot(13).width).toBe(floor.width)
    // Under the floor the bands widen instead: three pairs spread across the axis, not three slabs.
    const { width, pad } = columnPlot(3)
    expect((width - pad.left - pad.right) / 3).toBeGreaterThan(COLUMN_BAND_UNITS)
  })

  /** The floor fits the card of a default window, so today's import renders as it always did. */
  it('keeps the floor inside a default window, so the scroll starts where shrinking would have', () => {
    expect(columnPlotWidthPx(columnPlot(1))).toBeLessThan(1107)
  })

  it('grows by one band a month past the floor, and never changes height', () => {
    // Derived from the pad rather than restated: Story #243 took the left allowance to zero when
    // the value axis left the `viewBox`, and a hard-coded sum here would have to be found by hand.
    const text = COLUMN_PLOT_PAD.left + COLUMN_PLOT_PAD.right
    expect(columnPlot(60).width).toBe(text + 60 * COLUMN_BAND_UNITS)
    expect((columnPlot(60).width - text) / 60).toBe(COLUMN_BAND_UNITS)
    expect(columnPlot(60).height).toBe(columnPlot(13).height)
  })

  /**
   * The gutter is HTML beside the plot since Story #243, so the `viewBox` reserves nothing for it.
   * A left pad growing back would indent every bar behind a column that is no longer there.
   */
  it('reserves no room for a value axis it no longer draws', () => {
    expect(COLUMN_PLOT_PAD.left).toBe(0)
  })

  /**
   * The band is the *month label's* number, not the bars'. `Jul 2026` is eight glyphs at the
   * measured advance, and a band narrower than that collides two labels — which is why this chart
   * lengthens where `BarChart` thins (DDR-0049).
   */
  it('keeps a band wide enough for the month label that names it', () => {
    expect(COLUMN_BAND_UNITS).toBeGreaterThan('Jul 2026'.length * AXIS_LABEL_ADVANCE_UNITS)
  })
})

describe('the plot’s width in pixels', () => {
  /**
   * The story's whole point, and the property that was missing before it. A unit was worth
   * whatever the card's width divided by the history made it, so an 11-unit axis label rendered
   * 11.3px at thirteen months and 3.5px at five years — the chart being the only one in the app
   * not held to `MIN_AXIS_LABEL_PX`. Now the size is a constant and the plot gets longer instead.
   */
  it('renders a mark at the same size at one year and at five', () => {
    for (const count of [1, 12, 13, 24, 60, 240]) {
      const plot = columnPlot(count)
      expect(columnPlotWidthPx(plot) / plot.width, `${count} months`).toBeCloseTo(COLUMN_UNIT_PX, 9)
    }
  })

  /**
   * Derived from the two constants that already state the constraint, not picked. An axis label is
   * `AXIS_LABEL_UNITS` units and may not render below `MIN_AXIS_LABEL_PX`; both are 11, so a unit
   * is a pixel. It is the *smallest* value that clears the floor, which is the half that matters:
   * every pixel above it is plot the reader has to scroll.
   */
  it('takes its pixels a unit from the legibility floor rather than from taste', () => {
    expect(COLUMN_UNIT_PX).toBe(MIN_AXIS_LABEL_PX / AXIS_LABEL_UNITS)
    expect(columnAxisLabelPx()).toBe(MIN_AXIS_LABEL_PX)
    expect(COLUMN_MONTH_PX).toBe(COLUMN_BAND_UNITS * COLUMN_UNIT_PX)
  })

  /** A year of history is a plot a normal window can hold; the scroll is for what comes after. */
  it('fits a year inside a default window, and lengthens past it', () => {
    const year = columnPlotWidthPx(columnPlot(12))
    expect(year).toBeLessThan(1107)
    expect(columnPlotWidthPx(columnPlot(60))).toBeGreaterThan(year)
    // Strictly monotonic past the floor: one more month is one more band, never a rescale.
    const step = columnPlotWidthPx(columnPlot(25)) - columnPlotWidthPx(columnPlot(24))
    expect(step).toBeCloseTo(COLUMN_MONTH_PX, 9)
  })
})

describe('pairedDomain', () => {
  const pair = (primary: number, secondary: number): PairedDatum => ({ primary, secondary })

  /**
   * The axis spans zero again (Story #246): income above the line, tax below it. The `secondary`
   * is what reaches downward, so the bottom is its largest value negated — not the smallest net,
   * which is the stacked domain's rule and would scale the plot to a figure nothing draws.
   */
  it('spans zero, with the primary above it and the secondary below', () => {
    const domain = pairedDomain([pair(80, 20), pair(40, 5)])
    expect(domain.top).toBeGreaterThanOrEqual(80)
    expect(domain.bottom).toBeLessThanOrEqual(-20)
    expect(domain.ticks).toContain(0)
  })

  /**
   * The two extremes are independent. A month whose only entry is withholding has a gross of zero,
   * so neither side can be derived from the other: the top must still clear the largest *primary*
   * and the bottom the largest *secondary*, even when they fall in different months.
   */
  it('takes each extreme from its own series, across different months', () => {
    const domain = pairedDomain([pair(0, 6.02), pair(1, 0)])
    expect(domain.top).toBeGreaterThanOrEqual(1)
    expect(domain.bottom).toBeLessThanOrEqual(-6.02)
  })

  /**
   * The month DDR-0078 gave up and this story restores: withholding outweighing gross. It must
   * reach further below the line than the income reaches above it, which is the whole picture.
   */
  it('lets a month’s withholding outreach its gross, below the line', () => {
    const domain = pairedDomain([pair(10, 40)])
    expect(domain.bottom).toBeLessThanOrEqual(-40)
    expect(Math.abs(domain.bottom)).toBeGreaterThan(domain.top)
  })

  /** No input changes sign: a bar is negated by its series, never by its value. */
  it('never sends a primary below the line, however small', () => {
    const domain = pairedDomain([pair(0, 0), pair(0, 12)])
    expect(domain.top).toBeGreaterThanOrEqual(0)
    expect(domain.bottom).toBeLessThanOrEqual(-12)
  })

  it('collapses to a single 0 tick for an empty history', () => {
    expect(pairedDomain([])).toEqual({ top: 0, bottom: 0, ticks: [0] })
  })

  it('collapses to a single 0 tick for an all-zero history', () => {
    expect(pairedDomain([pair(0, 0), pair(0, 0)])).toEqual({ top: 0, bottom: 0, ticks: [0] })
  })
})

describe('the hover card inside the plot', () => {
  const ROWS: TooltipRow[] = [
    { label: 'Gross', value: '€1,234.56' },
    { label: 'Withholding tax', value: '€123.45' },
    { label: 'Net', value: '€1,111.11' },
  ]

  it('never leaves the plot, at any anchor and at any history length', () => {
    for (const count of [4, 12, 24, 60, 240]) {
      const plot = columnPlot(count)
      const right = plot.width - plot.pad.right
      for (let anchorX = plot.pad.left; anchorX <= right; anchorX += Math.max(7, count)) {
        const box = tooltipLayout(anchorX, 'December 2026', ROWS, plot)
        expect(box.x, `${count} months at ${anchorX}`).toBeGreaterThanOrEqual(plot.pad.left)
        expect(box.x + box.width).toBeLessThanOrEqual(right)
        expect(box.y).toBe(plot.pad.top)
        expect(box.y + box.height).toBeLessThan(plot.height - plot.pad.bottom)
      }
    }
  })

  /**
   * The card is one size in units and now also one size on screen, because a unit is. Before #241
   * it held its relation to the axis labels beside it and shrank with them; now neither shrinks.
   */
  it('is the same card on screen at a year and at five', () => {
    const near = tooltipLayout(120, 'Jul 2026', ROWS, columnPlot(12))
    const far = tooltipLayout(120, 'Jul 2026', ROWS, columnPlot(60))
    expect(far.width).toBe(near.width)
    expect(far.height).toBe(near.height)
    expect(far.width * COLUMN_UNIT_PX).toBe(near.width * COLUMN_UNIT_PX)
  })

  it('fits inside the narrowest plot the chart draws', () => {
    const plot = columnPlot(1)
    const box = tooltipLayout(plot.pad.left, 'December 2026', ROWS, plot)
    expect(box.width).toBeLessThan(plot.width - plot.pad.left - plot.pad.right)
  })
})

describe('pairedTooltipRows', () => {
  const c = (v: number): string => `EUR ${v.toFixed(2)}`
  const LABELS = { primary: 'Gross', secondary: 'Withholding tax', difference: 'Net' }
  const pair = (primary: number, secondary: number): PairedDatum => ({ primary, secondary })

  it('reports the month in the order it happened: declared, taken, landed', () => {
    const rows = pairedTooltipRows(pair(100, 20), LABELS, c)
    expect(rows.map((r) => r.label)).toEqual(['Gross', 'Withholding tax', 'Net'])
    // The difference is derived here, not carried as a fourth figure that could disagree.
    expect(rows.map((r) => r.value)).toEqual(['EUR 100.00', 'EUR 20.00', 'EUR 80.00'])
  })

  /** A row that does not exist is absent, not zero — and the card shrinks to fit. */
  it('drops the withholding row for a month with nothing withheld', () => {
    const rows = pairedTooltipRows(pair(80, 0), LABELS, c)
    expect(rows.map((r) => r.label)).toEqual(['Gross', 'Net'])
    expect(rows.some((r) => r.value === 'EUR 0.00')).toBe(false)
  })

  /**
   * The month the chart no longer draws a signed mark for. Since #241 nothing hangs below the
   * baseline, so the card is the only place the negative net appears — dropping it with the
   * downward bar is the regression this asserts against.
   */
  it('keeps a negative net, beside a gross of exactly zero', () => {
    const rows = pairedTooltipRows(pair(0, 6.02), LABELS, c)
    expect(rows.map((r) => r.label)).toEqual(['Gross', 'Withholding tax', 'Net'])
    expect(rows[0]!.value).toBe('EUR 0.00')
    expect(rows[2]!.value).toBe('EUR -6.02')
  })

  it('tones the net by its sign, and a flat month not at all', () => {
    expect(pairedTooltipRows(pair(100, 20), LABELS, c).at(-1)!.ink).toBe(INK_POSITIVE)
    expect(pairedTooltipRows(pair(0, 6), LABELS, c).at(-1)!.ink).toBe(INK_NEGATIVE)
    expect(pairedTooltipRows(pair(0, 0), LABELS, c).at(-1)!.ink).toBeUndefined()
  })

  /**
   * Only the difference is toned, and after #241 that is also the only row the chart does not
   * draw. The two bars are their own channel; a loss tone on a deduction restates its label —
   * DDR-0065's reasoning for the untoned trade side, from the other direction.
   */
  it('leaves both drawn bars untoned', () => {
    const rows = pairedTooltipRows(pair(0, 6), LABELS, c)
    expect(rows[0]!.ink).toBeUndefined()
    expect(rows[1]!.ink).toBeUndefined()
  })

  it('omits the difference row where the chart has no third figure to name', () => {
    const rows = pairedTooltipRows(pair(100, 20), { primary: 'In', secondary: 'Out' }, c)
    expect(rows.map((r) => r.label)).toEqual(['In', 'Out'])
  })
})

/**
 * The value axis, now that it is HTML beside the plot rather than `<text>` inside it
 * (Story #243, DDR-0079).
 *
 * The one thing that can go wrong and would not look wrong is a label drifting off its gridline,
 * and it cannot be observed here — Vitest has no jsdom, so nothing lays the grid out (DDR-0029).
 * What is checkable is that the offsets come from the *same* mapping the gridlines are drawn with,
 * and that they are expressed as a proportion, which is the only form that survives a plot whose
 * rendered height is decided by the card it lands in.
 */
describe('axisTicks', () => {
  const PLOT = columnPlot(13)
  // The chart's own mapping, copied from the component: value → unit, over the padded plot area.
  const plotH = PLOT.height - PLOT.pad.top - PLOT.pad.bottom
  const y = (v: number): number => PLOT.pad.top + plotH - (v / 200) * plotH

  it('places a tick where the gridline it names is drawn', () => {
    for (const tick of axisTicks([0, 50, 100, 150, 200], PLOT, y)) {
      expect(tick.topPercent).toBeCloseTo((y(tick.value) / PLOT.height) * 100, 9)
    }
  })

  /**
   * A proportion, never a length. The plot stretches to fill a card wider than its natural width,
   * so its rendered height is not a number this module knows — and the gutter is only as tall as
   * the plot because they share a grid row. A percentage is what is true at both ends of that.
   */
  it('expresses every offset as a share of the plot’s own height', () => {
    for (const tick of axisTicks([0, 100, 200], PLOT, y)) {
      expect(tick.topPercent).toBeGreaterThanOrEqual(0)
      expect(tick.topPercent).toBeLessThanOrEqual(100)
    }
    // The extremes land inside the padded plot area, not on the `viewBox`'s own edges: the top
    // tick sits at `pad.top` and the zero line at `pad.bottom` off the floor.
    const [zero, , top] = axisTicks([0, 100, 200], PLOT, y)
    expect(top!.topPercent).toBeCloseTo((PLOT.pad.top / PLOT.height) * 100, 9)
    expect(zero!.topPercent).toBeCloseTo(
      ((PLOT.height - PLOT.pad.bottom) / PLOT.height) * 100,
      9,
    )
  })

  /** Evenly-stepped ticks stay evenly stepped in the gutter — the mapping is linear either side. */
  it('keeps an even domain evenly spaced down the column', () => {
    const offsets = axisTicks([0, 50, 100, 150, 200], PLOT, y).map((t) => t.topPercent)
    const steps = offsets.slice(1).map((o, i) => o - offsets[i]!)
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 9)
  })

  it('has nothing to place for an empty axis', () => {
    expect(axisTicks([], PLOT, y)).toEqual([])
  })
})
