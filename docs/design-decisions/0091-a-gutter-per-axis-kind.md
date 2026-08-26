# 0091. A gutter per axis kind, and the left edge the grid spends to get it

- **Status:** Accepted. Amends [[0051-performance-chart-grid]] — specifically its §#190 amendment,
  whose *rule* is unchanged and whose *scope* is what this record widens. The 500×180 plot, the
  breakpoints, the legibility walk and the four equal cards all stand.
- **Date:** 2026-08-26

## Context

[[0051-performance-chart-grid]] put four charts in a 2×2 grid on one shared plot geometry, and its
Story #190 amendment fixed a y-axis gutter that had never fitted the label it was for. `pad.left`
became **derived** rather than picked: `AXIS_LABEL_ADVANCE_UNITS` (6.4) ×
`AXIS_LABEL_BUDGET_CHARS` (11) + `AXIS_LABEL_GAP_UNITS` (8), rounded to 80. Eleven characters is
`€999,999.99`, a base-currency figure at the width a six-figure portfolio produces.

That derivation is right and it was applied to one number for four charts. **Two of the four never
label their axis in currency.** The return curve labels it `+28.25%`, the daily-return bars
`-5.00%` — six to eight characters against a budget of eleven. So the gutter is correct on the two
charts it was measured against and roughly twenty units of empty space on the two it was not, and
the plot pays for all of it. On screen the return curve is squeezed against its own left edge
while its neighbour's gutter is full of text.

**This is #190's defect in the other direction, and the other direction is the one nothing
reports.** A gutter too narrow clips a glyph, which is at least visible once someone looks. A
gutter too wide never clips, never throws and never reflows — it silently costs plot width, at
every window size, for as long as nobody puts a ruler on it. #190 replaced a number with a rule
and left the rule reading one global; a single number cannot be derived from four different sets
of labels, and the moment the grid held two kinds of axis the derivation stopped describing three
of the charts it governed.

Story #269's own estimate — five or six characters, twenty-seven units recoverable — assumed one
decimal. `formatPercentValue` writes two, so the labels are six to eight and the recoverable space
is twenty units. The estimate moved; the finding did not.

## Decision

**The y-axis gutter is derived per *axis kind*, and nothing else about the plot varies.**

`lib/chartGeometry` states an `AxisLabelKind` (`'currency' | 'percent'`), a budget for each, and
one derivation over both:

- **currency — 11 characters**, `€999,999.99`. Unchanged, to the unit: the gutter is still exactly
  80. #190's bound is #269's bound.
- **percent — 8 characters**, `+999.99%` as `formatSignedPercent` writes it: a sign, three digits,
  two decimals, the symbol. It holds a cumulative return of ±999.99% — an order of magnitude past
  anything either chart has plotted — and clips at ±1,000%, where the grouping comma arrives. The
  gutter is **60**, and each of the 20 units the two percentage charts gain is a unit that carried
  no ink.

`axisGutterUnits(budgetChars)` is #190's arithmetic with the budget passed in, rounded up to the
**4-unit step every other pad edge already sits on** (16, 16, 28). That is what keeps a gutter a
whole number instead of the 59.2 the percent budget produces, and it is why the currency gutter
reproduces 80 rather than approximating it.

**Which chart takes which kind is a property of the chart, except where it isn't.** `BarChart`
plots a daily return and `StackedAreaChart` plots money; each pins its kind at module scope and
takes no prop for it. `LineChart` draws *both* curves in this grid, so it takes `axis` as a
**required** prop, stated beside the `formatValue` it describes. Required rather than defaulted on
purpose: a default would hand a new caller the currency gutter, and that is the failure with no
symptom.

**The left edges of the four plots stop lining up. That is spent deliberately, and it is the only
edge spent.**

Row 1 pairs a currency chart with a percentage one and row 2 does the same, so per-chart gutters
put the two plots in a row on different left edges — 80 and 60, about 25 CSS px at a 1421px
window. There is no arrangement that avoids it: the two kinds sit diagonally in the grid, so
neither a per-row nor a per-column gutter would be narrower than the currency one anywhere, and a
shared gutter is the thing this record removes. Widening the plot and keeping the alignment are
the same question asked twice.

What is *not* spent, and is shared on purpose: `pad.right`, `top`, `bottom`, the `viewBox` and the
ratio. **The right edge is the one that still lines up across the grid, and it carries the end of
the window** — the most-recent reading, which is where every one of these charts is scanned to.
The four cards remain identical in size, the date range remains one selection under one
`RangeFilter`, and the argument the grid makes is read across cards rather than off a shared
vertical.

It also helps that the alignment being given up was never exact. `BarChart` spaces its bars in
even **bands, one per trading day**, not by calendar distance (DDR-0049), and the composition
stack plots its own set of NAV days — so a vertical dropped through the grid already landed on
different dates in different charts. What the grid actually shares is the *window*, and the window
is unchanged.

## Consequences

Benefits:

- The return curve and the daily-return bars each gain 20 units of plot, from 404 to 424 — a 5%
  wider drawing area on two of four charts, taken entirely from space that drew nothing.
- The derivation now describes every chart it governs. `pad.left` was a rule about labels applied
  to one set of labels; it is a rule about labels applied per set.
- The failure mode that has no symptom is now the one under test. `chartGeometry.test.ts` runs the
  app's **own** formatters over the ticks each axis really renders and fails if the output is
  wider than the budget that chart's gutter is derived from — and fails on the upper bound too, so
  a gutter with more than one glyph of slack is a failure rather than a silent cost.
- The pairing is guarded where it actually lives: at the call site. `PerformanceView` hands
  `LineChart` a formatter *and* an axis, and nothing but a test can see whether the two agree.

Tradeoffs:

- The four plots' left edges differ. This is a real, visible change to a grid built for
  cross-reading, and it is the cost the width is bought with.
- `PERFORMANCE_PLOT` is no longer "the" plot — it is the currency one, kept as the default for the
  callers that draw no y-axis (`ChartTooltip`'s fallback, the pure modules' tests). It is the
  *widest* gutter of the two on purpose, so anything defaulted is bounded by the narrowest plot
  rather than the roomiest.
- Every chart now passes its own `plot` to `ChartTooltip`. The card clamps against the plot's left
  and right edges, so a card laid out against the other kind's plot would clamp to an edge its
  chart does not have.

Risks:

- **The percent bound is real and lower than it looks.** At ±1,000% the label takes a grouping
  comma and clips, exactly as the currency axis clips above €1M. Both bounds are stated in
  `AXIS_LABEL_BUDGET_CHARS` and both are widened in the same place.
- **A locale can push a label past its budget.** `formatCurrency` writes `999.999,99 €` — twelve
  characters — in a European locale, which the eleven-character budget predates and does not hold.
  That is not new here and is not what this story changed; it is recorded because the test suite
  runs in `en-US` and cannot see it. Widening the budget is a one-line change when it matters.
- A third axis kind (a share count, a ratio) would need a budget rather than a guess. The type is
  the place that asks.

## Alternatives Considered

### Keep one gutter, sized to the widest label any chart in the grid draws

The status quo, and the only way to keep the four left edges aligned. Rejected because it is the
defect: it holds eleven characters' worth of gutter behind a seven-character label on half the
grid, forever, and the story's acceptance criteria require the return chart's plot to be wider
than it was. Alignment and width are not both available.

### Reorder the quadrants so the two currency charts share a column

Geometrically the best of the alignment-preserving options: one gutter per *column*, so the
vertical pairs still line up and only the rows diverge. Rejected because the grid's order is an
argument, not a layout — row 1 is the two cumulative curves, row 2 the two charts that break them
apart, and the reading order is the DOM order a screen reader gets
([[0051-performance-chart-grid]]). Reordering it to make a gutter tidy would change an approved
decision to serve an unapproved one.

### Shorten the tick instead — `€68k`, `+16%`

Still the better long-run shape, and still the one [[0051-performance-chart-grid]]'s §#190
amendment deferred: the axis and the hover card share one `formatValue` prop, so it needs a second
formatter on three components, and a tick that no longer agrees with the card beside it is a
decision about the chart language rather than about this grid's geometry. It also solves a
different problem — it would narrow *both* kinds of gutter, and the finding here is that the two
kinds differ from each other. Worth its own story either way.

### Take the recovered space as `pad.right` on the percentage charts, keeping the left edges level

Rejected on inspection: it does not keep the left edges level. `pad.left` is what positions the
plot's left edge, and moving units to `pad.right` narrows the plot again by exactly what the
gutter gave back. It is the alignment-preserving option restated.

### Measure the widest tick at render time and size the gutter from it

The obviously "correct" answer, and unavailable. A `viewBox` has no layout engine, and
[[0018-content-measure-and-chart-aspect]] already rejected sizing a chart from a `ResizeObserver`.
A budget in characters is what can be checked in a Node suite, which is the whole reason #190's
derivation exists.

## References

- [[0051-performance-chart-grid]] (the shared geometry and the §#190 derivation this amends),
  [[0018-content-measure-and-chart-aspect]] (a chart is sized by ratio; an axis label is 11 viewBox
  units), [[0053-bundled-typefaces-and-the-figure-role]] (the face and tracking the advance is
  measured against)
- [[0049-daily-return-bars-thin-rather-than-aggregate]] (the bands that made the vertical
  alignment approximate already), [[0052-composition-cumulative-and-chart-readability]],
  [[0061-chart-language-gradient-zero-line-and-one-hover-card]] (the card that now takes each chart's own plot),
  [[0071-indigo-value-curve-and-the-signed-return-curve]] (`signedCurve`, which reads the same
  plot), [[0072-a-chart-title-names-the-chart-not-the-window]] (the four cards re-measured at
  1421px)
- `src/renderer/src/lib/chartGeometry.ts` + its test,
  `src/renderer/src/components/charts/{LineChart,BarChart,StackedAreaChart}.tsx`,
  `src/renderer/src/components/analytics/PerformanceView.tsx`
- GitHub Issue #269 (Epic #251)
