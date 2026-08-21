import type { PlotGeometry } from './chartGeometry'
import { signInk, type TooltipRow } from './chartTooltip'

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
 *
 * The Performance view's daily-return `BarChart` shares this module rather than growing its own:
 * a single signed series is the degenerate stack (`upper` = 0), so `columnDomain` already gives it
 * the axis it needs, and `bandIndexAt` below is the hover maths both even-band charts want.
 * Sharing the *maths* is not the same as sharing the component — see `BarChart`'s own header for
 * why that fork exists.
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

/**
 * Which evenly-spaced band a pointer at `x` (in `viewBox` units) falls in, or `null` when there
 * are no bands to hit.
 *
 * The daily-return chart's hover target, and deliberately the *band* rather than the bar. At any
 * real density the bar is a fraction of its band — 0.7 of it by `BAR_FILL`, and a hairline once
 * the series passes a few hundred days (DDR-0049) — so hit-testing the drawn rectangle would mean
 * asking the reader to land the pointer on a sub-pixel target to read a day. Every x inside the
 * plot belongs to exactly one day instead, which is what makes scrubbing across the chart work.
 *
 * Pointer positions outside the plot clamp to the nearest end rather than reporting nothing: the
 * padding is axis-label allowance, not a gap between days, and a readout that blanked whenever the
 * pointer strayed into it would flicker along the whole left edge.
 */
export function bandIndexAt(x: number, left: number, plotWidth: number, count: number): number | null {
  if (count <= 0 || !(plotWidth > 0)) return null
  const index = Math.floor(((x - left) / plotWidth) * count)
  return Math.min(count - 1, Math.max(0, index))
}

/* ---- The stacked column chart's own plot (Story #236) ---------------------
   Lifted out of the component so the hover card's placement can be checked in Node, the way
   `chartGeometry` holds the Performance grid's. It is deliberately *not* that module: those three
   charts share one fixed `viewBox` because they sit in a grid and are read against each other,
   and this one is alone in a full-width card and widens with its history. DDR-0018's rule is that
   a chart's own aspect decides its shape, and these are two different shapes. */

/** The plot's fixed height. Only the width moves; a month is a month however many there are. */
export const COLUMN_PLOT_HEIGHT = 240
/** Text allowance around the plot, as the chart draws it: value labels left, month labels below. */
export const COLUMN_PLOT_PAD = { top: 16, right: 16, bottom: 30, left: 64 } as const
/**
 * One column's share of the axis.
 *
 * It is the *month label* that picks this number, not the bar: `.chart-axis-label` advances 6.4
 * units a glyph (`chartGeometry`'s measured figure), so `Jul 2026` is 51 units and 56 is the
 * narrowest band that keeps two of them apart. That is why the `viewBox` widens with the history
 * instead of the columns thinning the way the daily-return bars do (DDR-0049) — thinning here
 * would collide the labels, which is the thing this chart has that `BarChart` does not.
 */
export const COLUMN_BAND_UNITS = 56
/**
 * The narrowest the plot gets, so a four-month history is not drawn as four slabs.
 *
 * Story #76's number, and it dates from when the line chart beside it was also 1080×240; DDR-0051
 * has since taken the Performance grid to 500×180, so this chart renders its 11-unit axis labels
 * roughly half the size that grid does at the same CSS width. That is a real finding and it is a
 * *re-decision of this chart's aspect*, so it is recorded rather than made here (DDR-0018).
 */
export const COLUMN_PLOT_FLOOR = 1080

/**
 * The plot `count` columns are drawn in.
 *
 * The width grows with the history and the height does not, which is the property everything drawn
 * in these units has to live with: at a multi-year history the whole `viewBox` scales down inside
 * the same card, so a unit buys less of the screen. Every mark in the chart pays that equally —
 * the axis labels, the month labels, the columns and the hover card alike — which is exactly why
 * the card is drawn in these units rather than in a fixed size of its own (DDR-0018, DDR-0061).
 */
export function columnPlot(count: number): PlotGeometry {
  const width = Math.max(
    COLUMN_PLOT_FLOOR,
    COLUMN_PLOT_PAD.left + COLUMN_PLOT_PAD.right + count * COLUMN_BAND_UNITS,
  )
  return { width, height: COLUMN_PLOT_HEIGHT, pad: COLUMN_PLOT_PAD }
}

/** What the hover card calls each part of a column. The chart supplies the figures. */
export interface StackedTooltipLabels {
  /** Names the column's full height. Omitted where the chart has no total worth naming. */
  readonly total?: string
  /** Names the segment stacked at the column's top. */
  readonly upper: string
  /** Names what is left of the column once the upper segment is taken off it. */
  readonly lower: string
}

/**
 * The hover card's rows for one column: its total, its upper segment, and its lower segment.
 *
 * **A row that does not exist is absent, not zero** (Story #236). A month with nothing withheld has
 * no withholding *row*, and the card shrinks to fit it, because `tooltipLayout` sizes from the rows
 * it is given. `€0.00` beside a label reads as a figure that was measured and came out at nothing,
 * which is a different statement from the one this card wants to make. The total row stays even at
 * zero, and that asymmetry is deliberate: a month where withholding is the only entry has a gross
 * of exactly zero, and *that* is the fact the reader needs to see the negative net explained.
 *
 * **Only the lower segment is toned.** It is the signed one — the figure whose sign the reader is
 * looking for — and `signInk` leaves a flat month untoned rather than painting it a direction it
 * did not move. The other two are not toned at all: an upper segment is a deduction by
 * construction, so a loss tone there restates the label instead of adding a channel, which is the
 * reasoning DDR-0065 settled for the untoned trade-side badge.
 */
export function stackedTooltipRows(
  column: ColumnDatum,
  labels: StackedTooltipLabels,
  formatValue: (v: number) => string,
): TooltipRow[] {
  const rows: TooltipRow[] = []
  if (labels.total !== undefined) {
    rows.push({ label: labels.total, value: formatValue(column.lower + column.upper) })
  }
  if (column.upper !== 0) {
    rows.push({ label: labels.upper, value: formatValue(column.upper) })
  }
  rows.push({ label: labels.lower, value: formatValue(column.lower), ink: signInk(column.lower) })
  return rows
}
