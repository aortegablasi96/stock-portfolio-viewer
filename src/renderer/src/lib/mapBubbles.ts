/**
 * Pure transforms behind the Allocation map's per-position bubbles (Milestone M3, Story #92;
 * DDR-0020, superseding DDR-0019 on how the data is drawn).
 *
 * The map used to draw one bubble per issuer *country*, split into sector wedges (Stories #46,
 * #71). It now draws one bubble per **holding**, so the owner can identify and assess a single
 * company from the map instead of reading a country total and going to the table for the detail.
 *
 * Two consequences follow, and both live here:
 *
 * 1. **Sector becomes a fill colour, not a wedge.** A Mapbox circle layer paints one fill per
 *    feature, so the wedge geometry has no canvas equivalent. Colour identity is unchanged —
 *    it still comes from `sectorPalette`, so a sector wears one hue on the map, in the map's
 *    legend, and in the Sector donut.
 * 2. **Holdings in a country must be pulled apart.** Every position in a country resolves to the
 *    same ISO centroid, and coincident points never separate — no amount of zooming distinguishes
 *    two circles at identical coordinates. `spreadOffset` fans them onto a phyllotaxis spiral in
 *    *geographic degrees*, which separates progressively as the map zooms in without this module
 *    knowing anything about zoom.
 *
 * The map therefore becomes explicitly **approximate**: a bubble sits *near* its issuer country,
 * not at a company's location. It was already approximate — a centroid is not where a company is —
 * and the view says so in its hint copy rather than letting the fan imply precision.
 *
 * Output carries **colour classes, never colour values**. Resolving `pie-series-N` to a hex needs
 * `getComputedStyle`, which does not exist in Vitest's Node environment; keeping the seam here is
 * what lets every bit of geometry below be unit-tested. The component resolves classes to values
 * when it builds the paint expression.
 */
import type { AllocationPosition } from '@shared/domain/allocation'
import type { SectorPalette } from './sectorMap'
import { divergingClass, returnPercent } from './gainLoss'
import { centroidFor } from './worldGeo'

/** Pixel radius of the smallest bubble. Also the hit-target floor — a 3px circle is a poor
 *  target even with a mouse, and every holding has to be reachable. */
const R_MIN = 4

/** Pixel radius of the largest bubble. Lower than the country era's 22: per-company bubbles are
 *  far more numerous, and a giant crowds its neighbours out of reach. */
const R_MAX = 16

/**
 * Spiral spacing, in degrees. The rosette grows as √n, so a country's fan widens with how much is
 * held there without a count ever being consulted directly.
 */
const SPREAD_STEP_DEG = 1.6

/**
 * How far a holding may drift from its country's centroid. Beyond this the outer holdings ring at
 * a constant radius rather than wandering into a neighbouring country — a denser rosette is the
 * lesser evil against a bubble that appears to be held somewhere it isn't.
 */
const SPREAD_MAX_DEG = 7

/** The golden angle — successive points land in the least-overlapping direction available. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Floor on cos(latitude) when converting a spiral radius into longitude. Guards the poles, where
 * the correction below divides by something approaching zero. No centroid is polar; this is
 * defensive rather than load-bearing.
 */
const COS_LAT_FLOOR = 0.2

/** One holding, ready to become a GeoJSON feature. */
export interface PositionBubble {
  /** Stable feature id — the same key the Positions table uses for its rows. */
  id: string
  ticker: string
  /** Company name, straight from the broker. Unbounded: the popup clamps it. */
  name: string
  /** Full country name (not the two-letter code) — the popup has room and 'NL' does not read. */
  countryName: string
  /**
   * The position's **own** sector, not the palette's display grouping. A sector past the palette's
   * eight slots is coloured neutral but still named honestly here — 'Other (2)' would be a lie in
   * a popup about one company. Empty when unclassified; the view renders that as '—'.
   */
  sectorLabel: string
  /** Sector-mode colour, e.g. `pie-series-3`. The component resolves it — see the docblock. */
  sectorClass: string
  /** Gain/loss-mode colour, e.g. `map-diverge-6` (Story #95). Resolved the same way. */
  gainLossClass: string
  /**
   * Unrealized return as a percent of cost basis, or `null` when there is no cost basis to
   * measure against. Carried so the popup can state the figure the gain/loss colour encodes —
   * the neutral step means "flat *or* unknown", and colour alone can't tell them apart.
   */
  returnPercent: number | null
  lon: number
  lat: number
  r: number
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
}

/** Everything that couldn't be placed on the map, aggregated so nothing is dropped. */
export interface UnknownBucket {
  value: number
  percent: number
  /** How many country groups folded in here (missing country + unmappable codes). */
  count: number
}

export interface PositionBubbles {
  /**
   * Largest value first. This is draw order *and* hit-test priority: later features paint on top,
   * and `queryRenderedFeatures` returns the topmost — so smaller bubbles stay both visible and
   * hoverable over the larger ones they sit near.
   */
  bubbles: PositionBubble[]
  unknown: UnknownBucket
}

/**
 * Offset for the `i`-th holding of a country, in degrees, on a phyllotaxis spiral.
 *
 * `i = 0` returns no offset at all, so a country holding one position keeps sitting exactly on its
 * centroid — the common case behaves as it always has.
 *
 * The longitude offset is divided by cos(latitude) because a degree of longitude covers far less
 * ground at 60°N than at the equator; without the correction a Nordic rosette renders visibly
 * squashed against an equatorial one.
 */
export function spreadOffset(i: number, lat: number): { dLon: number; dLat: number } {
  if (i <= 0) return { dLon: 0, dLat: 0 }
  const rho = Math.min(SPREAD_STEP_DEG * Math.sqrt(i), SPREAD_MAX_DEG)
  const theta = i * GOLDEN_ANGLE
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), COS_LAT_FLOOR)
  return { dLon: (rho * Math.cos(theta)) / cosLat, dLat: rho * Math.sin(theta) }
}

/** Area-proportional radius (r ∝ √value) between R_MIN and R_MAX. */
function radiusFor(value: number, maxValue: number): number {
  const ratio = maxValue > 0 ? Math.sqrt(Math.max(value, 0) / maxValue) : 0
  return R_MIN + (R_MAX - R_MIN) * ratio
}

/**
 * Turn the report's positions into one bubble per holding, plus an `unknown` bucket.
 *
 * Positions are grouped by issuer country only to assign spiral positions; a country with no
 * centroid (missing or unrecognised code) folds into `unknown` — one count per country group,
 * matching the policy every prior round of this map used — rather than being dropped.
 *
 * A position with a zero or negative market value (a short) still becomes a bubble, at R_MIN: it
 * cannot be sized proportionally, but it is a real holding and must stay reachable.
 */
export function positionBubbles(
  positions: AllocationPosition[],
  palette: SectorPalette,
): PositionBubbles {
  const byCountry = new Map<string, AllocationPosition[]>()
  for (const p of positions) {
    const group = byCountry.get(p.issuerCountry) ?? []
    group.push(p)
    byCountry.set(p.issuerCountry, group)
  }

  const unknown: UnknownBucket = { value: 0, percent: 0, count: 0 }
  const bubbles: PositionBubble[] = []
  // Scale against the largest *placeable* holding, so an unmappable giant can't flatten the map.
  let maxValue = 0
  for (const [code, group] of byCountry) {
    if (centroidFor(code)) {
      for (const p of group) maxValue = Math.max(maxValue, p.marketValueBase)
    }
  }

  for (const [code, group] of byCountry) {
    const centroid = centroidFor(code)
    if (!centroid) {
      for (const p of group) {
        unknown.value += p.marketValueBase
        unknown.percent += p.percentOfNav
      }
      unknown.count += 1
      continue
    }

    // Largest first, so the biggest holding takes the spiral's centre and the country's mass sits
    // where the centroid actually is.
    const ordered = [...group].sort((a, b) => b.marketValueBase - a.marketValueBase)
    ordered.forEach((p, i) => {
      const { dLon, dLat } = spreadOffset(i, centroid.lat)
      const pct = returnPercent(p.costBasisBase, p.unrealizedPnlBase)
      bubbles.push({
        id: String(p.conid ?? p.symbol),
        ticker: p.symbol,
        name: p.description,
        countryName: centroid.name,
        sectorLabel: p.sector,
        sectorClass: palette.colorClassOf(palette.displayKeyOf(p.sector)),
        gainLossClass: divergingClass(pct),
        returnPercent: pct,
        lon: centroid.lon + dLon,
        lat: centroid.lat + dLat,
        r: radiusFor(p.marketValueBase, maxValue),
        marketValueBase: p.marketValueBase,
        unrealizedPnlBase: p.unrealizedPnlBase,
        percentOfNav: p.percentOfNav,
      })
    })
  }

  bubbles.sort((a, b) => b.marketValueBase - a.marketValueBase)
  return { bubbles, unknown }
}
