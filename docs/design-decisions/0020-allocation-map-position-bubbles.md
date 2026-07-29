# 0020. Allocation map: one canvas circle per holding, with a hover popup

- **Status:** Superseded by 0030 (the unit, the spiral spread and the canvas circle layer — the popup
  design, the approximation, and the accessibility position below still apply)
- **Date:** 2026-07-26

## Context

The Allocation map has shipped in four rounds. [[0014-allocation-world-map-bubble-map]]
established one value-sized bubble per issuer country over a bundled land silhouette (Story #46),
Story #70 added pan/zoom, Story #71 split each bubble into sector wedges, and
[[0019-allocation-map-basemap-and-overlay]] replaced the silhouette with a Mapbox GL JS basemap
(Story #89).

Through all four the map has answered one question: *where in the world is my money?* It answers it
at country granularity — the owner sees that 38% sits in the United States, then leaves the map and
scans the Positions table to learn which holdings make up that mass, what each is worth, or whether
any is underwater. The map is a summary that sends you elsewhere for detail.

Story #92 changes the unit of the map from **country** to **company**, and replaces the native
`<title>` tooltip with a popup carrying the figures the owner would otherwise go looking for. The
architectural consequences are nil — no new dependency, no new origin, no CSP change, nothing below
the renderer — so [[0007-mapbox-basemap-and-renderer-network-policy]] continues to govern unchanged
and no ADR accompanies this. What changes is how the data is drawn, which is recorded here.

Two things make this more than a visual refresh, and both reverse decisions DDR-0019 took
deliberately.

## Decision

### Bubbles are drawn into the map canvas, not over it

DDR-0019 kept the data as **SVG elements layered over the basemap, never drawn into it**, and gave
two reasons: it preserved the `<title>` tooltips that make a bubble identifiable, and with "at most
a few dozen countries, there is no performance pressure" to justify a canvas layer.

Holdings are now a **Mapbox GeoJSON source and circle layer**, with hover served by a single
`mapboxgl.Popup`.

**The performance half of DDR-0019's rationale still holds and is not the reason.** A few dozen
positions is no more a rendering load than a few dozen countries. The justification is
**extensibility**: `circle-radius` and `circle-color` are data-driven expressions over feature
properties, so a later story can re-colour by gain/loss, filter by sector, or cluster by changing an
expression rather than restructuring how the map is drawn. The overlay could not offer that without
re-deriving per-marker DOM on every change.

### Sector becomes a fill colour, not a wedge

A circle layer paints one fill per feature, so Story #71's per-country sector wedges have no canvas
equivalent. Per-company circles **coloured** by sector carry that meaning forward instead, and the
invariant DDR-0019 protected is untouched: the palette is still `sectorPalette`, so a sector wears
one hue on the map, in the map legend, and in the Sector donut. Country-level sector composition
remains exactly readable in the "By geography" and "By sector" donuts below.

Colour crosses from CSS into the canvas in exactly one place. `lib/mapBubbles` emits palette
**classes**; the component resolves `--series-N` from `:root` at layer-build time. Duplicating the
hexes into TypeScript was rejected: it would create a second palette to keep in sync with the donut,
which is the drift DDR-0019 exists to prevent. It also keeps the seam that makes the map's geometry
testable — resolving a class needs `getComputedStyle`, which does not exist in Vitest's Node
environment.

### The map is approximate by design

Every holding in a country resolves to the same ISO centroid, and **coincident points never
separate**: no amount of zooming distinguishes two circles at identical coordinates. Making each
holding individually reachable therefore requires moving them apart.

Holdings sharing a country are fanned onto a **phyllotaxis spiral in geographic degrees**, largest
at the centre. Because the offsets are geographic rather than screen-space, they behave correctly
under zoom for free — a tight rosette at world view that fans out as the owner zooms in, with no
zoom listeners and no source rewriting. The spiral grows as √n, so a country's fan widens with how
much is held there, and clamps at 7° so an outer holding rings rather than wandering into a
neighbouring country.

The consequence is stated plainly because it is easy to misread: **a bubble sits near its issuer
country, not at a company's location.** The map was already approximate — a centroid is not where a
company is — but a fan of distinct circles *looks* like located companies in a way a single country
bubble did not. The legend hint therefore reads `positioned by issuer country`, and the popup names
the country, so the approximation is visible rather than inferred. Sourcing real per-company
coordinates would remove it, and is the strongest argument for doing so later.

A holding with a zero or negative market value (a short) cannot be sized proportionally. It is still
drawn, at the minimum radius, and its popup reports the actual figure — it is a real holding and
must stay reachable.

### The popup mirrors a Positions table row

Same fields, same order, same formatters: ticker, company name, sector · country, then market value,
% of NAV, and unrealized P&L with the app's existing `stat-positive` / `stat-negative` tone. The
owner learns one layout rather than two, and the two surfaces can be read against each other.

Surface, border, radius and shadow are the map's existing floating-control tokens (`.map-zoom-btn`),
not the 12px `.panel` — the popup is a thing on the map, not a panel. A dark popup over the light
basemap reads strongly and keeps the app's identity on a surface that is otherwise not ours.

Behavioural specifics that are decisions rather than details:

- **One `Popup` instance, moved and re-filled.** Creating one per hover flickers visibly when
  sliding between neighbours in a dense rosette — which is exactly where a concentrated portfolio is
  read.
- **`anchor` is left unset**, so Mapbox flips the popup to keep it inside the frame. The
  edge-visibility requirement is met by the library rather than by collision code of ours.
- **The popup is `pointer-events: none`.** It must never sit between the cursor and the circle that
  opened it, or moving onto it would read as a mouseleave and close it.
- **Content is built with `textContent`, never `innerHTML`.** Tickers, company names, sectors and
  countries all originate from broker data.
- **A tail sector is named honestly.** Colour comes from the palette's grouped display key, so a
  sector past the eight slots paints neutral — but the popup describes *one company* and names its
  actual sector. `Other (2)` would be a lie there.

### Vendor CSS is overridden, once, deliberately

`mapboxgl.Popup` ships a light default surface, so this is the first place the app overrides a
third-party stylesheet. DDR-0019 explicitly avoided exactly this by rejecting `NavigationControl`,
on the grounds that it "would be the first control in the app not styled from the design system."

This is a scoped acceptance of that same cost, and the trade is different: `NavigationControl`
offered less code in exchange for an unstyled control and a silently changed interaction, whereas
`Popup` provides viewport-edge flipping that would otherwise have to be hand-rolled. Five override
rules buy that. The app's own controls remain the app's own.

### Accessibility: the map is an enhanced visual, the table is the equivalent

This is the real cost of the decision and it is recorded rather than glossed. Moving to canvas loses
three things the overlay provided free:

| Lost | Consequence |
| --- | --- |
| `<title>` on every element | Screen readers get nothing from the map's contents |
| Real DOM nodes | Circles cannot take focus or be tabbed |
| `:hover` CSS | Emphasis must be a paint expression instead |

The position taken is that the **Positions table is the map's accessible equivalent** — not as a
concession but as a fact: it already carries every field the popup shows (ticker, description,
country, sector, market value, unrealized P&L, % of NAV) for every position, in semantic markup, in
the same panel stack. There is no information in the popup a screen-reader user cannot already
reach.

To make that stance honest, the map's `aria-label` was strengthened from a static string to a
summary carrying holding count, total value, and an explicit pointer to the table below. `role="img"`
stays; no interactive ARIA is added to something that cannot be operated. The popup names the sector
in text, so colour is a convenience rather than the channel.

**Keyboard parity for the map — tabbing between holdings, popup on focus — is a real remaining gap
and is deliberately out of scope for Story #92.** It warrants its own story rather than being
smuggled in or quietly forgotten.

### The frame, controls and degraded states are unchanged

Full content measure at `aspect-ratio: 3 / 1`, `fitBounds` to the same world bounds, the app's own
+/−/reset controls, Mapbox attribution, the sector legend, the `Unknown location` chip, and both
"map unavailable" messages all carry over from DDR-0019 exactly. Story #92 gave no reason to reopen
any of them.

## Alternatives Considered

### Keep the SVG overlay and simply draw more of it

One marker per holding instead of per country, retaining `<title>` and full a11y. Genuinely
tempting, and it would have avoided the accessibility regression entirely. Rejected by the owner in
favour of data-driven styling: re-colouring by gain/loss or filtering by sector would mean rebuilding
per-marker DOM on every change, which is the extensibility the story exists to enable.

### Mapbox clustering for the overlap

The idiomatic answer to dense points, and it is what the library offers. Rejected at the Product
Review: a cluster is not one company, so it reintroduces exactly the aggregation this story removes.
Aggregation is already what the map did. Retained as a legitimate *future* enhancement once
per-company identity has been lived with.

### Accept overlap and rely on zoom

Considered and found to be impossible rather than merely poor: points at identical coordinates never
separate at any zoom level. This is what forced the spread to be geometric rather than a display
trick.

### A React div positioned with `map.project()` instead of `Popup`

Would keep popup styling entirely the app's own and avoid overriding vendor CSS. Rejected: it means
reimplementing viewport-edge collision, which `Popup` provides free and which is an explicit
acceptance criterion.

### Duplicate the palette hexes into TypeScript

Simpler than reading CSS custom properties at runtime, and it would remove the one impure step in
the colour path. Rejected: two palettes to keep in sync is the drift DDR-0019 exists to prevent, and
it would pull `getComputedStyle`-free colour resolution into the pure module without buying anything.

## Supersedes

[[0019-allocation-map-basemap-and-overlay]] — **on the overlay and tooltip decisions only.** The
basemap choice (`light-v11`, muted on purpose), the flat Mercator projection, the fitted world
bounds, the app-owned zoom controls, the full-measure 3:1 frame, and the two-message degraded state
are all carried forward intact and still govern this view.

By extension this also completes the retirement of [[0014-allocation-world-map-bubble-map]]'s data
semantics, which DDR-0019 explicitly preserved: one bubble per issuer country and the sector-wedge
split are both replaced here. What survives from DDR-0014 is the area-proportional radius, the shared
sector palette, and the labelled `unknown` bucket for unplaceable positions.

## References

- [[0019-allocation-map-basemap-and-overlay]] — superseded on the overlay; basemap decisions retained
- [[0014-allocation-world-map-bubble-map]] — data semantics now fully replaced
- [[0007-mapbox-basemap-and-renderer-network-policy]] — the governing ADR, unchanged by this story
- [[0009-sector-classification-cache-and-allocation-donuts]] — where sector comes from
- [[0018-content-measure-and-chart-aspect]] — the frame's shared measure and aspect sizing
- Product Review, UI Review, Architecture Review and Implementation Plan for Story #92
- GitHub Issues #92 (Story), #4 (Epic M3); prior rounds #46, #70, #71, #89
