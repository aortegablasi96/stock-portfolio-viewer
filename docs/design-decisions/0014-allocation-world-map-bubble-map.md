# 0014. Allocation view: geographic exposure as an equirectangular bubble map

- **Status:** Superseded by 0019 (basemap and projection only — the data semantics below still apply)
- **Date:** 2026-07-24

## Context

Story #46 (Epic #4, M3 refinement) asks the Allocation view for a **world map** that
highlights, at a glance, the countries where the owner holds assets, weighted by each
country's share of the portfolio.

The data already existed. `allocationService.getAllocation()` has produced a `byCountry`
breakdown since Story #22 ([[0005-analytics-read-model-and-base-currency-conversion]]): an
`AllocationSlice[]` keyed by the Flex `SecurityInfo.issuerCountryCode`, each slice carrying a
base-currency `marketValueBase` and a `percentOfNav`. That code is **ISO 3166-1 alpha-2**
(verified against the owner's 2025/2026 Portfolio Analyst exports: `US, CA, GB, DE, ES, IT,
JP`), and positions with no determinable issuer country already collect under the `''` key
labelled `Unknown`. So #46 needed **no new service, IPC channel, table, or domain schema** —
only a new way to draw `byCountry`.

The constraint that shapes the answer is the same one behind [[0006-app-shell-tab-navigation]]
and [[0009-sector-classification-cache-and-allocation-donuts]]: charts are dependency-free
inline SVG, the analytics views work fully offline, and new dependencies need clear long-term
value. A geographic visualization normally pulls in a projection/geo library and a bundled
country-polygon dataset; both were avoided.

## Decision

### An equirectangular bubble map, not a choropleth

The map is a faint world-land **silhouette** with one **circle per country** placed at that
country's centroid, radius area-proportional to market value. The owner chose this over a
per-country choropleth: it avoids committing a large per-country-shape SVG asset, and reads
naturally as "here's where my money is." A single equirectangular projection
(`projectEquirectangular`: `x = lon + 180`, `y = 90 − lat`, into a `360×180` frame) positions
both the silhouette and the circles, so they line up exactly with no runtime projection code.

### Geometry is bundled static data, generated once at author time

`src/renderer/src/lib/worldGeo.ts` holds two static constants, in the same spirit as the
validated categorical palette baked into `app.css`:

- `WORLD_SILHOUETTE_PATH` — a single SVG path, generated from public-domain **Natural Earth
  110m land** GeoJSON, simplified to ~0.1° and pre-projected into the frame (~54 KB). It is a
  faint backdrop only; identity comes from circle position and size, never the land shape.
- `COUNTRY_CENTROIDS` — a complete ISO alpha-2 → `{ name, lat, lon }` table (public-domain
  country centroids, 244 entries), so any country IBKR reports is placeable and gets a
  readable name for the tooltip.

Both were produced by a throwaway generator script (not shipped); the app carries no geo
dependency and does no network lookup to render the map — consistent with the offline stance
of every other analytics view.

### Unplaceable countries are surfaced, never dropped

`splitCountryBubbles(slices)` (pure, unit-tested) turns `byCountry` into `bubbles` plus a
single `unknown` bucket. A slice folds into `unknown` when its key is `''` **or** when the
code has no centroid — so an exotic or malformed country code is aggregated and labelled, not
silently discarded (an explicit acceptance criterion). The bucket renders as a legend chip
(`Unknown — €X (Y% of NAV)`) beside the map. Radius is `√(value / maxValue)` scaled between a
3–22 px band so a 4× holding reads as ~2× the radius; bubbles are drawn largest-first so
smaller ones stay on top and hoverable, each with a native `<title>` tooltip
(`name — value (% of NAV)`) matching `PieChart`.

### Placement: additive, alongside the existing geography donut

`BubbleMap` renders in a new full-width panel **above** the 2×2 breakdown grid; the "By
geography (issuer country)" donut stays in the grid. The map gives geographic intuition; the
donut keeps the exact ranked values. The view's existing `loading` / `error` / `needs_import`
branches short-circuit before the report renders, so the map degrades to the shared
needs-import empty state for free.

## Consequences

Benefits:

- A recognizable world map with zero new dependencies and no per-country choropleth asset.
- Renders fully offline from data the service already computed; no new pipeline.
- Reuses `report.byCountry` verbatim, so conversion, weighting, and the unknown handling stay
  identical to the donut — one source of truth for geography.

Tradeoffs:

- A ~54 KB silhouette string is bundled into the renderer. Accepted as static reference data,
  the same category as the palette, and far smaller than a choropleth's per-country paths.
- Nearby countries (Western Europe) overlap. Mitigated by semi-transparent fills, largest-first
  draw order, and per-circle tooltips; the positions table remains the exact-value view.
- Equirectangular stretches the poles, so Antarctica shows as a faint bottom band. Cosmetic and
  low-contrast; not worth clipping the projection frame for.

Risks:

- Centroids and land geometry are a point-in-time snapshot of public-domain data; they drift
  only with geopolitical change and can be regenerated. IBKR's `issuerCountryCode` is assumed
  ISO alpha-2 (verified on the owner's exports); an unexpected code degrades to the `unknown`
  bucket rather than misplacing a bubble.

## Alternatives Considered

### Per-country choropleth (shade each country's shape)

The most literal reading of "highlight the countries." Rejected by the owner: it requires
committing a large ISO-keyed per-country-path SVG (~150–250 KB) and reads no better than sized
bubbles for a handful of holdings.

### A charting/geo dependency (d3-geo, a map component)

Real projections and topology handling out of the box. Rejected: contradicts the
dependency-free inline-SVG stance ([[0006-app-shell-tab-navigation]]) for a single view, and a
fixed equirectangular projection is a two-line function.

### Replacing the geography donut with the map

Tighter layout, one geography visual. Rejected by the owner in favour of keeping the donut's
exact ranked values alongside the map's spatial intuition.

## References

- GitHub Story #46, Epic #4 (M3)
- [[0005-analytics-read-model-and-base-currency-conversion]]
- [[0006-app-shell-tab-navigation]]
- [[0009-sector-classification-cache-and-allocation-donuts]]
- Natural Earth (public domain, 110m land); public-domain country centroid dataset
