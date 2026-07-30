# 0030. Allocation map: two donuts per country, and the retreat from per-holding marks

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
country's weight in the portfolio, and the country split by sector.

**Four forms were built inside this story before this one, and the three that failed teach more than
the one that shipped.** That is recorded first, because the failures are the transferable part.

## The colour problem, and what it ruled out

A mark on this map is 20–50px across. Whatever it draws must be identifiable at that size, and colour
was the channel every early form reached for.

**Attempt 1 — a nested sunburst.** An inner ring of sectors, an outer ring of holdings, each holding
wedge inside its own sector's arc. Nesting *forces* the holding to wear its sector's hue: anything
else breaks the visual claim that the wedge sits inside that arc. A real portfolio concentrates in a
few sectors, so the outer ring rendered as one solid block of colour.

**Attempt 2 — two donuts, holdings and sectors.** Separating the charts freed the holdings donut to
colour by rank, which fixed the block. But it needed **eight distinguishable categorical hues per
country** on a 40px mark, and it forced a tail fold at eight slices that quietly put small holdings
out of reach.

**Attempt 3 — two radial bar charts.** Concentric bars are told apart by **ring position**, not hue,
which dissolves the colour problem entirely: one bar for the country's weight, one ring per sector.
It works, and it was built and verified. It was set aside for a reason that has nothing to do with
correctness — see below.

**This form — two donuts, weight and sectors.** The same division of labour as attempt 3, drawn as
donuts. The colour problem stays solved for the same reason: **neither chart needs a colour it cannot
afford.** The left shows one number, so it needs one hue. The right shows sectors, which already have
a palette the map's legend explains.

The general rule worth carrying: **when marks are small, give each chart one job and check that the
colours that job needs actually exist.** Attempts 1 and 2 failed that test; the encoding was decided
first and the palette was asked to stretch afterwards.

## Decision

### The unit is the country, and each country gets two donuts

DDR-0020's spiral existed to solve a problem the country unit does not have. Every holding in a
country resolves to the same centroid, coincident points never separate at any zoom, and so making
each holding reachable meant moving it somewhere it is not. One mark per country removes the problem
rather than compensating for it.

The pair's **area** is proportional to the country's market value, as it has been since DDR-0014.

**Left — the country's weight in the portfolio.** Two slices: the country's share of NAV in
`--series-1` blue, the palette slot whose documented role is *magnitude / primary series*, and the
rest of the portfolio muted behind it. The muted remainder is what makes the blue arc read as a
proportion rather than an arbitrary arc.

The scale is **absolute 0–100% of NAV**, not relative to the largest country, so the same arc means
the same weight in every country and in every session. A relative scale was rejected for the same
reason DDR-0021 rejected a data-driven colour range: it makes the same mark mean different things in
different sessions.

**Right — the country split by sector.** One slice per sector, largest first, each in its own hue
from the shared `sectorPalette`, so a sector wears one hue here, in the map's legend, and in the
Sector donut below.

The legend gains a `Country weight` entry for the blue. It is the one hue on the mark that is not a
sector, and an unexplained colour in a legend-bearing chart is a defect.

### The palette's blue is reserved, and sectors start at slot 2

Saying "the weight arc is blue" is not enough on its own. `--series-1` is the palette's **only**
blue, and `sectorPalette` assigned slot 1 to the largest sector — so the weight donut and the biggest
sector beside it were *guaranteed* to be the same colour, on the same mark, whatever either chart
did. This was found by looking at the running app, not by reasoning about it.

Slot 1 is now reserved for the country weight, and the sector dimension starts at slot 2
(`SECTOR_SLOT_OFFSET` in `lib/pie`).

**The skip applies everywhere a sector appears** — the map, the map legend, the Sector donut and its
composing table — because the invariant that matters is *one sector, one hue everywhere*, not which
hue it is. Shifting only the map would have produced exactly the drift the shared palette exists to
prevent: a sector wearing one colour on the mark and another in its own donut a few centimetres
below. The Sector breakdown's colours therefore all move by one, which is a visible change to a panel
this story otherwise does not touch.

Three things follow, and the third is the reason this is recorded here rather than left in a commit
message:

- **Only the sector dimension pays.** Asset class, currency and country keep all eight slots; none of
  them is ever drawn beside the weight donut. The offset is a per-dimension argument, not a global
  change to `sliceColorClasses`.
- **Sectors lose one categorical slot**, so the fold into a neutral `Other` happens one sector
  earlier — seven named sectors rather than eight.
- **The constraint is now permanent and inherited.** Any future chart placed beside a sector chart
  must take its colour from outside the sector range, and any future use of slot 1 must not appear
  next to sectors. The test asserts the *invariant* — no sector ever takes `pie-series-1`, and sector
  hues stay mutually distinct — rather than the slot arithmetic, so a future reshuffle of the palette
  cannot quietly reintroduce the collision.

The alternative was a second blue outside the validated palette for the weight arc. Rejected: the
palette has one blue because that is what cleared the CVD and contrast gates, and two blues of
different lightness on marks this small read as one colour shaded, not as two categories.

### A 100% slice is a ring, not a segment

A donut segment is a closed shape with straight radial edges, and `.pie-slice` strokes its outline in
the surface colour so neighbouring slices separate. On a slice that sweeps the full turn there are no
neighbours — but the edges are still stroked, so a 100% chart painted two seams at 12 and 6 o'clock
that looked like divisions and represented nothing.

`fullRingPath` draws that case as a real ring instead: the outer circle clockwise, the inner circle
anticlockwise, the hole punched by the nonzero fill rule. There are no radial edges, so there is
nothing for the stroke to find.

This is recorded because it is **not** a map decision. It lived in `lib/pie` and affected every donut
in the Allocation view whenever a single category held 100% — one asset class, one currency, one
country. The map merely made it common enough to notice: a country holding a single sector hits it
every time.

The tests around it asserted the defect. "A full turn is two half-arcs" passes for a ring too, since
a ring also has two subpaths, so the assertion is now the absence of an `L` command — the radial edge
is what makes a segment a segment, and its absence is the fix rather than a proxy for it.

### Why donuts rather than the radial bars that also worked

Attempt 3's radial bars were correct and legible. The deciding argument was **consistency**: the
Allocation view already renders four donuts directly below the map, and the app has no other radial
chart anywhere. Two chart idioms for the same kind of part-of-whole question, ten centimetres apart
on the same screen, is a worse outcome than either idiom alone.

Two smaller consequences fell out in the donuts' favour:

- **No ring-pitch limit.** The radial form had to derive its ring count from the radius available
  and fold sectors it had no pixels for, so the number of sectors visible depended on the country's
  *size*. A donut has no such limit — every sector gets a slice.
- **One less mechanism.** Radial bars needed a track element per ring; a donut's remainder slice does
  the same work in the one place it is actually needed.

Recorded because the radial form is a legitimate answer to this problem and someone will reasonably
propose it again.

### Holdings are no longer on the map

This is the real cost and it is stated plainly: **Story #122 retires the per-holding granularity
DDR-0020 introduced.** No mark carries a per-company element, nothing on the map opens a company's
figures, and the map's `aria-label` now says every holding is listed individually in the Positions
table below.

The map answers *where, and in what*. It no longer answers *which company* — that moved back to the
table it came from in Story #92. Two rounds tried to keep company identity on a 40px mark and
neither survived contact with a real portfolio's colour distribution. Keeping it would mean bigger
marks, which crowd the map, or a click-to-expand interaction, which is a different story.

### Hover has two subjects, and the popup is tinted by return

| Region | Subject | Extra fields |
| --- | --- | --- |
| Either slice of the left donut | the country | — |
| A right-donut slice | one sector *within that country* | share of country, holding count |

The weight donut measures the country, so **both** its slices open the country: the remainder is
context for the blue arc, not a subject of its own. A disc too small to draw as a pair does the same.

One trap is worth recording because it cost a round of debugging in the radial form: **an SVG `<g>`
is only ever hit through its children**, so grouping slices and putting `pointer-events: auto` on the
group catches nothing if the children are `none`. Every slice is its own hit target here.

Hover is `onMouseEnter` per slice with a **single `onMouseLeave` on the mark as a whole**. Leaving one
slice for its neighbour must re-fill the one popup instance, never close and reopen it — a leave
followed by an enter in the same frame flickers visibly.

**The popup is tinted green when the hovered subject's return is positive and red when it is
negative** — `--pos` / `--neg` mixed to 12% of the popup surface, with the border at 45%. Flat, or no
cost basis to measure against, gets the plain surface.

This does not reopen [[0021-allocation-map-gain-loss-scale]], and the distinction is the whole point
of that DDR. It governs **fill colour used as the only channel**: a slice carries no number beside it,
so its scale must clear CVD contrast unaided, which is why gain/loss mode keeps the diverging red ↔
gray ↔ blue. The popup prints the return as text two rows below the tint — precisely the case
DDR-0021 carved out for the app's green/red. At 12% the tone is a tint on the dark surface rather
than a coloured panel, so text keeps the contrast it has against `--card`.

Surface and tip colour both read `--popup-surface`, so the tint is one variable override rather than
eight anchor-specific rules.

### Marks are SVG over the basemap, not paint in the canvas

DDR-0020 moved the data **into** the map canvas as a GeoJSON source and circle layer, justified by
extensibility: `circle-radius` and `circle-color` are data-driven expressions, so a later story could
re-colour or filter by changing an expression. Story #95 duly cashed that in.

A circle layer paints **one flat fill per feature**. Donut slices have no canvas equivalent, so this
is not a preference between two workable options. Marks are SVG, one `mapboxgl.Marker` per country
carrying both donuts, with React rendering the `<svg>` into each marker element through a portal.
Mapbox keeps the element pinned to its coordinates through pan, zoom and world-copy wrapping; React
owns what is drawn inside it.

Three consequences, all improvements, and one real loss:

- **Colour stops needing `getComputedStyle`.** DDR-0020 resolved `pie-series-3` to a hex at
  layer-build time because a canvas paint property cannot take a CSS class. A class on a `<path>`
  *is* the fill, so `:root` remains the single source of truth. `resolveColor` is deleted, and
  `.map-diverge-*` gained `fill` alongside `background` exactly as `.pie-series-*` carries both.
- **Colour mode becomes an ordinary re-render**, not `setPaintProperty`.
- **Hover emphasis becomes CSS.** DDR-0020 listed the loss of `:hover` as a cost of canvas; it
  returns. The mark dims to 0.5 opacity and the hovered slice comes back to full.
- **The loss:** data-driven filtering and clustering over feature properties are no longer free.
  Neither was built, but DDR-0020 paid real accessibility costs to buy that capability, and it is
  being given back.

The marks are real DOM again, so they *can* take focus and carry text — but Story #122 does not wire
that up. `role="img"` with a summary label stays and the slices are `aria-hidden`. What changes is
that #93 (keyboard access) is now a small story rather than a rewrite, and a smaller one than before
since there are far fewer targets.

### Small countries degrade to a disc, and sector slices keep a reachable sweep

Below a 8px radius two donuts are two smudges, so the country is drawn as a **single disc** in its
largest sector's hue — deliberately not the weight blue, which would say nothing about what is held —
and still opens a popup. The slices are still computed, because the totals and the popup need them;
they carry no paths.

`normalizedShares` lifts every **sector** slice to a 2% floor and renormalizes, so a sector worth a
rounding error stays hoverable and a country of only shorts splits evenly rather than vanishing. The
floor shrinks to `0.5 / n` on a busy donut so floors can never claim more than half of it.

**The floor is deliberately not applied to the weight donut.** Overstating a 1%-of-NAV country is
exactly what that chart exists not to do, so its share is used raw and merely clamped to [0, 1].
Getting this backwards would make every small country look larger than it is — which is the failure
mode a proportion chart has to be trusted not to have.

### What is unchanged

The frame (full content measure at `aspect-ratio: 3 / 1`), `fitBounds` to the same world bounds, the
app's own +/−/reset controls, Mapbox attribution, the gain/loss scale legend, the `Unknown location`
chip, both "map unavailable" messages, the `no-token` placeholder, and the CSP admitting only
`api.mapbox.com` with `events.mapbox.com` omitted so telemetry is platform-blocked. No new
dependency. Nothing below the renderer changed — no service, repository, IPC or schema touched,
because `AllocationPosition` already carried every field the donuts need.

`lib/mapBubbles` and its suite are deleted; `lib/countryDonuts` replaces them and inherits their
coverage of unknown-bucket folding, √value radius scaling, centroid anchoring and the empty case.

## Alternatives Considered

### A single nested sunburst per country

**Built, then rejected** — see *The colour problem*. The more elegant object, and unusable at map
scale because nesting forces holdings to wear their sector's hue. Worth revisiting only if marks get
much larger, e.g. a click-to-expand country.

### Two donuts, holdings and sectors

**Built, then rejected** — see *The colour problem*. Fixed the block, but spent eight categorical
hues per country on a 40px mark and folded holdings out of reach at eight slices.

### Two radial bar charts

**Built, then set aside** — see *Why donuts rather than the radial bars that also worked*. Correct and
legible; rejected on consistency with the four donuts directly below the map, and because its ring
count had to be derived from available pixels. The form came from shadcn/ui's `chart-radial-simple`
and `chart-radial-stacked`; their implementation (Recharts inside a Tailwind `ChartContainer`) was
never on the table, since this project has neither dependency and `CLAUDE.md` states charts are
hand-written SVG deliberately. Adopting Recharts would be an ADR-level change.

### Keeping holdings on the map as a third chart

Would preserve DDR-0020's granularity. Rejected: three charts per country triples the footprint in
the region that already collides worst, and the holdings chart is the one with no colour left.

### Keeping the canvas layer and drawing donuts as image sprites

Render each mark to a canvas and use a `symbol` layer. Rejected: it keeps paint-expression
extensibility but loses CSS colour, CSS hover, and per-slice hit-testing, which would then be
hand-rolled from cursor geometry.

## Consequences

The map is denser than the per-holding rounds were: two donuts per country roughly doubles a mark's
footprint, and in Western Europe — the Netherlands, Germany, France and Switzerland are nearly
coincident at world zoom — pairs will overlap. Marks are drawn largest-first so the smallest sit on
top and stay hoverable, the smallest collapse to discs, and zoom separates the rest. If it proves too
crowded against a real portfolio the answer is a smaller `R_MAX` or zoom-dependent sizing.

The absolute weight scale means most countries show a small blue arc, because most portfolios are not
40% in one country. That is honest and comparable, and the mark's *size* plus the popup carry the
magnitude.

Reserving slot 1 leaves the sector dimension seven categorical hues. If sector granularity ever
increases — a finer classification than the current broad sectors — that ceiling will bite before the
others do, and the answer is to widen the palette rather than to un-reserve the blue.

## Supersedes

[[0020-allocation-map-position-bubbles]] — on the **unit** (company → country), the **spiral spread**
(removed), the **canvas circle layer** (SVG markers), and its **per-holding granularity** (retired;
the Positions table carries it). Its statement that the map is approximate and positioned by issuer
country, its `textContent`-only rule for broker-sourced strings, and its position that the Positions
table is the map's accessible equivalent all carry forward intact.

By extension this restores, in a different form, the data semantics of
[[0014-allocation-world-map-bubble-map]] and Story #71 that DDR-0020 retired: one mark per issuer
country, split by sector. The area-proportional radius, the shared sector palette and the labelled
`unknown` bucket were never in question.

## References

- [[0020-allocation-map-position-bubbles]] — superseded on unit, spread, drawing and granularity
- [[0021-allocation-map-gain-loss-scale]] — unchanged; governs slice fill, and carved out the popup
- [[0019-allocation-map-basemap-and-overlay]] — the basemap, projection, bounds and controls, retained
- [[0014-allocation-world-map-bubble-map]] — the per-country unit this returns to
- [[0007-mapbox-basemap-and-renderer-network-policy]] — the governing ADR, unchanged by this story
- [[0009-sector-classification-cache-and-allocation-donuts]] — where sector comes from
- [[0018-content-measure-and-chart-aspect]] — the frame's shared measure and aspect sizing
- GitHub Issues #122 (Story), #98 (Epic, M4); prior rounds #46, #70, #71, #89, #92, #95
- #93 — keyboard access to the map: still open, cheaper now the marks are DOM and fewer
