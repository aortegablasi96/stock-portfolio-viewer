# DDR-0061 — The chart language: a gradient area, a zero line where the series crosses it, and one hover card

## Status

Accepted

## Date

2026-08-19

## Context

Story #188 is the last of Epic #179's *Shared surfaces* stories: the redesign draws every chart the
same way, and the app's charts were drawn one story at a time over four milestones. The prototype's
language has four elements — a gradient area fill, horizontal-only gridlines with no axis lines,
small muted ticks, a zero reference line wherever a series can go negative — plus a floating
tooltip card listing each series' name and value in the monospaced face.

Two findings shaped the work before any of it started.

**Three of the four elements were already correct.** The charts here were drawn without axis lines,
with horizontal rules in `--chart-grid`, and with 11-unit ticks in `--chart-axis` from the start;
DDR-0054 re-validated both of those tokens against the new ground and deliberately did not move
them. So the visual gap was not what the story's title suggests. It was the **flat area wash**, one
**missing zero line**, and the tooltip.

**The tooltip had already been written three times.** `LineChart`, `BarChart` and
`StackedAreaChart` each carried a private `HoverReadout`, and all three had copied the same
`widest * 7 + 16` width heuristic and the same "prefer right, flip left near the edge" placement.
They had already begun to disagree: two used a fixed 36-unit box and the third computed its height,
and the composition card put its first baseline at 13 units where its neighbours had 14. Restyling
the card meant editing that heuristic in three files, which is what the app's other consolidations
(DDR-0043, DDR-0033, DDR-0039) exist to stop.

Against that sit four invariants the story names and none of which may be spent on appearance:
the shared 500×180 `viewBox` and `pad.left: 64` (DDR-0018, DDR-0051); all four Performance cards
being exactly one header plus one bare `<svg>` tall (DDR-0052); band hit-testing with clamping,
and an active bar that is **outlined rather than recoloured** because hue is identity here
(DDR-0052); and `.stack-band`'s softened `fill-opacity` (DDR-0052).

## Decision

**The area under a curve becomes a vertical gradient, and its colour stays in the stylesheet.**
`.chart-area`'s flat `fill: var(--series-1); opacity: 0.12` is replaced by a `<linearGradient>`
from `stop-opacity: 0.28` at the curve to `0` at the baseline. The wash it replaces was one opacity
all the way down, so it had a hard edge of its own along the bottom of the plot and read as a
second, paler series; a gradient reads as the curve's own weight. The **stops are two CSS rules**
(`.chart-area-from` / `.chart-area-to`), so the hue is still `--series-1` and not a value pasted
into markup — but the `fill` is a per-element attribute, because a gradient is referenced by id and
the two curves in the Performance grid are two elements on one page. `LineChart` mints the id with
`useId()`; a module constant would have painted the second chart from the first one's stops.
`stop-opacity` rather than a `color-mix()` with the card, so the gridlines stay visible through
the fill the way they were through the wash.

**The zero line is drawn where zero is a level the series crosses, not where it is the floor.**
The cumulative-TWR curve spends whole periods below zero and had no baseline to read them against;
the value curve never does, because its domain floors at zero and the bottom of the plot *is* the
zero line. So `LineChart` draws the emphasised rule only when `minV < 0` — the same test the two
column charts already apply, now stated once more rather than assumed. This is the story's one
genuinely missing mark: it is the second channel that lets a reader resolve the sign without
resolving the colour (DDR-0021).

**One `ChartTooltip`, rendered inside the plot's `<svg>`, replaces the three private readouts.** The
layout maths moves to `lib/chartTooltip` — box size from its widest line, the side flip, the clamp,
and the row baselines — and the markup to `components/charts/ChartTooltip`, which draws the
crosshair too, because a card without one names a point it does not mark.

Three properties of that card are the decisions worth recording:

- **In the `viewBox`, not at the cursor.** The prototype's card is a `position: fixed` panel at the
  pointer. In a 2×2 grid that hangs over the chart next door. A card drawn in the plot's own
  coordinate space **cannot leave its plot**, so the story's constraint is met by construction
  rather than by an offset someone has to keep tuned as the grid changes — and the card scales with
  the chart like every other mark (DDR-0018). It is `pointerEvents="none"`, so the band beneath it
  stays hit-testable while the pointer crosses it.
- **Pinned to the top of the plot, in all three.** `BarChart` and `StackedAreaChart` already were;
  `LineChart` tracked its point and now does not. A daily-return bar can be one unit tall, so a
  card tracking the mark jumps the height of the plot between two adjacent days — and the three
  charts are read against each other, so a reader scrubbing from one to the next should find the
  card where they left it. The hover **dot** stays on the mark, drawn outside the card: the card
  says which day, the dot says where on the curve.
- **Two columns, and the label is not a figure.** A row is a muted series name on the left and its
  figure right-aligned on the right, so decimal points line up down a composition card's four
  rows. The name is prose and stays in the sans face; the date heading is a figure and keeps the
  role (DDR-0053). They share one rule for size and tone, which is why `tokenAdoption`'s exemption
  list stays at **eight** — the new selector joined the date's rule instead of copying it.

**The card fades in on `--duration-fast`**, as an `animation` rather than a `transition`: it is
mounted by the scrub, so there is no previous state to transition from. Drawing the duration from
the token is what puts it inside the one `prefers-reduced-motion` block, which zeroes the tokens
rather than listing what moves (DDR-0044).

**Scope: four charts take the parts they have, and two take none.** `ColumnChart` and `PieChart`
already draw the gridline, tick and zero-line treatment (or have no axis at all) and keep their
native `<title>` tooltips, which is what a donut says on its own where no table sits beside it
(DDR-0030). `CountryMap` is excluded by the story. `.stack-band` is **not** touched: eight
gradients would spend one-hue-per-asset-class for nothing, and its `fill-opacity` survives exactly
as DDR-0052 left it. And bars keep flat fills — the gradient is applied where there is an *area*,
which is the two curves.

## Consequences

- The tooltip's box is sized by a **character heuristic**, not by measurement, and always was:
  there is no layout engine inside a `viewBox`. `CHAR_W` is deliberately generous, because the
  figures are ~20% wider in `--font-figure` (DDR-0053) and a card a few units too wide is invisible
  where one a few units too narrow clips a number. A story that adds a much longer row should look
  at the rendered card, not just at the test.
- **Adding a fourth chart to the grid gets the card for free**, and gets it identical. The cost is
  the usual one: `ChartTooltip` now knows the Performance plot's geometry, so a chart on a
  different `viewBox` would need the plot passed in rather than imported. That is a two-line change
  and was not made speculatively.
- The area still fills from the curve to the **bottom of the plot** rather than to the zero line,
  which on the return curve means the fill crosses the new baseline. Considered and left alone:
  changing where an area terminates is geometry, and this story is a restyle. The gradient has
  faded to nothing well before it gets there, so nothing reads as positive area under zero.
- `.chart-area` no longer exists as a rule. A future chart wanting the gradient must mint its own
  id and reference it; `chartTooltip.test.ts` fails if the flat-wash rule comes back.
- The composition card's **Total** row now looks like a band row rather than taking the muted date
  treatment it used to. That is the two-column layout doing its job — the total is a figure in the
  same column as the figures it sums, which is where a reader compares it.

## Alternatives Considered

### Option A — port the prototype's fixed-position tooltip

Rejected. It is an HTML panel at `clientX/clientY`, so in the 2×2 grid it covers the neighbouring
chart, and it would put chart text back on the page type scale — the exact thing DDR-0018 keeps out
of a `viewBox`.

### Option B — keep three private readouts and restyle each

Rejected. It is the same edit three times to a heuristic that had already drifted, and it leaves
the placement maths where no Node test can reach it. The consolidation is what makes the layout
testable at all.

### Option C — add `recharts`, as the prototype does

Rejected by the Epic's own acceptance criteria and by ADR-0008. Charts here are dependency-free
inline SVG.

### Option D — give the composition bands gradients too

Rejected. Eight gradients over eight hues destroys the one-asset-class-one-hue reading the legend
depends on (DDR-0030), and DDR-0052 already settled how those bands are quietened.

## References

- Story #188; Epic #179 — visual redesign from the Figma proposal
- DDR-0018 — charts are sized by aspect ratio; SVG labels stay off the page type scale
- DDR-0051 — the Performance chart grid and the shared 500×180 geometry
- DDR-0052 — cumulative composition, band scrubbing, and one card height
- DDR-0049 — daily-return bars thin rather than aggregate
- DDR-0053 — the figure role: family, tabular digits and tracking as one rule
- DDR-0044 — two durations, two easings, reduced motion by zeroing the tokens
- DDR-0042 / DDR-0047 — the adoption ratchet, and stripping comments before matching
- DDR-0030 — one sector, one hue; the donut's native tooltip
- DDR-0021 — `--pos` / `--neg` may never be a mark's only channel
- ADR-0008 — an in-house design system; no component library
