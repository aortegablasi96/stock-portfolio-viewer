import { describe, it, expect } from 'vitest'
import { columnDomain, type ColumnDatum } from './column'

function col(lower: number, upper: number): ColumnDatum {
  return { lower, upper }
}

describe('columnDomain', () => {
  it('spans 0 → largest gross for an all-positive history, with a midpoint tick', () => {
    // Gross = lower + upper: 30 and 100. Behaviour must match the original positive-only chart.
    const domain = columnDomain([col(20, 10), col(80, 20)])

    expect(domain.bottom).toBe(0)
    expect(domain.top).toBe(100)
    expect(domain.ticks).toEqual([0, 50, 100])
  })

  it('extends the domain below zero when a net (lower) value is negative', () => {
    // Second month: withholding (30) exceeds the dividend (10), so net = -20 (Story #49).
    const domain = columnDomain([col(40, 10), col(-20, 30)])

    expect(domain.bottom).toBe(-20)
    expect(domain.top).toBe(50) // largest gross is 40 + 10
    expect(domain.ticks).toEqual([-20, 0, 50])
  })

  it('keeps the zero line labelled between the negative and positive extremes', () => {
    const domain = columnDomain([col(-15, 5), col(60, 40)])

    expect(domain.ticks).toEqual([-15, 0, 100])
  })

  it('never lets an all-negative history push the top above zero', () => {
    // Pure withholding months with no dividend: gross is 0, nets are negative.
    const domain = columnDomain([col(-10, 0), col(-25, 0)])

    expect(domain.top).toBe(0)
    expect(domain.bottom).toBe(-25)
    expect(domain.ticks).toEqual([-25, 0, 0])
  })

  it('handles a single column', () => {
    expect(columnDomain([col(10, 5)])).toEqual({ top: 15, bottom: 0, ticks: [0, 7.5, 15] })
  })

  it('is well-defined for no columns', () => {
    expect(columnDomain([])).toEqual({ top: 0, bottom: 0, ticks: [0, 0, 0] })
  })
})
