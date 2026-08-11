import { describe, expect, it } from 'vitest'
import type { ValuePoint } from '@shared/domain/performance'
import { dailyReturns } from './dailyReturns'
import { rebaseSeries } from './performanceRange'

const day = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d)

describe('dailyReturns', () => {
  it('has no returns to report for an empty series', () => {
    expect(dailyReturns([])).toEqual([])
  })

  it('has no returns to report for a single point', () => {
    // A window holding one observation describes no movement: there is nothing to move *from*.
    expect(dailyReturns([{ date: day(2025, 4, 7), value: 0 }])).toEqual([])
  })

  it('excludes the first point rather than reporting it as a flat day', () => {
    const series: ValuePoint[] = [
      { date: day(2025, 4, 7), value: 0 },
      { date: day(2025, 4, 8), value: 2 },
    ]
    const returns = dailyReturns(series)

    expect(returns).toHaveLength(1)
    // The bar lands on the 8th — the day the return was earned, not the day it was measured from.
    expect(returns[0]!.date).toBe(day(2025, 4, 8))
    expect(returns.some((r) => r.date === day(2025, 4, 7))).toBe(false)
  })

  it('reports a flat day as exactly 0%', () => {
    const series: ValuePoint[] = [
      { date: day(2025, 4, 7), value: 7.13 },
      { date: day(2025, 4, 8), value: 7.13 },
    ]
    expect(dailyReturns(series)[0]!.value).toBe(0)
  })

  it('chain-links rather than differencing the cumulative values', () => {
    // 10% then 21% cumulative is a 10% day, not an 11-point one. Differencing would say 11.
    const series: ValuePoint[] = [
      { date: day(2025, 4, 7), value: 10 },
      { date: day(2025, 4, 8), value: 21 },
    ]
    expect(dailyReturns(series)[0]!.value).toBeCloseTo(10, 10)
  })

  it('reports a wipe-out as −100%', () => {
    const series: ValuePoint[] = [
      { date: day(2025, 4, 7), value: 25 },
      { date: day(2025, 4, 8), value: -100 },
    ]
    expect(dailyReturns(series)[0]!.value).toBeCloseTo(-100, 10)
  })

  it('reports no further movement once the cumulative return has reached −100%', () => {
    // The base growth factor is zero here, so the ratio is undefined. A wiped-out account with no
    // deposit has nothing left to grow, so the honest reading is a flat day — never Infinity/NaN,
    // which would poison the chart's value axis.
    const series: ValuePoint[] = [
      { date: day(2025, 4, 7), value: -100 },
      { date: day(2025, 4, 8), value: -100 },
    ]
    const value = dailyReturns(series)[0]!.value

    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBe(0)
  })

  it('handles a negative day between positive cumulative points', () => {
    // 21% down to 10% cumulative: (1.10 / 1.21) − 1 = −9.0909…%
    const series: ValuePoint[] = [
      { date: day(2025, 4, 7), value: 21 },
      { date: day(2025, 4, 8), value: 10 },
    ]
    expect(dailyReturns(series)[0]!.value).toBeCloseTo(-9.0909090909, 8)
  })

  it('emits one return per point after the first', () => {
    const series: ValuePoint[] = [
      { date: day(2025, 4, 7), value: 0 },
      { date: day(2025, 4, 8), value: 1 },
      { date: day(2025, 4, 9), value: 3 },
      { date: day(2025, 4, 10), value: 2 },
    ]
    expect(dailyReturns(series)).toHaveLength(3)
  })
})

describe('dailyReturns windowing', () => {
  const series: ValuePoint[] = [
    { date: day(2025, 4, 7), value: 0 },
    { date: day(2025, 4, 8), value: 10 },
    { date: day(2025, 4, 9), value: 21 },
    { date: day(2025, 4, 10), value: 33.1 },
  ]

  it('keeps only the returns landing inside the bounds', () => {
    const windowed = dailyReturns(series, { from: day(2025, 4, 9), to: day(2025, 4, 10) })
    expect(windowed.map((r) => r.date)).toEqual([day(2025, 4, 9), day(2025, 4, 10)])
  })

  it('measures the window’s first return against its true predecessor, not against zero', () => {
    // The 9th is a 10% day whether or not the window opens on it. A window that rebased its first
    // bar to its own opening point would report 0% here and hide a real move.
    const windowed = dailyReturns(series, { from: day(2025, 4, 9), to: day(2025, 4, 10) })
    expect(windowed[0]!.value).toBeCloseTo(10, 8)
  })

  it('is unchanged by rebasing the source curve, because the base cancels', () => {
    // rebaseSeries re-anchors the whole curve onto the window's opening return (Story #169).
    // Consecutive ratios are invariant to that, so the bars can never disagree with the curve
    // drawn above them.
    const bounds = { from: day(2025, 4, 8), to: day(2025, 4, 10) }
    const raw = dailyReturns(series, bounds)
    const rebased = dailyReturns(rebaseSeries(series, bounds))

    for (const r of rebased) {
      expect(r.value).toBeCloseTo(raw.find((x) => x.date === r.date)!.value, 10)
    }
  })

  it('draws a bar the rebased curve could not, because rebasing discards the prior point', () => {
    // This is why dailyReturns takes the *unwindowed* series. rebaseSeries slices first, so its
    // opening point has no predecessor left and the window's first day yields nothing — even
    // though the 8th is a real 10% day.
    const bounds = { from: day(2025, 4, 8), to: day(2025, 4, 10) }

    expect(dailyReturns(rebaseSeries(series, bounds)).map((r) => r.date)).toEqual([
      day(2025, 4, 9),
      day(2025, 4, 10),
    ])
    expect(dailyReturns(series, bounds)[0]!.date).toBe(day(2025, 4, 8))
    expect(dailyReturns(series, bounds)[0]!.value).toBeCloseTo(10, 8)
  })

  it('returns nothing when the bounds hold no points', () => {
    expect(dailyReturns(series, { from: day(2026, 1, 1), to: day(2026, 2, 1) })).toEqual([])
  })
})
