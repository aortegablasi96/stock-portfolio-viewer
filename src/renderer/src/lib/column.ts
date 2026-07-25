/**
 * Pure value-axis geometry for the stacked column chart (Milestone M3, Stories #23 and #49).
 *
 * Each column stacks a signed `lower` segment (dividends net of withholding) and a
 * non-negative `upper` segment (withholding tax); the two sum to the column's gross total.
 * Normally the lower value is positive and the column reads bottom-up from the zero line to
 * gross. But when a month's withholding exceeds the dividends received, the net is negative
 * and its bar must extend *below* the zero axis (Story #49) — so the axis domain has to
 * accommodate values on both sides of zero.
 *
 * Kept out of the component so it can be unit-tested in Vitest's Node environment (no DOM),
 * matching how `lib/pie.ts` and `lib/format.ts` are tested.
 */

export interface ColumnDatum {
  /** Signed lower segment (net income); may be negative. */
  lower: number
  /** Non-negative upper segment (withholding tax) stacked on top of a positive lower. */
  upper: number
}

export interface ColumnDomain {
  /** Highest stacked total (gross) across all columns; never below 0. */
  top: number
  /** Lowest lower value (net) across all columns; never above 0. */
  bottom: number
  /** Axis tick values, always including 0, ordered low → high. */
  ticks: number[]
}

/**
 * The value-axis domain and ticks for a set of columns. The domain always spans zero: the
 * top is the largest gross (or 0), the bottom is the most-negative net (or 0). When no column
 * dips below zero the result is identical to the original positive-only chart — a `[0, top/2,
 * top]` tick set — so all-positive histories render exactly as before (Story #49). When some
 * net is negative, ticks become `[bottom, 0, top]` so the zero line is always labelled.
 */
export function columnDomain(columns: ColumnDatum[]): ColumnDomain {
  const top = Math.max(0, ...columns.map((c) => c.lower + c.upper))
  const bottom = Math.min(0, ...columns.map((c) => c.lower))

  const ticks = bottom < 0 ? [bottom, 0, top] : [0, top / 2, top]
  return { top, bottom, ticks }
}
