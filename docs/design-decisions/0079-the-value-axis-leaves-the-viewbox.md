# 0079. The value axis leaves the `viewBox`, and sticks to the scroller

- **Status:** Accepted

- **Date:** 2026-08-21

## Context

Story #241 gave the income chart a plot sized in pixels and a card that scrolls it
([[0078-two-columns-a-month-and-a-plot-sized-in-pixels]]). Its Consequences recorded what that
bought and what it cost:

> **The value axis scrolls out of view with the plot.** The gridlines stay, and the hover card
> gives exact figures for any month, but a reader scrolled back to 2021 has no tick labels on
> screen.

The tick labels were SVG `<text>` at `x = pad.left − 8`, inside the scrolling `<svg>`, so they slid
off with everything else. The gridlines they named stayed visible and unlabelled — which is worse
than either extreme, because the chart still looks like it has an axis.

It is latent rather than live: the plot only scrolls once its natural width passes the card, at 19
months at a default window and 22 at 1440px, against the owner's 13. But it is the one part of the
chart that the scroll makes *less* useful the more history there is, which is the opposite of what
#241 was for.

## Decision

### The value axis is HTML, not `<text>` in the `viewBox`

`lib/column.ts`'s `axisTicks` turns the domain's ticks into `{ value, topPercent }`, and the chart
renders them as `<span>`s in a gutter. `COLUMN_PLOT_PAD.left` drops from 64 units to **0** — the
space it reserved was this axis's — and everything that measured from it moves in one step: the
gridlines' start, `bandIndexAt`'s origin, and the hover card's clamp.

**This re-decides [[0018-content-measure-and-chart-aspect]] for this label**, and the rule's own
reasoning is what says where the line falls. A label in the `viewBox` scales with the plot. That is
right for a label attached to the plot's *geometry* and wrong for one attached to its *frame*. So
the **month** labels stay inside — they name the columns they sit under and scroll with them, which
is the whole point of them — and the value axis, which names the frame, comes out.

Coming out has a second effect worth stating: the figures are page type now. They take
`--text-2xs` and join the figure role's **existing** selector list (a second rule applying it
throws, [[0053-bundled-typefaces-and-the-figure-role]]). So the value axis stops shrinking at *any* history
length rather than merely stopping at #241's floor, and it costs the ratchet nothing — this story
removes a reason for a `viewBox`-unit exemption rather than adding one.

### The offset is a percentage, and the gutter is **inside** the scroller

A tick is placed at `top: topPercent%` — a share of the gutter's own height. That is the only
expression that survives a plot whose rendered height is decided by the card it lands in: the plot
stretches to fill a card wider than its natural width, so no length here is knowable.

Which makes the gutter's height the whole question, and the answer is not the obvious one. Placed
**beside** the scroll container as a second grid column, the labels measured exact at rest — and
**~15px low the moment the plot was long enough to scroll**, decreasing up the axis. The row's
height had become the scroller's, and a scroller's height includes its horizontal scrollbar. Exact
in the case that does not matter, wrong in the case the story exists for.

So the gutter is a **sticky flex item inside the scroll container**:

- *inside*, because a percentage resolves against the scroller's **content** box, which a
  horizontal scrollbar is not part of — so the gutter is exactly as tall as the `<svg>` beside it,
  by construction rather than by arithmetic;
- *sticky at `left: 0`*, so the plot slides under it instead of carrying it away.

Sliding under means it needs ground: `background: var(--card)`, the surface this chart is drawn on,
and the one declaration here that would have to move if it were ever drawn on another.

The plot's fill changes with it — `flex: 1 0 auto` rather than `min-width: 100%`. "Fill the card"
now means "fill what the gutter leaves", which growing does and a percentage of the container does
not; and `flex-shrink: 0` is what keeps it scrolling, since a flex item shrinks to its line by
default and a plot that shrank would be back to spending legibility on its history.

### The column sizes itself from its widest label

A hidden `.chart-axis-sizer` holds the longest formatted tick in normal flow, so the browser
measures the real string in the real face and the column is exactly as wide as it needs. This is
the failure [[0051-performance-chart-grid]] §#190 recorded, made unexpressible instead of
documented: a gutter hand-cut for eight characters, against charts that label their axes with ten,
clipped the currency symbol off every tick in silence. A number that must be re-derived when a
portfolio crosses a decimal place is a number nobody will re-derive.

### `COLUMN_PLOT_MIN_ASPECT` is re-derived, not re-tuned

It describes the *plot*, and the plot just lost its 64-unit gutter. `4.5` — a plot containing its
own axis — becomes **`4.2`**, which is the same total chart at its floor: 1008 units of plot plus a
55px gutter is the 1080px it has always been, and still inside the card of a default window. So
today's import still does not scroll and the plot's height does not jump.

## Consequences

- Measured in the running app against the owner's import and a synthetic 64-month one, at 1280,
  1440 and 1760: **every label lands on its gridline to within 0.01px**, at rest and with the plot
  scrolled to its end. The 15px drift above is what the first structure produced, and is why the
  harness measured label-to-gridline distance rather than taking a screenshot.
- The gutter is 55px on this data. The plot renders 1052×251px at 1280 and 1212×289px at 1440,
  against 1052×246 / 1212×282 before — a few pixels taller, because the plot kept its aspect and
  gave up its left pad.
- The leftmost **month** label is partly covered by the gutter while scrolled. That is what a
  frozen column does, and the label is legible again the moment it clears.
- The gutter is `aria-hidden`. The chart is a `role="img"` with a name and its figures are in the
  tables below; five bare numbers announced before it would be noise.
- No IPC channel, service, repository or table changed shape. The ratchet's `BASELINE` stays empty
  and the exemption list does not grow.

## Alternatives Considered

### Keep the axis in the `viewBox` and translate it by the scroll offset

Cheapest — track `scrollLeft`, shift the label group — and it buys a worse problem: the labels then
float over the bars with no ground, and giving them ground inside an `<svg>` is a fill decision the
app has no precedent for. It also makes the axis a function of a scroll event rather than of the
layout.

### A second `<svg>` outside the scroll container

The version #241 described as needing "a rendered height that varies with the stretch". It does,
and that is exactly the trap the beside-the-scroller grid fell into — with the added cost that an
SVG gutter would keep its labels on the `viewBox` scale, which is the thing worth losing here.

### Pin the month labels too

They name the columns they sit under. A month label that stayed still while its column moved would
be naming the wrong month.

### Leave it, and rely on the hover card

What #241 shipped. The card gives exact figures, but a chart is scanned before it is pointed at,
and gridlines with no values are a picture of an axis rather than one.

## References

- [[0078-two-columns-a-month-and-a-plot-sized-in-pixels]] — the paired columns, the pixel-sized
  plot and the scroll. This closes the gap its Consequences recorded.
- [[0018-content-measure-and-chart-aspect]] — a chart label lives in the `viewBox`. Re-decided here
  for the value axis of this one chart, on the rule's own reasoning.
- [[0051-performance-chart-grid]] — `MIN_AXIS_LABEL_PX`, `AXIS_LABEL_UNITS`, and §#190's hand-cut
  gutter that clipped a currency symbol off every tick.
- [[0053-bundled-typefaces-and-the-figure-role]] — the figure role is one rule listing its selectors, and
  only one rule may apply it.
- [[0031-design-token-scales]] / [[0042-token-adoption-ratchet]] — the type scale, and the ratchet
  this story pays back into.
- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — the hover card's clamp against
  the plot's pad, which moved with `pad.left`.
- [[0039-data-table-primitive-and-column-sorting]] — `.data-table-scroll`: overflow only.
- Story #243, Epic #240.
