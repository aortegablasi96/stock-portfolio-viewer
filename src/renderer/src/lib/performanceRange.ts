/**
 * Pure helpers for the Performance view's time-range filter (Story #69). Kept out of the
 * component so the trailing-window maths, carry-forward reads, and windowed-stat derivations
 * are unit-tested directly, the way the other renderer helpers in this folder are.
 *
 * Windowing is presentation only — the service already returns the day-by-day `valueSeries`
 * and cumulative-TWR `returnSeries` (both oldest → newest, base currency). These helpers slice
 * those series to a chosen window and read the endpoints; nothing is refetched, so switching
 * ranges reframes the charts and recomputes the top stats instantly.
 *
 * All series are assumed sorted ascending by `date` (the service builds them that way).
 */
import type { ValuePoint } from '@shared/domain/performance'

/** The selectable ranges: trailing windows back from the latest data point, plus custom. */
export type RangeId = '1m' | '3m' | '1y' | 'all' | 'custom'

export interface RangeOption {
  id: RangeId
  /** Compact button label. */
  label: string
  /** Accessible name / tooltip for the button. */
  title: string
}

export const RANGE_OPTIONS: readonly RangeOption[] = [
  { id: '1m', label: '1M', title: 'Last month' },
  { id: '3m', label: '3M', title: 'Last 3 months' },
  { id: '1y', label: '1Y', title: 'Last year' },
  { id: 'all', label: 'All', title: 'Full history' },
  { id: 'custom', label: 'Custom', title: 'Custom date range' },
] as const

/** An inclusive [from, to] window as epoch-ms UTC. */
export interface Bounds {
  from: number
  to: number
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
 * Resolve a range selection to a concrete window. Trailing presets end at the latest data
 * point (`extent.to`) and start N months back, clamped so a short history never starts before
 * the first point. `custom` is normalised (ordered and clamped into the data span).
 */
export function boundsFor(range: RangeId, extent: Bounds, custom: Bounds): Bounds {
  switch (range) {
    case '1m':
      return { from: Math.max(subtractMonths(extent.to, 1), extent.from), to: extent.to }
    case '3m':
      return { from: Math.max(subtractMonths(extent.to, 3), extent.from), to: extent.to }
    case '1y':
      return { from: Math.max(subtractMonths(extent.to, 12), extent.from), to: extent.to }
    case 'custom': {
      const lo = Math.min(custom.from, custom.to)
      const hi = Math.max(custom.from, custom.to)
      const from = Math.max(lo, extent.from)
      const to = Math.min(hi, extent.to)
      return { from: Math.min(from, to), to }
    }
    case 'all':
    default:
      return extent
  }
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

/** Format an epoch-ms (UTC) timestamp as `YYYY-MM-DD` for a native `<input type="date">`. */
export function toDateInput(ms: number): string {
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Parse a `YYYY-MM-DD` date-input value to epoch-ms at UTC midnight; `null` when malformed. */
export function fromDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}
