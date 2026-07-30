/**
 * Pure transforms behind the Allocation map's per-country donut pairs (Milestone M4, Story #122;
 * DDR-0030, superseding DDR-0020 on the map's unit and on how the data is drawn).
 *
 * The map has drawn its data several ways. DDR-0014 gave each issuer country one value-sized bubble;
 * Story #71 split that bubble into sector wedges; DDR-0020 replaced the whole thing with one flat
 * circle per *holding*, fanned onto a spiral so holdings sharing a country stayed separately
 * hoverable. This module returns the unit to the **country** and gives each one **two donuts side by
 * side**: the left splitting the country by holding, the right splitting the same country by sector.
 *
 * Four things follow from that choice, and all four live here:
 *
 * 1. **The spiral is gone.** One mark per country means no coincident points to pull apart, so the
 *    map stops fanning holdings into a rosette that looked like located companies. Positioning is
 *    still by issuer-country centroid, and still approximate — but it no longer *implies* more.
 * 2. **The two donuts colour independently.** Sector identity is global — the right donut uses the
 *    shared `sectorPalette`, so a sector wears one hue here, in the map legend, and in the Sector
 *    donut below. The left donut does not carry sector identity at all, because the donut beside it
 *    already does; its slices take the app's ordinary categorical donut palette by rank, which is
 *    what makes one holding distinguishable from the next. An earlier round tinted every holding
 *    with its sector's hue and the ring read as a single solid block.
 * 3. **The left donut folds its tail, exactly as every other donut in the app does.** Eight slots,
 *    seven named holdings plus an aggregated `Other (n)` — `lib/pie`'s rule, applied per country.
 *    Beyond eight, slices are too fine to hover and too many to colour without cycling hues.
 * 4. **Small countries degrade to a dot** and **every slice keeps a reachable sliver**. Below
 *    `DOT_MAX_RADIUS` a pair of donuts is a pair of smudges, so the country is drawn as one disc
 *    that still opens a popup. And raw value shares would give a holding worth 0.1% of its country
 *    a sub-pixel slice, and a short (value ≤ 0) none at all; `normalizedShares` lifts every share to
 *    a floor and renormalizes.
 *
 * Output carries **colour classes, never colour values**, the seam every `lib/` chart helper keeps:
 * resolving `pie-series-3` needs `getComputedStyle`, which does not exist in Vitest's Node
 * environment. Unlike the canvas era, nothing downstream has to resolve them — marks are SVG
 * elements now, so a class on a `<path>` *is* the colour (DDR-0030).
 */
import type { AllocationPosition } from '@shared/domain/allocation'
import type { SectorPalette } from './sectorMap'
import { arcPath, MAX_SLICES, OTHER_KEY, sliceColorClasses } from './pie'
import { divergingClass, returnPercent } from './gainLoss'
import { centroidFor } from './worldGeo'

/** Radius of each donut in the smallest country's pair. Also the hit-target floor for a dot. */
const R_MIN = 5

/**
 * Radius of each donut in the largest country's pair. Lower than a single mark could afford: the
 * pair spans roughly four radii plus a gap, and the dominant country must not cover its neighbours.
 */
const R_MAX = 24

/**
 * Below this radius a pair of donuts is a pair of smudges, and the mark degrades to a single disc.
 * A one-ring donut survives smaller than the nested rings an earlier round used, so this is lower.
 */
const DOT_MAX_RADIUS = 9

/** The donut hole, as a fraction of the radius — enough ring to read, enough hole to aim at. */
const HOLE_FRACTION = 0.46

/** Gap between the two donuts, as a fraction of one radius. Wide enough to read as two charts. */
const GAP_FRACTION = 0.34

/**
 * Angular floor for one slice, as a share of its donut. Guarantees a holding worth almost nothing —
 * or nothing at all — is still large enough to hover. Bounded distortion is the price, paid
 * knowingly: the donut answers "what is in here?", and the figures come from the popup.
 */
const MIN_SLICE_SHARE = 0.02

const FULL_TURN = 2 * Math.PI

/** Which donut of the pair a slice belongs to. */
export type DonutSide = 'holdings' | 'sectors'

/** One slice of one donut. */
export interface DonutSlice {
  /** Stable key within its donut — a conid/ticker, a sector display key, or the tail's own key. */
  key: string
  /** What the popup titles itself with: a ticker, a sector name, or `Other (n)`. */
  label: string
  /** Company name for a holding slice, straight from the broker. Empty for every other slice. */
  name: string
  /**
   * A holding's **own** sector, not the palette's display grouping — 'Other (2)' would be a lie in
   * a popup about one company. Empty for aggregate slices; the popup renders that as '—'.
   */
  sectorLabel: string
  /** Categorical colour class. Sector slices share the global palette; holdings are ranked locally. */
  colorClass: string
  /** Gain/loss-mode colour class, on the diverging return-on-cost scale (DDR-0021). */
  gainLossClass: string
  returnPercent: number | null
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
  /** Share of the country this slice's donut describes, as a percent — what the angle encodes. */
  percentOfCountry: number
  /** How many holdings the slice covers. 1 for a single holding; more for a sector or the tail. */
  holdingCount: number
  /** SVG path, in the pair's shared coordinate system (origin between the two donuts). */
  path: string
}

/** One country's mark: two donuts over the same holdings, split two ways. */
export interface CountryDonuts {
  /** ISO 3166-1 alpha-2 code, as Flex reported it. */
  code: string
  /** Full country name — the popup has room, and 'NL' does not read. */
  countryName: string
  lon: number
  lat: number
  /** Radius of each donut. The *pair's* area is proportional to the country's market value. */
  r: number
  /** Donut hole radius — the country-level hover target at the centre of each donut. */
  rHole: number
  /** Centre offset of each donut from the mark's origin: left sits at −this, right at +this. */
  cx: number
  /**
   * True when the mark is too small to draw as two donuts and is drawn as one disc instead.
   * The slices are still populated (the popup and the totals need them); they carry no path.
   */
  dot: boolean
  /** Colour class for the disc when `dot` — the country's largest sector, so it matches the legend. */
  colorClass: string
  gainLossClass: string
  returnPercent: number | null
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
  holdingCount: number
  /** Left donut — the country split by holding, largest first, tail folded into `Other (n)`. */
  holdings: DonutSlice[]
  /** Right donut — the same country split by sector, largest first. */
  sectors: DonutSlice[]
}

/** Everything that couldn't be placed on the map, aggregated so nothing is dropped. */
export interface UnknownBucket {
  value: number
  percent: number
  /** How many country groups folded in here (missing country + unmappable codes). */
  count: number
}

export interface CountryDonutMap {
  /**
   * Largest value first. This is draw order *and* hit-test priority: SVG paints later siblings on
   * top, so the smallest marks end up above the largest ones they may sit near, and stay hoverable.
   */
  countries: CountryDonuts[]
  unknown: UnknownBucket
}

/**
 * Angular shares for one donut, each lifted to a floor and renormalized so they still sum to 1.
 *
 * Three cases are folded together deliberately. A donut whose values are all zero or negative — a
 * country holding only shorts — splits evenly rather than vanishing. A holding worth a rounding
 * error gets `floor` rather than a sub-pixel sliver. And the floor itself shrinks as the donut gets
 * busier (`0.5 / n`), so floors can never claim more than half of it however many slices share it.
 */
export function normalizedShares(values: number[], minShare = MIN_SLICE_SHARE): number[] {
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
 * A donut segment between two angles (radians, clockwise from 12 o'clock), centred on `cx`.
 *
 * A full turn is drawn as two half-arcs: an arc whose start and end coincide renders as nothing,
 * which would erase the most common mark on the map — a country holding exactly one position, whose
 * every donut is a complete ring. `lib/pie` handles the same case for the view's own donuts.
 */
export function donutPath(
  cx: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  if (end - start >= FULL_TURN - 1e-9) {
    const mid = start + Math.PI
    return `${arcPath(cx, 0, rOuter, rInner, start, mid)} ${arcPath(cx, 0, rOuter, rInner, mid, end)}`
  }
  return arcPath(cx, 0, rOuter, rInner, start, end)
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
  holdingCount: number
}

function sumTotals(positions: AllocationPosition[]): Totals {
  return positions.reduce<Totals>(
    (acc, p) => ({
      marketValueBase: acc.marketValueBase + p.marketValueBase,
      costBasisBase: acc.costBasisBase + p.costBasisBase,
      unrealizedPnlBase: acc.unrealizedPnlBase + p.unrealizedPnlBase,
      percentOfNav: acc.percentOfNav + p.percentOfNav,
      holdingCount: acc.holdingCount + 1,
    }),
    {
      marketValueBase: 0,
      costBasisBase: 0,
      unrealizedPnlBase: 0,
      percentOfNav: 0,
      holdingCount: 0,
    },
  )
}

/** What a slice is built from, before it is given an angle and a path. */
interface SliceSeed {
  key: string
  label: string
  name: string
  sectorLabel: string
  totals: Totals
}

/**
 * The left donut's seeds: holdings largest-first, with everything past the palette's slots folded
 * into one `Other (n)`.
 *
 * Unlike `lib/pie`'s `groupTail`, a non-positive holding is **kept** rather than filtered out. A
 * short is a real position, it has to remain reachable, and `normalizedShares` is what gives it an
 * angle. It sorts last, so in a busy country it lands in the tail anyway.
 */
function holdingSeeds(positions: AllocationPosition[]): SliceSeed[] {
  const ordered = [...positions].sort((a, b) => b.marketValueBase - a.marketValueBase)
  const seedOf = (p: AllocationPosition): SliceSeed => ({
    key: String(p.conid ?? p.symbol),
    label: p.symbol,
    name: p.description,
    sectorLabel: p.sector,
    totals: sumTotals([p]),
  })

  if (ordered.length <= MAX_SLICES) return ordered.map(seedOf)

  const head = ordered.slice(0, MAX_SLICES - 1)
  const tail = ordered.slice(MAX_SLICES - 1)
  return [
    ...head.map(seedOf),
    {
      key: OTHER_KEY,
      label: `Other (${tail.length})`,
      name: '',
      sectorLabel: '',
      totals: sumTotals(tail),
    },
  ]
}

/** The right donut's seeds: the same holdings grouped by the palette's *display* sector key. */
function sectorSeeds(positions: AllocationPosition[], palette: SectorPalette): SliceSeed[] {
  const groups = new Map<string, AllocationPosition[]>()
  for (const p of positions) {
    const key = palette.displayKeyOf(p.sector)
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: palette.labelOf(key),
      name: '',
      sectorLabel: '',
      totals: sumTotals(group),
    }))
    .sort((a, b) => b.totals.marketValueBase - a.totals.marketValueBase)
}

/** Lay seeds out as one donut's slices, in order, filling the full turn. */
function layOut(
  seeds: SliceSeed[],
  colorClasses: string[],
  countryValue: number,
  cx: number,
  r: number,
  rHole: number,
  dot: boolean,
): DonutSlice[] {
  const shares = normalizedShares(seeds.map((s) => s.totals.marketValueBase))
  let angle = 0
  return seeds.map((seed, i) => {
    const span = (shares[i] ?? 0) * FULL_TURN
    const start = angle
    angle = start + span
    const pct = returnPercent(seed.totals.costBasisBase, seed.totals.unrealizedPnlBase)
    return {
      key: seed.key,
      label: seed.label,
      name: seed.name,
      sectorLabel: seed.sectorLabel,
      colorClass: colorClasses[i] ?? 'pie-series-neutral',
      gainLossClass: divergingClass(pct),
      returnPercent: pct,
      marketValueBase: seed.totals.marketValueBase,
      unrealizedPnlBase: seed.totals.unrealizedPnlBase,
      percentOfNav: seed.totals.percentOfNav,
      percentOfCountry:
        countryValue > 0 ? (seed.totals.marketValueBase / countryValue) * 100 : 0,
      holdingCount: seed.totals.holdingCount,
      path: dot ? '' : donutPath(cx, r, rHole, start, angle),
    }
  })
}

/**
 * Turn the report's positions into one donut pair per issuer country, plus an `unknown` bucket.
 *
 * A country with no centroid (missing or unrecognised code) folds into `unknown` — one count per
 * country group, the policy every prior round of this map used — rather than being dropped.
 */
export function countryDonuts(
  positions: AllocationPosition[],
  palette: SectorPalette,
): CountryDonutMap {
  const byCountry = new Map<string, AllocationPosition[]>()
  for (const p of positions) {
    byCountry.set(p.issuerCountry, [...(byCountry.get(p.issuerCountry) ?? []), p])
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
    const rHole = r * HOLE_FRACTION
    const cx = r + (r * GAP_FRACTION) / 2

    const hSeeds = holdingSeeds(group)
    const sSeeds = sectorSeeds(group, palette)
    const holdings = layOut(
      hSeeds,
      // The app's ordinary donut palette, assigned by rank within this country: the slices only
      // have to be told apart from each other, and the donut beside them carries sector identity.
      sliceColorClasses(hSeeds),
      totals.marketValueBase,
      -cx,
      r,
      rHole,
      dot,
    )
    const sectors = layOut(
      sSeeds,
      // The *shared* palette, so a sector wears one hue here, in the legend, and in the Sector donut.
      sSeeds.map((s) => palette.colorClassOf(s.key)),
      totals.marketValueBase,
      cx,
      r,
      rHole,
      dot,
    )

    const countryReturn = returnPercent(totals.costBasisBase, totals.unrealizedPnlBase)
    return {
      code,
      countryName: centroid.name,
      lon: centroid.lon,
      lat: centroid.lat,
      r,
      rHole,
      cx,
      dot,
      // A disc has one fill and must choose: the country's largest sector, which is the hue the
      // legend can explain.
      colorClass: sectors[0]?.colorClass ?? 'pie-series-neutral',
      gainLossClass: divergingClass(countryReturn),
      returnPercent: countryReturn,
      marketValueBase: totals.marketValueBase,
      unrealizedPnlBase: totals.unrealizedPnlBase,
      percentOfNav: totals.percentOfNav,
      holdingCount: group.length,
      holdings,
      sectors,
    }
  })

  countries.sort((a, b) => b.marketValueBase - a.marketValueBase)
  return { countries, unknown }
}
