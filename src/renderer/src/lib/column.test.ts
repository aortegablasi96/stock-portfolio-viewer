import { describe, it, expect } from 'vitest'
import { columnDomain, type ColumnDatum } from './column'

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
