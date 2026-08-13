/**
 * The Performance grid's shared plot geometry (Story #172, DDR-0051).
 *
 * DDR-0018 settled that a chart is sized by its **aspect ratio** — the `viewBox` — and never by a
 * pixel width, because the SVG scales to whatever column it lands in. The corollary nobody had to
 * face until now: the ratio also decides how big an axis label renders, since `.chart-axis-label`
 * is 11 *viewBox units* and a unit is only as large as the scale factor makes it. One chart at
 * full width made that invisible. Four charts in a 2×2 grid make it the whole problem — halving
 * the column halves the label with it, and 1080×240 at half width puts an 8px number on the axis.
 *
 * So the three time-series charts share one geometry rather than each declaring 1080×240 and
 * drifting: this module is the single place the ratio is chosen, and
 * {@link chartGeometry.test.ts} is where the choice is *checked* rather than asserted — it walks
 * the layout from the collapse breakpoint out to `--content-max` and fails if a label would
 * render outside the legible band.
 *
 * `ColumnChart`, `PieChart` and the map keep their own geometry: they are not in this grid, and
 * DDR-0018's point is that a chart's own aspect decides its shape.
 */

export interface PlotPad {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface PlotGeometry {
  readonly width: number
  readonly height: number
  readonly pad: PlotPad
}

/**
 * 500×180 — **25:9, ≈2.78:1**, down from DDR-0018's 1080×240 (4.5:1).
 *
 * Two things move, and they move for different reasons. The **width** halves because the column
 * halves: a unit is worth roughly what it was worth before, so an axis label renders at roughly
 * the size it rendered at full width. The **ratio** shortens from 4.5:1 to 2.78:1 because
 * carrying 4.5:1 into half the width would halve the height too, and a 180px-tall value curve
 * flattens a drawdown into a wobble — the plot needs its vertical resolution back.
 *
 * `pad` is unchanged, and deliberately so: it is an absolute allowance for text, not a fraction
 * of the plot. `left: 64` is what a formatted currency label occupies at 11 units, and the axis
 * label did not get shorter because the chart did.
 */
export const PERFORMANCE_PLOT: PlotGeometry = {
  width: 500,
  height: 180,
  pad: { top: 16, right: 16, bottom: 28, left: 64 },
}

/**
 * `.chart-axis-label`'s `font-size`, in viewBox units — one of `lib/tokenAdoption`'s permanent
 * exemptions precisely because it is not a page-scale length (DDR-0018, DDR-0042). Mirrored here
 * so the legibility maths below has something to compute with; the test pins it against `app.css`,
 * because a number restated in two files is a number that will disagree.
 */
export const AXIS_LABEL_UNITS = 11

/**
 * The viewport width at or below which `.performance-charts` collapses to a single column.
 *
 * Chosen from the floor, not from a round number: a half-column chart at 1201px CSS px renders
 * its axis labels at 11.2px, and one pixel narrower is where they stop clearing
 * {@link MIN_AXIS_LABEL_PX}. It sits **below the 1280px default window width** on purpose, so a
 * fresh install opens on the grid rather than on the stack.
 */
export const PERFORMANCE_GRID_BREAKPOINT_PX = 1200

/** The floor an axis label may not render below: the app's smallest type is `--text-2xs`, 11.5px. */
export const MIN_AXIS_LABEL_PX = 11

/** The ceiling inside the grid. The collapsed column is a wider chart and has its own bound. */
export const MAX_GRID_AXIS_LABEL_PX = 18

/**
 * The ceiling in the collapsed single column, where one chart spans the whole measure.
 *
 * Higher than the grid's because collapsing *doubles* the chart's width, and a viewBox has no
 * way to not double the label with it. Capping the chart's width instead was tried and rejected
 * when the measure widened (DDR-0018: a chart floating in the middle of a panel reads as a
 * rendering bug), and the rejection still holds — an oversized label is legible, which is the
 * direction that costs nothing.
 */
export const MAX_STACKED_AXIS_LABEL_PX = 25

/* The shell's own measures, mirrored from `:root` so the width maths can run under Node. The
   test reads each one back out of `app.css` and fails if the stylesheet has moved. */
const CONTENT_MAX_PX = 1760 /* --content-max: 110rem */
const CONTENT_PAD_PX = 32 /* --content-pad: 2rem, one side */
const CARD_PAD_PX = 20 /* --surface-pad-md (--space-6: 1.25rem), one side */
const GRID_GAP_PX = 24 /* --space-7: 1.5rem */

/**
 * A classic Windows scrollbar. The analytics views are always taller than the window, so the
 * viewport the grid actually gets is this much narrower than the window — which matters, because
 * the breakpoint is chosen against a legibility floor and 15px is a third of the margin.
 */
const SCROLLBAR_PX = 15

/** How many columns the grid resolves to at a given window width. */
export function gridColumns(viewportPx: number): 1 | 2 {
  return viewportPx > PERFORMANCE_GRID_BREAKPOINT_PX ? 2 : 1
}

/**
 * The CSS width one chart is drawn at, from the window width down through the content measure,
 * the grid and the card that holds it. Pure arithmetic over the tokens above — there is no
 * measurement here and deliberately none in the components either (DDR-0018 rejected sizing a
 * chart from a `ResizeObserver`).
 */
export function chartWidthPx(viewportPx: number): number {
  const columns = gridColumns(viewportPx)
  const content = Math.min(viewportPx - SCROLLBAR_PX, CONTENT_MAX_PX) - 2 * CONTENT_PAD_PX
  const column = (content - (columns - 1) * GRID_GAP_PX) / columns
  return column - 2 * CARD_PAD_PX
}

/** What an 11-unit axis label renders at, once the `viewBox` has been scaled to that width. */
export function axisLabelPx(chartWidth: number): number {
  return (AXIS_LABEL_UNITS * chartWidth) / PERFORMANCE_PLOT.width
}

/** The chart's rendered height, which follows from the ratio alone. */
export function chartHeightPx(chartWidth: number): number {
  return (chartWidth * PERFORMANCE_PLOT.height) / PERFORMANCE_PLOT.width
}
