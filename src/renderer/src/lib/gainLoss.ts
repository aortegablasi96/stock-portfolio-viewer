/**
 * Unrealized return on cost, for the Allocation map's popup (Story #95; reduced to this by #160).
 *
 * This module was the map's second colour mode: a red ↔ gray ↔ blue diverging scale over return on
 * cost, seven steps around a neutral middle, bounded at ±25% (DDR-0021). The mode is gone — the map
 * has one view, coloured by sector — and the scale went with it, because `--diverge-*` had no other
 * consumer.
 *
 * What survives is the measure itself, which the popup still prints beside the country's P&L. It
 * stays a **percentage of cost basis rather than absolute P&L** for the reason the colour scale
 * needed it: the mark's area already encodes market value, so return is the figure the size does
 * not already tell you.
 */

/**
 * Unrealized return as a percentage of what was put in, or `null` when it cannot be computed.
 *
 * Divides by the **absolute** cost basis so the sign means the same thing for a short as for a
 * long: a short position carries a negative cost basis, and a gain on it is still a gain.
 *
 * A zero cost basis has no return to express — that is `null`, not 0%. Reporting it as flat would
 * quietly assert something untrue about the holding.
 */
export function returnPercent(costBasisBase: number, unrealizedPnlBase: number): number | null {
  if (costBasisBase === 0) return null
  return (unrealizedPnlBase / Math.abs(costBasisBase)) * 100
}
