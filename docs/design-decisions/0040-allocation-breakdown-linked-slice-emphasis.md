# 0040. The breakdown table and its donut link on hover: keyed emphasis, muting rather than recolouring

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

`AllocationBreakdown` renders the two halves of one dataset. `groupTail` produces the slice set,
`sliceColorClasses` assigns the palette, and both the `DataTable` and the `PieChart` are driven
from that same array — which is why the component's own comment calls the table "the donut's
legend spread out with tabular numbers", and why the donut here renders with
`showLegend={false}`.

What was missing was the link between them. Reconciling a wedge with its row meant matching
colours by eye against eight palette slots on a 200px donut — the exact task the app avoids
everywhere else by direct-labelling ([[0006-app-shell-tab-navigation]]'s chart stance,
[[0030-allocation-map-country-donut-pairs]]'s legend rules). The only affordance a slice had was
the native browser tooltip from its `<title>`: slow to appear, unstyled, and with no counterpart
in the table.

[[0039-data-table-primitive-and-column-sorting]] then made the table sortable, which removed the
one weak correspondence that did exist — row order no longer matches arc order at all.

## Decision

**Hovering either half emphasises the matching slice in both, keyed on the slice's identity.**

`AllocationBreakdown` owns a single `activeKey: string | null`. The table reports the row the
pointer or keyboard focus is on; the donut reports the wedge the pointer is on; both render the
same state. Neither child owns the pairing, because neither one *is* the pairing — it is the one
thing the two have to agree about.

### Three states, and rest is the absence of the other two

`sliceEmphasis(activeKey, key)` returns `resting | active | muted`, and
`sliceEmphasisClassName('resting')` returns `''` — the same statement as
`toneClassName('neutral')` ([[0034-stat-tile-primitive-tone-axis]]) and
`statePanelSurfaceClassName('panel')` ([[0038-state-panel-primitive-variant-and-surface-axes]]).

**Muting the others is what makes the active one read.** Emphasising a wedge on its own leaves it
competing with seven neighbours at full strength; the small slices — the ones hardest to find and
therefore the ones the link is most useful for — barely move. Stepping the rest back to 0.35 is
what makes a 7% wedge findable.

### The emphasis never touches `fill`

Hue **is** identity in this app: one sector wears one colour everywhere, the map included
([[0030-allocation-map-country-donut-pairs]]), and the categorical and diverging scales are
CVD-validated ([[0021-allocation-map-gain-loss-scale]]). A highlight that recoloured a wedge would
be saying "a different slice". So the active wedge keeps its hue and gains a `var(--text)` stroke
— the page's own ink, outlining rather than repainting — and the muted ones change only opacity.
`lib/sliceHighlight.test.ts` fails if either rule starts declaring `fill`.

### Keyed, never positional

The table sorts by any column since [[0039-data-table-primitive-and-column-sorting]], so its row
order and the donut's arc order have no reason to agree. A positional link would light the wrong
wedge the moment a reader sorted by value — which is precisely when they are most likely to be
reconciling the two. `groupTail`'s aggregated tail needs no special case: it is one slice with one
key, so its row and its wedge light together by construction.

### The table's linked row is a general capability, and it is neutral

`DataTable` gains two props — `activeRowKey` and `onRowActivate` — rather than the breakdown
reaching into it. The primitive computes each row's key through the `rowKey` it already has, so
the keyed guarantee holds inside the primitive rather than at one call site.

The linked row is tinted `color-mix(in srgb, var(--text) 7%, transparent)` and deliberately
**not** the accent: the row is being *pointed at*, not selected, and the accent already means
"this column holds the sort" two rows above it.

### Rows become focusable only where they link to something

Supplying `onRowActivate` is what makes rows a tab stop, and `onFocus`/`onBlur` sit beside the
pointer handlers. An ordinary table adds nothing to the tab order, and the linked one adds as many
stops as it has slices — at most eight, since `groupTail` caps them.

That is the whole keyboard story, and it is deliberately one-directional: tabbing through rows
lights each wedge in turn, which is the direction that carries information a keyboard user cannot
otherwise get. The reverse — focusing a wedge to find its row — would mean making SVG paths focus
targets to reach data the table already spells out in text beside them.

## Consequences

- The two halves of every allocation breakdown reconcile without colour-matching, on all four
  dimensions (asset class, sector, country, currency).
- `AllocationView` remounts `AllocationBreakdown` per breakdown tab (`key={tab}`), so switching
  tabs clears the emphasis with nothing having to reset it.
- `PieChart`'s new props are optional, so the chart is unchanged wherever it renders without a
  table beside it — the per-slice `<title>` stays in both cases.
- A transition of 120ms is dropped entirely under `prefers-reduced-motion: reduce`.
- **The separator ring fades with its slice.** `.pie-slice` strokes `var(--card)` at 2px, and
  opacity applies to the whole path, so muted neighbours lose a little of their separation. It is
  the correct reading — they have stepped back together — but it is why `active` uses stroke
  *colour* rather than stroke *width*, which would have made the fading rings uneven.

## Not Included

- **The Positions table.** Its rows are holdings, not slices; a holding reaches a slice only
  through the active breakdown dimension, and an unclassified position reaches none. That
  indirection deserves its own story.
- **Click-to-filter or drill-down.** This is about reading the pair, not filtering by it — which
  is why the interaction is hover/focus and leaves no state behind.
- **A custom tooltip.** The native `<title>` is what the donut says on its own, and the table now
  says the rest.
- **The Allocation map.** Separate Epic (#98); its marks are `mapboxgl.Marker` SVG with their own
  popup ([[0030-allocation-map-country-donut-pairs]]).

## Alternatives Considered

### Emphasise the active slice without muting the others

Rejected. It works for the largest wedge and fails for exactly the slices the link exists to
help with — a 7% wedge outlined among seven full-strength neighbours is still a hunt.

### Brighten or saturate the active slice

Rejected outright: it changes hue, which is identity here. See above.

### Explode the active slice outward from the centre

Rejected. It is the conventional donut affordance and it moves geometry — the arc no longer
subtends its true angle at its true radius, which is a proportion chart telling a small lie for
emphasis. Opacity and stroke say "this one" without touching the reading.

### Let the pairing live in `AllocationView` beside the breakdown tab

Rejected. The tab already remounts the component; hoisting the hover state would give it a
lifetime longer than the thing it describes, and every other view rendering a `PieChart` would
inherit a prop it has no table for.

### A generic `rowProps` escape hatch on `DataTable`

Rejected. It would let any call site attach arbitrary handlers and rebuild the keyed guarantee
per view — the drift [[0039-data-table-primitive-and-column-sorting]] exists to remove. Two named
props keep the identity rule inside the primitive.

## References

- Story #147, Epic #99.
- [[0039-data-table-primitive-and-column-sorting]] — the sortable table, and why the link is keyed.
- [[0030-allocation-map-country-donut-pairs]], [[0021-allocation-map-gain-loss-scale]] — hue as
  identity; the validated palettes this must not disturb.
- [[0034-stat-tile-primitive-tone-axis]], [[0038-state-panel-primitive-variant-and-surface-axes]] —
  a default with no class of its own.
- [[0006-app-shell-tab-navigation]] — dependency-free inline SVG charts.
- [[0018-content-measure-and-chart-aspect]] — the donut is sized by its `viewBox`.
- `src/renderer/src/lib/sliceHighlight.ts`,
  `src/renderer/src/components/analytics/AllocationBreakdown.tsx`.
