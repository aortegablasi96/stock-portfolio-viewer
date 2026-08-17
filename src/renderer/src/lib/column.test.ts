import { describe, it, expect } from 'vitest'
import { bandIndexAt, columnDomain, type ColumnDatum } from './column'

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
