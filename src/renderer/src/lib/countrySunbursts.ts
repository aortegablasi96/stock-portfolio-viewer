/**
 * Pure transforms behind the Allocation map's per-country sunbursts (Milestone M4, Story #122;
 * DDR-0030, superseding DDR-0020 on the map's unit and on how the data is drawn).
 *
 * The map has drawn its data three ways. DDR-0014 gave each issuer country one value-sized bubble;
 * Story #71 split that bubble into sector wedges; DDR-0020 replaced the whole thing with one flat
 * circle per *holding*, fanned onto a spiral so holdings sharing a country stayed separately
 * hoverable. This module returns the unit to the **country** and makes each mark a **nested
 * sunburst**: an inner ring splitting the country by sector, an outer ring splitting it by holding,
 * with every holding wedge lying inside its own sector's arc.
 *
 * Four things follow from that choice, and all four live here:
 *
 * 1. **The spiral is gone.** One mark per country means no coincident points to pull apart, so the
 *    map stops fanning holdings into a rosette that looked like located companies. Positioning is
 *    still by issuer-country centroid, and still approximate — but it no longer *implies* more.
 * 2. **Nesting is the encoding.** A holding wedge's angular span is a share of its sector's span,
 *    not of the country, so reading outward answers "how much of this country is tech, and how much
 *    of that tech is one company?" without the two rings having to be mentally joined.
 * 3. **Small countries degrade to a dot.** Below `DOT_MAX_RADIUS` the two rings would each be a
 *    couple of pixels — unreadable, and worse, unhittable. Such a country is drawn as a plain disc
 *    that still opens a popup, rather than as rings that exist but cannot be used.
 * 4. **Every holding keeps a reachable sliver.** Raw value shares would give a holding worth 0.1%
 *    of its country a sub-pixel wedge, and a short (value ≤ 0) no wedge at all. `normalizedShares`
 *    lifts every share to a floor and renormalizes, so the ring stays honest to within a bounded
 *    distortion and nothing in it is impossible to hover.
 *
 * Output carries **colour classes, never colour values**, the seam every `lib/` chart helper keeps:
 * resolving `pie-series-3` needs `getComputedStyle`, which does not exist in Vitest's Node
 * environment. Unlike the canvas era, nothing downstream has to resolve them — marks are SVG
 * elements now, so a class on a `<path>` *is* the colour (DDR-0030).
 */
import type { AllocationPosition } from '@shared/domain/allocation'
import type { SectorPalette } from './sectorMap'
import { arcPath } from './pie'
import { divergingClass, returnPercent } from './gainLoss'
import { centroidFor } from './worldGeo'

/** Radius of the smallest country mark, in pixels. Also the hit-target floor for a dot. */
const R_MIN = 6

/**
 * Radius of the largest country mark. Higher than the per-holding era's 16 because one mark now
 * carries two rings and a hub, and lower than it could be because the dominant country would
 * otherwise cover its neighbours on a 3:1 frame.
 */
const R_MAX = 32

/**
 * Below this radius the rings are too thin to read or hit, and the mark degrades to a plain disc.
 * At exactly this radius each ring is a little over 4px — thin, but usable with a mouse.
 */
const DOT_MAX_RADIUS = 14

/** Hub radius, as a fraction of the mark's radius. The hub is the country-level hover target. */
const HUB_FRACTION = 0.28

/** Where the inner (sector) ring ends, as a fraction of the radius. */
const SECTOR_OUTER_FRACTION = 0.6

/** Where the outer (holding) ring begins. The gap to the sector ring is what reads as two rings. */
const HOLDING_INNER_FRACTION = 0.66

/**
 * Angular floor for one wedge, as a share of its ring. Guarantees a holding worth almost nothing —
 * or nothing at all — is still large enough to hover. Bounded distortion is the price, and it is
 * paid knowingly: the ring answers "what is in here?", and the figures come from the popup.
 */
const MIN_WEDGE_SHARE = 0.02

const FULL_TURN = 2 * Math.PI

/** One holding, as a wedge of the outer ring. */
export interface HoldingWedge {
  /** Stable key — the same identity the Positions table rows use. */
  id: string
  ticker: string
  /** Company name, straight from the broker. Unbounded: the popup clamps it. */
  name: string
  /**
   * The holding's **own** sector, not the palette's display grouping. A sector past the palette's
   * eight slots paints neutral but is still named honestly here — 'Other (2)' would be a lie in a
   * popup about one company. Empty when unclassified; the popup renders that as '—'.
   */
  sectorLabel: string
  /** Sector-mode colour class, shared with the holding's sector wedge and the Sector donut. */
  sectorClass: string
  /** Gain/loss-mode colour class, on the diverging return-on-cost scale (DDR-0021). */
  gainLossClass: string
  /** Unrealized return on cost, or `null` when there is no cost basis to measure against. */
  returnPercent: number | null
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
  /** SVG path for the wedge, in a coordinate system centred on (0, 0). */
  path: string
}

/** One sector within one country, as a wedge of the inner ring. */
export interface SectorWedge {
  /** The palette's display key — tail sectors share the grouped 'Other' key. */
  key: string
  label: string
  sectorClass: string
  gainLossClass: string
  returnPercent: number | null
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
  holdingCount: number
  path: string
}

/** One country's mark: a hub, a ring of sectors, and a ring of holdings nested inside them. */
export interface CountrySunburst {
  /** ISO 3166-1 alpha-2 code, as Flex reported it. */
  code: string
  /** Full country name — the popup has room, and 'NL' does not read. */
  countryName: string
  lon: number
  lat: number
  /** Outer radius in pixels. The mark's *area* is proportional to the country's market value. */
  r: number
  /** Hub radius — the country-level hover target at the centre of the mark. */
  rHub: number
  /**
   * True when the mark is too small to split into rings and is drawn as a plain disc instead.
   * `sectors` and `holdings` are still populated (the popup and the totals need them); they simply
   * carry no usable path.
   */
  dot: boolean
  /** Colour class for the disc when `dot` — the country's largest sector by value. */
  sectorClass: string
  gainLossClass: string
  returnPercent: number | null
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
  holdingCount: number
  /** Largest first, so a country's dominant sector always starts at 12 o'clock. */
  sectors: SectorWedge[]
  /** In ring order — grouped by sector, largest first within each. */
  holdings: HoldingWedge[]
}

/** Everything that couldn't be placed on the map, aggregated so nothing is dropped. */
export interface UnknownBucket {
  value: number
  percent: number
  /** How many country groups folded in here (missing country + unmappable codes). */
  count: number
}

export interface CountrySunbursts {
  /**
   * Largest value first. This is draw order *and* hit-test priority: SVG paints later siblings on
   * top, so the smallest marks end up above the largest ones they may sit near, and stay hoverable.
   */
  countries: CountrySunburst[]
  unknown: UnknownBucket
}

/**
 * Angular shares for one ring, each lifted to a floor and renormalized so they still sum to 1.
 *
 * Three cases are folded together deliberately. A ring whose values are all zero or negative — a
 * country holding only shorts — splits evenly rather than vanishing. A holding worth a rounding
 * error gets `floor` rather than a sub-pixel sliver. And the floor itself shrinks as the ring gets
 * busier (`0.5 / n`), so floors can never claim more than half the ring however many holdings share
 * it; past that point the wedges are genuinely too many to hover individually and honest
 * proportions matter more.
 */
export function normalizedShares(values: number[], minShare = MIN_WEDGE_SHARE): number[] {
  const n = values.length
  if (n === 0) return []

  const floor = Math.min(minShare, 0.5 / n)
  const positive = values.map((v) => Math.max(v, 0))
  const total = positive.reduce((sum, v) => sum + v, 0)
  const raw = total > 0 ? positive.map((v) => v / total) : positive.map(() => 1 / n)

  const lifted = raw.map((s) => Math.max(s, floor))
  const liftedTotal = lifted.reduce((sum, s) => sum + s, 0)
  return lifted.map((s) => s / liftedTotal)
}

/**
 * A ring segment between two angles (radians, clockwise from 12 o'clock), centred on the origin.
 *
 * A full turn is drawn as two half-arcs: an arc whose start and end coincide renders as nothing,
 * which would erase the most common mark on the map — a country holding exactly one position, whose
 * every ring is a complete circle. `lib/pie` handles the same case for the donuts.
 */
export function ringPath(rOuter: number, rInner: number, start: number, end: number): string {
  if (end - start >= FULL_TURN - 1e-9) {
    const mid = start + Math.PI
    return `${arcPath(0, 0, rOuter, rInner, start, mid)} ${arcPath(0, 0, rOuter, rInner, mid, end)}`
  }
  return arcPath(0, 0, rOuter, rInner, start, end)
}

/** Area-proportional radius (r ∝ √value) between R_MIN and R_MAX. */
function radiusFor(value: number, maxValue: number): number {
  const ratio = maxValue > 0 ? Math.sqrt(Math.max(value, 0) / maxValue) : 0
  return R_MIN + (R_MAX - R_MIN) * ratio
}

interface Totals {
  marketValueBase: number
  costBasisBase: number
  unrealizedPnlBase: number
  percentOfNav: number
}

function sumTotals(positions: AllocationPosition[]): Totals {
  return positions.reduce<Totals>(
    (acc, p) => ({
      marketValueBase: acc.marketValueBase + p.marketValueBase,
      costBasisBase: acc.costBasisBase + p.costBasisBase,
      unrealizedPnlBase: acc.unrealizedPnlBase + p.unrealizedPnlBase,
      percentOfNav: acc.percentOfNav + p.percentOfNav,
    }),
    { marketValueBase: 0, costBasisBase: 0, unrealizedPnlBase: 0, percentOfNav: 0 },
  )
}

/** Group a country's positions by the palette's *display* sector key, largest group first. */
function groupBySector(
  positions: AllocationPosition[],
  palette: SectorPalette,
): Array<{ key: string; positions: AllocationPosition[]; totals: Totals }> {
  const groups = new Map<string, AllocationPosition[]>()
  for (const p of positions) {
    const key = palette.displayKeyOf(p.sector)
    const group = groups.get(key) ?? []
    group.push(p)
    groups.set(key, group)
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      // Largest first within the sector, so the dominant holding leads its sector's arc.
      positions: [...group].sort((a, b) => b.marketValueBase - a.marketValueBase),
      totals: sumTotals(group),
    }))
    .sort((a, b) => b.totals.marketValueBase - a.totals.marketValueBase)
}

/**
 * Turn the report's positions into one nested sunburst per issuer country, plus an `unknown` bucket.
 *
 * A country with no centroid (missing or unrecognised code) folds into `unknown` — one count per
 * country group, the policy every prior round of this map used — rather than being dropped.
 */
export function countrySunbursts(
  positions: AllocationPosition[],
  palette: SectorPalette,
): CountrySunbursts {
  const byCountry = new Map<string, AllocationPosition[]>()
  for (const p of positions) {
    const group = byCountry.get(p.issuerCountry) ?? []
    group.push(p)
    byCountry.set(p.issuerCountry, group)
  }

  const unknown: UnknownBucket = { value: 0, percent: 0, count: 0 }
  const placeable: Array<{ code: string; group: AllocationPosition[]; totals: Totals }> = []

  for (const [code, group] of byCountry) {
    if (!centroidFor(code)) {
      for (const p of group) {
        unknown.value += p.marketValueBase
        unknown.percent += p.percentOfNav
      }
      unknown.count += 1
      continue
    }
    placeable.push({ code, group, totals: sumTotals(group) })
  }

  // Scale against the largest *placeable* country, so an unmappable giant can't flatten the map.
  const maxValue = placeable.reduce((max, c) => Math.max(max, c.totals.marketValueBase), 0)

  const countries = placeable.map(({ code, group, totals }) => {
    const centroid = centroidFor(code)!
    const r = radiusFor(totals.marketValueBase, maxValue)
    const dot = r < DOT_MAX_RADIUS
    const rHub = r * HUB_FRACTION
    const rSectorOuter = r * SECTOR_OUTER_FRACTION
    const rHoldingInner = r * HOLDING_INNER_FRACTION

    const groups = groupBySector(group, palette)
    const sectorShares = normalizedShares(groups.map((g) => g.totals.marketValueBase))

    const sectors: SectorWedge[] = []
    const holdings: HoldingWedge[] = []
    let angle = 0

    groups.forEach((g, i) => {
      const span = (sectorShares[i] ?? 0) * FULL_TURN
      const start = angle
      const end = start + span
      angle = end

      const sectorClass = palette.colorClassOf(g.key)
      const sectorReturn = returnPercent(g.totals.costBasisBase, g.totals.unrealizedPnlBase)
      sectors.push({
        key: g.key,
        label: palette.labelOf(g.key),
        sectorClass,
        gainLossClass: divergingClass(sectorReturn),
        returnPercent: sectorReturn,
        marketValueBase: g.totals.marketValueBase,
        unrealizedPnlBase: g.totals.unrealizedPnlBase,
        percentOfNav: g.totals.percentOfNav,
        holdingCount: g.positions.length,
        path: dot ? '' : ringPath(rSectorOuter, rHub, start, end),
      })

      // Holdings divide their *sector's* arc, not the country's — that nesting is the encoding.
      const holdingShares = normalizedShares(g.positions.map((p) => p.marketValueBase))
      let inner = start
      g.positions.forEach((p, j) => {
        const hSpan = (holdingShares[j] ?? 0) * span
        const hStart = inner
        const hEnd = hStart + hSpan
        inner = hEnd
        const pct = returnPercent(p.costBasisBase, p.unrealizedPnlBase)
        holdings.push({
          id: String(p.conid ?? p.symbol),
          ticker: p.symbol,
          name: p.description,
          sectorLabel: p.sector,
          sectorClass,
          gainLossClass: divergingClass(pct),
          returnPercent: pct,
          marketValueBase: p.marketValueBase,
          unrealizedPnlBase: p.unrealizedPnlBase,
          percentOfNav: p.percentOfNav,
          path: dot ? '' : ringPath(r, rHoldingInner, hStart, hEnd),
        })
      })
    })

    const countryReturn = returnPercent(totals.costBasisBase, totals.unrealizedPnlBase)
    return {
      code,
      countryName: centroid.name,
      lon: centroid.lon,
      lat: centroid.lat,
      r,
      rHub,
      dot,
      // A dot has one fill and must choose: the country's largest sector, which is the same hue its
      // inner ring would have led with.
      sectorClass: sectors[0]?.sectorClass ?? palette.colorClassOf(''),
      gainLossClass: divergingClass(countryReturn),
      returnPercent: countryReturn,
      marketValueBase: totals.marketValueBase,
      unrealizedPnlBase: totals.unrealizedPnlBase,
      percentOfNav: totals.percentOfNav,
      holdingCount: group.length,
      sectors,
      holdings,
    }
  })

  countries.sort((a, b) => b.marketValueBase - a.marketValueBase)
  return { countries, unknown }
}
