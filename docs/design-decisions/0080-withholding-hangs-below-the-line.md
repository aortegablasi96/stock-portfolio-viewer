# 0080. Withholding hangs below the line, and the card stops explaining itself

- **Status:** Accepted

- **Date:** 2026-08-23

## Context

[[0078-two-columns-a-month-and-a-plot-sized-in-pixels]] stopped the income chart's stack and put a
month's gross and its withholding side by side on one baseline. That was the right fix for the
problem it had: a withholding segment drawn at the top of a column whose height was a *different*
figure could only be sized against a baseline that was not there.

Reviewing the result on screen, the pair states the two figures and not the relationship between
them. Both bars are magnitudes, both rise from zero, and nothing in the picture says that one of
them was taken **out of** the other. Gross and withholding are not two things to compare; they are
an amount and a deduction from it. The reader still performs the subtraction — #241 only moved
where.

DDR-0078 named the cost it accepted: Story #49's negative month "is no longer drawn", and a month
whose tax outweighed its income reads as a withholding bar beside *no* income bar. Its stated
reason was that "a chart cannot have one baseline and a signed series at once".

**That reason was answering a different proposal.** The alternative on the table was a third *net*
bar, and net's sign moves with the data — a series that is sometimes up and sometimes down really
does need a second reference, because the reader cannot tell by looking which direction means what.
Withholding is not that. It is a magnitude drawn in a **fixed** direction: every withholding bar
points down, always, whatever its value. The plot keeps exactly one baseline.

The card also carried a four-line `source-note` explaining the geometry, the hover card and the
scroll. It was the last chart note in the app — the Performance grid dropped both of its own in the
redesign, and `ChartCard` records why: prose competing with the plot it annotates, on a card where
the note is a real share of the height.

## Decision

### The secondary hangs below the baseline

`ColumnChart` draws each month's `primary` upward from zero and its `secondary` downward from it,
each keeping the position in the band it already had. Two x positions per month, mirrored across
the line rather than merged onto one.

**The negation is on the series, never on the value.** Both figures stay non-negative magnitudes
from the report all the way to the plot; the minus sign appears at exactly one place, the `rect`'s
own height (`y(-c.secondary) - zeroY`). This is the invariant that makes the change legal against
DDR-0078's objection, and it is what a future reader should check first if the chart ever looks
wrong: a bar whose *direction* came from its value would be the signed series that record refused.

`pairedDomain` spans zero again. The two extremes are independent `max`es — the top from the
largest `primary`, the bottom from the largest `secondary` negated — because a month whose only
entry is withholding has a gross of zero, so neither side can be derived from the other. It is
expressed through the existing `columnDomain` (`{ lower: -secondary, upper: primary + secondary }`)
rather than beside it, so the rounding, the even step and the guaranteed `0` tick are the ones
every other chart already uses. That machinery was never removed by #241 — it was built for Story
#49 and only bypassed — so this reaches it rather than rebuilding it.

Story #49's month is drawn again, and by a different mechanism: it is the *withholding series*
reaching further down, not a loss-toned net bar. There is still no third bar and no
`.chart-bar-loss`.

A bar with no figure is **absent, not flat** — the rule `pairedTooltipRows` applies to the card's
rows, applied to the plot.

### The card carries no prose

The income card's `source-note` is removed. The title, the key and the month labels all stay.

The two changes are one decision rather than two that happened together: once the deduction is
drawn *as* a deduction, the sentence "each month is two columns on the same baseline" describes
something the reader can see, and a caption explaining a picture that now explains itself is the
clearest thing on the card that can go.

What the paragraph also did was **disclose the horizontal scroll**, and that had to survive it. It
moved into the scroll region's own accessible name, which is the better home: a `role="group"` with
`tabIndex={0}` announces its label when a keyboard reader arrives at the region, where the
paragraph announced it to whoever read the card top to bottom.

## Consequences

Benefits:

* The relationship the chart is about — income, less tax — is the shape of the picture rather than
  an arithmetic the reader performs.
* Story #49's month has a mark again, without a second baseline and without a third bar.
* The card spends its height on the plot. One less body of prose competing with a chart, and the
  app is now consistent: no chart in it carries a caption.
* No new geometry module, constant or class. The domain change is four tokens inside
  `pairedDomain`; the draw change is one `rect`'s anchor.

Tradeoffs:

* **Comparing a bar that points up against one that points down is harder** than comparing two
  that point the same way. That is the real cost, and it is accepted because the question changed:
  the reader is no longer asking "which of these is bigger" but "how much of what came in was
  taken", which is a part-and-remainder question the mirrored form answers and the side-by-side
  form does not.
* The plot's vertical range now has to cover both directions, so the positive region is shorter
  than it was for the same card height.
* The method the note described is no longer on the card. It is in `lib/column` and in DDR-0005 /
  DDR-0077 / this record — better service for a reader who wants it than a caption, and no service
  at all for one who does not.

Risks:

* **The negative region is over-allocated when withholding is a small fraction of gross.** Both
  extremes round outward to one shared nice step, so a €14.25 largest withholding against a €184
  largest gross floors the axis at −€100 and spends roughly a quarter of the plot on empty space
  below the line. The chart is correct and the bars are drawn where they belong; the proportion is
  not yet earning its height. Measured in the running app on the owner's own import, and left as a
  finding rather than fixed here — tightening it means either a non-uniform tick step or a domain
  edge that is not a tick, and both are decisions this record's story did not scope.
* A later story that reintroduces a net mark would put the signed-series problem straight back.
  The net stays a toned figure in the hover card, which is where DDR-0077 put it.

## Alternatives Considered

### One column position a month, gross up and withholding down

Rejected. It looks like it would halve the chart's width and does not: `COLUMN_BAND_UNITS` is the
**month label's** number (`Jul 2026` advances 51.2 units), not the bars', so the band cannot narrow
while the labels stay. It would have bought a denser pair of bars inside an unchanged band.

### Keep both bars above the line and tone the withholding harder

What a colour-only change would be. It restates the label instead of adding a channel — the
reasoning [[0065-the-trade-side-badge-is-untoned]] settled — and leaves the reader doing the same
subtraction.

### A third bar for the net

Declined again, for DDR-0078's original reason, which is undisturbed: net's sign moves with the
data. It is the one figure here that genuinely needs a second reference, and it stays in the card.

### Remove the key or the month labels instead of the note

Considered as the way to save the same height. Both are things a reader cannot otherwise resolve —
which colour is which, and which month is which — where the note was describing a picture that is
now self-evident. A key earns its space; a caption restating the geometry does not.

## References

* [[0078-two-columns-a-month-and-a-plot-sized-in-pixels]] — the pair, the pixel-sized plot, and the
  below-zero decision this record reverses. Its width half is untouched and still governs.
* [[0077-the-income-key-names-the-column-and-the-card-scales-with-it]] — the key and the hover
  card's three rows, both unchanged.
* [[0079-the-value-axis-leaves-the-viewbox]] — the pinned axis, which now renders negative ticks
  through the same `y` the gridlines use.
* [[0071-indigo-value-curve-and-the-signed-return-curve]] — a signed series splitting at zero, and
  why SVG writes both tones as `fill`.
* [[0005-dividend-analytics-figures]] — gross, withholding as a positive magnitude, and net.
* `PerformanceView.tsx` `ChartCard` — the precedent for removing a chart card's source note.
* Story #49 — the negative month restored here in a different form.
* Epic #245, Stories #246 and #247.
