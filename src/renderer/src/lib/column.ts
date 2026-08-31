import { AXIS_LABEL_UNITS, MIN_AXIS_LABEL_PX, type PlotGeometry } from './chartGeometry'
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
 * matching how `lib/pie.ts` and `@shared/format.ts` are tested.
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

/**
 * A month drawn as **two bars on one baseline** (Story #241): what came in, and what was taken
 * out of it. Both are non-negative, which is what lets the axis floor at zero.
 *
 * It replaces a `{ lower, upper }` stack whose `lower` was the *net* — the figure the chart no
 * longer draws. That indirection is what made the old key readable two ways: a segment named
 * `Withholding tax` sat on top of a column whose height was a third figure, so its size could only
 * be read against a baseline that was not there. Two bars share the zero line, so both are read
 * the same way.
 */
export interface PairedDatum {
  /** The taller bar — a month's whole income. Non-negative. */
  primary: number
  /** The bar beside it — what was taken out of the primary. Non-negative. */
  secondary: number
}

/**
 * The value domain a deducted pair needs: the largest `primary` above zero, the largest
 * `secondary` below it (Story #246).
 *
 * **The domain spans zero again**, and the zero line is the level both series are read against
 * rather than the floor one of them sits on. Story #241 floored it here, because both bars rose
 * from the baseline and neither could reach below it; drawing the `secondary` *downward* puts the
 * axis back across zero. Note what did **not** come back with it: no figure changes sign. Both
 * inputs stay magnitudes and each is negated by its **series**, never by its value, which is the
 * distinction [[0078-two-columns-a-month-and-a-plot-sized-in-pixels]] was really drawing when it
 * refused a signed series — that argument was answering a third *net* bar, whose sign moves with
 * the data and which genuinely would need a second baseline.
 *
 * The extremes are independent `max`es rather than a comparison of the two. A month whose only
 * entry is withholding has a gross of zero, so neither side can be derived from the other, and a
 * top taken from the taller *of the pair* would scale the plot to a bar hanging off the opposite
 * end of it.
 *
 * **The step comes from the dominant side, and the small side is not rounded to it** (Story #248).
 * Story #246 expressed this through `columnDomain`, which rounds *both* extremes outward to one
 * shared nice step. That is right when the two sides are comparable and wrong when one is an order
 * of magnitude smaller than the other, which is the normal shape of this data: measured on a real
 * import, a largest withholding of €14.25 against a largest gross of €184.21 floored the axis at
 * −€100 and spent about a quarter of the plot on empty space below the line. Tax is a fraction of
 * income in every ordinary month, so the failing case is the common one.
 *
 * So the step is taken from whichever side has the range to divide, and then:
 *
 * - **the tax side needs a whole step or more** — it is rounded outward to that step like the
 *   income side, and every gridline is evenly spaced, exactly as before;
 * - **it needs less than one step** — it rounds outward to a nice number of *its own* magnitude
 *   instead, contributing a single labelled tick at the bottom.
 *
 * The second branch is the only place in the app where gridline spacing is not uniform, and it is
 * uneven **across zero and nowhere else**. That is the deliberate trade: the alternative is a step
 * fine enough to divide the tax side, which puts eleven gridlines behind a chart that wants four.
 * What keeps it honest is that the bottom tick is *labelled* — the reader takes the number from the
 * axis, not from counting spaces — and that zero is still a tick, so the one line both series are
 * read against is never the interpolated one.
 *
 * `columnDomain` is deliberately left alone. It is the daily-return chart's domain too, and that
 * chart's two sides are genuinely comparable — a shared step is right there, and this reasoning
 * does not reach it.
 */
export function pairedDomain(columns: PairedDatum[]): ColumnDomain {
  const rawTop = Math.max(0, ...columns.map((c) => c.primary))
  const rawBottom = -Math.max(0, ...columns.map((c) => c.secondary))

  if (rawTop === 0 && rawBottom === 0) {
    return { top: 0, bottom: 0, ticks: [0] }
  }

  // Whichever side has more to divide sets the step, so a history that is all withholding and no
  // income still gets a sensible one rather than the `niceStep(0)` fallback.
  const step = niceStep(Math.max(rawTop, -rawBottom) / TARGET_INTERVALS)
  const top = clean(Math.ceil(rawTop / step) * step)

  // A history with nothing withheld anywhere has no negative side at all, and must not be given
  // one: `niceStep(0)` falls back to 1, which would hang a −1 tick under a chart that never goes
  // below zero. The zero line is then the floor again, exactly as Story #241 drew it.
  //
  // Otherwise `niceStep` is reused as a nice-*ceiling* — 14.25 rounds to 20, 6 to 10 — because
  // "round outward to 1, 2 or 5 times a power of ten" is the same rule at both scales.
  const bottom =
    rawBottom === 0
      ? 0
      : -rawBottom >= step
        ? clean(Math.floor(rawBottom / step) * step)
        : -niceStep(-rawBottom)

  const ticks: number[] = [0]
  for (let v = step; v <= top + step / 2; v += step) ticks.push(clean(v))
  // Downward from zero by the same step while whole ones fit; the remainder is the bottom edge,
  // which is a tick in its own right precisely so the negative side is never left unlabelled.
  for (let v = -step; v >= bottom + step / 2; v -= step) ticks.unshift(clean(v))
  if (bottom < 0 && ticks[0] !== bottom) ticks.unshift(bottom)

  return { top, bottom, ticks }
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
 * The same value axis for a **single signed series** — one number a point, no stack (Story #270).
 *
 * A curve and a row of bars are the degenerate column: `upper` is 0 and `lower` is the reading, so
 * everything {@link columnDomain} states already holds — the extremes round *outward* to one nice
 * step, the spacing is uniform, and zero is always a tick because both edges are whole multiples
 * of that step. This is the named way to say so, rather than three call sites each writing
 * `{ lower: v, upper: 0 }` and each free to drift.
 *
 * **It is what the two Performance curves adopted.** `LineChart` built its own three ticks inline
 * until this story — `[minV, minV + spanV / 2, maxV]` — which is evenly *spaced* and arbitrarily
 * *levelled*: the extremes are wherever the window's data happened to land, so the value curve
 * labelled `€0.00 / €34,258.85 / €68,517.70` and the return curve `-12.20% / +8.03% / +28.25%`,
 * and no line in either sat on a number a reader would have picked. The two charts beside them in
 * the grid were already drawn against `€0 … €80,000` and `-5% … +10%` — the grid exists to be
 * read across its rows, and one quadrant was reading in a different vocabulary from the other
 * three.
 *
 * The cost is stated where it is paid: rounding outward means the top gridline is at or above the
 * series maximum, so a window whose range lands just past a step boundary spends up to about half
 * the plot on empty domain. That is the trade [[0081-the-tax-side-keeps-its-own-scale]] already
 * named from the other end — the alternative is a step fine enough to fit the data exactly, which
 * is how a 180-unit plot ends up behind eleven gridlines — and it is bounded: no domain this rule
 * produces carries more than {@link MAX_SERIES_TICKS} of them.
 */
export function seriesDomain(values: readonly number[]): ColumnDomain {
  return columnDomain(values.map((value) => ({ lower: value, upper: 0 })))
}

/**
 * The most gridlines {@link seriesDomain} or {@link columnDomain} can ever produce, which is
 * arithmetic rather than a policy: `niceStep` rounds up, so one step is at least a quarter of the
 * raw span, and rounding each extreme outward adds less than one more at each end — under six
 * intervals, and an integer count of them is therefore at most five.
 *
 * It is exported because the number nothing else can see is the *rendered* one: six labels down a
 * 136-unit plot is what the axis has to stay legible at, and `chartGeometry.test.ts` is where that
 * is checked against {@link AXIS_LABEL_UNITS} at the narrowest column the grid draws.
 */
export const MAX_SERIES_TICKS = 6

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

/* ---- The paired column chart's own plot (Stories #236, #241) --------------
   Lifted out of the component so the hover card's placement and the plot's rendered width can be
   checked in Node, the way `chartGeometry` holds the Performance grid's. It is deliberately *not*
   that module: those three charts share one fixed `viewBox` because they sit in a grid and are
   read against each other, and this one is alone in a card and as wide as its history needs. */

/** The plot's fixed height. Only the width moves; a month is a month however many there are. */
export const COLUMN_PLOT_HEIGHT = 240
/**
 * Text allowance around the plot: month labels below, and **nothing on the left** since Story #243.
 *
 * The 64 units that used to sit there were the value axis's, and the value axis is no longer drawn
 * in the `viewBox` — it is HTML beside the scroll container, so that scrolling the plot cannot
 * carry it off the screen. Everything that measured from `pad.left` moves with it in one step: the
 * gridlines' start, `bandIndexAt`'s origin, and the hover card's clamp.
 */
export const COLUMN_PLOT_PAD = { top: 16, right: 16, bottom: 30, left: 0 } as const
/**
 * One month's share of the axis, in `viewBox` units.
 *
 * It is the *month label* that picks this number, not the bars: `.chart-axis-label` advances 6.4
 * units a glyph ({@link AXIS_LABEL_ADVANCE_UNITS}), so `Jul 2026` is 51.2 units and 56 is the
 * narrowest band that keeps two of them apart. Every other measure below is derived from it.
 */
export const COLUMN_BAND_UNITS = 56

/**
 * What one `viewBox` unit is worth in **CSS pixels**, and the whole of Story #241's width change.
 *
 * Until this story the chart had no pixel size at all: the `viewBox` widened by a band a month and
 * the `<svg>` was `width: 100%`, so a unit was worth whatever the card's width divided by the
 * history happened to make it. That is DDR-0018's rule — a chart is sized by its aspect ratio —
 * and on a plot whose aspect is a *function of the data* it spends legibility as the history
 * accumulates. Measured in the running app: an 11-unit axis label rendered 11.3px on a 13-month
 * import at the default window, 10.6px at 19 months, and 3.5px at five years. The other three
 * charts are held to {@link MIN_AXIS_LABEL_PX} by `chartGeometry.test.ts`; this one was held to
 * nothing, because there was no number to hold it to.
 *
 * So the plot takes a pixel width from its history and the card scrolls it. **The number is
 * derived from the two constants that already state the constraint** rather than chosen: an axis
 * label is {@link AXIS_LABEL_UNITS} units and may not render below {@link MIN_AXIS_LABEL_PX}, and
 * both are 11 — so a unit is worth exactly one pixel. It is also the *smallest* value that
 * satisfies the floor, which is the half worth saying out loud: every pixel above it is plot the
 * reader has to scroll, so the cheapest legible chart is the one that scrolls least.
 *
 * This is a re-decision of DDR-0018 **for this chart alone**. Nothing here reaches the Performance
 * grid, whose four cards are cross-read and must stay exactly as wide as each other (DDR-0051).
 */
export const COLUMN_UNIT_PX = MIN_AXIS_LABEL_PX / AXIS_LABEL_UNITS

/** What one month is worth on screen, which follows from the two numbers above. */
export const COLUMN_MONTH_PX = COLUMN_BAND_UNITS * COLUMN_UNIT_PX

/**
 * The widest the plot may get relative to its height, which is what floors a short history.
 *
 * The reason is the **card's height**: the `<svg>` keeps its aspect when it stretches to fill a
 * card wider than its natural width, so a short history in a narrow plot is a *tall* card — at a
 * twelve-month floor the same import rendered 376px instead of 282px, half again as much of the
 * view for the same thirteen bars (Story #241).
 *
 * **Re-derived rather than re-tuned by Story #243**, which is the distinction worth keeping: the
 * number describes the *plot*, and the plot lost its 64-unit gutter to the HTML axis beside it. So
 * `4.5` — a plot that contained its own gutter — becomes `4.2`, which is the same total chart at
 * its floor: 1008 units of plot plus a gutter of about 56px is the 1080px it has always been, and
 * that still fits inside the card of a default window (measured at 1107px). Today's import
 * therefore still does not scroll, and the plot's height does not jump.
 */
export const COLUMN_PLOT_MIN_ASPECT = 4.2

/**
 * The plot `count` months are drawn in.
 *
 * The width grows with the history and the height does not. Unlike before Story #241 that no
 * longer costs anything, because {@link columnPlotWidthPx} gives the `<svg>` a matching pixel
 * width: the plot gets *longer* rather than denser, and the card scrolls it. Below the aspect
 * floor the bands widen instead, so a three-month import is three pairs spread across the axis
 * rather than three slabs.
 */
export function columnPlot(count: number): PlotGeometry {
  const width = Math.max(
    COLUMN_PLOT_HEIGHT * COLUMN_PLOT_MIN_ASPECT,
    COLUMN_PLOT_PAD.left + COLUMN_PLOT_PAD.right + count * COLUMN_BAND_UNITS,
  )
  return { width, height: COLUMN_PLOT_HEIGHT, pad: COLUMN_PLOT_PAD }
}

/**
 * The plot's natural width on screen, in CSS pixels.
 *
 * A **floor, not a fixed size**: the `<svg>` also carries `min-width: 100%`, so a history narrower
 * than its card stretches to fill it rather than floating in the middle of a panel, which DDR-0018
 * rejected on sight. Past that the card scrolls and every mark holds its size.
 */
export function columnPlotWidthPx(plot: PlotGeometry): number {
  return plot.width * COLUMN_UNIT_PX
}

/**
 * What an 11-unit **month** label renders at, at the plot's natural width. Derived, never restated.
 *
 * The month labels are the only `.chart-axis-label` this chart still draws: they name the columns
 * they sit under and scroll with them, which is what keeps them in the `viewBox` where the value
 * axis no longer is (Story #243).
 */
export function columnAxisLabelPx(): number {
  return AXIS_LABEL_UNITS * COLUMN_UNIT_PX
}

/** One value-axis tick: its figure, and where the gutter puts it. */
export interface AxisTick {
  readonly value: number
  /** Distance from the plot's top edge, as a percentage of the plot's **rendered** height. */
  readonly topPercent: number
}

/**
 * The value axis, as offsets a stylesheet can use (Story #243).
 *
 * The gutter is HTML beside the scrolling plot, so it cannot share the plot's coordinate space and
 * must not try to: the plot stretches to fill a card wider than its natural width, so its rendered
 * height is not a number this module knows. A **percentage of the plot's own height** is the one
 * expression that is true at every size — the two sit in one grid row, so the gutter is exactly as
 * tall as the plot, and `topPercent` lands each label on its gridline without either measuring the
 * other.
 *
 * `y` is the chart's own value-to-unit mapping, passed in rather than recomputed, so a tick label
 * and the gridline it names cannot come from two different domains.
 */
export function axisTicks(
  ticks: readonly number[],
  plot: PlotGeometry,
  y: (value: number) => number,
): AxisTick[] {
  return ticks.map((value) => ({ value, topPercent: (y(value) / plot.height) * 100 }))
}

/** What the hover card calls each of a month's three figures. The chart supplies them. */
export interface PairedTooltipLabels {
  /** Names the taller bar — the month's whole income. */
  readonly primary: string
  /** Names the bar beside it — what was taken out of the primary. */
  readonly secondary: string
  /** Names `primary − secondary`, which the chart no longer draws. Omitted where there is none. */
  readonly difference?: string
}

/**
 * The hover card's rows for one month: both bars, and the difference the chart stopped drawing.
 *
 * **A row that does not exist is absent, not zero** (Story #236). A month with nothing withheld has
 * no withholding *row*, and the card shrinks to fit it, because `tooltipLayout` sizes from the rows
 * it is given. `€0.00` beside a label reads as a figure that was measured and came out at nothing,
 * which is a different statement from the one this card wants to make. The primary row stays even
 * at zero, and that asymmetry is deliberate: a month where withholding is the only entry has a
 * gross of exactly zero, and *that* is the fact that explains a negative net beneath it.
 *
 * **Only the difference is toned.** It is the signed one — the figure whose sign the reader is
 * looking for, and since Story #241 the only one of the three the chart does not draw — and
 * `signInk` leaves a flat month untoned rather than painting it a direction it did not move. The
 * two bars are not toned at all: a deduction is a deduction by construction, so a loss tone there
 * restates the label instead of adding a channel, which is the reasoning DDR-0065 settled for the
 * untoned trade-side badge.
 */
export function pairedTooltipRows(
  column: PairedDatum,
  labels: PairedTooltipLabels,
  formatValue: (v: number) => string,
): TooltipRow[] {
  const rows: TooltipRow[] = [{ label: labels.primary, value: formatValue(column.primary) }]
  if (column.secondary !== 0) {
    rows.push({ label: labels.secondary, value: formatValue(column.secondary) })
  }
  if (labels.difference !== undefined) {
    const difference = column.primary - column.secondary
    rows.push({
      label: labels.difference,
      value: formatValue(difference),
      ink: signInk(difference),
    })
  }
  return rows
}
