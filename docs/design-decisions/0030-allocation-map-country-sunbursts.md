# 0030. Allocation map: one nested sunburst per country, hovered at three depths

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

The Allocation map has now shipped its data five ways. [[0014-allocation-world-map-bubble-map]] gave
each issuer country one value-sized bubble over a bundled land silhouette (Story #46), Story #70
added pan/zoom, Story #71 split each bubble into sector wedges,
[[0019-allocation-map-basemap-and-overlay]] replaced the silhouette with a Mapbox GL JS basemap
(Story #89), and [[0020-allocation-map-position-bubbles]] replaced the whole thing with one flat
canvas circle per **holding**, fanned onto a phyllotaxis spiral so holdings sharing a country stayed
separately hoverable (Story #92). [[0021-allocation-map-gain-loss-scale]] then layered a second
colour scale onto those circles (Story #95).

Story #122 returns the unit to the **country** and makes the mark a **nested sunburst**: an inner
ring splitting the country by sector, an outer ring splitting it by holding, every holding wedge
lying inside its own sector's arc.

That reverses two things DDR-0020 decided deliberately, so this DDR supersedes it rather than
extending it. What is *not* reversed is DDR-0020's actual purpose: per-company detail. Story #92
existed so the owner could identify one company from the map instead of reading a country total and
going to the Positions table for the detail. The outer ring keeps that — hovering a holding wedge
opens the same popup Story #92 introduced. The granularity survives; the geometry carrying it does
not.

## Decision

### The unit is the country again, and the mark is a hierarchy

DDR-0020's spiral existed to solve a problem the country unit does not have. Every holding in a
country resolves to the same centroid, coincident points never separate at any zoom, and so making
each holding reachable meant moving it somewhere it is not. One mark per country removes the
problem rather than compensating for it: there is nothing to pull apart, and the map stops fanning
holdings into a rosette that *looked* like located companies.

The mark's **area** is proportional to the country's market value, as it has been since DDR-0014.
Inside it, a holding wedge's angular span is a share of **its sector's** span, not of the country.
That nesting is the encoding: reading outward answers "how much of this country is technology, and
how much of that technology is one company?" without the two rings having to be mentally joined.
Two independent concentric donuts were considered and rejected for exactly that — they would show
the same two facts and make the reader do the join.

Sector ordering is largest-first, and holdings are largest-first within their sector, so a country's
dominant sector always starts at 12 o'clock and the marks are comparable to each other.

### Marks are SVG over the basemap, not paint in the canvas

DDR-0020 moved the data **into** the map canvas as a GeoJSON source and circle layer. Its stated
justification was extensibility: `circle-radius` and `circle-color` are data-driven expressions, so a
later story could re-colour or filter by changing an expression rather than restructuring how the map
is drawn. Story #95 duly cashed that in.

A circle layer paints **one flat fill per feature**. Wedges have no canvas equivalent, so this is not
a preference between two workable options — the sunburst cannot be a circle layer. Marks return to
SVG, one `mapboxgl.Marker` per country, with React rendering the `<svg>` into each marker element
through a portal. Mapbox keeps the element pinned to its coordinates through pan, zoom and
world-copy wrapping; React owns what is drawn inside it.

Three consequences, all of them improvements, and one real loss:

- **Colour stops needing `getComputedStyle`.** DDR-0020 had to resolve `pie-series-3` to a hex at
  layer-build time because a canvas paint property cannot take a CSS class. A class on a `<path>`
  *is* the fill, so `:root` remains the single source of truth with no resolution step in between —
  which is what `lib/pie` and `lib/sectorMap` have always emitted classes for. `resolveColor` is
  deleted. `.map-diverge-*` gained `fill` alongside `background`, exactly as `.pie-series-*` carries
  both, so one class paints a wedge and its legend swatch from one variable.
- **Colour mode becomes an ordinary re-render**, not `setPaintProperty`. The geometry is memoized and
  unchanged across a mode switch, so only fills move.
- **Hover emphasis becomes CSS.** DDR-0020 listed the loss of `:hover` as a cost of going to canvas;
  it comes back. The mark dims to 0.55 opacity and the wedge under the cursor returns to full with a
  `--text` outline.
- **The loss:** data-driven filtering and clustering over feature properties are no longer free. They
  were never built, and both would be re-derived per-mark DOM now. Recorded because DDR-0020 paid
  real accessibility costs to buy that capability and it is being given back.

The accessibility ledger DDR-0020 opened is partly repaid. The marks are real DOM again, so they
*can* take focus and carry text — but Story #122 does not wire that up. `role="img"` with a summary
label stays, the wedges are `aria-hidden`, and the **Positions table remains the map's accessible
equivalent**, carrying every field the popup shows for every holding in semantic markup. What
changes is that #93 (keyboard access to the map) is now a small story rather than a rewrite.

### Hover has three depths, and the popup is tinted by return

The sunburst has three meaningful regions, and each answers a different question:

| Region | Subject | Extra field |
| --- | --- | --- |
| Outer wedge | one holding | — |
| Inner wedge | one sector *within that country* | holding count |
| Hub | the country | holding count |

The holding popup is Story #92's, unchanged: ticker, company name, sector · country, then market
value, % of NAV, unrealized P&L and return, in Positions-table order with Positions-table
formatters. The two aggregate depths keep that shape and swap the identity lines. The hub exists to
be the country's hit target as much as to make the mark read as a ring system rather than a pie.

Hover is `onMouseEnter` per wedge with a **single `onMouseLeave` on the mark as a whole**. Leaving
one wedge for its neighbour must re-fill the one popup instance, never close and reopen it — a leave
followed by an enter in the same frame flickers visibly, and a dense mark is exactly where a
concentrated portfolio is read.

**The popup is tinted green when the hovered subject's return is positive and red when it is
negative** — `--pos` / `--neg` mixed to 12% of the popup surface, with the border at 45%. Flat, or a
holding with no cost basis to measure against, gets the plain surface.

This does not reopen [[0021-allocation-map-gain-loss-scale]], and the distinction is the whole point
of that DDR. It governs **fill colour used as the only channel**: a mark carries no number beside it,
so its scale must clear CVD contrast unaided, which is why the wedges keep the diverging red ↔ gray
↔ blue. The popup prints the return as text two rows below the tint. That is precisely the case
DDR-0021 carved out for the app's green/red — "`--pos` / `--neg` keep their role wherever a figure
accompanies them, including this map's own popup." At 12% the tone is a tint on the dark surface
rather than a coloured panel, so text keeps the contrast it has against `--card`.

Surface and tip colour both read `--popup-surface`, so the tint is one variable override rather than
eight anchor-specific rules.

### Small countries degrade to a dot, and every holding keeps a reachable sliver

Two failure modes are specific to putting a chart on a map, and both are handled in
`lib/countrySunbursts` rather than left to fall out of the geometry.

**A country too small to split.** Below a 14px radius the two rings would each be a couple of pixels
— unreadable, and worse, unhittable. Such a country is drawn as a **plain disc** in its largest
sector's hue, which still opens a popup. When it holds exactly one position — nearly always, at that
size — the popup goes straight to that holding rather than aggregating one thing. The wedges are
still computed, because the totals and the popup need them; they simply carry no path.

**A holding too small to hover.** Raw value shares give a holding worth 0.1% of its country a
sub-pixel wedge, and a short (market value ≤ 0) no wedge at all. `normalizedShares` lifts every share
to a 2% floor and renormalizes, so the ring stays honest to within a bounded distortion and nothing
in it is impossible to reach. The floor itself shrinks to `0.5 / n` on a busy ring, so floors can
never claim more than half of it; past that point the wedges are too many to hover individually and
honest proportions matter more. A ring whose values are all zero or negative splits evenly rather
than vanishing.

This is a deliberate, small dishonesty in service of reachability, and it is the reason the popup
always states the figures: the ring answers *what is in here*, the popup answers *how much*.

### What is unchanged

The frame (full content measure at `aspect-ratio: 3 / 1`), `fitBounds` to the same world bounds, the
app's own +/−/reset controls, Mapbox attribution, the shared sector legend and the gain/loss scale
legend, the `Unknown location` chip, both "map unavailable" messages, the `no-token` placeholder, and
the CSP admitting only `api.mapbox.com` with `events.mapbox.com` omitted so telemetry is
platform-blocked. No new dependency. Nothing below the renderer changed — no service, repository, IPC
or schema touched, because `AllocationPosition` already carried every field the sunburst needs.

`lib/mapBubbles` and its suite are deleted; `lib/countrySunbursts` replaces them and inherits their
coverage of unknown-bucket folding, √value radius scaling, centroid anchoring and the empty case.

## Alternatives Considered

### Two separate donuts per country, side by side

Closest to the literal request. Rejected on density: it doubles the marks in the region where they
already collide worst — the Netherlands, Belgium, Germany, France and Switzerland are nearly
coincident at world zoom — and re-opens the crowding the spiral was invented to solve.

### Two independent concentric rings (holdings inner, sectors outer)

One mark, but the rings unaligned. Rejected because the nesting is what makes the mark a hierarchy
rather than two charts sharing a centre; and the outer ring has more circumference, which should go
to the more numerous slices.

### A holdings donut on the map, the sector donut in the popup

Least clutter, and genuinely tempting. Rejected because the sector split then requires a hover to
exist at all, and "where is my money by sector" is the question the map is on the page to answer.

### Distinct shades per holding within a sector

Would make the outer ring's subdivisions readable by colour rather than by the hairline between
them. Rejected: it means generating hues outside the eight validated palette slots, which is the
drift DDR-0019 exists to prevent, and it would break the invariant that a sector wears exactly one
hue on the map, in the legend, and in the Sector donut. The surface-coloured hairline separates
neighbours instead.

### Keeping the canvas layer and drawing sunbursts as image sprites

Technically possible — render each mark to a canvas and use a `symbol` layer. Rejected: it keeps the
paint-expression extensibility but loses CSS colour, CSS hover, and per-wedge hit-testing, which
would then have to be hand-rolled from cursor geometry. Every advantage of the canvas is spent
re-implementing what the DOM does.

## Supersedes

[[0020-allocation-map-position-bubbles]] — on the **unit** (company → country), the **spiral spread**
(removed; no longer needed), and the **canvas circle layer** (SVG markers). Its popup design, its
statement that the map is approximate and positioned by issuer country, its `textContent`-only rule
for broker-sourced strings, and its position that the Positions table is the map's accessible
equivalent all carry forward intact.

By extension this restores, in a different form, the data semantics of
[[0014-allocation-world-map-bubble-map]] and Story #71 that DDR-0020 retired: one mark per issuer
country, split by sector. The area-proportional radius, the shared sector palette and the labelled
`unknown` bucket were never in question.

## References

- [[0020-allocation-map-position-bubbles]] — superseded on unit, spread and drawing technology
- [[0021-allocation-map-gain-loss-scale]] — unchanged; governs wedge fill, and carved out the popup
- [[0019-allocation-map-basemap-and-overlay]] — the basemap, projection, bounds and controls, retained
- [[0014-allocation-world-map-bubble-map]] — the per-country unit this returns to
- [[0007-mapbox-basemap-and-renderer-network-policy]] — the governing ADR, unchanged by this story
- [[0009-sector-classification-cache-and-allocation-donuts]] — where sector comes from
- [[0018-content-measure-and-chart-aspect]] — the frame's shared measure and aspect sizing
- GitHub Issues #122 (Story), #98 (Epic, M4); prior rounds #46, #70, #71, #89, #92, #95
- #93 — keyboard access to the map: still open, and much cheaper now the marks are DOM
