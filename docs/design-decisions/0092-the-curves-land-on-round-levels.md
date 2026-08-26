# 0092. The curves take the grid's axis, and the axis lands on round levels

- **Status:** Accepted. Extends [[0051-performance-chart-grid]],
  [[0049-daily-return-bars-thin-rather-than-aggregate]] and
  [[0081-the-tax-side-keeps-its-own-scale]]; the rule those records state is reused here rather
  than restated. Nothing in [[0091-a-gutter-per-axis-kind]] moves, though one of its bounds is
  re-measured against a new input — see *Consequences*.
- **Date:** 2026-08-26

## Context

The Performance view is a 2×2 grid of four charts built to be **read across its rows**
([[0051-performance-chart-grid]]). Three of them draw their value axis from `lib/column`'s
`columnDomain`: the extremes round *outward* to a nice step — 1, 2 or 5 times a power of ten —
ticks are laid down at that step, and zero is always one of them.

`LineChart` never adopted it. It built three ticks inline:

```ts
const ticks = [minV, minV + spanV / 2, maxV]
```

The *spacing* is even; the *levels* are whatever the window's data happened to reach. Measured on
the owner's real import, at the full-history range:

| chart | ticks before | ticks after |
| --- | --- | --- |
| Portfolio value over time | `€0.00 · €34,258.85 · €68,517.70` | `€0.00 · €20,000.00 · €40,000.00 · €60,000.00 · €80,000.00` |
| Performance change over time | `-12.20% · +8.03% · +28.25%` | `-20.00% · 0.00% · +20.00% · +40.00%` |
| Daily return (`BarChart`) | `-5.00% · 0.00% · +5.00% · +10.00%` | unchanged |
| Composition over time (`StackedAreaChart`) | `€0 … €80,000` in `€20,000` steps | unchanged |

Two things are wrong with the left column, and the second is what made this a story rather than a
preference. The first is that no gridline sits on a number a reader would have picked, so reading a
value off the chart means interpolating between three arbitrary ones — and every change of range
moves all three to a *new* set of arbitrary ones. The second is that **the value curve and the
composition stack plot the same quantity** — daily NAV in base currency, from the same series — and
were drawn against two different axes on one screen. A grid whose whole argument is cross-reading
had one quadrant reading in a vocabulary the other three did not use.

There is a third, smaller defect underneath it. On the return curve, break-even was drawn as a rule
at `y(0)` with **no gridline under it and no label beside it**. The one level on that chart the
reader most needs a number for was the one level the axis did not name.

## Decision

**A single signed series takes the same axis a stack does, through one named function.**

`lib/column` gains `seriesDomain(values)`, which is `columnDomain` applied to the degenerate stack
(`upper` is 0, `lower` is the reading). It is not a new rule — it is the existing rule with a name,
so the two curves and the daily bars stop writing `{ lower: v, upper: 0 }` at three call sites,
each free to drift. `LineChart` and `BarChart` both call it; the stack reaches `columnDomain`
through `lib/composition` as it always has.

Three things follow inside `LineChart`, and each is a decision rather than a side effect:

- **The domain is the axis, and the projection reads off it.** `y` maps `[bottom, top]` rather than
  `[minV, maxV]`, and the value curve's area wash anchors on the domain floor rather than on the
  series minimum. The top gridline is therefore at or above the series maximum by construction: a
  curve can no longer be clipped by its own axis.
- **Zero is a tick, and `showZero` becomes a question about the data.** Every domain this rule
  produces spans zero and contains it exactly, because both edges are whole multiples of the step.
  So the emphasised rule is no longer a *second line* drawn over the gridline at `y(0)` — it is the
  class that one line takes, exactly as `BarChart` has drawn it since Story #170. What decides it
  is unchanged in meaning and changed in source: `showZero` asks whether the **series crosses**
  zero, not whether the axis reaches it. A value curve rests on zero as its floor and gets a plain
  gridline; a return curve passes through it and gets the rule — and now, either way, a label. The
  signed curve's split ([[0071-indigo-value-curve-and-the-signed-return-curve]]) still meets the
  axis on that same line.
- **The value curve is included, and that is the part that was decidable.** It is the same
  component with the same defect, and excluding it would have left one component holding two tick
  rules keyed by nothing a reader could see. The positive case is stronger than the symmetry: it
  and the composition stack are two drawings of one series, and after this they share an axis to
  the euro.

**The bound is stated and exported.** `MAX_SERIES_TICKS` is 6, and it is arithmetic rather than
taste: `niceStep` rounds up, so a step is at least a quarter of the raw span, and rounding each
extreme outward adds under one more interval at each end — under six intervals, so at most six
lines. Six across a 136-unit plot is 27.2 units apart, against an 11-unit label; at the narrowest
column the grid ever draws (one pixel past the breakpoint, a 509px chart) that is 27.7px against
11.2px. Both are asserted, in units and in pixels.

## Consequences

Benefits:

- A gridline lands on a number the reader would have picked, in every range, on all four charts.
  Reading a value off a curve stops being an interpolation between three arbitrary levels.
- The value curve and the composition stack agree, so the grid reads across its rows in one
  vocabulary — the property [[0051-performance-chart-grid]] put four charts on one geometry for.
- Break-even is labelled on the return curve for the first time. It was always drawn; it was never
  named.
- `LineChart` loses its private tick calculation, so there is one place in the app that decides
  where a gridline goes.

Tradeoffs:

- **Rounding outward spends plot, and it is spent at every render.** The full-history return curve
  used to fill its plot exactly and now fills about two-thirds of it (`-12.20% … +28.25%` inside a
  `-20% … +40%` domain); the value curve fills 86%. The worst case is a range landing just past a
  step boundary, which spends about half the plot on empty domain. This is
  [[0081-the-tax-side-keeps-its-own-scale]]'s trade seen from the other end: the alternative is a
  step fine enough to fit the data exactly, which is how a 180-unit plot ends up behind eleven
  gridlines. Round levels are bought with vertical resolution, and the price is real.
- **A chart can now draw a figure its series does not contain.** The top tick is a rounded number,
  so the widest label is a property of the *domain* rather than of the data — an input
  [[0091-a-gutter-per-axis-kind]]'s character budget did not have. Its currency bound is unmoved
  (`€999,999.99`, eleven characters) but is now **reached sooner**: at €800,000 of portfolio the
  step is €200,000 and the top tick lands on the maximum exactly; one euro past it the step becomes
  €500,000 and the top rounds to `€1,000,000.00`, two characters too wide. Both sides of that
  ceiling are asserted, so it is a stated bound rather than a discovered clip, and the honest place
  to widen it is still `AXIS_LABEL_BUDGET_CHARS`.

Risks:

- **The value curve still floors at zero**, so a one-month window of a €62,000 portfolio is a
  near-flat line across the top of the plot. Unchanged by this record and deliberately so: the
  floor decides what the axis *means*, a truncated value axis exaggerates every move, and that is a
  decision for its own story rather than one to make while changing where the ticks land.
- At a range under about 0.02% the two-decimal percent formatter prints neighbouring ticks
  identically (`+0.01% · +0.01% · +0.02%`). Pre-existing — the old midpoint ticks collapsed the same
  way, and the daily bars have always been able to — and not reached by any real window. The fix is
  a tick formatter, the story [[0091-a-gutter-per-axis-kind]] already deferred.
- **No Playwright spec pins the rendered labels.** The e2e app runs with no imported Flex history,
  so the Performance charts never render there at all — the gap
  [[0087-the-holdings-table-says-what-a-position-made]] and
  [[0089-the-rail-comes-down-and-the-store-takes-a-row]] both record from the other side. What
  exists instead: the tick maths is pure and unit-tested, the components are scanned for a private
  tick calculation, and the change was captured on screen against the owner's real database.

## Alternatives Considered

### Leave the value curve on its old ticks and fix only the return curve

The story that reported this named the return curve. Rejected on two counts: it is one component,
so the exclusion would have to be expressed as a branch keyed on something — `tone`, or the axis
kind — and neither has anything to do with where a gridline goes; and the value curve is the half
with the stronger case, because the chart it disagrees with is drawing the same series.

### A step fine enough that the domain always fits the data

Keeps every unit of vertical resolution and gives up round levels at the ends — or keeps both by
putting a gridline every few units. That is exactly what
[[0081-the-tax-side-keeps-its-own-scale]] refused for the income chart: a step chosen to divide the
smaller quantity puts eleven gridlines behind a chart that wants four.

### Recover the lost resolution by dropping the value axis's zero floor

Tempting in the same breath, and a different decision: it changes what the axis asserts, not where
its ticks land. Out of scope here, and worth a story of its own.

### A private `niceTicks` in `LineChart`

The shortest diff, and the one the story explicitly forbids. Two implementations of "1, 2 or 5
times a power of ten" is how the grid's four charts drift apart again, one convenience at a time.

### Keep the emphasised zero as its own line, over the new gridline

Two `<line>` elements at one `y`, one `chart-zero` and one `chart-grid`, resolved by paint order.
It renders correctly today and says nothing about which is meant to win.

## References

- [[0051-performance-chart-grid]] — the 2×2 grid, the shared geometry, and the legibility floor the
  gridline spacing is checked against.
- [[0091-a-gutter-per-axis-kind]] — the per-kind gutter and the character budgets whose currency
  bound is re-measured here.
- [[0081-the-tax-side-keeps-its-own-scale]] — the step, the uniform spacing, and the eleven-gridline
  trade this record pays from the other side.
- [[0049-daily-return-bars-thin-rather-than-aggregate]] — the daily bars, on `columnDomain` since
  Story #170.
- [[0071-indigo-value-curve-and-the-signed-return-curve]] — the split that meets the axis at zero.
- `src/renderer/src/lib/column.ts` — `seriesDomain`, `MAX_SERIES_TICKS`, `niceStep`.
- GitHub Story #270, Epic #251.
