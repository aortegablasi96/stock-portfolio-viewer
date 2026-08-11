import { describe, expect, it } from 'vitest'
import type { ValuePoint } from '@shared/domain/performance'
import { rebaseSeries, seriesExtent, sliceSeries, valueAt, windowStats } from './performanceRange'

const day = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d)

describe('seriesExtent', () => {
  it('returns null for an empty series', () => {
    expect(seriesExtent([])).toBeNull()
  })

  it('spans the earliest and latest dates', () => {
    const series: ValuePoint[] = [
      { date: day(2024, 1, 1), value: 100 },
      { date: day(2024, 6, 1), value: 120 },
      { date: day(2025, 1, 1), value: 150 },
    ]
    expect(seriesExtent(series)).toEqual({ from: day(2024, 1, 1), to: day(2025, 1, 1) })
  })
})

describe('valueAt (carry-forward)', () => {
  const series: ValuePoint[] = [
    { date: day(2024, 1, 1), value: 100 },
    { date: day(2024, 6, 1), value: 120 },
    { date: day(2024, 12, 1), value: 150 },
  ]

  it('returns the first value when t predates the series', () => {
    expect(valueAt(series, day(2023, 1, 1))).toBe(100)
  })

  it('carries the last point forward between and after points', () => {
    expect(valueAt(series, day(2024, 3, 1))).toBe(100)
    expect(valueAt(series, day(2024, 6, 1))).toBe(120)
    expect(valueAt(series, day(2024, 8, 1))).toBe(120)
    expect(valueAt(series, day(2025, 1, 1))).toBe(150)
  })

  it('returns 0 for an empty series', () => {
    expect(valueAt([], day(2024, 1, 1))).toBe(0)
  })
})

describe('sliceSeries', () => {
  const series: ValuePoint[] = [
    { date: day(2024, 1, 1), value: 100 },
    { date: day(2024, 4, 1), value: 110 },
    { date: day(2024, 7, 1), value: 130 },
    { date: day(2024, 10, 1), value: 125 },
  ]

  it('returns the full series unchanged for a whole-history window', () => {
    expect(sliceSeries(series, { from: day(2024, 1, 1), to: day(2024, 10, 1) })).toEqual(series)
  })

  it('anchors synthetic endpoints at window edges with carry-forward values', () => {
    const out = sliceSeries(series, { from: day(2024, 5, 1), to: day(2024, 8, 1) })
    expect(out[0]).toEqual({ date: day(2024, 5, 1), value: 110 }) // carried from Apr
    expect(out[out.length - 1]).toEqual({ date: day(2024, 8, 1), value: 130 }) // carried from Jul
    // The interior real point (Jul 1) is retained between the anchors.
    expect(out).toContainEqual({ date: day(2024, 7, 1), value: 130 })
  })

  it('returns [] for an empty series', () => {
    expect(sliceSeries([], { from: 0, to: 1 })).toEqual([])
  })
})

describe('rebaseSeries (Story #169)', () => {
  // A cumulative TWR curve (percent) with an inception-to-date baseline: by Jul it is already
  // up 48%, which is exactly the number that used to sit under a "1M" heading.
  const returns: ValuePoint[] = [
    { date: day(2024, 1, 1), value: 0 },
    { date: day(2024, 4, 1), value: 20 },
    { date: day(2024, 7, 1), value: 48 },
    { date: day(2024, 10, 1), value: 52.7 },
  ]

  it('opens the window at 0%', () => {
    const out = rebaseSeries(returns, { from: day(2024, 7, 1), to: day(2024, 10, 1) })
    expect(out[0]!.value).toBe(0)
    expect(out[0]!.date).toBe(day(2024, 7, 1))
  })

  it('opens at 0% even when the window starts between points (carry-forward base)', () => {
    const out = rebaseSeries(returns, { from: day(2024, 5, 1), to: day(2024, 9, 1) })
    expect(out[0]).toEqual({ date: day(2024, 5, 1), value: 0 })
  })

  it('chain-links rather than subtracting', () => {
    const out = rebaseSeries(returns, { from: day(2024, 4, 1), to: day(2024, 7, 1) })
    // (1.48 / 1.20) − 1 = 23.33%, not the 28pp a subtraction would report.
    expect(out[out.length - 1]!.value).toBeCloseTo(23.3333, 4)
    expect(out[out.length - 1]!.value).not.toBeCloseTo(28, 4)
  })

  it('ends exactly on the Time-weighted return tile for the same window', () => {
    const values: ValuePoint[] = returns.map((p) => ({ date: p.date, value: 1000 + p.value * 10 }))
    for (const bounds of [
      { from: day(2024, 1, 1), to: day(2024, 10, 1) },
      { from: day(2024, 4, 1), to: day(2024, 10, 1) },
      { from: day(2024, 5, 15), to: day(2024, 8, 20) },
      { from: day(2024, 7, 1), to: day(2024, 7, 1) },
    ]) {
      const curve = rebaseSeries(returns, bounds)
      // Strict equality, not `toBeCloseTo`: both go through the same chain-link, so a curve
      // that merely rounds to the tile would mean they had drifted apart.
      expect(curve[curve.length - 1]!.value).toBe(windowStats(values, returns, bounds).twr)
    }
  })

  it('is the identity for a full-history window (the series already opens at 0%)', () => {
    expect(rebaseSeries(returns, { from: day(2024, 1, 1), to: day(2024, 10, 1) })).toEqual(returns)
  })

  it('rebases off a negative opening return', () => {
    const drawdown: ValuePoint[] = [
      { date: day(2024, 1, 1), value: 0 },
      { date: day(2024, 6, 1), value: -20 },
      { date: day(2024, 12, 1), value: -4 },
    ]
    const out = rebaseSeries(drawdown, { from: day(2024, 6, 1), to: day(2024, 12, 1) })
    expect(out[0]!.value).toBe(0)
    // (0.96 / 0.80) − 1 = +20%: recovering from −20% to −4% is a 20% gain over the window.
    expect(out[out.length - 1]!.value).toBeCloseTo(20)
  })

  it('returns a single 0% point for a single-instant window', () => {
    const out = rebaseSeries(returns, { from: day(2024, 4, 1), to: day(2024, 4, 1) })
    expect(out).toEqual([{ date: day(2024, 4, 1), value: 0 }])
  })

  it('returns [] for an empty series', () => {
    expect(rebaseSeries([], { from: day(2024, 1, 1), to: day(2024, 10, 1) })).toEqual([])
  })

  it('degrades instead of dividing by zero when the window opens at a total loss', () => {
    // −100% is the one base the chain-link cannot take: the denominator is zero.
    const wipeout: ValuePoint[] = [
      { date: day(2024, 1, 1), value: 0 },
      { date: day(2024, 6, 1), value: -100 },
      { date: day(2024, 12, 1), value: -100 },
    ]
    const out = rebaseSeries(wipeout, { from: day(2024, 6, 1), to: day(2024, 12, 1) })
    expect(out.map((p) => p.value)).toEqual([0, 0])
    for (const p of out) expect(Number.isFinite(p.value)).toBe(true)

    // Same degradation on the tile, so the two still agree in the degenerate case.
    const values: ValuePoint[] = [
      { date: day(2024, 1, 1), value: 1000 },
      { date: day(2024, 6, 1), value: 0 },
      { date: day(2024, 12, 1), value: 0 },
    ]
    const stats = windowStats(values, wipeout, { from: day(2024, 6, 1), to: day(2024, 12, 1) })
    expect(stats.twr).toBe(out[out.length - 1]!.value)
  })
})

describe('windowStats', () => {
  const valueSeries: ValuePoint[] = [
    { date: day(2024, 1, 1), value: 100 },
    { date: day(2024, 6, 1), value: 120 },
    { date: day(2024, 12, 1), value: 150 },
  ]
  // Cumulative TWR curve (percent) aligned to the same dates.
  const returnSeries: ValuePoint[] = [
    { date: day(2024, 1, 1), value: 0 },
    { date: day(2024, 6, 1), value: 10 },
    { date: day(2024, 12, 1), value: 21 },
  ]

  it('computes whole-history change and TWR for the full window', () => {
    const s = windowStats(valueSeries, returnSeries, { from: day(2024, 1, 1), to: day(2024, 12, 1) })
    expect(s.endValue).toBe(150)
    expect(s.changeAbs).toBe(50)
    expect(s.changePct).toBeCloseTo(50)
    expect(s.twr).toBeCloseTo(21)
  })

  it('windows change and chain-links TWR between two cumulative endpoints', () => {
    // From the Jun 1 point (TWR 10%) to Dec 1 (TWR 21%): (1.21/1.10 − 1) = 10%.
    const s = windowStats(valueSeries, returnSeries, { from: day(2024, 6, 1), to: day(2024, 12, 1) })
    expect(s.endValue).toBe(150)
    expect(s.changeAbs).toBe(30)
    expect(s.changePct).toBeCloseTo(25)
    expect(s.twr).toBeCloseTo(10)
  })

  it('reports a null percentage when the start value is zero', () => {
    const zeroStart: ValuePoint[] = [
      { date: day(2024, 1, 1), value: 0 },
      { date: day(2024, 6, 1), value: 40 },
    ]
    const s = windowStats(zeroStart, returnSeries, { from: day(2024, 1, 1), to: day(2024, 6, 1) })
    expect(s.changeAbs).toBe(40)
    expect(s.changePct).toBeNull()
  })
})
