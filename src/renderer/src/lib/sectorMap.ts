/**
 * The shared sector → colour assignment (Milestone M3, Story #30).
 *
 * One palette, built once from the allocation report's `bySector` breakdown, so a sector wears the
 * same hue everywhere it appears: in the Sector donut, on the Allocation map's holding circles, and
 * in the map's own legend. That shared identity is the point — a colour must mean the same thing on
 * both surfaces or neither can be read against the other.
 *
 * Built from the donut's own `groupTail` + `sliceColorClasses` pipeline (`lib/pie`), so sectors past
 * the palette's eight slots fold into a neutral 'Other' exactly as the donut folds its tail, and
 * unclassified positions share that neutral rather than consuming a categorical hue.
 *
 * Kept out of the components so it can be unit-tested in Vitest's Node environment, the way the
 * other `lib/` helpers are. It emits colour **classes**, never resolved colour values: resolving one
 * needs `getComputedStyle`, which does not exist under Node, and keeping that step in the component
 * is what leaves this module testable (see `lib/mapBubbles`).
 *
 * Story #92 moved the map's bubble geometry to `lib/mapBubbles`, where per-holding circles replaced
 * the per-country sector wedges this module used to lay out (DDR-0020).
 */
import type { AllocationSlice } from '@shared/domain/allocation'
import { groupTail, OTHER_KEY, sliceColorClasses, type PieDatum } from './pie'

const NEUTRAL_CLASS = 'pie-series-neutral'

/** One entry of the map's shared sector legend — matches the Sector donut's slices. */
export interface SectorLegendEntry {
  key: string
  label: string
  colorClass: string
}

/**
 * A stable sector → colour assignment shared by the map circles and the map legend. Built once
 * from `report.bySector` so it matches the Sector donut. Sectors outside the palette's slots
 * collapse to a neutral 'Other'; unclassified ('') is neutral too.
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
