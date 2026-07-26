import { describe, expect, it } from 'vitest'
import {
  DIVERGING_CLASSES,
  divergingClass,
  divergingStep,
  NEUTRAL_STEP,
  RETURN_BOUND,
  returnPercent,
} from './gainLoss'

/**
 * The map's gain/loss scale (Story #95). Bucketing and the "cannot be computed" case are what
 * carry meaning here — the component only turns the resulting class into a colour.
 */

describe('returnPercent', () => {
  it('expresses unrealized P&L as a percentage of cost basis', () => {
    expect(returnPercent(1000, 250)).toBe(25)
    expect(returnPercent(1000, -400)).toBe(-40)
  })

  it('keeps the sign meaningful for a short position', () => {
    // A short carries a negative cost basis; a positive P&L on it is still a gain, so dividing by
    // the signed basis would report it as a loss.
    expect(returnPercent(-1000, 200)).toBe(20)
    expect(returnPercent(-1000, -200)).toBe(-20)
  })

  it('returns null when there is no cost basis to measure against', () => {
    // Not 0% — rendering "flat" would assert something untrue about the holding.
    expect(returnPercent(0, 150)).toBeNull()
    expect(returnPercent(0, 0)).toBeNull()
  })
})

describe('divergingStep', () => {
  it('puts a flat holding on the neutral middle', () => {
    expect(divergingStep(0)).toBe(NEUTRAL_STEP)
  })

  it('puts an uncomputable return on the neutral middle', () => {
    // The colour cannot distinguish "flat" from "unknown", which is why the popup states it.
    expect(divergingStep(null)).toBe(NEUTRAL_STEP)
  })

  it('steps up through the gain arm and down through the loss arm', () => {
    // Bound is 25% over 3 steps → arm boundaries at 8.33% and 16.67%.
    expect(divergingStep(5)).toBe(NEUTRAL_STEP + 1)
    expect(divergingStep(12)).toBe(NEUTRAL_STEP + 2)
    expect(divergingStep(20)).toBe(NEUTRAL_STEP + 3)
    expect(divergingStep(-5)).toBe(NEUTRAL_STEP - 1)
    expect(divergingStep(-12)).toBe(NEUTRAL_STEP - 2)
    expect(divergingStep(-20)).toBe(NEUTRAL_STEP - 3)
  })

  it('is symmetric about zero', () => {
    for (const pct of [1, 8, 12, 17, 24, 40]) {
      expect(divergingStep(pct) - NEUTRAL_STEP).toBe(NEUTRAL_STEP - divergingStep(-pct))
    }
  })

  it('clamps beyond the bound rather than running off the scale', () => {
    // A +150% winner paints the same as a +25% one; both are "strongly up".
    expect(divergingStep(RETURN_BOUND)).toBe(NEUTRAL_STEP + 3)
    expect(divergingStep(150)).toBe(NEUTRAL_STEP + 3)
    expect(divergingStep(-99)).toBe(NEUTRAL_STEP - 3)
  })

  it('never leaves the scale', () => {
    for (const pct of [-1000, -25, -0.001, 0, 0.001, 25, 1000]) {
      const step = divergingStep(pct)
      expect(step).toBeGreaterThanOrEqual(1)
      expect(step).toBeLessThanOrEqual(DIVERGING_CLASSES.length)
    }
  })
})

describe('divergingClass', () => {
  it('names the class for a step', () => {
    expect(divergingClass(0)).toBe('map-diverge-4')
    expect(divergingClass(20)).toBe('map-diverge-7')
    expect(divergingClass(-20)).toBe('map-diverge-1')
    expect(divergingClass(null)).toBe('map-diverge-4')
  })

  it('lists every class in scale order, deepest loss first', () => {
    expect(DIVERGING_CLASSES).toEqual([
      'map-diverge-1',
      'map-diverge-2',
      'map-diverge-3',
      'map-diverge-4',
      'map-diverge-5',
      'map-diverge-6',
      'map-diverge-7',
    ])
    // Every class the scale can produce is one the legend renders.
    for (const pct of [-99, -12, -1, 0, null, 1, 12, 99]) {
      expect(DIVERGING_CLASSES).toContain(divergingClass(pct))
    }
  })
})
