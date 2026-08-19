/**
 * How a set of allocation weights becomes a set of drawn bars (Story #189).
 *
 * The Portfolio view draws the same fact twice — the rail's weight list and the micro-bar under
 * each holdings row — so the scaling lives here rather than in either component, and both read
 * the same numbers. It is a pure module for the usual reason: no test in this repo may render a
 * component, so the arithmetic has to be reachable without one.
 *
 * The redesign's prototype scaled each bar against a hard-coded divisor (`weight / 30`,
 * `weight / 28`). That is wrong in both directions: a portfolio whose top holding is 45% draws
 * two bars pinned at full and no visible difference between them, and a portfolio of forty
 * positions draws forty stubs. Scaling against the set's own maximum fixes the first and creates
 * the second failure the story names — with a 4% top holding, max-scaling would draw 4% as a
 * *full* bar, which reads as "this is the whole portfolio".
 *
 * So the denominator is the larger of the real maximum and {@link WEIGHT_BAR_FLOOR}. Above the
 * floor the bars are relative and the largest one fills its track; below it they are read against
 * a quarter of the portfolio and nothing fills. The two edge cases the story calls out fall out
 * of that one rule:
 *
 *   - **One holding.** Its weight is 1.0, which is its own maximum and well over the floor, so it
 *     fills the track — and that is the honest drawing, because the position really is the entire
 *     portfolio. There is no comparison being implied, because there is no second bar.
 *   - **A tiny largest weight.** Forty positions with a 4% top holding divide by the floor, not by
 *     0.04, so the longest bar is 16% of its track and the row reads as small.
 */

/**
 * The smallest denominator a bar set may be drawn against — a quarter of the portfolio.
 *
 * Picked as the point where "the largest holding" stops being a useful yardstick. At or above it
 * the top bar filling its track says something (one position dominates); below it, filling the
 * track would say the same thing about a position that dominates nothing.
 */
export const WEIGHT_BAR_FLOOR = 0.25

/**
 * The fill a non-zero weight is never drawn below, in percent.
 *
 * A 0.05% position rounds to a zero-width bar, which is indistinguishable from an empty track —
 * so a holding that exists always draws a hairline. Zero itself stays zero.
 */
export const WEIGHT_BAR_MIN_FILL = 1

/** A weighted thing, keyed by whatever its owner keys rows on. */
export interface Weighted {
  readonly conid: number
  readonly symbol: string
  readonly weight: number
}

/** One drawn bar: the weight it reports, and the percentage of the track it fills. */
export interface WeightBar extends Weighted {
  /** 0–100, ready for a `width` percentage. */
  readonly fill: number
}

/**
 * The denominator one set of bars shares. Negative and non-finite weights cannot scale anything,
 * so they are ignored here; {@link weightBarFill} clamps them where they are drawn.
 */
export function weightBarScale(weights: readonly number[]): number {
  const largest = weights.reduce(
    (max, weight) => (Number.isFinite(weight) && weight > max ? weight : max),
    0,
  )
  return Math.max(largest, WEIGHT_BAR_FLOOR)
}

/** One bar's fill against a scale from {@link weightBarScale}, in percent. */
export function weightBarFill(weight: number, scale: number): number {
  if (!Number.isFinite(weight) || weight <= 0 || scale <= 0) return 0
  return Math.min(Math.max((weight / scale) * 100, WEIGHT_BAR_MIN_FILL), 100)
}

/**
 * The bars for one allocation, largest first — the order the rail lists them in, and the order
 * the scale is derived from. The holdings table keys off `conid` instead of using this order,
 * because its own rows are sorted by whichever column the owner clicked.
 */
export function weightBars(slices: readonly Weighted[]): WeightBar[] {
  const scale = weightBarScale(slices.map((slice) => slice.weight))
  return [...slices]
    .sort((a, b) => b.weight - a.weight)
    .map((slice) => ({ ...slice, fill: weightBarFill(slice.weight, scale) }))
}
