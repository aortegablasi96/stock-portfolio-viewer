# 0052. Composition stacks cumulatively; the charts drop their prose and gain a scrub

- **Status:** Accepted (supersedes the 100%-stacked half of
  [[0050-daily-nav-from-equity-summary]]; extends
  [[0051-performance-chart-grid]], [[0049-daily-return-bars-thin-rather-than-aggregate]],
  [[0030-allocation-map-country-donut-pairs]])
- **Date:** 2026-08-13

## Context

[[0051-performance-chart-grid]] put the Performance view's four charts on screen together for the
first time. Reading them side by side — against the owner's real 2025/2026 imported statements, in
the running app — surfaced three things that a switcher had been hiding, all of them about the
grid rather than about any one chart.

**The prose was competing with the plots.** Two of the four cards carried a `source-note` paragraph
explaining how their numbers were derived. DDR-0051 had already moved those notes *below* their
charts to keep the row's plots level, which fixed the alignment and left the real problem: on a
screen showing four charts, two of them are followed by five and seven lines of small grey text.
The composition card was taller than its own chart.

**The daily-return bars could not be read one day at a time.** They shipped with a `<title>` on
each `<rect>` — the browser's native tooltip. [[0049-daily-return-bars-thin-rather-than-aggregate]]
is explicit that the bars thin with the series rather than aggregating, and at the owner's ~190
trading days a bar is roughly one viewBox unit wide. A tooltip you have to *aim at* is not
available on a target that thin, and the half-second hover delay makes scrubbing across the series
impossible. The chart could show the shape of the ride and not the days in it.

**The composition stack was the loudest thing in the view and said the least.** Two separate
causes. It was 100%-stacked, so its top edge was a flat line at 100% every day — which meant its
whole vertical extent was spent on proportion, and eight saturated `--series-*` hues filled the
entire card to say so. Next to three charts that all move, a rectangle of full-strength colour
reads as the subject of the view.

That last one is a reversal, not a refinement. DDR-0050 chose 100%-stacked deliberately and gave
two reasons, both of which have to be answered rather than ignored.

## Decision

### The composition chart stacks cumulatively, in base currency

Bands stack from zero in the account's base currency and the top edge of the stack is the day's
NAV. The y axis is money, its ticks come from `columnDomain` — the same rounding the dividend
columns use — and the hover readout gives every band **both** its amount and its share of NAV, plus
a **Total** row.

DDR-0050's two reasons, taken in turn:

- *"Composition is a question about proportions."* It is, and the percentage is still there — in
  the readout, per band, per day. What the normalised chart could not express is a quantity: under
  it, every band moved whenever any band moved, so "cash went from nothing to €4k" was not a
  sentence the chart could produce. The owner asked for the cumulative version having used both.
- *"It would sit next to the value curve saying the same thing twice."* The top edge does now trace
  the value curve. That is a real cost and it is accepted: the curve answers *how much*, and the
  stack answers *how much, made of what* — the redundancy is the shared axis that lets the eye move
  between them. The feared failure was worse than the actual one; the two cannot diverge, because
  since DDR-0050 they are the same `EquitySummaryInBase` series.

Everything else in the stacking survives unchanged, because none of it was about normalisation:
negative bands still hang **below** the zero line rather than being clamped or folded (stacking
`|value|` would draw a margin position as an asset); the `other` band is still the **residual**,
surfaced and never redistributed; a zero-NAV day still pinches to the baseline rather than
producing `NaN`. What is gone is the domain's anchor to `[0, 1]` — that existed so two windows at
the same proportion drew the same shape, and here the domain is *supposed* to follow the money.

The top edge is NAV **because the bands are exhaustive**, not because anything enforces it. That is
now load-bearing in a way it was not before: the old chart divided by `total`, so it drew a flat
100% whether or not the parts summed. `composition.test.ts` therefore asserts the stack's top
against `point.total` directly.

### The composition bands are softened, and only there

`.stack-band` carries `fill-opacity: 0.5`, and `.composition-legend`'s swatches the same. The value
was picked on screen against the owner's real imported statements rather than derived — 0.62 was
tried first and still read as the loudest thing in the grid.

`.stack-band` needs no ancestor selector, since it exists in this chart alone; the legend swatch is
the shared `.legend-swatch` class, so that half is scoped.

### The legend moves into the card header, and all four cards become the same height

`CompositionLegend` renders at the right of the composition card's `CardHeader`, beside the title.
`StackedAreaChart` therefore emits a bare `<svg>` exactly like `LineChart` and `BarChart`.

This is not only about where a legend reads best. Sharing a `viewBox` ([[0051-performance-chart-grid]])
makes the three *plots* identical; it says nothing about the *cards*, and a `<figcaption>` under one
plot made that card taller than the two beside it — the same misalignment DDR-0051 built the grid to
avoid, arriving by a different route. Three things make the equality hold rather than merely happen:

- **Every** `ChartCard` renders a `CardHeader`, including the three with nothing to put in it. A
  bare `CardTitle` and a `CardHeader` wrapping one are near-identical, and a grid read across its
  rows cannot afford "near".
- The header is **centred and never wraps** (`.chart-card-header`). `.card-header` wraps by
  default, which is right for a toolbar and wrong here: just above the 1200px collapse, the title
  and a four-band legend come within a few dozen pixels of the column, and a wrapped legend puts
  back exactly the height the move removed.
- When the row is too narrow, the **title yields**, not the legend — it shrinks and ellipsizes. A
  clipped key is unreadable where a clipped title is merely abbreviated, and the chart states its
  full name in `aria-label` regardless.

Colour for both now comes from `compositionColors` (`lib/composition`), called by the chart and the
legend alike. They are no longer in the same element, and two call sites deriving palette slots
separately is how a key starts disagreeing with what it keys.
The `--series-*` palette is validated as a set for CVD and contrast
([[0030-allocation-map-country-donut-pairs]]) and is tuned for donut wedges and map marks — small
isolated shapes that must hold identity at a few dozen pixels against a dark card. The same eight
hues as slabs covering most of a card are a different problem, and it is a *scale* problem, not a
hue problem. So the classes are unchanged and one asset class still means one hue everywhere: this
is the same colour, further back.

`fill-opacity` rather than `opacity`, so the bands stay individually composited instead of being
flattened into a group. The legend is softened by the same amount or the key stops matching what it
keys.

### The daily-return chart is scrubbed, not aimed at

The per-bar `<title>` is replaced by the crosshair-and-tooltip readout the other two charts in the
grid already use. The hit target is the **band**, not the drawn bar: `bandIndexAt`
(`lib/column.ts`) maps any x in the plot to exactly one day, so dragging across the chart reads the
series out continuously. Positions in the axis padding **clamp** to the nearest end rather than
blanking — the padding is label allowance, not a gap between days, and a readout that vanished
there would flicker along the whole edge.

The scrubbed bar is **outlined**, never recoloured: hue is identity, and a bar that changed colour
under the pointer would read as a change of sign. The outline takes `vector-effect:
non-scaling-stroke` because by a few hundred days the bar is a hairline and a stroke measured in
viewBox units would be wider than what it outlines.

### The two source notes are deleted

Not collapsed behind a disclosure — deleted. The derivations they described are unchanged and are
where a reader who wants the method is better served: `lib/dailyReturns`, `lib/composition`,
DDR-0049 and DDR-0050. What the reader of the *view* needs is on the chart itself — the axis, the
legend, the readout — and the cumulative stack plus the new hover rows put more of it there than
the paragraphs did.

## Consequences

Benefits:

- A band's thickness is now a quantity. "Cash went from nothing to €4k" is readable off the chart,
  and the amount and the share are both in the readout rather than one replacing the other.
- The composition card no longer dominates the grid, and the two curves beside it are legible
  against it rather than in spite of it.
- Every trading day in the daily-return series is reachable, at any density DDR-0049 produces —
  which is what makes finding the worst day of a drawdown possible rather than lucky.
- Four cards of **exactly** equal height, guarded rather than observed: `chartGeometry.test.ts`
  fails if a grid chart grows a wrapper below its plot, if a card declares its own header, or if
  the single-line header rule leaves `app.css`. The note-placement rule DDR-0051 needed is gone
  with the notes.

Tradeoffs:

- **A small band is harder to read as NAV grows.** A 2% cash sliver is thinner at €45k than at
  €20k, where the normalised chart held it at a constant 2% of the plot. This is the cost DDR-0050
  named and it is real; the readout is what answers it.
- **The top edge duplicates the value curve.** Accepted above.
- The palette now has one call site that deviates from the validated tokens. It deviates in
  *opacity*, not hue, and only inside one figure — but it is a precedent, and a second such
  exception would be the moment to ask whether the palette needs a second, quieter scale rather
  than a per-chart override.
- `stackSpans` is now unit-agnostic in practice as well as in principle. Its tests moved from
  shares to currency, which is a weaker guard against someone passing the wrong one in.

Risks:

- Nothing enforces that the bands sum to `total`. If a future NAV category were dropped rather than
  folded into `other`, the top edge would silently stop being NAV — and unlike the normalised
  chart, nothing would look wrong. The test asserting the top against `point.total` is the guard;
  keep it.
- The hover readout grows with the band count. Five bands plus a heading and a total is 106 viewBox
  units in a 180-unit plot; a sixth band would want the box to flip or shrink rather than overflow.

## Alternatives Considered

### Keep 100%-stacked and only restyle it

Offered to the owner as the option that leaves DDR-0050 intact, and declined. It answers the
loudness but not the reason the chart was being read: the owner wanted to see what an asset class
was *worth* over time, which no amount of restyling gets out of a normalised chart.

### A toggle between absolute and percentage

Rejected, as DDR-0050 already rejected it, and now for a second reason: DDR-0051 exists to remove a
switcher from this view. Putting one back inside a card six weeks later is the same mistake at a
smaller scale.

### Retune `--series-1..8` globally

Considered and declined by the owner. The palette is worn by both allocation donuts, the map's
country marks and every legend, none of which have this problem — they are small shapes that need
the saturation. Retuning would also mean re-validating the CVD and contrast gates for eight tokens
to fix one figure, and moving values `designTokens.test.ts` pins on purpose.

### Collapse the source notes behind a disclosure

Offered and declined. It keeps the text available at the cost of a control per card and a second
thing in the grid that can be in two states; the notes' content belongs in the modules and DDRs
that own those derivations, which is where it already is.

### Hit-test the drawn bar rather than the band

Rejected. It is the obvious implementation and it fails at exactly the density the chart is built
for: at ~190 days the bar is 0.7 of a ~2.2-unit band, and past ~1,090 days it is `MIN_BAR_W`. The
band is the day; the bar is only how the day is drawn.

## References

- [[0050-daily-nav-from-equity-summary]] (superseded on the 100%-stacked point; its NAV source,
  negative-band, residual and zero-NAV rules all stand), [[0051-performance-chart-grid]],
  [[0049-daily-return-bars-thin-rather-than-aggregate]],
  [[0030-allocation-map-country-donut-pairs]], [[0040-allocation-breakdown-linked-slice-emphasis]]
  (hue is identity; emphasise by outline, not by recolour), [[0018-content-measure-and-chart-aspect]],
  [[0031-design-token-scales]]
- `src/renderer/src/lib/composition.ts` (`valueDomain`, `compositionColors`) + its test,
  `src/renderer/src/lib/column.ts` (`bandIndexAt`) + its test,
  `src/renderer/src/lib/chartGeometry.test.ts` (the equal-card-height guard),
  `src/renderer/src/components/charts/{StackedAreaChart,BarChart}.tsx`,
  `src/renderer/src/components/analytics/PerformanceView.tsx`,
  `src/renderer/src/app.css` (`.stack-band`, `.composition-legend`, `.chart-legend-header`,
  `.chart-card-header`, `.chart-bar-active`)
- Owner request, 2026-08-13 (in-session refinement of Stories #170–#172, Epic #99)
