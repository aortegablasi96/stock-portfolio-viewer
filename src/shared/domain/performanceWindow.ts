import type { CompositionPoint, ValuePoint } from './performance'

/**
 * Windowing a performance report, in the one place **both processes** can reach (Story #327).
 *
 * ## Why it moved
 *
 * Every function here was a `renderer/src/lib/` module: the range vocabulary was `dateRange`'s, the
 * carry-forward reads and the chain-linked return were `performanceRange`'s, the per-day steps were
 * `dailyReturns`', and the composition slice was `composition`'s. That was right while the only
 * thing that windowed a report was a chart.
 *
 * Epic #322 puts a second reader in a second process: the assistant's performance tools execute in
 * **main**, where a renderer module is not (DDR-0111, decision 2). The record's own words for the
 * formatter move apply unchanged here — *"the move is a path change, not a port"* — and so does its
 * reason: a **second** implementation of "how this app windows a return" would be free to disagree
 * with the chart the owner is looking at, and grounding means a figure in an answer and the same
 * figure on a page are one number (DDR-0098).
 *
 * So the four modules keep their names and their call sites: each **re-exports** what moved here, and
 * everything they own that is about *drawing* — `RANGE_OPTIONS`, `sliceSeries`, `rebaseSeries`, the
 * stacking geometry — stayed where it was. What crossed is only what a report needs to be windowed
 * at all.
 *
 * ## What it refuses
 *
 * **It never anchors to the clock.** Every preset ends at `extent.to`, the last day the imported
 * history actually holds (DDR-0085). A history that stops last year still has a `1y` and a `ytd`;
 * anchored to today both would be empty, and an empty period reads as a flat one.
 *
 * **It never carries a value into an empty window silently.** {@link valueAt} is a carry-forward
 * read and will happily report the nearest value at both ends of a gap. That is right for a chart
 * and wrong for a sentence, so every caller counts the points really inside the window and treats
 * zero as a *state* rather than as a flat period (DDR-0099).
 *
 * Dependency-free but for a type-only import of the report's own shapes, so no Zod can reach the
 * renderer's bundle through it (DDR-0105, `zodIsolation.test.ts`).
 */

/**
 * The selectable ranges: trailing windows back from the latest data point, one calendar-anchored
 * window (`ytd`), the full history, and custom.
 */
export type RangeId = '1m' | '3m' | '1y' | 'ytd' | 'all' | 'custom'

/** An inclusive [from, to] window as epoch-ms UTC. */
export interface Bounds {
  from: number
  to: number
}

/** Subtract whole months from an epoch-ms timestamp, in UTC. `Date.UTC` normalises overflow. */
function subtractMonths(ms: number, months: number): number {
  const d = new Date(ms)
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() - months,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  )
}

/** UTC midnight on 1 January of the year containing `ms`. */
function startOfUtcYear(ms: number): number {
  return Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)
}

/**
 * Resolve a range selection to a concrete window. Trailing presets end at the latest data
 * point (`extent.to`) and start N months back, clamped so a short history never starts before
 * the first point. `custom` is normalised (ordered and clamped into the data span).
 *
 * Anchoring to the data rather than to "now" matters for imported history: a statement exported
 * last month would otherwise leave "1M" empty.
 *
 * `ytd` is the one **calendar-anchored** preset (Story #256, DDR-0085), and it takes the same
 * anchor as the trailing ones — `extent.to`, not today. Two reasons, and both are the anchor
 * rather than the arithmetic: this function is a pure function of its arguments, which is what
 * lets its whole contract be asserted without a clock; and a history that stops in an earlier year
 * resolves to that year's 1 January through its last point, which is the tail of the last year
 * that has data. Anchored to today the same history would resolve to an empty window — a chart
 * showing nothing, with no way for a reader to tell the preset from the data.
 *
 * The `switch` is deliberately **exhaustive without a `default`**: the declared return type makes
 * a missing case a compile error, where a `default` would have quietly folded a new id into
 * `all` — a window over everything looks plausible enough to ship.
 */
export function boundsFor(range: RangeId, extent: Bounds, custom: Bounds): Bounds {
  switch (range) {
    case '1m':
      return { from: Math.max(subtractMonths(extent.to, 1), extent.from), to: extent.to }
    case '3m':
      return { from: Math.max(subtractMonths(extent.to, 3), extent.from), to: extent.to }
    case '1y':
      return { from: Math.max(subtractMonths(extent.to, 12), extent.from), to: extent.to }
    case 'ytd':
      return { from: Math.max(startOfUtcYear(extent.to), extent.from), to: extent.to }
    case 'custom': {
      const lo = Math.min(custom.from, custom.to)
      const hi = Math.max(custom.from, custom.to)
      const from = Math.max(lo, extent.from)
      const to = Math.min(hi, extent.to)
      return { from: Math.min(from, to), to }
    }
    case 'all':
      return extent
  }
}

/**
 * Chain-link a cumulative return onto a new base — `(1 + rₜ) / (1 + r₀) − 1`, both percentages.
 * This is the one place the rebasing arithmetic lives, so the *Time-weighted return* tile and
 * the rebased curve cannot drift apart: the curve's final point is this function applied to the
 * same two endpoints the tile reads (Story #169).
 *
 * Exported for `dailyReturns`, which rebases each point onto the one before it (Story #170) — the
 * same operation with a different base, and the same reason to have one definition of it: a
 * private copy would be free to disagree about the two degenerate bases below.
 *
 * A base of exactly 0% short-circuits to the value itself. That is not just an optimisation —
 * it keeps "Full history" an exact identity rather than one float round-trip away from it.
 *
 * A base of exactly −100% is a total loss: the denominator is zero, the window's time-weighted
 * return is undefined, and the chain-link would emit `Infinity` (or `NaN`, when the value is
 * also −100%) into a chart axis. Degrade to the difference — bounded, still 0 at the window's
 * open, and equal to the chain-link in the only shape a wiped-out account can actually take
 * (a series that stays at −100%, since without a deposit there is nothing left to grow).
 */
export function chainLink(cumulativePct: number, basePct: number): number {
  if (basePct === 0) return cumulativePct
  const baseGrowth = 1 + basePct / 100
  if (baseGrowth === 0) return cumulativePct - basePct
  return ((1 + cumulativePct / 100) / baseGrowth - 1) * 100
}

/** Windowed headline figures the Performance stat tiles render. */
export interface WindowStats {
  /** Portfolio value at the window end. */
  endValue: number
  /** Absolute value change across the window (end − start). */
  changeAbs: number
  /** Percentage value change; `null` when the start value is zero (undefined ratio). */
  changePct: number | null
  /** Time-weighted return over the window, chain-linked from the cumulative TWR endpoints. */
  twr: number
}

/** The full [earliest, latest] date span of a series, or `null` when it has no points. */
export function seriesExtent(series: readonly ValuePoint[]): Bounds | null {
  if (series.length === 0) return null
  let from = series[0]!.date
  let to = series[0]!.date
  for (const p of series) {
    if (p.date < from) from = p.date
    if (p.date > to) to = p.date
  }
  return { from, to }
}

/**
 * The series value in effect at time `t` — the last point at or before `t` (carry-forward
 * step), or the first point's value when `t` predates the series. Assumes ascending order.
 */
export function valueAt(series: readonly ValuePoint[], t: number): number {
  if (series.length === 0) return 0
  let result = series[0]!.value
  for (const p of series) {
    if (p.date <= t) result = p.value
    else break
  }
  return result
}

/**
 * Headline figures for a window: portfolio value at the end, its absolute and percentage
 * change from the window start, and the window's time-weighted return. TWR is chain-linked
 * from the cumulative-TWR curve's endpoints, so it is contribution-adjusted like the series —
 * and through the shared `chainLink`, it is exactly where `rebaseSeries` leaves the curve.
 */
export function windowStats(
  valueSeries: readonly ValuePoint[],
  returnSeries: readonly ValuePoint[],
  bounds: Bounds,
): WindowStats {
  const startValue = valueAt(valueSeries, bounds.from)
  const endValue = valueAt(valueSeries, bounds.to)
  const changeAbs = endValue - startValue
  const changePct = startValue !== 0 ? (changeAbs / startValue) * 100 : null

  const twr = chainLink(valueAt(returnSeries, bounds.to), valueAt(returnSeries, bounds.from))

  return { endValue, changeAbs, changePct, twr }
}

/**
 * The point-over-point return at each point of a cumulative-return series, as a percentage —
 * `date` is the day the return landed on, `value` is that day's return.
 *
 * **Chain-linked, never differenced.** `rₜ = (1 + cₜ) / (1 + cₜ₋₁) − 1` over the *return* series,
 * not `vₜ − vₜ₋₁` over the value series — which is the whole reason DDR-0013 chose TWR for the
 * curve in the first place. A €10,000 deposit moves `valueSeries` by €10,000 and would be reported
 * as a spectacular day; it does not move `returnSeries` at all.
 *
 * The **first point emits nothing**: it has no predecessor, and a first day rendered as a 0% bar
 * would claim a flat day the data does not describe. So a series of one point (or none) yields no
 * returns at all, and an N-point series yields N−1.
 *
 * `bounds` restricts which returns are *returned*, not which are computed — every return is still
 * measured against the point that really preceded it, including the one landing on `bounds.from`.
 * Because the base cancels out of consecutive ratios, the window decides which steps are reported
 * and never their sizes, which is why callers pass the **unwindowed** series (DDR-0049).
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

/**
 * The composition points really inside a window (Story #171).
 *
 * Deliberately **not** the carry-forward slice a scalar series takes, which anchors synthetic
 * endpoints at the window edges. That is right for a single scalar — a portfolio had *some* value
 * on the window's first day — but a composition point is a simultaneous observation of every band,
 * and a carried-forward one would draw a portfolio shape on a date it was never measured. The
 * series is daily, so the real first point inside the window is at most a day away from its edge
 * and there is nothing to gain by inventing one (DDR-0052).
 */
export function sliceComposition(
  points: readonly CompositionPoint[],
  bounds: Bounds,
): CompositionPoint[] {
  return points.filter((p) => p.date >= bounds.from && p.date <= bounds.to)
}
