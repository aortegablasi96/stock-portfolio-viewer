import { describe, it, expect } from 'vitest'
import type { CompositionPoint } from '@shared/domain/performance'
import {
  nearestIndex,
  shareDomain,
  shares,
  sliceComposition,
  stackGeometry,
  stackSpans,
} from './composition'

/**
 * The composition chart's stacking maths (Story #171, DDR-0050). The invariant the whole chart
 * rests on is that the bands sum to NAV at every point — a stacked chart whose parts do not sum
 * is worse than no chart — so that is asserted directly, including in the two cases where it is
 * least obvious: a day with negative cash and a day with no NAV at all.
 */

const point = (total: number, values: number[], date = 0): CompositionPoint => ({
  date,
  total,
  values,
})

/** Sum with a tolerance, since real NAV components are floats. */
const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0)

const BOX = { width: 1000, height: 200, pad: { top: 10, right: 10, bottom: 20, left: 60 } }

describe('shares', () => {
  it('turns band values into proportions of NAV that sum to exactly 1', () => {
    const s = shares(point(1000, [900, 100]))
    expect(s).toEqual([0.9, 0.1])
    expect(sum(s)).toBe(1)
  })

  it('sums to 1 even when a band is negative (margin)', () => {
    // Stock exceeds NAV because cash is borrowed: 45000 − 5000 = 40000.
    const s = shares(point(40_000, [45_000, -5000]))
    expect(s[0]).toBeCloseTo(1.125, 10)
    expect(s[1]).toBeCloseTo(-0.125, 10)
    expect(sum(s)).toBeCloseTo(1, 10)
  })

  it('yields all-zero shares on a zero-NAV day rather than dividing by zero', () => {
    // The owner's real 2025 export opens on the day before the account was funded.
    const s = shares(point(0, [0, 0, 0]))
    expect(s).toEqual([0, 0, 0])
    expect(s.every(Number.isFinite)).toBe(true)
  })

  it('sums to 1 for real IBKR figures, which only reconcile to float precision', () => {
    const s = shares(point(38510.982350092, [38420.766223, 40.185955492, 50.0301716]))
    expect(sum(s)).toBeCloseTo(1, 12)
  })
})

describe('stackSpans', () => {
  it('stacks positive bands bottom-first, each starting where the last ended', () => {
    expect(stackSpans([0.5, 0.3, 0.2])).toEqual([
      { lo: 0, hi: 0.5 },
      { lo: 0.5, hi: 0.8 },
      { lo: 0.8, hi: 1 },
    ])
  })

  it('hangs a negative band below the zero line instead of clamping it', () => {
    const spans = stackSpans([1.125, -0.125])
    expect(spans[0]).toEqual({ lo: 0, hi: 1.125 })
    // Below the baseline, not stacked on top of the band above it.
    expect(spans[1]).toEqual({ lo: -0.125, hi: 0 })
  })

  it('keeps the positive stack anchored at zero when a band goes negative', () => {
    // The margin band must not drag the bands above it down through the baseline — a reader
    // comparing two days would otherwise see stock "move" purely because cash changed sign.
    const flat = stackSpans([0.9, 0.1])
    const margin = stackSpans([1.1, -0.1])
    expect(flat[0]?.lo).toBe(0)
    expect(margin[0]?.lo).toBe(0)
  })

  it('collapses every band to zero thickness on a zero-NAV day', () => {
    expect(stackSpans([0, 0])).toEqual([
      { lo: 0, hi: 0 },
      { lo: 0, hi: 0 },
    ])
  })

  it('lets a band that flips sign move across the baseline', () => {
    // Cash crossing into margin between two days is a real transition, not an error.
    expect(stackSpans([0.8, 0.2])[1]).toEqual({ lo: 0.8, hi: 1 })
    expect(stackSpans([1.2, -0.2])[1]).toEqual({ lo: -0.2, hi: 0 })
  })
})

describe('shareDomain', () => {
  it('is exactly 0–100% for an ordinary all-positive series', () => {
    expect(
      shareDomain([point(100, [60, 40]), point(200, [50, 150])]),
    ).toEqual({ min: 0, max: 1 })
  })

  it('widens to fit a negative band rather than cropping it', () => {
    const domain = shareDomain([point(100, [60, 40]), point(40_000, [45_000, -5000])])
    expect(domain.min).toBeCloseTo(-0.125, 10)
    expect(domain.max).toBeCloseTo(1.125, 10)
  })

  it('stays anchored to 0–100% so two windows are drawn at the same scale', () => {
    // Every day 100% stock: without the anchor this would be [0, 1] here and something else
    // next door, and equal proportions would draw as different shapes.
    expect(shareDomain([point(100, [100]), point(200, [200])])).toEqual({ min: 0, max: 1 })
  })

  it('is unaffected by zero-NAV days', () => {
    expect(shareDomain([point(0, [0, 0]), point(100, [60, 40])])).toEqual({ min: 0, max: 1 })
  })

  it('is the anchored default for an empty series', () => {
    expect(shareDomain([])).toEqual({ min: 0, max: 1 })
  })
})

describe('stackGeometry', () => {
  const series = [point(100, [60, 40], 10), point(100, [50, 50], 20), point(100, [80, 20], 30)]

  it('emits one closed ribbon per band', () => {
    const { paths } = stackGeometry(series, 2, BOX)
    expect(paths).toHaveLength(2)
    for (const path of paths) {
      expect(path.startsWith('M ')).toBe(true)
      expect(path.endsWith(' Z')).toBe(true)
      expect(path).not.toMatch(/NaN|Infinity|undefined/)
    }
  })

  it('spans the plot box horizontally, respecting the padding', () => {
    const { xs } = stackGeometry(series, 2, BOX)
    expect(xs).toHaveLength(3)
    expect(xs[0]).toBe(BOX.pad.left)
    expect(xs[2]).toBe(BOX.width - BOX.pad.right)
  })

  it('puts the bottom band on the baseline and the top band at full height', () => {
    const { paths } = stackGeometry([point(100, [100, 0]), point(100, [100, 0])], 2, BOX)
    // The lower band fills the plot: its top edge is at the top pad, its base at the bottom.
    expect(paths[0]).toContain(`,${BOX.pad.top}`)
    expect(paths[0]).toContain(`,${BOX.height - BOX.pad.bottom}`)
  })

  it('produces finite geometry for a zero-NAV day mid-series', () => {
    const withGap = [point(100, [60, 40], 10), point(0, [0, 0], 20), point(100, [80, 20], 30)]
    const { paths } = stackGeometry(withGap, 2, BOX)
    for (const path of paths) expect(path).not.toMatch(/NaN|Infinity/)
  })

  it('produces finite geometry when a band is negative', () => {
    const margin = [point(40_000, [45_000, -5000], 10), point(40_000, [44_000, -4000], 20)]
    const { paths, domain } = stackGeometry(margin, 2, BOX)
    expect(domain.min).toBeLessThan(0)
    for (const path of paths) expect(path).not.toMatch(/NaN|Infinity/)
  })

  it('handles a band that only appears partway through the range', () => {
    // An asset class first bought mid-window: zero-thickness until it opens, then a real band.
    const appearing = [
      point(100, [100, 0], 10),
      point(100, [100, 0], 20),
      point(100, [70, 30], 30),
    ]
    const { paths } = stackGeometry(appearing, 2, BOX)
    expect(paths).toHaveLength(2)
    for (const path of paths) expect(path).not.toMatch(/NaN|Infinity/)
    // The new band is a real ribbon, not a degenerate empty string.
    expect(paths[1]?.length).toBeGreaterThan(10)
  })

  it('draws nothing for a series too short to form a ribbon', () => {
    expect(stackGeometry([point(100, [100])], 1, BOX).paths).toEqual([])
    expect(stackGeometry([], 1, BOX).paths).toEqual([])
  })

  it('draws nothing when there are no bands', () => {
    expect(stackGeometry(series, 0, BOX).paths).toEqual([])
  })
})

describe('sliceComposition', () => {
  const series = [point(100, [100], 10), point(100, [100], 20), point(100, [100], 30)]

  it('keeps the days inside the window, inclusive of both edges', () => {
    expect(sliceComposition(series, { from: 20, to: 30 }).map((p) => p.date)).toEqual([20, 30])
    expect(sliceComposition(series, { from: 10, to: 30 })).toHaveLength(3)
  })

  it('invents no point at the window edge', () => {
    // A carried-forward point would draw a portfolio shape on a day it was never measured.
    expect(sliceComposition(series, { from: 15, to: 25 }).map((p) => p.date)).toEqual([20])
  })

  it('is empty when the window contains no measured day', () => {
    expect(sliceComposition(series, { from: 40, to: 50 })).toEqual([])
  })
})

describe('nearestIndex', () => {
  it('finds the closest point by x', () => {
    expect(nearestIndex([0, 50, 100], 60)).toBe(1)
    expect(nearestIndex([0, 50, 100], 90)).toBe(2)
    expect(nearestIndex([0, 50, 100], -20)).toBe(0)
  })

  it('has no target in an empty series', () => {
    expect(nearestIndex([], 10)).toBeNull()
  })
})
