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
 *
 * **`chainLink`, `seriesExtent`, `valueAt` and `windowStats` live in
 * `@shared/domain/performanceWindow` since Story #327** and are re-exported here. The assistant's
 * performance tools read the same endpoints from **main**, where a renderer module is not
 * (DDR-0111), and a second implementation of a chain-linked return would be free to disagree with
 * the curve the owner is looking at. What stayed is what is about *drawing*: the two slices that
 * anchor synthetic endpoints so a plotted line meets the edges of its own plot.
 */
import type { ValuePoint } from '@shared/domain/performance'
import {
  chainLink,
  seriesExtent,
  valueAt,
  windowStats,
  type Bounds,
  type WindowStats,
} from '@shared/domain/performanceWindow'

export { chainLink, seriesExtent, valueAt, windowStats }
export type { WindowStats }

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
