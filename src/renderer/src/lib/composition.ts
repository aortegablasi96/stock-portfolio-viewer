/**
 * Stacking geometry for the Performance view's portfolio-composition chart (Story #171,
 * DDR-0050).
 *
 * Kept out of the component for the reason every other module in this folder is: Vitest runs
 * in a Node environment with no DOM, so anything inside a `.tsx` is untestable. What lands
 * here is the whole of the chart's maths — proportions, the signed stack, the vertical domain
 * and the ribbon paths — leaving `StackedAreaChart` with only the parts that need a DOM.
 *
 * The chart is **cumulative**: bands stack in base currency and the top edge of the stack is the
 * day's total NAV. It supersedes the 100%-stacked version this module shipped with (DDR-0052
 * supersedes that half of DDR-0050), so the y axis is currency rather than share of NAV.
 *
 * The trade that decision makes is worth stating, because DDR-0050 made it the other way. A
 * 100%-stacked chart holds proportion still and shows shape alone; a cumulative one shows shape
 * *and* size, at the cost of squeezing a small band against a growing total — a 2% cash sliver is
 * harder to read at €45k of NAV than at €20k. What buys that back is that a band's own thickness
 * is now a quantity a reader can price: "cash went from nothing to €4k" is a sentence the
 * normalised version could not produce, since there every band moved whenever any band moved.
 *
 * Three things here are less obvious than they look.
 *
 * **Negative bands are drawn below the zero line, not clamped or folded away.** Cash goes negative
 * on margin, and when it does, the stock band alone exceeds NAV. Stacking |value| would put the
 * top edge back on the total at the cost of drawing a borrowed position as though it were an
 * asset, which is precisely the shape the chart exists to reveal. So positive values stack upward
 * from zero, negative values stack downward, and the axis domain widens to fit. This survived the
 * move off proportions unchanged — it was never about normalisation.
 *
 * **The top edge is NAV because the bands are exhaustive, not because anything forces it.** The
 * `other` band is a residual (`total − Σ components`), so the stack sums to `total` by
 * construction — the same property the normalised version relied on to reach exactly 100%. If a
 * future band were ever dropped rather than folded into `other`, the top edge would quietly stop
 * being NAV, and unlike the old chart nothing would look wrong.
 *
 * **The stacking order is this module's, not the report's** (Story #222, DDR-0073). The report's
 * `bands` array orders the *palette*; `stackOrder` orders the *picture*, bottom first, and every
 * consumer — ribbons, legend, hover card — reads the stack through it. Splitting the two is what
 * lets the stack be inverted without every band changing colour.
 *
 * **A zero-NAV day is a genuine zero here, not a division by zero.** The stack simply pinches to
 * the baseline and reopens after it. This is not hypothetical: the owner's real 2025 export opens
 * on the day before the account was funded, with `total="0"`. `shares` still guards the division,
 * because the hover readout quotes a percentage beside each figure.
 */
import type { CompositionBand, CompositionPoint } from '@shared/domain/performance'
import { columnDomain, type ColumnDomain } from './column'
import type { Bounds } from './dateRange'
import { OTHER_KEY, sliceColorClasses } from './pie'

/**
 * The palette class for each band, index-aligned with `bands`.
 *
 * Shared by the chart and its legend rather than computed twice. They are no longer in the same
 * element — the legend moved into the card header so that every card in the 2×2 grid is exactly
 * the same height (DDR-0052) — and two call sites deriving colour separately is how a legend
 * starts disagreeing with the thing it keys.
 *
 * **No offset**: `SECTOR_SLOT_OFFSET` reserves slot 1 for the Allocation map's weight donut and
 * applies to *sectors* only (DDR-0030); an asset class is not a sector, so this chart keeps all
 * eight slots. The residual `other` band is mapped onto `OTHER_KEY` so it takes the neutral gray
 * rather than consuming a hue — it is not a category anyone named.
 *
 * **Taken from the report's own order, which is no longer the order the stack is drawn in**
 * (Story #222, DDR-0073). The two were the same array until the stack was inverted; keeping the
 * palette on the report's order is what stops a presentation change from repainting every band —
 * Stocks keeps slot 1's blue at the top of the stack exactly as it had it at the bottom.
 */
export function compositionColors(bands: readonly CompositionBand[]): string[] {
  return sliceColorClasses(bands.map((b) => ({ key: b.key === 'other' ? OTHER_KEY : b.key })))
}

/**
 * Where each band sits in the stack, **bottom first** (Story #222, DDR-0073).
 *
 * A `Record` rather than a list, so the compiler is the guard the story asked for: add a key to
 * `compositionBandSchema` and this object stops type-checking until someone decides where the new
 * band goes. A list would have accepted the new key silently and dropped the band off the chart.
 *
 * The order runs from the least invested at the bottom to the most invested at the top, which is
 * what puts Stocks under the value curve's own line and the hairline accrual band down on the
 * baseline where it is legible. `other` is the unnamed residual: above the cash it is not, below
 * the named invested bands it cannot be identified with.
 */
const STACK_SLOT: Record<CompositionBand['key'], number> = {
  accruals: 0,
  cash: 1,
  other: 2,
  options: 3,
  stock: 4,
}

/** One band, resolved to where it is drawn, what it is drawn from, and what colour it wears. */
export interface StackBand {
  readonly band: CompositionBand
  /** Its index in the report's `values` array, which the stack order no longer matches. */
  readonly index: number
  /** Its palette class, assigned from the report's order by {@link compositionColors}. */
  readonly color: string
}

/**
 * The report's bands in stacking order, bottom first.
 *
 * Every consumer of the stack goes through this — the ribbons, the legend and the hover card —
 * so the three cannot disagree about either order or colour. The band's original index rides
 * along because `point.values` is still index-aligned with the *report's* array.
 */
export function stackOrder(bands: readonly CompositionBand[]): StackBand[] {
  const colors = compositionColors(bands)
  return bands
    .map((band, index) => ({ band, index, color: colors[index] ?? '' }))
    .sort((a, b) => STACK_SLOT[a.band.key] - STACK_SLOT[b.band.key])
}

/**
 * The series with each point's values put in stacking order, so `stackSpans` and `stackGeometry`
 * keep taking one flat array and knowing nothing about which band is which.
 */
export function orderComposition(
  points: readonly CompositionPoint[],
  stack: readonly StackBand[],
): CompositionPoint[] {
  return points.map((point) => ({
    ...point,
    values: stack.map((s) => point.values[s.index] ?? 0),
  }))
}

/** How one ribbon is painted (Story #222, DDR-0073). */
export interface BandPaint {
  /**
   * The palette class carried by the ribbon's wrapping `<g>`, whose only job is to publish
   * `--series-hue` — the band's own colour, which its stroke and (at the top) its gradient stops
   * read back out. The group is uniform across bands so that rule has one shape.
   */
  readonly hue: string
  /** The ribbon's own classes. */
  readonly className: string
  /** The `fill` attribute, present only where the class does not supply one. */
  readonly fill?: string
}

/**
 * The paint for each ribbon, bottom first — the top band on a gradient, the rest flat.
 *
 * The top band is whichever band is drawn top-most, not `stock` by name: an account holding no
 * equities still gets its top edge treated as the NAV line it is.
 *
 * Why the top band's `fill` is an *attribute* while every other band's comes from its class: CSS
 * beats a presentation attribute, so a ribbon carrying `.pie-series-N` cannot also be filled with
 * a gradient reference. The hue therefore moves to the wrapping group, where it is inherited as a
 * custom property and nothing competes with it (DDR-0061's `useId()` trap applies to the id).
 */
export function bandPaint(stack: readonly StackBand[], gradientId: string): BandPaint[] {
  const top = stack.length - 1
  return stack.map((s, i) =>
    i === top
      ? { hue: s.color, className: 'stack-band stack-band-top', fill: `url(#${gradientId})` }
      : { hue: s.color, className: `stack-band ${s.color}` },
  )
}

/**
 * Restrict the series to a window, keeping only the days that really fall in it.
 *
 * Deliberately **not** `sliceSeries`, which anchors synthetic endpoints at the window edges by
 * carrying the last known value forward. That is right for a single scalar — a portfolio had
 * *some* value on the window's first day — but a composition point is a simultaneous
 * observation of every band, and a carried-forward one would draw a portfolio shape on a date
 * it was never measured. The series is daily, so the real first point inside the window is at
 * most a day away from its edge and there is nothing to gain by inventing one.
 */
export function sliceComposition(
  points: readonly CompositionPoint[],
  bounds: Bounds,
): CompositionPoint[] {
  return points.filter((p) => p.date >= bounds.from && p.date <= bounds.to)
}

/** The plot box, in `viewBox` units. */
export interface StackBox {
  width: number
  height: number
  pad: { top: number; right: number; bottom: number; left: number }
}

/** Where one band sits at one point, in base currency. */
export interface BandSpan {
  lo: number
  hi: number
}

export interface StackGeometry {
  /** One closed SVG path per band, index-aligned with the series' `bands`. */
  paths: string[]
  /** The currency vertical domain drawn, with the axis ticks that go with it. */
  domain: ColumnDomain
  /** Each point's x in `viewBox` units, for the hover crosshair and nearest-point search. */
  xs: number[]
}

/**
 * Each band's signed share of NAV at one point, index-aligned with `point.values`.
 *
 * No longer what the chart is *drawn* from — that is `stackSpans` over the raw values now — but
 * still what the hover readout quotes beside each figure, because "€612" answers a different
 * question from "1.4% of the portfolio" and the reader of a composition chart wants both.
 *
 * Sums to exactly 1 when NAV is non-zero, and is all zero when NAV is zero rather than `NaN`.
 */
export function shares(point: CompositionPoint): number[] {
  if (point.total === 0) return point.values.map(() => 0)
  return point.values.map((v) => v / point.total)
}

/**
 * Turn one point's band values into stacked spans, bottom band first.
 *
 * Positive and negative values are stacked from two independent cursors at zero, so a band that
 * flips sign — cash crossing into margin — moves from above the baseline to below it rather than
 * dragging the bands above it down through zero.
 *
 * Unit-agnostic: it stacked shares before DDR-0052 and stacks base currency after it, because the
 * two-cursor rule is about sign, not scale.
 */
export function stackSpans(values: readonly number[]): BandSpan[] {
  let up = 0
  let down = 0
  return values.map((value) => {
    if (value >= 0) {
      const span = { lo: up, hi: up + value }
      up = span.hi
      return span
    }
    const span = { lo: down + value, hi: down }
    down = span.lo
    return span
  })
}

/**
 * The currency domain across the whole series — the deepest negative stack to the tallest
 * positive one — with the axis ticks to label it.
 *
 * Delegated to `columnDomain` rather than taking the raw extremes, for the reason that module
 * exists: an axis running to €43,718.02 is an axis nobody can read across. It rounds the extremes
 * outward to a nice step, always spans zero, and always puts a tick on it — which is also what
 * gives the tallest stack headroom instead of clipping it against the top grid line.
 *
 * The anchor the 100%-stacked version needed is gone with it. That chart pinned its domain to
 * [0, 1] so two windows at the same proportion drew the same shape; here the domain is *supposed*
 * to follow the money, since a window in which NAV doubled should look like one in which NAV
 * doubled.
 */
export function valueDomain(points: readonly CompositionPoint[]): ColumnDomain {
  return columnDomain(
    points.map((point) => {
      const spans = stackSpans(point.values)
      const lo = Math.min(0, ...spans.map((s) => s.lo))
      const hi = Math.max(0, ...spans.map((s) => s.hi))
      // `columnDomain` reads its top off `lower + upper` and its bottom off `lower`, so a stack
      // is expressed to it as one column from the bottom of the stack to the top.
      return { lower: lo, upper: hi - lo }
    }),
  )
}

/**
 * Lay the series out as one closed ribbon per band: forward along the band's top edge, back
 * along its bottom. A single point cannot describe a ribbon, so a series shorter than two
 * points yields no paths and the caller renders its empty state.
 */
export function stackGeometry(
  points: readonly CompositionPoint[],
  bandCount: number,
  box: StackBox,
): StackGeometry {
  const domain = valueDomain(points)
  if (points.length < 2 || bandCount === 0) return { paths: [], domain, xs: [] }

  const { width, height, pad } = box
  const dates = points.map((p) => p.date)
  const minD = Math.min(...dates)
  const maxD = Math.max(...dates)
  const spanD = maxD - minD || 1
  const spanV = domain.top - domain.bottom || 1

  const x = (d: number): number => pad.left + ((d - minD) / spanD) * (width - pad.left - pad.right)
  const y = (v: number): number =>
    height - pad.bottom - ((v - domain.bottom) / spanV) * (height - pad.top - pad.bottom)

  const xs = dates.map(x)
  const spansPerPoint = points.map((p) => stackSpans(p.values))

  const paths = Array.from({ length: bandCount }, (_, band) => {
    const top = spansPerPoint.map((spans, i) => `${xs[i]},${y(spans[band]?.hi ?? 0)}`)
    const bottom = spansPerPoint
      .map((spans, i) => `${xs[i]},${y(spans[band]?.lo ?? 0)}`)
      .reverse()
    return `M ${top.join(' L ')} L ${bottom.join(' L ')} Z`
  })

  return { paths, domain, xs }
}

/**
 * The index of the point nearest a given x in `viewBox` units — the hover target.
 * Returns `null` for an empty series so the caller has no point to read.
 */
export function nearestIndex(xs: readonly number[], targetX: number): number | null {
  if (xs.length === 0) return null
  let nearest = 0
  let best = Infinity
  xs.forEach((x, i) => {
    const dist = Math.abs(x - targetX)
    if (dist < best) {
      best = dist
      nearest = i
    }
  })
  return nearest
}
