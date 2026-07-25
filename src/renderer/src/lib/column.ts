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
  /** Highest grid line (≥ largest gross); never below 0. Bars scale against this. */
  top: number
  /** Lowest grid line (≤ most-negative net); never above 0. */
  bottom: number
  /** Axis tick values — evenly spaced, always including 0, ordered low → high. */
  ticks: number[]
}

/** Roughly how many tick intervals to aim for across the value axis. */
const TARGET_INTERVALS = 4

/**
 * Round `rough` up to a "nice" number — 1, 2, or 5 times a power of ten — so grid lines land
 * on values that read cleanly (…20, 50, 100…) rather than arbitrary fractions.
 */
function niceStep(rough: number): number {
  if (!(rough > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(rough))
  const frac = rough / pow
  const niceFrac = frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10
  return niceFrac * pow
}

/** Snap away the floating-point dust from summing a nice step repeatedly. */
function clean(v: number): number {
  return Math.round(v * 1e6) / 1e6
}

/**
 * The value-axis domain and ticks for a set of columns. The domain always spans zero: the
 * top covers the largest gross (or 0), the bottom the most-negative net (or 0), each rounded
 * outward to a "nice" round number. Ticks are then laid down at a single even step from bottom
 * to top, so the spacing is uniform and zero is always one of them — a labelled baseline that
 * positive and negative months read either side of (Story #49). Rounding the extremes outward
 * also gives the tallest bar a little headroom instead of clipping the top grid line.
 *
 * An empty history (or one that is all zeros) collapses to a single `0` tick.
 */
export function columnDomain(columns: ColumnDatum[]): ColumnDomain {
  const rawTop = Math.max(0, ...columns.map((c) => c.lower + c.upper))
  const rawBottom = Math.min(0, ...columns.map((c) => c.lower))

  if (rawTop === 0 && rawBottom === 0) {
    return { top: 0, bottom: 0, ticks: [0] }
  }

  const step = niceStep((rawTop - rawBottom) / TARGET_INTERVALS)
  const top = clean(Math.ceil(rawTop / step) * step)
  const bottom = clean(Math.floor(rawBottom / step) * step)

  const count = Math.round((top - bottom) / step)
  const ticks: number[] = []
  for (let i = 0; i <= count; i++) {
    ticks.push(clean(bottom + i * step))
  }
  return { top, bottom, ticks }
}
