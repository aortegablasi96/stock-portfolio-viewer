# 0030. Allocation map: two donuts per country, hovered at three depths

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

The Allocation map has now shipped its data five ways. [[0014-allocation-world-map-bubble-map]] gave
each issuer country one value-sized bubble over a bundled land silhouette (Story #46), Story #70
added pan/zoom, Story #71 split each bubble into sector wedges,
[[0019-allocation-map-basemap-and-overlay]] replaced the silhouette with a Mapbox GL JS basemap
(Story #89), and [[0020-allocation-map-position-bubbles]] replaced the whole thing with one flat
canvas circle per **holding**, fanned onto a phyllotaxis spiral so holdings sharing a country stayed
separately hoverable (Story #92). [[0021-allocation-map-gain-loss-scale]] then layered a second
colour scale onto those circles (Story #95).

Story #122 returns the unit to the **country** and gives each one **two donuts side by side**: the
left splitting the country by holding, the right splitting the same country by sector.

That reverses two things DDR-0020 decided deliberately, so this DDR supersedes it rather than
extending it. What is *not* reversed is DDR-0020's actual purpose. Story #92 existed so the owner
could identify one company from the map instead of reading a country total and going to the Positions
table for the detail. The left donut keeps that — hovering a holding slice opens the same popup Story
#92 introduced. The granularity survives; the geometry carrying it does not.

**One round inside this story was built and rejected, and the reason is the most transferable thing
here.** The first implementation drew a single **nested sunburst** per country: an inner ring of
sectors, an outer ring of holdings, each holding wedge inside its own sector's arc. It was rejected
on sight for a reason that is obvious in hindsight and was not obvious in design — see *Colour is
what makes a donut readable*, below.

## Decision

### The unit is the country again, and each country gets two donuts

DDR-0020's spiral existed to solve a problem the country unit does not have. Every holding in a
country resolves to the same centroid, coincident points never separate at any zoom, and so making
each holding reachable meant moving it somewhere it is not. One mark per country removes the problem
rather than compensating for it: there is nothing to pull apart, and the map stops fanning holdings
into a rosette that *looked* like located companies.

The pair's **area** is proportional to the country's market value, as it has been since DDR-0014.
Both donuts describe the same holdings over the same total, split two ways — so the two rings are
comparable to each other, and either one's hole can stand for the country.

Slices are largest-first in both donuts, so a country's dominant holding and dominant sector are in
a predictable place across countries.

### Colour is what makes a donut readable, and the two donuts colour independently

This is the decision worth the record, because getting it wrong made the first attempt unusable.

Sector identity is **global**: the right donut uses the shared `sectorPalette`, so a sector wears one
hue there, in the map's legend, and in the Sector donut below. That invariant predates this story and
is untouched.

The left donut **does not carry sector identity at all**. Its slices take the app's ordinary
categorical donut palette assigned *by rank within the country* — `pie-series-1` for the largest
holding, and so on.

The rejected sunburst tinted every holding with **its sector's** hue, separated only by a hairline.
It preserved the palette invariant perfectly and destroyed the chart: a country whose holdings
cluster in one or two sectors — which is what a real portfolio looks like — rendered as one solid
block of colour. A donut's slices exist to be told apart from *each other*; making them all agree
with a second encoding is precisely what prevents that.

What makes the fix legitimate rather than a palette violation is that the sector donut sits beside
it. Once sector composition has its own chart, the holdings chart is free to spend its colour channel
on distinguishing holdings, which is the only thing it needs colour for. Two charts, two independent
categorical assignments, each internally consistent — exactly how every other donut in the app works.

The cost is that the map's legend explains only the right donut. The caption says so
(`left donut = holdings, right donut = sectors (legend above)`), and holdings are named on hover
rather than in a legend, because a legend of every holding in every country is not a caption.

### The left donut folds its tail, exactly as every other donut does

Eight slots: the seven largest holdings plus an aggregated `Other (n)`, per `lib/pie`'s rule, applied
per country. Beyond eight, slices are too fine to hover and too many to colour without cycling hues —
and cycling is the one thing the palette forbids.

This is a real loss against DDR-0020, and it is recorded rather than glossed: in a country holding
more than eight positions, the smallest are no longer individually hoverable on the map. They remain
in the tail slice's totals, and every one of them is a row in the Positions table with the same
figures. `holdingCount` on the country still reports the true number, so the country popup never
under-reports what is held.

Non-positive holdings are **kept** rather than filtered, which is where this departs from
`lib/pie`'s `groupTail`. A short is a real position and has to stay reachable; it sorts last, so in a
busy country it lands in the tail anyway.

### Marks are SVG over the basemap, not paint in the canvas

DDR-0020 moved the data **into** the map canvas as a GeoJSON source and circle layer, justified by
extensibility: `circle-radius` and `circle-color` are data-driven expressions, so a later story could
re-colour or filter by changing an expression rather than restructuring how the map is drawn. Story
#95 duly cashed that in.

A circle layer paints **one flat fill per feature**. Donut slices have no canvas equivalent, so this
is not a preference between two workable options — the chart cannot be a circle layer. Marks return
to SVG, one `mapboxgl.Marker` per country carrying both donuts, with React rendering the `<svg>` into
each marker element through a portal. Mapbox keeps the element pinned to its coordinates through pan,
zoom and world-copy wrapping; React owns what is drawn inside it.

Three consequences, all improvements, and one real loss:

- **Colour stops needing `getComputedStyle`.** DDR-0020 had to resolve `pie-series-3` to a hex at
  layer-build time because a canvas paint property cannot take a CSS class. A class on a `<path>`
  *is* the fill, so `:root` remains the single source of truth with no resolution step in between —
  which is what `lib/pie` and `lib/sectorMap` have always emitted classes for. `resolveColor` is
  deleted. `.map-diverge-*` gained `fill` alongside `background`, exactly as `.pie-series-*` carries
  both, so one class paints a slice and its legend swatch from one variable.
- **Colour mode becomes an ordinary re-render**, not `setPaintProperty`. The geometry is memoized and
  unchanged across a mode switch, so only fills move.
- **Hover emphasis becomes CSS.** DDR-0020 listed the loss of `:hover` as a cost of going to canvas;
  it comes back. The mark dims to 0.5 opacity and the slice under the cursor returns to full with a
  `--text` outline.
- **The loss:** data-driven filtering and clustering over feature properties are no longer free. They
  were never built, and both would be re-derived per-mark DOM now. Recorded because DDR-0020 paid
  real accessibility costs to buy that capability and it is being given back.

The accessibility ledger DDR-0020 opened is partly repaid. The marks are real DOM again, so they
*can* take focus and carry text — but Story #122 does not wire that up. `role="img"` with a summary
label stays, the slices are `aria-hidden`, and the **Positions table remains the map's accessible
equivalent**, carrying every field the popup shows for every holding in semantic markup. What changes
is that #93 (keyboard access to the map) is now a small story rather than a rewrite.

### Hover has three depths, and the popup is tinted by return

| Region | Subject | Extra fields |
| --- | --- | --- |
| Left donut slice | one holding (or the `Other (n)` tail) | share of country |
| Right donut slice | one sector *within that country* | share of country, holding count |
| Either donut's hole | the country | — |

The holding popup is Story #92's, unchanged: ticker, company name, sector · country, then market
value, % of NAV, unrealized P&L and return, in Positions-table order with Positions-table formatters.
Aggregate slices keep that shape and add the two figures an aggregate has and a single position does
not — how many holdings it covers, and the **share of the country its angle encodes**. That last row
matters because % of NAV and % of country are different numbers and the angle is the second one.

Both holes open the country, because both donuts describe the same country. The hole is also what
makes each mark read as a donut rather than a pie.

Hover is `onMouseEnter` per slice with a **single `onMouseLeave` on the mark as a whole**. Leaving one
slice for its neighbour must re-fill the one popup instance, never close and reopen it — a leave
followed by an enter in the same frame flickers visibly, and a dense mark is exactly where a
concentrated portfolio is read.

**The popup is tinted green when the hovered subject's return is positive and red when it is
negative** — `--pos` / `--neg` mixed to 12% of the popup surface, with the border at 45%. Flat, or a
holding with no cost basis to measure against, gets the plain surface.

This does not reopen [[0021-allocation-map-gain-loss-scale]], and the distinction is the whole point
of that DDR. It governs **fill colour used as the only channel**: a slice carries no number beside it,
so its scale must clear CVD contrast unaided, which is why gain/loss mode keeps the diverging red ↔
gray ↔ blue. The popup prints the return as text two rows below the tint. That is precisely the case
DDR-0021 carved out for the app's green/red — "`--pos` / `--neg` keep their role wherever a figure
accompanies them, including this map's own popup." At 12% the tone is a tint on the dark surface
rather than a coloured panel, so text keeps the contrast it has against `--card`.

Surface and tip colour both read `--popup-surface`, so the tint is one variable override rather than
eight anchor-specific rules.

### Small countries degrade to a disc, and every slice keeps a reachable sliver

Two failure modes are specific to putting charts on a map, and both are handled in
`lib/countryDonuts` rather than left to fall out of the geometry.

**A country too small to draw as a pair.** Below a 9px radius two donuts are two smudges. Such a
country is drawn as a **single disc** in its largest sector's hue — the one hue the legend can
explain — and still opens a popup. When it holds exactly one position, which at that size it nearly
always does, the popup goes straight to that holding rather than aggregating one thing. The slices
are still computed, because the totals and the popup need them; they simply carry no path.

**A slice too small to hover.** Raw value shares give a holding worth 0.1% of its country a sub-pixel
slice, and a short (market value ≤ 0) none at all. `normalizedShares` lifts every share to a 2% floor
and renormalizes, so the donut stays honest to within a bounded distortion and nothing in it is
impossible to reach. The floor itself shrinks to `0.5 / n` on a busy donut, so floors can never claim
more than half of it. A donut whose values are all zero or negative splits evenly rather than
vanishing.

This is a deliberate, small dishonesty in service of reachability, and it is the reason the popup
always states the figures: the donut answers *what is in here*, the popup answers *how much*.

### What is unchanged

The frame (full content measure at `aspect-ratio: 3 / 1`), `fitBounds` to the same world bounds, the
app's own +/−/reset controls, Mapbox attribution, the shared sector legend and the gain/loss scale
legend, the `Unknown location` chip, both "map unavailable" messages, the `no-token` placeholder, and
the CSP admitting only `api.mapbox.com` with `events.mapbox.com` omitted so telemetry is
platform-blocked. No new dependency. Nothing below the renderer changed — no service, repository, IPC
or schema touched, because `AllocationPosition` already carried every field the donuts need.

`lib/mapBubbles` and its suite are deleted; `lib/countryDonuts` replaces them and inherits their
coverage of unknown-bucket folding, √value radius scaling, centroid anchoring and the empty case.

## Alternatives Considered

### A single nested sunburst per country

**Built, then rejected** — see *Colour is what makes a donut readable*. Inner ring of sectors, outer
ring of holdings, each holding nested in its sector's arc. It is the more elegant object: one mark
instead of two, and the nesting means reading outward answers "how much of this country is
technology, and how much of that technology is one company?" without joining two charts mentally.

It fails on colour, which is not a detail but the channel that makes a donut a chart. Nesting forces
each holding to wear its sector's hue — anything else breaks the visual claim that the wedge sits
inside that arc — so in a portfolio concentrated in a few sectors the outer ring is a solid block.
Shades within each sector's hue were considered and rejected: it means generating colours outside the
eight validated palette slots, and adjacent shades of one hue at map scale are not reliably
distinguishable anyway.

The nested form is worth revisiting only if the marks get much larger — a click-to-expand country,
for instance, where a single mark has the pixels to carry both rings legibly.

### Two independent concentric rings

One mark, holdings inside, sectors outside, but the rings not aligned. Rejected: it inherits the
sunburst's cramped ring thickness while giving up the one thing nesting bought, and two concentric
rings that are *not* nested actively invite being read as if they were.

### A holdings donut on the map, the sector donut in the popup

Least clutter. Rejected because the sector split then requires a hover to exist at all, and "where is
my money by sector, geographically" is the question the map is on the page to answer.

### Keeping the canvas layer and drawing donuts as image sprites

Technically possible — render each mark to a canvas and use a `symbol` layer. Rejected: it keeps the
paint-expression extensibility but loses CSS colour, CSS hover, and per-slice hit-testing, which would
then have to be hand-rolled from cursor geometry. Every advantage of the canvas is spent
re-implementing what the DOM does.

## Consequences

The map is denser than it was. Two donuts per country roughly doubles a mark's footprint, and in
Western Europe — the Netherlands, Germany, France and Switzerland are nearly coincident at world zoom
— pairs will overlap. Three things keep that usable rather than fatal: marks are drawn largest-first
so the smallest sit on top and stay hoverable, the smallest countries collapse to discs instead of
pairs, and zoom separates what world view overlaps. It is still the honest cost of the layout, and if
it proves too crowded in practice the answer is a smaller `R_MAX` or a zoom-dependent size, not a
return to nesting.

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
- [[0021-allocation-map-gain-loss-scale]] — unchanged; governs slice fill, and carved out the popup
- [[0019-allocation-map-basemap-and-overlay]] — the basemap, projection, bounds and controls, retained
- [[0014-allocation-world-map-bubble-map]] — the per-country unit this returns to
- [[0007-mapbox-basemap-and-renderer-network-policy]] — the governing ADR, unchanged by this story
- [[0009-sector-classification-cache-and-allocation-donuts]] — where sector comes from
- [[0018-content-measure-and-chart-aspect]] — the frame's shared measure and aspect sizing
- GitHub Issues #122 (Story), #98 (Epic, M4); prior rounds #46, #70, #71, #89, #92, #95
- #93 — keyboard access to the map: still open, and much cheaper now the marks are DOM
