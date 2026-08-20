/**
 * Pure transforms behind the Allocation map's per-country donut pairs (Milestone M4, Story #122;
 * DDR-0030, superseding DDR-0020 on the map's unit and on how the data is drawn).
 *
 * Each issuer country carries **two donuts side by side**, the same form the Allocation view's own
 * breakdown charts use, so the map and the panels below it read as one chart language:
 *
 * - **Left, the country's weight in the portfolio:** two slices — the country's share of NAV in
 *   blue, and the rest of the portfolio muted behind it. An absolute 0–100% scale, not one relative
 *   to the largest country, so the same arc means the same weight in every session.
 * - **Right, the country split by sector:** one slice per sector, each in its own hue from the
 *   shared `sectorPalette`.
 *
 * **Neither donut needs a colour it cannot afford, and that is why this form works.** Two earlier
 * rounds of this story failed on exactly that. A nested sunburst forced every holding to wear its
 * sector's hue and rendered as one solid block; a holdings donut needed eight distinguishable
 * categorical hues on a 40px mark. Here the left donut shows one number, so it needs one colour, and
 * the right donut shows sectors, which already have a palette the map's legend explains.
 *
 * The cost is recorded in DDR-0030 rather than hidden: **holdings are not on the map**. This retires
 * the per-holding granularity DDR-0020 introduced. The map answers *where, and in what* — the
 * Positions table is where one company's figures are read.
 *
 * **A mark still says which companies it covers** (Story #223, DDR-0074). That is not the granularity
 * DDR-0030 retired: no holding gets a mark, an arc or a colour of its own, and no per-holding figure
 * is added. What each mark and each sector slice carries is a **bounded list of names** — the
 * `holdings` field below — which the popup prints as a row of chips so hovering answers "which of my
 * companies is this?" without a trip to the table. Bounded because the popup may not grow taller than
 * the map that carries it: {@link MAX_NAMED_HOLDINGS} are named, largest market value first, and
 * whatever is left is stated as a count rather than dropped.
 *
 * The name comes from {@link instrumentName} and never from `formatCompanyName` (DDR-0066, DDR-0067):
 * IBKR writes the identifier again where an instrument has none, and title-casing that produces
 * `Cad`. A holding with no name of its own therefore carries `name: null`, and the chip is its
 * symbol alone.
 *
 * Output carries **colour classes, never colour values**, the seam every `lib/` chart helper keeps:
 * resolving `pie-series-3` needs `getComputedStyle`, which does not exist in Vitest's Node
 * environment. Nothing downstream has to resolve them — marks are SVG, so a class on a `<path>` *is*
 * the colour (DDR-0030).
 */
import type { AllocationPosition } from '@shared/domain/allocation'
import type { SectorPalette } from './sectorMap'
import { arcPath, fullRingPath } from './pie'
import { instrumentName } from './format'
import { returnPercent } from './gainLoss'
import { centroidFor } from './worldGeo'

/** Radius of each donut in the smallest country's pair. Also the hit-target floor for a disc. */
const R_MIN = 5

/**
 * Radius of each donut in the largest country's pair. The pair spans roughly four radii plus a gap,
 * so this is where the dominant country stops covering its neighbours.
 */
const R_MAX = 25

/** Below this radius a pair of donuts is a pair of smudges, and the mark degrades to one disc. */
const DOT_MAX_RADIUS = 8

/** Gap between the two donuts, as a fraction of one radius. Wide enough to read as two charts. */
const GAP_FRACTION = 0.34

/** The donut hole, as a fraction of the radius — enough ring to read, enough hole to read as a donut. */
const HOLE_FRACTION = 0.5

/**
 * Angular floor for one slice, as a share of its donut. A sector worth almost nothing would sweep a
 * sub-degree arc and be impossible to hover. Bounded distortion is the price, paid knowingly: the
 * donut answers "what is in here?", and the figures come from the popup.
 */
const MIN_SLICE_SHARE = 0.02

const FULL_TURN = 2 * Math.PI

/**
 * How many instruments a mark or a sector slice names before the rest becomes a count
 * (Story #223, DDR-0074).
 *
 * A bound rather than a scroll or a clamp, because the popup is hover-only and pointer-transparent:
 * nothing in it can be reached, so anything that overflows is simply lost. Four is what keeps the
 * tallest popup — a six-row sector card — inside the map frame it floats over, and it is stated
 * here rather than in the stylesheet because the *arithmetic* is what bounds the height.
 */
export const MAX_NAMED_HOLDINGS = 4

/** One instrument named on a mark. */
export interface HeldInstrument {
  symbol: string
  /**
   * The readable company name, or `null` where the import carries none — a currency pair or a bare
   * code, where IBKR's description is the identifier again (DDR-0066). The chip is then the symbol
   * alone rather than the same text twice.
   */
  name: string | null
}

/** The instruments a mark or a slice covers, bounded so a popup cannot outgrow the map. */
export interface HeldInstruments {
  /** Largest market value first, at most {@link MAX_NAMED_HOLDINGS} of them. */
  named: HeldInstrument[]
  /** How many holdings are covered but not named. `0` when every one of them is listed. */
  remainder: number
}

/** Which donut of the pair a slice belongs to. */
export type DonutSide = 'weight' | 'sectors'

/** The colour class the country's weight slice always wears — the palette's magnitude slot. */
export const WEIGHT_COLOR_CLASS = 'pie-series-1'

/** Keys for the left donut's two slices. */
export const WEIGHT_KEY = '__weight__'
export const REST_KEY = '__rest__'

/** One slice of one donut. */
export interface DonutSlice {
  /** Stable key within its donut — a sector display key, or one of the two weight-donut keys. */
  key: string
  /** What the popup titles itself with: a sector name, or the country for the weight slice. */
  label: string
  /** Categorical colour class. Blue for the country's weight, the shared palette for a sector. */
  colorClass: string
  returnPercent: number | null
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
  /** Share of the country, as a percent. What a sector slice's angle encodes. */
  percentOfCountry: number
  /** How many holdings the slice covers. */
  holdingCount: number
  /** Which instruments those are, bounded and largest first (Story #223). */
  holdings: HeldInstruments
  /** SVG path, in the pair's shared coordinate system (origin between the two donuts). */
  path: string
}

/** One country's mark: a weight donut and a sector donut, side by side. */
export interface CountryDonuts {
  /** ISO 3166-1 alpha-2 code, as Flex reported it. */
  code: string
  /** Full country name — the popup has room, and 'NL' does not read. */
  countryName: string
  lon: number
  lat: number
  /** Radius of each donut. The *pair's* area is proportional to the country's market value. */
  r: number
  /** The donut hole radius. */
  rHole: number
  /** Centre offset of each donut from the mark's origin: left at −this, right at +this. */
  cx: number
  /**
   * True when the mark is too small to draw as a pair and is drawn as one disc instead. The slices
   * are still populated (the popup and totals need them); they carry no paths.
   */
  dot: boolean
  /** Colour class for the disc when `dot` — the country's largest sector, which the legend explains. */
  colorClass: string
  returnPercent: number | null
  marketValueBase: number
  unrealizedPnlBase: number
  percentOfNav: number
  holdingCount: number
  /** Which instruments the country holds, bounded and largest first (Story #223). */
  holdings: HeldInstruments
  /** Left donut: the country's share of NAV in blue, then the rest of the portfolio. */
  weight: DonutSlice[]
  /** Right donut: one slice per sector, largest first. */
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
 * country holding only shorts — splits evenly rather than vanishing. A sector worth a rounding error
 * gets `floor` rather than a sub-pixel sliver. And the floor itself shrinks as the donut gets busier
 * (`0.5 / n`), so floors can never claim more than half of it.
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
 * A full turn becomes a **seamless ring**, not a segment: a segment carries straight radial edges,
 * and the slice stroke would paint them as two seams that look like divisions but represent
 * nothing. This is the common case on this map — a country holding one sector, or one whose weight
 * rounds to the whole portfolio — so it is worth getting right. See `fullRingPath` in `lib/pie`,
 * which the view's own donuts share.
 */
export function donutPath(
  cx: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  if (end - start >= FULL_TURN - 1e-9) return fullRingPath(cx, 0, rOuter, rInner)
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

/**
 * The instruments in a group, bounded and largest first (Story #223, DDR-0074).
 *
 * Ordered by market value rather than alphabetically, because the bound has to cut somewhere and
 * the four it keeps should be the four that account for most of the arc. The remainder is a count,
 * not a silent truncation: `+3 more` says the mark covers more than it names.
 *
 * The source list is copied before sorting — `positions` belongs to the report the view is still
 * rendering from, and `Array.prototype.sort` is in place.
 */
function nameHoldings(positions: AllocationPosition[]): HeldInstruments {
  const ordered = [...positions].sort((a, b) => b.marketValueBase - a.marketValueBase)
  return {
    named: ordered.slice(0, MAX_NAMED_HOLDINGS).map((p) => ({
      symbol: p.symbol,
      // Never `formatCompanyName`: it assumes its input is a company name, and a description that
      // merely repeats the symbol title-cases into `Cad` (DDR-0066, DDR-0067).
      name: instrumentName(p.symbol, p.description),
    })),
    remainder: Math.max(0, ordered.length - MAX_NAMED_HOLDINGS),
  }
}

/** What a slice is built from, before it is given an angle and a path. */
interface SliceSeed {
  key: string
  label: string
  colorClass: string
  totals: Totals
  percentOfCountry: number
  holdings: HeldInstruments
}

/** Lay seeds out as one donut's slices, in order, filling the full turn. */
function layOut(
  seeds: SliceSeed[],
  shares: number[],
  cx: number,
  r: number,
  rHole: number,
  dot: boolean,
): DonutSlice[] {
  let angle = 0
  return seeds.map((seed, i) => {
    const span = (shares[i] ?? 0) * FULL_TURN
    const start = angle
    angle = start + span
    const pct = returnPercent(seed.totals.costBasisBase, seed.totals.unrealizedPnlBase)
    return {
      key: seed.key,
      label: seed.label,
      colorClass: seed.colorClass,
      returnPercent: pct,
      marketValueBase: seed.totals.marketValueBase,
      unrealizedPnlBase: seed.totals.unrealizedPnlBase,
      percentOfNav: seed.totals.percentOfNav,
      percentOfCountry: seed.percentOfCountry,
      holdingCount: seed.totals.holdingCount,
      holdings: seed.holdings,
      path: dot ? '' : donutPath(cx, r, rHole, start, angle),
    }
  })
}

/** The right donut's seeds: the country's positions grouped by the palette's display sector key. */
function sectorSeeds(
  positions: AllocationPosition[],
  palette: SectorPalette,
  countryValue: number,
): SliceSeed[] {
  const groups = new Map<string, AllocationPosition[]>()
  for (const p of positions) {
    const key = palette.displayKeyOf(p.sector)
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const totals = sumTotals(group)
      return {
        key,
        label: palette.labelOf(key),
        colorClass: palette.colorClassOf(key),
        totals,
        percentOfCountry: countryValue > 0 ? (totals.marketValueBase / countryValue) * 100 : 0,
        holdings: nameHoldings(group),
      }
    })
    .sort((a, b) => b.totals.marketValueBase - a.totals.marketValueBase)
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
    const countryReturn = returnPercent(totals.costBasisBase, totals.unrealizedPnlBase)
    const holdings = nameHoldings(group)

    // --- Left: the country's share of NAV, against the rest of the portfolio ------------
    // Clamped because `percentOfNav` is IBKR's own figure and a rounding artefact above 100 would
    // wrap the slice onto itself; the remainder is whatever is left of the portfolio.
    const share = Math.min(1, Math.max(0, totals.percentOfNav / 100))
    const weight = layOut(
      [
        {
          key: WEIGHT_KEY,
          label: centroid.name,
          colorClass: WEIGHT_COLOR_CLASS,
          totals,
          percentOfCountry: 100,
          holdings,
        },
        {
          key: REST_KEY,
          label: 'Rest of portfolio',
          colorClass: 'map-rest',
          totals: {
            marketValueBase: 0,
            costBasisBase: 0,
            unrealizedPnlBase: 0,
            percentOfNav: 100 - totals.percentOfNav,
            holdingCount: 0,
          },
          percentOfCountry: 0,
          // The remainder is the portfolio held *elsewhere*, and this map has no list of it: it is
          // context for the blue arc, not a subject. Both weight slices open the country anyway.
          holdings: { named: [], remainder: 0 },
        },
      ],
      // Not `normalizedShares`: this donut is an absolute 0–100% scale, so a country worth 3% of NAV
      // must draw a 3% arc. Flooring it would overstate the small countries, which is the one thing
      // this chart exists to report honestly.
      [share, 1 - share],
      -cx,
      r,
      rHole,
      dot,
    )

    // --- Right: one slice per sector ----------------------------------------------------
    const seeds = sectorSeeds(group, palette, totals.marketValueBase)
    const sectors = layOut(
      seeds,
      normalizedShares(seeds.map((s) => s.totals.marketValueBase)),
      cx,
      r,
      rHole,
      dot,
    )

    return {
      code,
      countryName: centroid.name,
      lon: centroid.lon,
      lat: centroid.lat,
      r,
      rHole,
      cx,
      dot,
      // A disc has one fill and must choose: the country's largest sector, the hue the legend
      // explains. Deliberately not the weight blue, which would say nothing about what is held.
      colorClass: sectors[0]?.colorClass ?? 'pie-series-neutral',
      returnPercent: countryReturn,
      marketValueBase: totals.marketValueBase,
      unrealizedPnlBase: totals.unrealizedPnlBase,
      percentOfNav: totals.percentOfNav,
      holdingCount: group.length,
      holdings,
      weight,
      sectors,
    }
  })

  countries.sort((a, b) => b.marketValueBase - a.marketValueBase)
  return { countries, unknown }
}
