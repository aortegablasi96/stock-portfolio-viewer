/**
 * The time-range vocabulary shared by every view that offers period presets — the Performance
 * charts and stats (Story #69) and the dividends & trades tables (Story #75). Extracted out of
 * `performanceRange` when the tables adopted the same presets, so "1M" means the same window
 * everywhere by construction rather than by two implementations agreeing.
 *
 * Everything here is pure and view-agnostic: a range selection resolves to a `Bounds` window,
 * and rows or points are filtered against it by the caller. All timestamps are epoch-ms UTC,
 * matching the rest of the app.
 *
 * **`RangeId`, `Bounds` and `boundsFor` live in `@shared/domain/performanceWindow` since Story
 * #327** and are re-exported here, so every call site keeps this module's name. The assistant's
 * performance tools window the same report from **main**, where a renderer module is not
 * (DDR-0111), and a second implementation of "what 1M means" would be free to disagree with the
 * chart. What stayed is what is about a *control*: the preset list its buttons render, the row
 * filters the tables use, and the two date-input conversions.
 */
import { boundsFor, type Bounds, type RangeId } from '@shared/domain/performanceWindow'

export { boundsFor }
export type { Bounds, RangeId }

export interface RangeOption {
  id: RangeId
  /** Compact button label. */
  label: string
  /** Accessible name / tooltip for the button. */
  title: string
}

/**
 * One vocabulary for every view that offers presets — `RangeFilter` renders this list for
 * Performance, Dividends and Trades alike, so "1M" means one window everywhere by construction.
 *
 * `ytd` sits **after** `1Y`, not between `3M` and `1Y` where its length would put it (Story #256,
 * DDR-0085). The group is not ordered by length but by kind: `1M`, `3M` and `1Y` are one run of
 * trailing windows, and breaking it to interleave the one calendar-anchored preset would make the
 * odd one out look like a member of the run. After `1Y` it reads as what it is — a window of its
 * own, before the two that are not periods at all.
 *
 * Its title says "Since 1 January" rather than "Year to date": the window is anchored to the data,
 * so in a history that stops in an earlier year it is *that* year's 1 January, which "to date"
 * would overclaim.
 */
export const RANGE_OPTIONS: readonly RangeOption[] = [
  { id: '1m', label: '1M', title: 'Last month' },
  { id: '3m', label: '3M', title: 'Last 3 months' },
  { id: '1y', label: '1Y', title: 'Last year' },
  { id: 'ytd', label: 'YTD', title: 'Since 1 January' },
  { id: 'all', label: 'All', title: 'Full history' },
  { id: 'custom', label: 'Custom', title: 'Custom date range' },
] as const

/** The last instant of the UTC day containing `ms`. */
function endOfUtcDay(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
}

/**
 * The window a selection restricts rows to, or `null` for "no restriction" — which is both the
 * `all` preset and the degenerate case of rows carrying no dates at all. Callers that filter
 * rows use this rather than `boundsFor` directly, because "unfiltered" and "windowed to the
 * full extent" differ for undated rows: the first keeps them, the second cannot place them.
 *
 * A custom window's end runs to the close of the chosen day, so a row timestamped during that
 * day — a trade, say — falls inside the period the owner picked rather than just outside it.
 * (Charts don't need this: they read a value *at* an instant rather than selecting rows.)
 */
export function windowFor(
  range: RangeId,
  extent: Bounds | null,
  custom: Bounds | null,
): Bounds | null {
  if (extent === null || range === 'all') return null
  const bounds = boundsFor(range, extent, custom ?? extent)
  return range === 'custom' ? { from: bounds.from, to: endOfUtcDay(bounds.to) } : bounds
}

/**
 * The [earliest, latest] span of the dated rows, ignoring undated ones; `null` when no row
 * carries a date. Rows need not be sorted — the analytics tables arrive newest-first, and
 * some (trades) can hold a row IBKR reports without a timestamp.
 */
export function datedExtent<T>(rows: readonly T[], key: (row: T) => number | null): Bounds | null {
  let from: number | null = null
  let to: number | null = null
  for (const row of rows) {
    const date = key(row)
    if (date === null) continue
    if (from === null || date < from) from = date
    if (to === null || date > to) to = date
  }
  return from === null || to === null ? null : { from, to }
}

/**
 * The rows falling inside `bounds` (inclusive), or every row when `bounds` is `null` (Story #75).
 * An undated row is dropped whenever a window is active — it cannot be shown to belong to the
 * chosen period — and kept when there is no window, so clearing back to "All" restores every row.
 * Returns a fresh array so callers can render it directly without aliasing the input.
 */
export function filterByRange<T>(
  rows: readonly T[],
  key: (row: T) => number | null,
  bounds: Bounds | null,
): T[] {
  if (bounds === null) return [...rows]
  return rows.filter((row) => {
    const date = key(row)
    return date !== null && date >= bounds.from && date <= bounds.to
  })
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
