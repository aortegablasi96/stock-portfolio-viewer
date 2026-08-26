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
 * `.chart-axis-label`'s per-character advance, in viewBox units.
 *
 * The three charts set their axis labels in `--font-figure` at {@link AXIS_LABEL_UNITS}, and
 * JetBrains Mono advances 0.6em per glyph with `--tracking-figure` taking 0.02em back — 6.38
 * units, which is what `getComputedTextLength()` reports in the running app. Rounded up rather
 * than down, for the reason `lib/chartTooltip`'s `CHAR_W` is generous: a label allowance a
 * fraction too wide is invisible, and one a fraction too narrow clips a currency symbol.
 *
 * It is a *number* here because a `viewBox` has no layout engine. That is the same constraint
 * DDR-0018 met by sizing charts from a ratio, and it is why the y-axis gutter below has to be
 * derived rather than eyeballed — nothing at runtime will notice a label that no longer fits.
 */
export const AXIS_LABEL_ADVANCE_UNITS = 6.4

/** The gap between the end of a y-axis label and the plot's left edge, as the charts draw it. */
export const AXIS_LABEL_GAP_UNITS = 8

/**
 * Which kind of figure a chart labels its **value axis** with (Story #269).
 *
 * Not a style and not a formatter — it is the one fact the gutter has to be derived from, and it
 * is a type rather than a number because four charts draw two kinds of label. `pad.left` was one
 * number for all of them until this story: correct on the two charts it was measured against
 * (`€999,999.99`) and twenty units of empty gutter on the two it was not, which the plot paid for.
 */
export type AxisLabelKind = 'currency' | 'percent'

/**
 * The longest y-axis label each kind of axis is given room for, in characters.
 *
 * **currency — eleven.** `€999,999.99`: a formatted base-currency figure with grouping and two
 * decimals, at the widest a six-figure portfolio produces. Ten is what the value curve and the
 * composition stack render today (`€68,517.70`, `€80,000.00`), and a budget fitted to today's
 * data is a budget that clips on the first good year. Above €1M the symbol clips again; that is a
 * real bound, and the honest place to widen it is here rather than at the two decimals, which the
 * tooltip has no way to restate if the axis stops showing them.
 *
 * **percent — eight.** `+999.99%`, as `formatSignedPercent` writes it: a sign, up to three
 * digits, two decimals and the symbol. The return curve labels its axis `+16.14%` and the daily
 * bars `-1.23%` — seven and six — so eight holds a cumulative return of ±999.99%, an order of
 * magnitude past anything either chart has plotted, and clips at ±1,000% where the grouping comma
 * arrives. The same shape of bound as the currency one, stated in the same place.
 *
 * Story #269 read the percent labels as five or six characters, which assumes one decimal;
 * `formatPercentValue` writes two, so the real spread is six to eight and the gutter hands back
 * twenty units rather than the twenty-seven the issue estimated. The budget is what moved, not
 * the estimate — sizing to five characters would clip the return curve the first time it passed
 * +100%.
 */
export const AXIS_LABEL_BUDGET_CHARS: Readonly<Record<AxisLabelKind, number>> = {
  currency: 11,
  percent: 8,
}

/**
 * The step a `pad` edge is stated in.
 *
 * The three edges every chart shares — 16, 16, 28 — have sat on a 4-unit grid since DDR-0018, and
 * `left: 80` landed on it by arithmetic rather than by intent. Rounding the derivation up to the
 * same step is what keeps a gutter a whole number of units instead of the 59.2 the percent budget
 * produces, and it is why the currency gutter is still exactly the 80 Story #190 arrived at.
 */
const PAD_STEP_UNITS = 4

/**
 * The y-axis gutter a character budget needs, in viewBox units.
 *
 * This is Story #190's derivation with the budget passed in rather than read off a global — the
 * one change this story makes to the *rule*. The charts anchor a tick at
 * `pad.left - AXIS_LABEL_GAP_UNITS` with `text-anchor="end"`, so the label grows leftward from
 * there and the gutter has to hold the gap plus the label.
 *
 * Nothing at runtime will notice if it does not. A `viewBox` has no layout engine, the root
 * `<svg>` clips to its viewport in silence, and a label that starts at a negative x simply loses
 * its leading glyph — which is exactly how a clipped `€` survived two milestones.
 */
export function axisGutterUnits(budgetChars: number): number {
  const needed = budgetChars * AXIS_LABEL_ADVANCE_UNITS + AXIS_LABEL_GAP_UNITS
  return Math.ceil(needed / PAD_STEP_UNITS) * PAD_STEP_UNITS
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
 * This is the part all four charts share and the part that must never differ between them: the
 * ratio decides how big an axis label renders, and two charts in one row at two ratios would read
 * as two different spans of the same dates.
 */
export const PERFORMANCE_FRAME = { width: 500, height: 180 } as const

/**
 * The three edges of the padding that do not depend on what a chart labels its axis with.
 *
 * `right` in particular is shared on purpose (Story #269): with the gutters now differing, the
 * **right** edge of the plot is what still lines up across the grid, and it is the edge carrying
 * the end of the window — the reading every one of these charts is scanned to.
 */
const SHARED_PAD = { top: 16, right: 16, bottom: 28 } as const

/**
 * The plot each kind of axis is drawn in — one frame, two gutters (Story #269).
 *
 * `pad` is an absolute allowance for text, not a fraction of the plot: an axis label does not get
 * shorter because the chart did. What Story #190 could not see, with two charts to look at, is
 * that it does not get *longer* either — `+16.14%` is seven characters however wide the column
 * is, and holding eleven characters' worth of gutter for it spends 20 units of plot on nothing.
 *
 * So the gutter is per axis kind and derived from that kind's budget. Currency is still 80, to
 * the unit. Percent is 60, and every one of the 20 units the two percentage charts gain is a unit
 * that carried no ink.
 */
export const PERFORMANCE_PLOTS: Readonly<Record<AxisLabelKind, PlotGeometry>> = {
  currency: {
    ...PERFORMANCE_FRAME,
    pad: { ...SHARED_PAD, left: axisGutterUnits(AXIS_LABEL_BUDGET_CHARS.currency) },
  },
  percent: {
    ...PERFORMANCE_FRAME,
    pad: { ...SHARED_PAD, left: axisGutterUnits(AXIS_LABEL_BUDGET_CHARS.percent) },
  },
}

/**
 * The plot a caller with no value axis of its own is laid out against — the widest gutter of the
 * two, so anything defaulted here is bounded by the narrowest plot in the grid rather than by the
 * roomiest.
 *
 * Its remaining users are the ones that do not draw a y-axis: `ChartTooltip`'s fallback, and the
 * pure modules' tests. Every chart in the grid names its own kind.
 */
export const PERFORMANCE_PLOT: PlotGeometry = PERFORMANCE_PLOTS.currency

/**
 * `.chart-axis-label`'s `font-size`, in viewBox units — one of `lib/tokenAdoption`'s permanent
 * exemptions precisely because it is not a page-scale length (DDR-0018, DDR-0042). Mirrored here
 * so the legibility maths below has something to compute with; the test pins it against `app.css`,
 * because a number restated in two files is a number that will disagree.
 */
export const AXIS_LABEL_UNITS = 11

/**
 * The content column at which a half-column plot stops clearing {@link MIN_AXIS_LABEL_PX}.
 *
 * The one number both breakpoints below are chosen from. It is a property of the *column*, so it
 * survived a sidebar arriving beside it (Story #182) and survives that sidebar collapsing (Story
 * #184) — what changes each time is only how much window it takes to leave 1200px of column.
 */
export const GRID_CONTENT_BREAKPOINT_PX = 1200

/* The shell's own measures, mirrored from `:root` so the width maths can run under Node. The
   test reads each one back out of `app.css` and fails if the stylesheet has moved. */
const CONTENT_MAX_PX = 1760 /* --content-max: 110rem */
const CONTENT_PAD_PX = 32 /* --content-pad: 2rem, one side */
const CARD_PAD_PX = 20 /* --surface-pad-md (--space-6: 1.25rem), one side */
const GRID_GAP_PX = 24 /* --space-7: 1.5rem */
export const SIDEBAR_PX = 220 /* --sidebar-width, the shell's left column (Story #182) */
export const SIDEBAR_COLLAPSED_PX = 56 /* --sidebar-width-collapsed, the icon rail (Story #184) */

/**
 * The viewport width at or below which `.performance-charts` collapses to a single column.
 *
 * Chosen from the floor, not from a round number: a half-column chart renders its axis labels at
 * 11.2px one pixel above this, and one pixel below is where they stop clearing
 * {@link MIN_AXIS_LABEL_PX}. The number that matters is the **content column**, which is still
 * 1200px here — but the column is no longer the window. Story #182 put a 220px sidebar beside it
 * (DDR-0055), so the same threshold is 1420px of *viewport*, and moving the two numbers together
 * is what keeps the breakpoint meaning what it meant.
 *
 * The one thing that could not come across is DDR-0051's second property: 1200 sat **below** the
 * 1280px default window, so a fresh install opened on the grid. 1420 does not, and no arithmetic
 * makes it — at 1280px the content column is 1045px, and a half column of that renders a 9.7px
 * axis label, which is under the floor whatever the breakpoint says. So a default window now
 * opens Performance **stacked**, four full-width charts at a comfortable 20.7px label, and the
 * 2×2 grid wants a window of 1421px or more. That is a real cost of the sidebar and it is
 * recorded rather than absorbed; the two ways out — a wider default window, or a narrower
 * sidebar — are both decisions about the shell, not about this module.
 */
export const PERFORMANCE_GRID_BREAKPOINT_PX = GRID_CONTENT_BREAKPOINT_PX + SIDEBAR_PX

/**
 * The same threshold measured from a window carrying the **collapsed** rail (Story #184).
 *
 * Nothing about the legibility floor moved — the number that decides the grid is still a 1200px
 * content column, and the only term that changed is what stands beside it. 56px instead of 220px
 * hands 164px back, so the grid arrives at 1256px of viewport rather than 1420px.
 *
 * That recovers the property DDR-0051 had and #182 spent: the default 1280px window is *above*
 * this, so collapsing the rail opens Performance on the 2×2 grid there. It is a legibility fact
 * rather than a preference — at 1280px a half column is 520px collapsed (an 11.4px label, over
 * the floor) against 438px expanded (9.7px, under it) — which is why the two thresholds are
 * derived from one content width instead of hand-picked apart.
 */
export const PERFORMANCE_GRID_BREAKPOINT_COLLAPSED_PX =
  GRID_CONTENT_BREAKPOINT_PX + SIDEBAR_COLLAPSED_PX

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

/**
 * A classic Windows scrollbar. The analytics views are always taller than the window, so the
 * viewport the grid actually gets is this much narrower than the window — which matters, because
 * the breakpoint is chosen against a legibility floor and 15px is a third of the margin.
 */
const SCROLLBAR_PX = 15

/**
 * How many columns the grid resolves to at a given window width.
 *
 * `sidebarPx` defaults to the expanded column because that is what a launch opens on. Passing
 * {@link SIDEBAR_COLLAPSED_PX} asks the same question of the rail — the grid collapses on the
 * *column* it is given, and the sidebar is the only thing between that column and the window.
 */
export function gridColumns(viewportPx: number, sidebarPx: number = SIDEBAR_PX): 1 | 2 {
  return viewportPx > GRID_CONTENT_BREAKPOINT_PX + sidebarPx ? 2 : 1
}

/**
 * The CSS width one chart is drawn at, from the window width down through the content measure,
 * the grid and the card that holds it. Pure arithmetic over the tokens above — there is no
 * measurement here and deliberately none in the components either (DDR-0018 rejected sizing a
 * chart from a `ResizeObserver`).
 */
export function chartWidthPx(viewportPx: number, sidebarPx: number = SIDEBAR_PX): number {
  const columns = gridColumns(viewportPx, sidebarPx)
  // The sidebar comes off the top, before the measure caps anything: it is a fixed column beside
  // the content, not part of it. Omitting it is the drift this story would otherwise have left —
  // the arithmetic would keep passing while describing a layout that no longer exists.
  const available = viewportPx - sidebarPx - SCROLLBAR_PX
  const content = Math.min(available, CONTENT_MAX_PX) - 2 * CONTENT_PAD_PX
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
