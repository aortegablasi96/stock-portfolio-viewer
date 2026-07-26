# 0019. Allocation map: Mapbox basemap with an SVG bubble overlay

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

The Allocation world map has shipped in three rounds: [[0014-allocation-world-map-bubble-map]]
established one value-sized bubble per issuer country over a bundled land silhouette (Story #46),
Story #70 added pan/zoom as a moving SVG `viewBox`, and Story #71 split each bubble into sector
wedges coloured from the Sector donut's palette.

The silhouette was chosen to avoid a geo dependency and keep the view fully offline, and it
succeeded at that. What it cannot do is answer *which country is this?* It carries no coastline
detail, no borders and no labels, so a bubble is identifiable only by hovering it for a tooltip —
and in Western Europe, where bubbles overlap, that is exactly where identification matters most.

Story #89 replaces the surface beneath the data. The architectural consequences — the `mapbox-gl`
dependency and the renderer's first outbound network access — are decided in
[[0007-mapbox-basemap-and-renderer-network-policy]]. This DDR records how the map is drawn.

## Decision

### Basemap and overlay are separate layers

The Mapbox map draws geography; the app draws data on top of it as **SVG elements, never into the
map canvas**. The separation is what preserves the existing hover tooltips
(`Country · Sector — value (% of NAV)`) as ordinary `<title>` elements, and it keeps the bubbles
independent of the basemap provider — the overlay would survive a provider swap unchanged.

### Bubbles are anchored geographically, not projected

`splitSectorBubbles` previously returned each bubble at an absolute `x`/`y` in a fixed 360×180
equirectangular frame. It now returns **`lon`/`lat`** straight from `COUNTRY_CENTROIDS`, and lays
wedge paths out around a **local `0,0` origin**, so the map can position the same path data at any
zoom. `projectEquirectangular` and the whole `lib/mapViewport.ts` viewport-maths module are
retired — the map owns projection, panning, zooming and clamping.

Everything else in the transform is deliberately unchanged: country grouping, √value radius scaling
between `R_MIN` and `R_MAX`, palette matching against the Sector donut, neutral-last wedge
ordering, largest-first bubble sort, and the `unknown` bucket. Those remain pure and unit-tested in
`lib/sectorMap.ts`, which is why they survived a basemap swap untouched.

### The basemap is muted on purpose

A **monochrome, low-saturation** style (`light-v11`). Streets and satellite styles are rejected as
a legibility decision, not a taste one: the sector palette is categorical, and the wedge hues must
remain the only strongly saturated thing on screen. The basemap is context; the bubbles are the
data. Wedge opacity and the white outline ring are strengthened relative to DDR-0014's values,
which were tuned against a flat faint silhouette and read as muddy over real terrain.

### Controls stay the app's own; attribution is not optional

The existing `.map-zoom-btn` +/−/reset controls are kept and wired to the map, rather than adopting
Mapbox's `NavigationControl` — it ships its own visual language and would be the first control in
the app not styled from the design system. The owner's interaction from Story #70 is preserved
exactly, including the reset affordance and its disabled-at-world-view state.

Mapbox's attribution ("© Mapbox © OpenStreetMap") is required by their terms, stays enabled, and
is the one genuinely new visual element in the panel. It is not chrome to be hidden.

### Layout is unchanged; the canvas needs help sizing

The panel, the centred `max-width: 56rem` frame ([[0018-content-measure-and-chart-aspect]]), the
sector legend, the pan hint and the `Unknown location` chip all carry over as-is, so nothing below
the map shifts. Two mechanical differences from an SVG: the frame must declare `aspect-ratio: 2 / 1`
because a canvas does not size itself from a `viewBox`, and the map must be told to resize when its
container changes or it renders letterboxed after a window resize.

### One degraded state, two messages

A missing token, an unreachable tile service and a revoked or rate-limited token all render the
same way: the existing in-figure `.chart-empty` treatment where the basemap would be — no new
pattern, no modal, no error styling. The panel keeps its title, and the rest of the Allocation view
renders normally.

The copy distinguishes two causes, because their fixes differ and a single message would send the
owner hunting a network problem when the token is merely unset:

- **No token** — names `RENDERER_VITE_MAPBOX_TOKEN` explicitly. The owner is the developer here, so
  a vague message would cost them a search.
- **Unreachable** — points at the connection and states that allocation data is unaffected.

Both close by pointing at the breakdown below, which still carries the exact values. The state is
driven by the map's **error events, not a timeout**, so a slow connection never flashes it.

## Alternatives Considered

### Draw bubbles into the map canvas as a Mapbox layer

The idiomatic Mapbox approach, and it would scale to far more points. Rejected: it would destroy
the `<title>` tooltips that make a bubble identifiable, replacing them with popup handling the app
does not otherwise use — and with at most a few dozen countries, there is no performance pressure
to justify it.

### Mapbox `NavigationControl`

Less code. Rejected: an unstyled third-party control in a UI that has otherwise been kept
consistent, and it would silently change the interaction Story #70 established.

### A streets or satellite basemap

More detail. Rejected on legibility — see above; the sector palette must stay dominant.

### Bubbles over a blank canvas when offline

Considered as the degraded state: keep drawing positioned bubbles with no basemap behind them. The
owner chose the message instead — bubbles floating without geography are harder to read than an
honest "unavailable", and the geography donut already covers the offline case with exact values.

### Keep the silhouette as an offline fallback

Would preserve the offline guarantee entirely. Rejected by the owner: it means maintaining two
complete map implementations forever, for a case the donut already serves.

## Supersedes

[[0014-allocation-world-map-bubble-map]] — **on the basemap and projection only.** DDR-0014's data
semantics are carried forward intact and still govern this view: one bubble per issuer country,
area-proportional radius, the shared sector palette, and unplaceable countries surfaced in a
labelled `unknown` bucket rather than dropped.

## References

- [[0007-mapbox-basemap-and-renderer-network-policy]] — the companion ADR (dependency, CSP,
  telemetry, token, offline posture)
- [[0014-allocation-world-map-bubble-map]] — superseded on the basemap; data semantics retained
- [[0009-sector-classification-cache-and-allocation-donuts]] — where sector comes from
- [[0018-content-measure-and-chart-aspect]] — the frame's shared measure and aspect sizing
- [[0006-app-shell-tab-navigation]] — the inline-SVG chart convention this scopes an exception to
- GitHub Issues #89 (Story), #4 (Epic M3); prior rounds #46, #70, #71
