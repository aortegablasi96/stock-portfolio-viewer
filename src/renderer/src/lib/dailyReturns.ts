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
 */
import type { ValuePoint } from '@shared/domain/performance'
import type { Bounds } from './dateRange'
import { chainLink } from './performanceRange'

/**
 * The point-over-point return at each point of a cumulative-return series, as a percentage —
 * `date` is the day the return landed on, `value` is that day's return.
 *
 * The **first point emits nothing**: it has no predecessor, and a first day rendered as a 0% bar
 * would claim a flat day the data does not describe. So a series of one point (or none) yields no
 * returns at all, and an N-point series yields N−1.
 *
 * `bounds` restricts which returns are *returned*, not which are computed — every return is still
 * measured against the point that really preceded it, including the one landing on `bounds.from`.
 *
 * Assumes the series is sorted ascending by `date`, the way the service builds it.
 */
export function dailyReturns(series: readonly ValuePoint[], bounds?: Bounds): ValuePoint[] {
  const out: ValuePoint[] = []
  for (let i = 1; i < series.length; i++) {
    const point = series[i]!
    if (bounds && (point.date < bounds.from || point.date > bounds.to)) continue
    out.push({ date: point.date, value: chainLink(point.value, series[i - 1]!.value) })
  }
  return out
}
