# 0082. The hover card is bounded down the plot, and says what it dropped

- **Status:** Accepted

- **Date:** 2026-08-23

## Context

`tooltipLayout` bounded the card **across** the plot and against nothing **down** it. It flips the
card left when the right side has no room and clamps it to `pad.left` in the degenerate case; its
height was `TITLE_H + rows × ROW_H + 2 × PAD_Y` and its top `plot.pad.top`, and neither was ever
compared against the plot it was given.

Nothing overflowed. The margin was one row:

| rows | card's bottom edge | |
| --- | --- | --- |
| 6 — today's maximum (5 bands + Total) | 135 | fits |
| 7 | 149 | fits, with 3 units to spare |
| 8 | 163 | past the plot's inner bottom (152) — the card sits **over the date labels** |
| 10 | 191 | past the `viewBox` (180) — the root `<svg>` **clips it away** |

Two different failures, neither of which announces itself.

This is the failure class [[0051-performance-chart-grid]] §#190 already recorded, in the
other axis: *a `viewBox` clips in silence.* That story found `pad.left` described by a rule the
number never implemented — the `€` had been clipped off every tick for months — and replaced the
number with a derivation from a measured glyph advance and a stated character budget. The card's
height had the same defect and had never been looked at.

**The suite read as though it covered this.** `chartTooltip.test.ts` built a nine-row card and
asserted only that each baseline fell inside *the box* — which stays true however far past the plot
the box has grown. The containment assertion, `box.y + box.height < plot.height - pad.bottom`, ran
on a **one-row** card inside a test about anchoring. A guard named "the card never leaves its plot"
was walking the anchor and holding the row count at one: it varied the axis that could not
overflow.

## Decision

### What the card can hold is derived, not chosen

`maxRowsFor(plot)` returns `floor((inner − TITLE_H − 2 × PAD_Y) / ROW_H)`, where `inner` is the
plot's own height less its padding. Every term is a constant the card is already built from, so
changing the row height, the padding or the plot moves the bound with them rather than leaving a
literal behind to go stale. On `PERFORMANCE_PLOT` it is **7**.

Floored at 1, so a plot too short for a single row still yields a card rather than a negative count.

### Past the bound, the card truncates and says so

The card keeps as many rows as fit and spends its last slot on a `+N more` row.

**A truncation is information.** Dropping rows off the bottom is the defect this record exists to
remove, and doing it quietly would only move the silence rather than end it — the reader would see
a shorter card and no reason to think anything was missing. This is the same principle
[[0021-allocation-map-gain-loss-scale]] and [[0048-tab-icons-as-a-second-channel]] settled for
colour, applied to presence: a reader must not lose a figure without being able to tell that a
figure is missing.

The marker carries **no label**, so it sets left-aligned under the date like any bare figure and
cannot be mistaken for a series with a value. It costs a slot of its own, and the count it reports
includes the row it displaced — treating that slot as free would put the card one row past the
bound and under-report by one on the way out.

### The component renders the layout's rows, not its own

`TooltipLayout` now carries `rows` and `hiddenRows`, and `ChartTooltip` maps over `box.rows` rather
than the `rows` prop. This is what makes the bound impossible to bypass: a chart cannot draw a row
the layout decided there was no room for. Geometry stays in `lib/chartTooltip`, markup stays in the
component ([[0061-chart-language-gradient-zero-line-and-one-hover-card]]).

### The band list and the card can see each other

The composition card is the tallest caller — one row per `CompositionBand` key plus a `Total`. Those
keys are a Zod enum in `shared/domain/performance.ts`, which is the side a change would arrive
from, so the capacity assertion binds to **the enum** rather than to a copied number or a scan of
`BAND_SPECS`. Adding a sixth key still fits; a seventh fails the test instead of being found on
screen.

## Consequences

Benefits:

* The card is inside its plot at every row count, and the two silent failures are both closed.
* The bound moves with the constants that define it, so this cannot go stale the way `pad.left`
  did.
* A change to what a chart plots is caught from the side that would break it.
* `chartTooltip.test.ts` now walks the row count the way it already walked the anchor, so the axis
  that could overflow is the axis that varies.

Tradeoffs:

* **The truncation is unreachable today** — 6 rows against a bound of 7 — so it is a guard rather
  than a feature, and guards that never fire are guards nobody has seen work. Its arithmetic is
  covered at several counts precisely because the screen will not exercise it.
* `TooltipLayout` grew two fields, and a caller that renders the prop instead of `box.rows` silently
  reintroduces the bug. The doc comment on `rows` says so; a renderer test cannot catch it (DDR-0029).

Risks:

* If a future card genuinely needs more rows than the plot holds, `+N more` is the wrong answer —
  a reader wanting all the bands cannot get them. The right fix then is the plot or the placement,
  both of which this record explicitly leaves alone.

## Alternatives Considered

### Shrink the rows to fit

Rejected. `ROW_H` and `TITLE_H` are the card's type rhythm; compressing them past the bound makes
the failing case the least legible one, and the sizes are shared with three other charts.

### Grow `PERFORMANCE_PLOT.height`

Rejected, and out of scope by the story's own terms: it changes every chart in the grid and the
ratio DDR-0051 chose for the value curve's vertical resolution — a large change to fix a margin.

### Move the card, or let it track the mark

Rejected. Pinned-to-top is [[0061-chart-language-gradient-zero-line-and-one-hover-card]]'s decision and re-placing
the card is a re-decision for `ui-designer`, not something to settle while fixing a bound. A card
that moved to make room would also move for reasons the reader cannot see.

### Truncate silently

Rejected — see above. It converts a clipped card into a short one and tells the reader no more than
the clipping did.

### Only add the test, and rely on the guard

Tempting, since nothing overflows today. Rejected because the guard binds the *domain enum*, and a
chart can also gain rows without gaining a band — a `Total`, a percentage line, a second figure.
The runtime bound is what covers those.

## References

* [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — one card, geometry here and markup there.
* [[0051-performance-chart-grid]] §#190 — the derived gutter, and the same defect in the
  other axis.
* [[0070-hover-card-restyle-and-the-series-ink-ramp]] — the card's padding, corner and `MIN_WIDTH`:
  the width bound this is the height counterpart of.
* [[0050-daily-nav-from-equity-summary]] / [[0052-composition-cumulative-and-chart-readability]] — the
  bands and the `other` residual.
* [[0021-allocation-map-gain-loss-scale]], [[0048-tab-icons-as-a-second-channel]] — silence is
  not a channel.
* Story #228, Epic #251.
