/**
 * Day-over-day returns, derived from the cumulative time-weighted-return curve (Story #170).
 *
 * The Performance view's two line charts are cumulative: a curve that rises 40% over a year looks
 * identical whether it climbed in steady 0.15% steps or in a dozen violent swings. This module
 * recovers the individual steps, so the daily-return bar chart can show the shape of the ride.
 *
 * **Chain-linked, never differenced.** `rₜ = (1 + cₜ) / (1 + cₜ₋₁) − 1` over the *return* series,
 * not `vₜ − vₜ₋₁` over the value series — which is the whole reason DDR-0013 chose TWR for the
 * curve in the first place. A €10,000 deposit moves `valueSeries` by €10,000 and would be reported
 * as a spectacular day; it does not move `returnSeries` at all.
 *
 * That arithmetic already exists as {@link chainLink}, which `rebaseSeries` uses to re-anchor the
 * whole curve onto a window's opening return. Rebasing onto the *previous point* rather than onto
 * the window's first point is the same operation with a different base, so it is the same function
 * — including its treatment of a −100% base, where the denominator is zero and the ratio would
 * emit `Infinity` into a chart axis.
 *
 * A consequence worth knowing: because the base cancels out of consecutive ratios, feeding this
 * the raw `returnSeries` and feeding it the *rebased* one give identical daily returns. The window
 * therefore only decides which bars are drawn, never their heights, and `dailyReturns` takes the
 * unwindowed series so the window's first bar measures against its true predecessor rather than
 * against the synthetic carry-forward point `sliceSeries` anchors at the window edge.
 *
 * Kept out of the component and unit-tested under Node, like every other renderer helper here.
 *
 * **The function itself lives in `@shared/domain/performanceWindow` since Story #327** and is
 * re-exported here, so the bar chart's call site keeps this module's name. `get_daily_returns`
 * reports the same steps from **main**, where a renderer module is not (DDR-0111), and two
 * implementations of a chain-linked step would be free to disagree — the answer's best day and the
 * chart's tallest bar have to be one figure.
 */
export { dailyReturns } from '@shared/domain/performanceWindow'
