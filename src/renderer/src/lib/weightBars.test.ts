import { describe, expect, it } from 'vitest'
import {
  WEIGHT_BAR_FLOOR,
  WEIGHT_BAR_MIN_FILL,
  weightBarFill,
  weightBarScale,
  weightBars,
} from './weightBars'

const slice = (conid: number, symbol: string, weight: number): { conid: number; symbol: string; weight: number } => ({
  conid,
  symbol,
  weight,
})

describe('weightBarScale', () => {
  it('is the set’s own maximum where that maximum is meaningful', () => {
    expect(weightBarScale([0.45, 0.3, 0.25])).toBe(0.45)
  })

  it('falls back to the floor when the largest weight is tiny, so nothing draws full', () => {
    // Forty positions with a 4% top holding: max-scaling would pin that 4% bar at 100%.
    expect(weightBarScale([0.04, 0.03, 0.02])).toBe(WEIGHT_BAR_FLOOR)
  })

  it('is the floor for an empty set, rather than zero', () => {
    expect(weightBarScale([])).toBe(WEIGHT_BAR_FLOOR)
  })

  it('ignores negative and non-finite weights when looking for the maximum', () => {
    expect(weightBarScale([0.4, Number.NaN, -2, Number.POSITIVE_INFINITY])).toBe(0.4)
  })
})

describe('weightBarFill', () => {
  it('fills the track at the scale and half of it at half the scale', () => {
    expect(weightBarFill(0.4, 0.4)).toBe(100)
    expect(weightBarFill(0.2, 0.4)).toBe(50)
  })

  it('never draws a non-zero weight as nothing', () => {
    expect(weightBarFill(0.0001, 0.4)).toBe(WEIGHT_BAR_MIN_FILL)
  })

  it('draws nothing for zero, negative and non-finite weights', () => {
    expect(weightBarFill(0, 0.4)).toBe(0)
    expect(weightBarFill(-0.1, 0.4)).toBe(0)
    expect(weightBarFill(Number.NaN, 0.4)).toBe(0)
  })

  it('cannot overflow its track', () => {
    expect(weightBarFill(0.9, 0.4)).toBe(100)
  })
})

describe('weightBars', () => {
  it('orders largest first and scales every bar against the same maximum', () => {
    const bars = weightBars([
      slice(1, 'AAPL', 0.2),
      slice(2, 'MSFT', 0.5),
      slice(3, 'NVDA', 0.3),
    ])

    expect(bars.map((b) => b.symbol)).toEqual(['MSFT', 'NVDA', 'AAPL'])
    expect(bars.map((b) => b.fill)).toEqual([100, 60, 40])
  })

  it('leaves the reported weights untouched — only the drawing is rescaled', () => {
    const bars = weightBars([slice(1, 'AAPL', 0.04), slice(2, 'MSFT', 0.02)])

    expect(bars.map((b) => b.weight)).toEqual([0.04, 0.02])
  })

  it('draws a single holding’s full weight as a full bar, because it is the whole portfolio', () => {
    expect(weightBars([slice(1, 'AAPL', 1)])).toEqual([
      { conid: 1, symbol: 'AAPL', weight: 1, fill: 100 },
    ])
  })

  it('degrades for a portfolio whose largest weight is tiny, rather than pinning it full', () => {
    const bars = weightBars([slice(1, 'AAPL', 0.04), slice(2, 'MSFT', 0.02)])

    // 0.04 / 0.25 → 16% of the track, not 100%.
    expect(bars.map((b) => b.fill)).toEqual([16, 8])
  })

  it('renders an empty allocation as no bars at all', () => {
    expect(weightBars([])).toEqual([])
  })
})
