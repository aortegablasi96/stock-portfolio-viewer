/**
 * Pure geometry + grouping helpers for the donut charts (Milestone M3, Story #30).
 *
 * Kept out of the component so they can be unit-tested in Vitest's Node environment
 * (no DOM), matching how `@shared/format.ts` is tested.
 */

export interface PieDatum {
  key: string
  label: string
  /** Magnitude that drives the slice angle (base-currency market value). */
  value: number
  /** Share of NAV as a percent — what the legend and tooltip report. */
  percent: number
}

/**
 * The categorical palette carries eight validated slots, so at most eight slices are ever
 * drawn: the seven largest plus an aggregated "Other". A ninth hue is never generated
 * (data-viz rule: assign categorical hues in fixed order, never cycled).
 */
export const MAX_SLICES = 8

/** The aggregated tail slice's key. */
export const OTHER_KEY = '__other__'

/**
 * Residual slices — the aggregated tail, and the "this dimension has no value" bucket the
 * services emit with an empty key (unknown country, unclassified sector). They are painted
 * a neutral gray rather than consuming a categorical hue, so colour keeps meaning identity.
 */
export function isResidual(key: string): boolean {
  return key === OTHER_KEY || key === ''
}

/** Collapse the tail of an already value-sorted list into a single "Other" slice. */
export function groupTail(data: PieDatum[], maxSlices: number = MAX_SLICES): PieDatum[] {
  const positive = data.filter((d) => d.value > 0)
  if (positive.length <= maxSlices) return positive

  const head = positive.slice(0, maxSlices - 1)
  const tail = positive.slice(maxSlices - 1)
  return [
    ...head,
    {
      key: OTHER_KEY,
      label: `Other (${tail.length})`,
      value: tail.reduce((sum, d) => sum + d.value, 0),
      percent: tail.reduce((sum, d) => sum + d.percent, 0),
    },
  ]
}

export interface PieArc extends PieDatum {
  /** SVG path for the donut segment. */
  path: string
  /** Share of the drawn total, 0–1 (the slice's angular size). */
  share: number
}

/** A point on the circle at `angle` radians, measured clockwise from 12 o'clock. */
function pointOnCircle(cx: number, cy: number, r: number, angle: number): [number, number] {
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]
}

/** Donut segment path between two angles (radians, clockwise from 12 o'clock). */
export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  start: number,
  end: number,
): string {
  const large = end - start > Math.PI ? 1 : 0
  const [x0, y0] = pointOnCircle(cx, cy, rOuter, start)
  const [x1, y1] = pointOnCircle(cx, cy, rOuter, end)
  const [x2, y2] = pointOnCircle(cx, cy, rInner, end)
  const [x3, y3] = pointOnCircle(cx, cy, rInner, start)
  return [
    `M ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ')
}

/**
 * How many leading palette slots the **sector** dimension skips (Story #122).
 *
 * Slot 1 is the palette's only blue, and the Allocation map spends it on a country's weight in the
 * portfolio — a magnitude, which is exactly that slot's documented role. Sectors therefore start at
 * slot 2, so no sector can ever wear the same hue as the weight donut beside it.
 *
 * The skip applies to *every* surface a sector appears on — the map, the map legend, the Sector
 * donut and its composing table — because the invariant that matters is that one sector has one
 * hue everywhere, not which hue it is. The cost is one fewer categorical slot before the tail
 * folds into 'Other', which is why this is opt-in per dimension rather than global: asset class,
 * currency and country keep all eight.
 */
export const SECTOR_SLOT_OFFSET = 1

/**
 * Assign each slice its colour class, in the same fixed order the donut uses: categorical
 * hues (`pie-series-1…8`) go to the *named* categories only, while residual slices — the
 * aggregated tail and the empty "no value" key — take the neutral gray, so a hue always
 * means a real category. Shared by the donut and its composing-assets table (Story #48) so
 * a slice wears the same colour in both.
 *
 * `offset` skips that many leading slots — see `SECTOR_SLOT_OFFSET`.
 */
export function sliceColorClasses(
  slices: Array<Pick<PieDatum, 'key'>>,
  offset = 0,
): string[] {
  let slot = offset
  return slices.map((s) =>
    isResidual(s.key) ? 'pie-series-neutral' : `pie-series-${(slot += 1)}`,
  )
}

/**
 * A complete ring, with no radial edges.
 *
 * Two subpaths — the outer circle clockwise, the inner circle anticlockwise — so the nonzero fill
 * rule punches the hole. Each circle is itself two half-arcs, because an arc whose start and end
 * coincide renders as nothing.
 *
 * This exists because a 100% slice cannot be drawn as a donut *segment*. A segment is a closed
 * shape with straight radial edges, and `.pie-slice` strokes its outline in the surface colour to
 * separate neighbouring slices — so a full-circle segment paints two seams at 12 and 6 o'clock that
 * look like divisions but represent nothing. A ring has no radial edges, so there is nothing there
 * to stroke.
 */
export function fullRingPath(cx: number, cy: number, rOuter: number, rInner: number): string {
  return [
    `M ${cx - rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 1 1 ${cx + rOuter} ${cy}`,
    `A ${rOuter} ${rOuter} 0 1 1 ${cx - rOuter} ${cy}`,
    'Z',
    `M ${cx - rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 1 0 ${cx + rInner} ${cy}`,
    `A ${rInner} ${rInner} 0 1 0 ${cx - rInner} ${cy}`,
    'Z',
  ].join(' ')
}

/**
 * Lay the data out as donut segments. A single 100% datum is drawn as a seamless full ring — see
 * `fullRingPath` for why it cannot be a segment.
 */
export function toArcs(
  data: PieDatum[],
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
): PieArc[] {
  const total = data.reduce((sum, d) => sum + d.value, 0)
  if (total <= 0) return []

  let angle = 0
  return data.map((d) => {
    const share = d.value / total
    const start = angle
    const end = share >= 1 ? 2 * Math.PI : angle + share * 2 * Math.PI
    angle = end
    const path =
      share >= 1
        ? fullRingPath(cx, cy, rOuter, rInner)
        : arcPath(cx, cy, rOuter, rInner, start, end)
    return { ...d, share, path }
  })
}
