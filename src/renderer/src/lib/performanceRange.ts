/**
 * Pure helpers for windowing the Performance view's day-by-day series (Story #69). Kept out of
 * the component so the carry-forward reads and windowed-stat derivations are unit-tested
 * directly, the way the other renderer helpers in this folder are. The range vocabulary itself
 * — presets, `Bounds`, and resolving a selection to a window — lives in `dateRange`, shared with
 * the analytics tables (Story #75).
 *
 * Windowing is presentation only — the service already returns the day-by-day `valueSeries`
 * and cumulative-TWR `returnSeries` (both oldest → newest, base currency). These helpers slice
 * those series to a chosen window and read the endpoints; nothing is refetched, so switching
 * ranges reframes the charts and recomputes the top stats instantly.
 *
 * All series are assumed sorted ascending by `date` (the service builds them that way).
 */
import type { ValuePoint } from '@shared/domain/performance'
import type { Bounds } from './dateRange'

/**
 * Chain-link a cumulative return onto a new base — `(1 + rₜ) / (1 + r₀) − 1`, both percentages.
 * This is the one place the rebasing arithmetic lives, so the *Time-weighted return* tile and
 * the rebased curve cannot drift apart: the curve's final point is this function applied to the
 * same two endpoints the tile reads (Story #169).
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
function chainLink(cumulativePct: number, basePct: number): number {
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
 * Slice a series to a window for charting, anchoring synthetic endpoints at the window edges
 * (using carry-forward values) so the plotted line starts exactly at `from` and ends at `to`
 * even when no real point lands on the boundary. Returns the full series unchanged for a
 * whole-history window.
 */
export function sliceSeries(series: readonly ValuePoint[], bounds: Bounds): ValuePoint[] {
  if (series.length === 0) return []
  const { from, to } = bounds
  const inRange = series.filter((p) => p.date >= from && p.date <= to)

  const out: ValuePoint[] = []
  if (inRange.length === 0 || inRange[0]!.date > from) {
    out.push({ date: from, value: valueAt(series, from) })
  }
  out.push(...inRange)
  if (out[out.length - 1]!.date < to) {
    out.push({ date: to, value: valueAt(series, to) })
  }
  return out
}

/**
 * Slice a **cumulative return** series to a window and rebase it so the window opens at 0%
 * (Story #169). Each point is chain-linked off the cumulative return in effect at the window
 * start rather than shifted down by it, so the curve stays a genuine time-weighted return over
 * the window and keeps DDR-0013's property: deposits and withdrawals do not move it.
 *
 * Its final point equals `windowStats(...).twr` for the same bounds by construction — both are
 * `chainLink` over the endpoints `sliceSeries` anchors. That agreement is the point of the
 * story: the curve and the tile above it now answer the same question.
 *
 * For a whole-history window the series already opens at 0%, so the slice is returned unchanged.
 */
export function rebaseSeries(series: readonly ValuePoint[], bounds: Bounds): ValuePoint[] {
  const windowed = sliceSeries(series, bounds)
  if (windowed.length === 0) return []
  const base = windowed[0]!.value
  if (base === 0) return windowed
  return windowed.map((p) => ({ date: p.date, value: chainLink(p.value, base) }))
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
