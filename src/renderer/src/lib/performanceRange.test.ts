import { describe, expect, it } from 'vitest'
import type { ValuePoint } from '@shared/domain/performance'
import {
  boundsFor,
  fromDateInput,
  seriesExtent,
  sliceSeries,
  toDateInput,
  valueAt,
  windowStats,
} from './performanceRange'

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

describe('boundsFor', () => {
  const extent = { from: day(2024, 1, 1), to: day(2025, 1, 1) }
  const custom = { from: day(2024, 3, 1), to: day(2024, 9, 1) }

  it('all uses the full extent', () => {
    expect(boundsFor('all', extent, custom)).toEqual(extent)
  })

  it('1m / 3m / 1y trail back from the latest point', () => {
    expect(boundsFor('1m', extent, custom)).toEqual({ from: day(2024, 12, 1), to: day(2025, 1, 1) })
    expect(boundsFor('3m', extent, custom)).toEqual({ from: day(2024, 10, 1), to: day(2025, 1, 1) })
    expect(boundsFor('1y', extent, custom)).toEqual({ from: day(2024, 1, 1), to: day(2025, 1, 1) })
  })

  it('clamps a trailing window that predates the first point to the extent start', () => {
    const shallow = { from: day(2024, 12, 20), to: day(2025, 1, 1) }
    // A one-month window would start 2024-12-01, before the data begins.
    expect(boundsFor('1m', shallow, custom)).toEqual({ from: day(2024, 12, 20), to: day(2025, 1, 1) })
  })

  it('custom is clamped into the data span', () => {
    const wide = { from: day(2020, 1, 1), to: day(2030, 1, 1) }
    expect(boundsFor('custom', extent, wide)).toEqual(extent)
  })

  it('custom swaps reversed dates into order', () => {
    const reversed = { from: day(2024, 9, 1), to: day(2024, 3, 1) }
    expect(boundsFor('custom', extent, reversed)).toEqual({ from: day(2024, 3, 1), to: day(2024, 9, 1) })
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

describe('date-input conversion', () => {
  it('formats epoch-ms as YYYY-MM-DD in UTC', () => {
    expect(toDateInput(day(2024, 3, 7))).toBe('2024-03-07')
  })

  it('round-trips through fromDateInput', () => {
    expect(fromDateInput('2024-03-07')).toBe(day(2024, 3, 7))
  })

  it('returns null for a malformed value', () => {
    expect(fromDateInput('')).toBeNull()
    expect(fromDateInput('2024/03/07')).toBeNull()
  })
})
