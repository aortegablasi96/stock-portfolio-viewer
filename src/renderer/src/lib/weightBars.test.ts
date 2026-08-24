import { describe, expect, it } from 'vitest'
import {
  WEIGHT_BAR_FLOOR,
  WEIGHT_BAR_MIN_FILL,
  weightBarFill,
  weightBarScale,
} from './weightBars'

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

/**
 * The two edge cases DDR-0062 states, over the pair of functions the holdings table calls.
 *
 * They were asserted through `weightBars()` until Story #266 retired the allocation list that
 * needed a whole ordered set. The rule they exercise is unchanged, and it is the rule rather
 * than the removed helper that a later story could break.
 */
describe('one column of bars, scaled together', () => {
  it('draws a single holding’s full weight as a full bar, because it is the whole portfolio', () => {
    const weights = [1]
    expect(weightBarFill(1, weightBarScale(weights))).toBe(100)
  })

  it('degrades for a portfolio whose largest weight is tiny, rather than pinning it full', () => {
    const weights = [0.04, 0.02]
    const scale = weightBarScale(weights)

    // 0.04 / 0.25 → 16% of the track, not 100%.
    expect(weights.map((w) => weightBarFill(w, scale))).toEqual([16, 8])
  })

  it('scales every row against the same maximum, whatever order they are drawn in', () => {
    const scale = weightBarScale([0.2, 0.5, 0.3])

    expect([0.2, 0.5, 0.3].map((w) => weightBarFill(w, scale))).toEqual([40, 100, 60])
  })
})
