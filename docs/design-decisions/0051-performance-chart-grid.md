# 0051. The four Performance charts in a 2×2 grid, and the aspect ratio that pays for it

- **Status:** Accepted
- **Date:** 2026-08-13

## Context

The Performance view has shown **one** chart at a time since Story #45, chosen from a
`ToggleGroup` ([[0036-toggle-group-mode-axis-and-pressed-semantics]]). That was a reasonable
shape for two charts. It is a bad one for four: Story #170 added the daily-return bars
([[0049-daily-return-bars-thin-rather-than-aggregate]]) and Story #171 the composition stack
([[0050-daily-nav-from-equity-summary]]), and switching became the dominant interaction in the
view.

Worse, switching is the wrong interaction for what these four charts are. They answer one
question between them, and each is read *against* the others — a drawdown in the value curve
means one thing beside a run of red daily bars and another beside a shift in composition. A
switcher shows you one and asks you to remember the rest.

Story #172 replaces it with a grid. What makes that a decision rather than a CSS change is
[[0018-content-measure-and-chart-aspect]]. Charts here are sized by **aspect ratio** — the
`viewBox` — and never by a pixel width, because the SVG scales to whatever column it lands in.
The corollary nobody had to face while there was one chart: the ratio also decides how big an
**axis label** renders, since `.chart-axis-label` is 11 *viewBox units* and a unit is only as
large as the scale factor makes it. Halving the column halves the label with it. Dropping
1080×240 into a half-width card puts an **8.3px** number on the axis at a 1920px window, and
5.2px at the narrowest width the grid is usable at — and halves the plot's height at the same
time, flattening a 3% drawdown into a wobble.

So the grid cannot ship on the existing ratio, and DDR-0018 already says which lever to pull.
This is the first time it has been pulled for a reason other than the width of the column.

## Decision

**All four charts render at once, in a 2×2 grid, under one `RangeFilter`.** The chart-selection
`ToggleGroup` and its `chartTab` state are retired; every other `ToggleGroup` call site — the
range presets, the type chips, the Allocation breakdown strip — is untouched, and
[[0036-toggle-group-mode-axis-and-pressed-semantics]] is unchanged. Row 1 is the two cumulative
curves (value, return); row 2 is the two charts that break them apart (daily bars, composition).
Each chart sits in its own titled `Card` and keeps the `aria-label` it already had, so the card
title is the visible half of a name the chart states either way.

**The shared plot becomes 500×180 — 25:9, ≈2.78:1 — down from 1080×240 (4.5:1).** Two numbers
move for two different reasons:

- The **width halves** because the column halves. A viewBox unit is then worth roughly what it
  was worth at full width, so an axis label renders at roughly the size it rendered before:
  12.1px at the default 1280px window, 17.5px at `--content-max`.
- The **ratio shortens** because carrying 4.5:1 into half the width would halve the height too.
  2.78:1 gives a 197px plot at the default window where 4.5:1 would have given 122px.

The padding is deliberately **not** scaled with it. `pad.left: 64` is an absolute allowance for a
formatted currency label at 11 units; the label did not get shorter because the chart did.

**The geometry lives in one module.** `renderer/src/lib/chartGeometry.ts` holds the plot, the
breakpoint and the width maths; `LineChart`, `BarChart` and `StackedAreaChart` import it instead
of each declaring the same three constants. Two charts in one row plotting the same date range at
different heights would read as different spans, so agreeing on the geometry stopped being a
nicety when they stopped sharing a card. `ColumnChart`, `PieChart` and the map are not in this
grid and keep their own aspect, which is DDR-0018's point.

**The grid collapses to one column at or below 1200px**, and 1200 is chosen from the floor rather
than for roundness: at 1201px a half-column chart renders its labels at 11.2px, and one pixel
narrower is where they stop clearing the app's smallest type. It sits **below the 1280px default
window width** on purpose — a breakpoint at 1280 would ship the grid to nobody who had not first
resized.

**The source notes move below their charts.** Above them, a note pushed its plot down by however
many lines it happened to run to, so the two charts in a row started at different heights — a grid
whose whole point is reading one chart against the one beside it, with the two misaligned.

**The ratio is checked, not asserted.** `chartGeometry.test.ts` mirrors the layout tokens, reads
each one back out of `app.css`, and walks the layout from the breakpoint out to `--content-max`,
failing with the label size it would have produced. It also pins the breakpoint against the
stylesheet, since CSS cannot read the module that derives it.

## Consequences

Benefits:

- The four charts are read together, which is what they are for. No interaction at all replaces
  three clicks to compare two charts, and one range selection reframes all four.
- Axis labels stay inside 11–18px across every width the grid is used at, against 8.3px for the
  naive 2×2 — and the plot is *taller* relative to its width than it was, so the charts lost less
  vertical resolution than the halved column implies.
- The three charts can no longer drift apart, and the aspect ratio has a test that fails if a
  padding token, the content measure or the `viewBox` moves against it.
- One less piece of view-local state. [[0027-analytics-views-persist-and-explicit-refresh]] is
  untouched: the range selection still lives above `AnalyticsShell` and still survives a tab
  switch, `loading` still means the first load, and the shell still owns the four-branch guard
  ([[0043-analytics-view-shell]]).

Tradeoffs:

- **The collapsed column doubles the label with the chart.** Below 1200px a single full-width
  chart renders its axis labels near 24px — legible, but heavier than the page around them. This
  is the direction that costs nothing, and the alternative is the one DDR-0018 rejected.
- The view is taller: two rows of charts plus a table means scrolling on a 1000px-tall window
  where one chart did not. Inherent to showing four things at once, which is the story.
- The bar chart's `MIN_BAR_W` and `MAX_BAR_W` are plot-relative and had to move with the width
  (0.75 → 0.4, 24 → 10). A floor wider than the band it sits in makes neighbouring bars overlap,
  and the plot is now 436 units wide rather than 1000.

Risks:

- Below ~800px every chart's labels fall under 11px again. The window has no enforced minimum
  size, but at that width every view in the app is squeezed, not just this one — a minimum window
  size is its own decision.
- Four charts is what the grid holds. A fifth is not a card added to the row; it is this decision
  taken again.

## Alternatives Considered

### Keep 1080×240 and just lay four of them out

Rejected, and it is the version this DDR exists to rule out. It is the whole change if you stop
at the CSS: two columns, done. It also puts an 8.3px number on the axis at a 1920px window and
halves the plot height, which is precisely the "charts remain readable" criterion DDR-0018 wrote
into its own acceptance.

### Cap the chart's width and centre it inside the wider card

Rejected — again. DDR-0018 tried exactly this when the measure widened and found that a chart
floating in the middle of a panel with dark bands on both sides reads as a rendering bug rather
than a design. It would have bounded the collapsed column's label size, which is the one place
this decision accepts a compromise, and it is not worth reopening a rejection to buy that.

### Pick the `viewBox` at runtime from the container's width

Rejected, for the reason DDR-0018 gave and one more. It is a `ResizeObserver` and a re-render per
chart to solve a problem a ratio solves, and the charts are deliberately dependency-free inline
SVG. The extra reason: runtime geometry is geometry a Node-only suite cannot check, and the
acceptance criterion here is a claim about rendered pixels that only the arithmetic makes
testable.

### Keep the switcher and add a "compare" mode

Rejected. It keeps the switcher's cost and adds a second thing to learn, for a view whose four
charts are *always* better read together — there is no reading of this view where showing one is
the right default. The owner confirmed the grid replaces the switcher rather than joining it.

### A 3-up row plus one, or a 2×1 arrangement

Considered as the fallback if Story #171 slipped, per the story's own sequencing note. Moot:
composition landed first, so the grid ships with four quadrants filled rather than with a hole in
it.

## References

- [[0018-content-measure-and-chart-aspect]] (the aspect-ratio rule this pulls the lever on, and
  the source of the rejected width cap), [[0049-daily-return-bars-thin-rather-than-aggregate]],
  [[0050-daily-nav-from-equity-summary]], [[0036-toggle-group-mode-axis-and-pressed-semantics]],
  [[0027-analytics-views-persist-and-explicit-refresh]], [[0043-analytics-view-shell]],
  [[0031-design-token-scales]], [[0042-token-adoption-ratchet]]
- `src/renderer/src/lib/chartGeometry.ts` + its test,
  `src/renderer/src/components/analytics/PerformanceView.tsx`,
  `src/renderer/src/components/charts/{LineChart,BarChart,StackedAreaChart}.tsx`,
  `src/renderer/src/app.css` (`.performance-charts`)
- GitHub Issue #172 (Epic #99)
