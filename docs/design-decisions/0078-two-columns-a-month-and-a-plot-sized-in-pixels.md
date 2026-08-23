# 0078. Two columns a month, and a plot sized in pixels that scrolls

- **Status:** Accepted — *the below-zero decision superseded by
  [[0080-withholding-hangs-below-the-line]]; the width and scroll decisions still govern*

- **Date:** 2026-08-21

## Context

Story #236 renamed the Dividends income key to *Gross* and *Withholding tax* and gave the chart the
app's hover card ([[0077-the-income-key-names-the-column-and-the-card-scales-with-it]]). It kept the
geometry deliberately — its acceptance criteria said the stack "is correct and does not change" —
and reviewing the result on screen showed that criterion was the wrong call.

**A key that names two things over a column that draws one of them as part of the other.** The
column's height was the gross; the withholding was a segment stacked at its top; the solid part
below was the net, which the key had stopped naming. So the tax segment's size could only be read
against a baseline that was not there, and the reader was left doing the subtraction the chart
exists to do for them. Naming the parts, which is all #236 did, cannot fix that — the ambiguity is
in the geometry.

**And the width policy was still spending legibility.** DDR-0077 recorded the finding and deferred
it: the `viewBox` widened by 56 units a month while the card's width did not, so every mark shrank
as history accumulated. Measured in the running app on the owner's import — 11.3px axis labels at
thirteen months at the default window, 10.6px at nineteen, 3.5px at five years. The other three
charts are held to `MIN_AXIS_LABEL_PX` by `chartGeometry.test.ts`; this one was held to nothing,
because there was no number to hold it to.

Both have the same fix underneath, which is why they are one story and one record.

## Decision

### A month is two bars on one baseline

`ColumnChart` stops stacking. Each month draws a `primary` (the gross, `--series-1`) and a
`secondary` beside it (the withholding, `--neg`), both anchored on the zero line, and the key names
one apiece. The `{ lower, upper }` model becomes `{ primary, secondary }` — the view hands over the
report's own `grossBase` and `withholdingBase` instead of mapping `lower: m.netBase`, which was the
indirection that let the key and the picture disagree. `.chart-bar-lower` / `.chart-bar-upper` and
their two legend swatches are renamed with it: a class named for its position in a stack that no
longer exists describes nothing.

The domain follows from the data rather than from a choice. Both series are magnitudes, so
`pairedDomain` floors the axis at zero and takes its top from the **taller of the two** — a month
whose only entry is withholding has a gross of zero, so a top derived from the primary alone would
draw that bar off the plot.

**The cost, stated: Story #49's negative month is no longer drawn.** A month whose withholding
outweighed its dividends used to hang below the zero line in the loss colour. Nothing hangs below
the line now; that month reads as a withholding bar beside **no** income bar, which states the same
fact — tax paid, nothing received — without asking the plot to carry a second baseline. The signed
figure itself stays in the hover card, toned by `signInk`, and it is now the only one of the card's
three rows the chart does not draw. That is a real thing given up and it is given up on purpose:
one baseline is what makes the two bars comparable, and a chart cannot have one baseline and a
signed series at once.

### The plot is sized in pixels, and the card scrolls it

The `<svg>` takes an explicit CSS width of `plot.width × COLUMN_UNIT_PX` inside a
`.chart-scroll` wrapper. A `viewBox` unit is therefore worth a fixed number of pixels at every
history length, and the plot grows **longer** instead of denser.

`COLUMN_UNIT_PX` is **derived from the two constants that already stated the constraint**, not
chosen: an axis label is `AXIS_LABEL_UNITS` units and may not render below `MIN_AXIS_LABEL_PX`, and
both are 11 — so a unit is worth exactly one pixel. It is also the *smallest* value that clears the
floor, which is the half worth saying out loud: every pixel above it is plot the reader has to
scroll, so the cheapest legible chart is the one that scrolls least.

`min-width: 100%` on the `<svg>` makes that width a **floor**. A history narrower than its card
stretches to fill it rather than floating in the middle of a panel, which
[[0018-content-measure-and-chart-aspect]] rejected on sight — and stretching only ever makes marks
larger, so the guarantee is a minimum size rather than a fixed one.

**This is a re-decision of DDR-0018 for this chart alone.** That rule holds where a chart's aspect
is a property of the chart; here it is a property of the *data*, and a chart whose aspect is a
function of its row count cannot also hold its type size. Nothing here reaches the Performance
grid, whose four cards are cross-read and must stay exactly as wide as each other
([[0051-performance-chart-grid]]).

### The 1080-unit floor stays, and finally gets a reason

Story #76 chose it to match a line chart that DDR-0051 has since taken to 500×180, and DDR-0077
recorded that the number had outlived its justification. The justification it has now is the
**card's height**: the `<svg>` keeps its aspect when it stretches, so a short history in a narrow
plot is a *tall* card. A twelve-month floor was implemented, measured, and reverted — the same
thirteen bars rendered 376px instead of 282px, half again as much of the view.

So the floor is expressed as `COLUMN_PLOT_MIN_ASPECT = 4.5`, which is 1080 units and 1080px, and
that fits inside the card of a default window (measured at 1107px). **Today's import therefore
renders at exactly the size it rendered before this story** — 1267×282px at a 1440px window — and
the scroll begins at the point the chart would otherwise have started shrinking.

### The scroll region is a keyboard-reachable, named group

`tabIndex={0}`, `role="group"` and an `aria-label`, because a scroll region only a mouse can reach
hides the older months from a keyboard reader entirely (WCAG 2.1.1) — it holds the only copy of
them. `role="group"` for the reason [[0047-allocation-map-is-a-group]] gave the map
one. It declares no focus rule and takes the app's one ring by falling through the `:where(...)`
base rule. `overscroll-behavior-x: contain` keeps a trackpad swipe that reaches the end of the plot
out of the window's own back-navigation gesture.

The wrapper does overflow and nothing else — whether anything is *drawn* stays the card's job,
which is the split `.data-table-scroll` already makes ([[0039-data-table-primitive-and-column-sorting]]).

## Consequences

- The page still does not scroll sideways; the overflow is inside the card. Verified in the running
  app at 64 months (`documentElement.scrollWidth - clientWidth` is 0), which is what
  `e2e/tab-navigation.spec.ts` and `e2e/sidebar-collapse.spec.ts` assert generally.
- **The value axis scrolls out of view with the plot.** The gridlines stay, and the hover card
  gives exact figures for any month, but a reader scrolled back to 2021 has no tick labels on
  screen. Pinning the gutter means splitting the axis into a second `<svg>` outside the scroll
  container, and the two would have to agree on a rendered height that varies with the stretch —
  a real design decision rather than a detail, so it is recorded here and left for its own story.
- The hover card is unchanged: same three rules, same placement, same surface. It is now also a
  constant size *on screen*, because a unit is.
- `lib/column.ts` is where this chart's geometry lives, and it now holds a pixel measure as well as
  `viewBox` units. It is still not `chartGeometry`, and `chartGeometry.test.ts` still asserts
  `ColumnChart` never imports that module.
- No CSS value was added off the scale: `.chart-scroll` is overflow and overscroll only, and the
  pixel width is an inline attribute because it is a function of the data rather than a design
  value. The ratchet's `BASELINE` stays empty and its exemption list does not grow.
- No IPC channel, service, repository or table changed shape.

## Alternatives Considered

### Keep the stack and rename harder

What #236 did. The ambiguity is geometric: a segment whose size can only be read against an absent
baseline is not fixed by what the swatch beside it says.

### Three bars — gross, withholding and net

Net is `primary − secondary`, so a third bar draws a number the other two already contain, and it
is the one that can go negative — which would put the second baseline straight back. The card gives
it as a figure instead, where its sign can be toned.

### Cap the `viewBox` and thin the columns, as `BarChart` does

Declined for the reason DDR-0077 gave: the 56-unit band is the **month label's** number, not the
bars' — `Jul 2026` advances 51.2 units — so capping the width collides the labels.
[[0049-daily-return-bars-thin-rather-than-aggregate]] thins bars that carry no labels at all.

### A range filter on the chart instead of a scroll

A second control that answers the same question the scroll does, on a card whose neighbour already
has one (DDR-0017). The card is the window; the scroll is the history.

### A twelve-month floor instead of an aspect floor

Implemented and measured: 376px of card height for thirteen bars, against 282px. A floor in months
says something true about the data and nothing about the shape of the card, and the shape of the
card is what the floor is protecting.

## References

- [[0077-the-income-key-names-the-column-and-the-card-scales-with-it]] — the key naming the column,
  the hover card's three rules, and the width finding this record closes. Its "the card is
  calibrated against the plot's own axis label" reasoning is superseded in its conclusion but not
  in its measurement: the card no longer shrinks because *nothing* does.
- [[0018-content-measure-and-chart-aspect]] — chart sized by aspect ratio, never a pixel width.
  Re-decided here for this chart alone.
- [[0051-performance-chart-grid]] — `MIN_AXIS_LABEL_PX`, `AXIS_LABEL_UNITS`, the shared grid
  geometry that is untouched by this.
- [[0049-daily-return-bars-thin-rather-than-aggregate]] — band hit-testing, and why that chart
  thins where this one lengthens.
- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — the hover card inside the plot's
  `viewBox`, pinned to its top.
- [[0064-toned-badges-and-the-income-key]] — the key in the card header, and the bare `<svg>`.
- [[0065-untoned-side-badge-and-the-dimmed-cell]] — a tone declined because it restates its label.
- [[0047-allocation-map-is-a-group]] — a graphic region given a role and made
  keyboard-correct rather than left to a default.
- [[0039-data-table-primitive-and-column-sorting]] — `.data-table-scroll`: overflow only, the surface stays the card's.
- [[0005-analytics-read-model-and-base-currency-conversion]] — gross, withholding as a positive
  magnitude, and net in base currency. Untouched.
- Story #49 — the negative-net month whose drawing this record retires.
- Story #241, Epic #240.
