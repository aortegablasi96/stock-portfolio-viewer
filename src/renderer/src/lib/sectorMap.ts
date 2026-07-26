/**
 * Pure transforms behind the Allocation world map's sector segmentation (Story #71).
 *
 * The map already places one bubble per issuer country (Story #46). This story splits each
 * bubble into sector wedges so the owner can read how their holdings' sectors are distributed
 * across geography. Sector comes from the local classification cache (Story #30, DDR-0009), so
 * a position may legitimately be unclassified.
 *
 * Everything here is derived in the renderer from `report.positions` (which already carry
 * `issuerCountry`, `sector` and the base-currency value) plus `report.bySector` (for a stable,
 * donut-matching colour assignment) — nothing below the renderer changes and the map still
 * renders offline from imported data. Kept out of the component so the country grouping, wedge
 * aggregation, colour matching and radius scaling are unit-tested directly, the way the other
 * `lib/` helpers are.
 *
 * Colour identity is shared with the Sector donut: the wedge palette is built from the same
 * `groupTail` + `sliceColorClasses` pipeline (`lib/pie`), so a sector wears the same hue on the
 * map, in the donut, and in the map's own legend. Sectors past the palette's eight slots fold
 * into a neutral 'Other', exactly as the donut folds its tail; unclassified positions share that
 * neutral rather than consuming a categorical hue.
 */
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { groupTail, OTHER_KEY, sliceColorClasses, toArcs, type PieDatum } from './pie'
import { centroidFor, type Centroid, projectEquirectangular } from './worldGeo'

const NEUTRAL_CLASS = 'pie-series-neutral'

/** One entry of the map's shared sector legend — matches the Sector donut's slices. */
export interface SectorLegendEntry {
  key: string
  label: string
  colorClass: string
}

/**
 * A stable sector → colour assignment shared by the map wedges and the map legend. Built once
 * from `report.bySector` so it matches the Sector donut, then applied per country. Sectors
 * outside the palette's slots collapse to a neutral 'Other'; unclassified ('') is neutral too.
 */
export interface SectorPalette {
  /** Grouped, coloured sector list (the donut's slices) — rendered as the map legend. */
  legend: SectorLegendEntry[]
  /** Map any raw sector key to the legend key it displays as (tail sectors → 'Other'). */
  displayKeyOf: (rawSectorKey: string) => string
  /** Colour class for a display key (neutral for 'Other', unclassified, or anything unknown). */
  colorClassOf: (displayKey: string) => string
  /** Friendly label for a display key. */
  labelOf: (displayKey: string) => string
}

function toPieData(bySector: AllocationSlice[]): PieDatum[] {
  return bySector.map((s) => ({
    key: s.key,
    label: s.label,
    value: s.marketValueBase,
    percent: s.percentOfNav,
  }))
}

/** Build the shared sector palette from the allocation report's `bySector` breakdown. */
export function sectorPalette(bySector: AllocationSlice[]): SectorPalette {
  const grouped = groupTail(toPieData(bySector))
  const classes = sliceColorClasses(grouped)
  const colorByKey = new Map<string, string>()
  const labelByKey = new Map<string, string>()
  const legend: SectorLegendEntry[] = grouped.map((g, i) => {
    const colorClass = classes[i] ?? NEUTRAL_CLASS
    colorByKey.set(g.key, colorClass)
    labelByKey.set(g.key, g.label)
    return { key: g.key, label: g.label, colorClass }
  })
  const known = new Set(grouped.map((g) => g.key))

  return {
    legend,
    displayKeyOf: (raw) => (known.has(raw) ? raw : OTHER_KEY),
    colorClassOf: (key) => colorByKey.get(key) ?? NEUTRAL_CLASS,
    labelOf: (key) => labelByKey.get(key) ?? (key === OTHER_KEY ? 'Other' : key || 'Unclassified'),
  }
}

/** One sector wedge of a country bubble, pre-laid-out as an SVG pie path. */
export interface SectorWedge {
  key: string
  label: string
  value: number
  /** Share of NAV (percent) for this sector within the country. */
  percent: number
  colorClass: string
  /** SVG path for the wedge, a full pie slice (inner radius 0) of the country bubble. */
  path: string
}

/** One country bubble, sized by total value and split into sector wedges. */
export interface SectorBubble {
  code: string
  name: string
  x: number
  y: number
  /** Total base-currency market value held in this country. */
  value: number
  /** Total share of NAV (percent) held in this country. */
  percent: number
  r: number
  wedges: SectorWedge[]
}

/** Everything that couldn't be placed on the map, aggregated so nothing is dropped. */
export interface UnknownBucket {
  value: number
  percent: number
  /** How many country groups folded in here (missing country + unmappable codes). */
  count: number
}

export interface SectorBubbles {
  bubbles: SectorBubble[]
  unknown: UnknownBucket
}

const R_MIN = 3
const R_MAX = 22

/** Area-proportional radius (r ∝ √value) between R_MIN and R_MAX. */
function radiusFor(value: number, maxValue: number): number {
  const ratio = maxValue > 0 ? Math.sqrt(Math.max(value, 0) / maxValue) : 0
  return R_MIN + (R_MAX - R_MIN) * ratio
}

/**
 * Aggregate a country's positions into sector wedges laid out as pie slices of its bubble.
 * Positions are grouped by their palette display key (so at most one wedge per legend entry),
 * value-sorted with the neutral bucket last so hues lead, then turned into arc paths. Only
 * positive-valued wedges are drawn (a short/zero position can't own an angular share).
 */
function buildWedges(
  positions: AllocationPosition[],
  palette: SectorPalette,
  cx: number,
  cy: number,
  r: number,
): SectorWedge[] {
  const byKey = new Map<string, { value: number; percent: number }>()
  for (const p of positions) {
    const key = palette.displayKeyOf(p.sector)
    const agg = byKey.get(key) ?? { value: 0, percent: 0 }
    agg.value += p.marketValueBase
    agg.percent += p.percentOfNav
    byKey.set(key, agg)
  }

  const data: (PieDatum & { colorClass: string })[] = [...byKey.entries()]
    .map(([key, agg]) => ({
      key,
      label: palette.labelOf(key),
      value: agg.value,
      percent: agg.percent,
      colorClass: palette.colorClassOf(key),
    }))
    .filter((d) => d.value > 0)
    .sort((a, b) => {
      const ra = a.colorClass === NEUTRAL_CLASS ? 1 : 0
      const rb = b.colorClass === NEUTRAL_CLASS ? 1 : 0
      return ra !== rb ? ra - rb : b.value - a.value
    })

  const arcs = toArcs(data, cx, cy, r, 0)
  return arcs.map((arc, i) => ({
    key: arc.key,
    label: arc.label,
    value: arc.value,
    percent: arc.percent,
    colorClass: data[i]!.colorClass,
    path: arc.path,
  }))
}

/**
 * Turn the report's positions into sector-segmented country bubbles plus an `unknown` bucket.
 *
 * Positions are grouped by issuer country; a country with a centroid becomes a bubble at its
 * projected centroid, its radius area-proportional to the country's total value, split into
 * sector wedges. Positions whose country is missing ('') or has no centroid are folded into
 * `unknown` (one count per country group) rather than dropped — the same policy the country-only
 * map used. Bubbles are returned largest-first so smaller circles stay on top and hoverable.
 */
export function splitSectorBubbles(
  positions: AllocationPosition[],
  palette: SectorPalette,
): SectorBubbles {
  const byCountry = new Map<string, AllocationPosition[]>()
  for (const p of positions) {
    const arr = byCountry.get(p.issuerCountry) ?? []
    arr.push(p)
    byCountry.set(p.issuerCountry, arr)
  }

  const placeable: { code: string; centroid: Centroid; positions: AllocationPosition[] }[] = []
  const unknown: UnknownBucket = { value: 0, percent: 0, count: 0 }

  for (const [code, ps] of byCountry) {
    const centroid = centroidFor(code)
    if (centroid) {
      placeable.push({ code, centroid, positions: ps })
    } else {
      for (const p of ps) {
        unknown.value += p.marketValueBase
        unknown.percent += p.percentOfNav
      }
      unknown.count += 1
    }
  }

  const totalOf = (ps: AllocationPosition[]): number =>
    ps.reduce((sum, p) => sum + p.marketValueBase, 0)
  const maxValue = placeable.reduce((m, pl) => Math.max(m, totalOf(pl.positions)), 0)

  const bubbles: SectorBubble[] = placeable.map(({ code, centroid, positions: ps }) => {
    const { x, y } = projectEquirectangular(centroid.lon, centroid.lat)
    const value = totalOf(ps)
    const percent = ps.reduce((sum, p) => sum + p.percentOfNav, 0)
    const r = radiusFor(value, maxValue)
    return { code, name: centroid.name, x, y, value, percent, r, wedges: buildWedges(ps, palette, x, y, r) }
  })
  bubbles.sort((a, b) => b.value - a.value)

  return { bubbles, unknown }
}
