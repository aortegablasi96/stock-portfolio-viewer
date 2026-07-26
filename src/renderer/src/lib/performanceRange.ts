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
 * Headline figures for a window: portfolio value at the end, its absolute and percentage
 * change from the window start, and the window's time-weighted return. TWR is chain-linked
 * from the cumulative-TWR curve's endpoints, so it is contribution-adjusted like the series.
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

  const twrStart = valueAt(returnSeries, bounds.from)
  const twrEnd = valueAt(returnSeries, bounds.to)
  const twr = ((1 + twrEnd / 100) / (1 + twrStart / 100) - 1) * 100

  return { endValue, changeAbs, changePct, twr }
}
