import { describe, expect, it } from 'vitest'
import { returnPercent } from './gainLoss'

/**
 * Return on cost, all that remains of the map's gain/loss scale after #160 withdrew the colour
 * mode. The "cannot be computed" case is what carries meaning here.
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
