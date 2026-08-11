# 0049. Daily-return bars thin rather than aggregate, in their own chart

- **Status:** Accepted (extends [[0013-performance-twr-curve-and-chart-hover]], [[0018-content-measure-and-chart-aspect]])
- **Date:** 2026-08-11
- **Story:** #170, under Epic #99

## Context

The Performance view drew two cumulative lines. Neither answers *what does a normal day look
like?* — a curve that rises 40% over a year looks identical whether it climbed in steady 0.15%
steps or in a dozen violent swings. Story #170 adds the third chart that shows the individual days.

Two things were settled before it was built, and both were settled by reading rather than guessing.

**The data is already imported.** The owner checked on 2026-08-10 whether the Flex Query needed a
new section. It does not: `PriorPeriodPositions` is already enabled, already carries `priorMtmPnl`
per instrument per trading day, already lands in `flex_prior_period_positions`, and
`performanceService` already folds it into the cumulative `returnSeries` the view draws. The two
committed samples carry 334 distinct trading days between them. So the story is renderer-only — no
service, no contract, no channel, no migration.

**The measure is a chain-link, not a difference.** `rₜ = (1 + cₜ) / (1 + cₜ₋₁) − 1` over the
*return* series, never `vₜ − vₜ₋₁` over the value series. A €10,000 deposit moves `valueSeries` by
€10,000 and would be drawn as a spectacular day; it does not move `returnSeries` at all. That is
the whole reason [[0013-performance-twr-curve-and-chart-hover]] chose TWR for the curve, and a
bar chart differencing the value series underneath it would reintroduce exactly what that record
excluded.

## Decision

### Thinner bars as the series densifies — never aggregation

The `viewBox` is fixed at 1080×240 and bars thin with the count: `band × 0.7`, clamped to
`[0.75, 24]` viewBox units. A five-point window draws slabs; 334 trading days draw ~2-unit bars;
a multi-year window reads as a volatility envelope rather than a row of bars.

Aggregation — rolling days up into weeks or months — was rejected, and not on effort. **It removes
the signal the chart exists to carry.** A week of +3%/−3%/+2%/−4%/+1% nets to roughly −2% and
renders as one calm bar; the chart would then report the same thing the cumulative curve already
reports, at coarser resolution, having thrown away the volatility that motivated it. Thinning
degrades *legibility of an individual day* while preserving the distribution; aggregating preserves
legibility while destroying the distribution. Only one of those failures is recoverable by the
reader, who can narrow the `RangeFilter`.

### One band per point, not a date-proportional axis

Trading days are irregular. Spacing bars by calendar distance leaves a gap every weekend, a wider
one at every holiday, and makes the bars around them unequal — which reads as a change in the data.
Even bands are what "one bar per trading day" means. The cost is that the x-axis is ordinal, so
only the two endpoints are labelled.

### The zero baseline is the second channel, so `--pos` / `--neg` are spent freely

[[0021-allocation-map-gain-loss-scale]] holds that green/red may not be the *only* channel on a mark. Here
a bar's side of an emphasised zero line already states the sign; the colour reinforces a fact the
geometry has stated. This is the same allowance `.chart-bar-loss` was granted in Story #49. The
**fill** tokens are used — `--neg`, not `--neg-text` — because these are areas, not glyphs
([[0046-contrast-split-tone-tokens]]).

### Its own component, sharing the axis rather than the chart

`BarChart.tsx` is new; `ColumnChart` was not extended. That chart models two *stacked* series, so
it always carries a legend; it labels every column with its own `<text>`; and it widens its
`viewBox` by 56 units per column — correct for twelve months of dividend income, and all three
wrong here. 191 trading days through it give a 10,800-unit-wide plot (a 45:1 strip) under 191
overlapping date labels, for a chart with one series and nothing to legend. Serving both would mean
conditioning the legend, the per-column labels, the width policy and the fill policy on four flags:
a fork wearing a shared name.

What *is* shared is `lib/column.ts`'s `columnDomain`, which already rounds a signed domain outward
to nice steps and always puts a tick on zero. A single series is its degenerate stack
(`upper: 0`). The 1080×240 ratio is shared with `LineChart` deliberately: the three charts sit in
one switcher today and in one grid tomorrow (Story #172), and nothing should jump when the
selection changes.

### The maths takes the unwindowed curve

`dailyReturns(series, bounds?)` computes every return, then filters. `bounds` decides which bars
are *drawn*, never their heights — so the window's opening bar is measured against the trading day
that really preceded it, rather than against the synthetic carry-forward point `sliceSeries`
anchors at the window edge.

Feeding it the rebased curve instead would have been *almost* right: the base cancels out of
consecutive ratios, so the heights agree — but `rebaseSeries` slices first, leaving its opening
point with no predecessor, and the window's first day silently yields no bar at all. Both halves
are pinned by tests.

The arithmetic itself is `performanceRange`'s `chainLink`, now exported rather than copied.
Rebasing onto the previous point is the same operation as rebasing onto a window's opening point,
including its handling of a −100% base — where the denominator is zero and a naive ratio emits
`Infinity` into a chart's value axis. A private second copy would be free to disagree about that.

### The approximation is stated on the page, not buried

A daily *return* needs a denominator. `buildReturnSeries` anchors each statement period's endpoints
to the TWR IBKR reports and apportions the days between them by each day's share of the period's
mark-to-market result. So the boundaries are exact and the interior is modelled. A `.source-note`
under the chart says so, in the pattern the Dividends view established for its stacked columns.

## Consequences

- The first point of the history draws no bar. It has no predecessor, and rendering it as 0% would
  assert a flat day the data does not describe. A one-point window therefore draws nothing and
  falls to the inline `StatePanel`.
- Beyond roughly 1,300 bars the gaps close and the chart is a filled envelope. That is the intended
  floor, not a defect — the reader narrows the range.
- `.chart-bar-loss` is now worn on its own, not only as a modifier on `.chart-bar-lower`.
- The chart is added as a third `ToggleGroup` option. Retiring that switcher for a 2×2 grid is
  Story #172's scope, explicitly, and this record's fixed aspect ratio is what that story will have
  to revisit — halving the column width halves the height too ([[0018-content-measure-and-chart-aspect]]).

## Alternatives Considered

- **Weekly or monthly aggregation.** Rejected above: it answers the cumulative curve's question at
  coarser resolution.
- **Differencing `valueSeries`.** Rejected: it reports deposits as gains, which
  [[0013-performance-twr-curve-and-chart-hover]] exists to prevent.
- **True intra-day (open→close) returns**, the original phrasing of the request. Not possible from
  the imported data — Flex carries daily marks, not intraday opens. Confirmed with the owner that
  the intent was each day's return.
- **A hover crosshair readout**, as `LineChart` has. Left out: each bar carries a native `<title>`,
  and a scrubbing readout over 2-unit bands is a separate interaction problem.
