/**
 * Stacking geometry for the Performance view's portfolio-composition chart (Story #171,
 * DDR-0050).
 *
 * Kept out of the component for the reason every other module in this folder is: Vitest runs
 * in a Node environment with no DOM, so anything inside a `.tsx` is untestable. What lands
 * here is the whole of the chart's maths — proportions, the signed stack, the vertical domain
 * and the ribbon paths — leaving `StackedAreaChart` with only the parts that need a DOM.
 *
 * The chart is **100%-stacked**: it answers "did the portfolio's shape change?", which is a
 * question about proportions, so the y axis is share of NAV rather than currency. That also
 * keeps it honest beside the value curve, whose absolute scale it would otherwise appear to
 * contradict on any day the two were built differently.
 *
 * Two things here are less obvious than they look.
 *
 * **Negative bands are drawn below the zero line, not clamped or normalised away.** Cash goes
 * negative on margin, and when it does, stock exceeds 100% of NAV. Dividing by Σ|value| would
 * make both bands positive and put the stack back inside 0–100% — at the cost of drawing a
 * borrowed position as though it were an asset, which is precisely the shape the chart exists
 * to reveal. So positive shares stack upward from zero, negative shares stack downward, and
 * the axis domain widens to fit. In the ordinary case that domain is exactly [0, 1] and the
 * chart looks like any other 100%-stacked area.
 *
 * **A zero-NAV day has no proportions at all.** Every share is 0 rather than `NaN` from a
 * division by zero, so the stack pinches to nothing at that x and reopens after it. This is
 * not hypothetical: the owner's real 2025 export opens on the day before the account was
 * funded, with `total="0"`.
 */
import type { CompositionPoint } from '@shared/domain/performance'
import type { Bounds } from './dateRange'

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

/** Where one band sits at one point, in share space (1 = 100% of NAV). */
export interface BandSpan {
  lo: number
  hi: number
}

export interface StackGeometry {
  /** One closed SVG path per band, index-aligned with the series' `bands`. */
  paths: string[]
  /** The share-space vertical domain drawn — exactly [0, 1] unless a band goes negative. */
  domain: { min: number; max: number }
  /** Each point's x in `viewBox` units, for the hover crosshair and nearest-point search. */
  xs: number[]
}

/**
 * Each band's signed share of NAV at one point, index-aligned with `point.values`.
 *
 * Sums to exactly 1 when NAV is non-zero — the invariant the chart's "bands total 100%"
 * promise rests on, and the one asserted directly in the tests. All zero when NAV is zero.
 */
export function shares(point: CompositionPoint): number[] {
  if (point.total === 0) return point.values.map(() => 0)
  return point.values.map((v) => v / point.total)
}

/**
 * Turn one point's shares into stacked spans, bottom band first.
 *
 * Positive and negative shares are stacked from two independent cursors at zero, so a band
 * that flips sign — cash crossing into margin — moves from above the baseline to below it
 * rather than dragging the bands above it down through zero.
 */
export function stackSpans(pointShares: readonly number[]): BandSpan[] {
  let up = 0
  let down = 0
  return pointShares.map((share) => {
    if (share >= 0) {
      const span = { lo: up, hi: up + share }
      up = span.hi
      return span
    }
    const span = { lo: down + share, hi: down }
    down = span.lo
    return span
  })
}

/**
 * The vertical domain across the whole series — the deepest negative stack to the tallest
 * positive one.
 *
 * Anchored to include 0 and 1 always, so the chart does not silently rescale between renders:
 * a window in which every day is 100% stock would otherwise draw the stack against a domain of
 * [0, 1] while its neighbour drew [−0.1, 1.1], and the two would look like different shapes at
 * the same proportion. Zero-NAV days contribute nothing and cannot collapse it.
 */
export function shareDomain(points: readonly CompositionPoint[]): { min: number; max: number } {
  let min = 0
  let max = 1
  for (const point of points) {
    for (const span of stackSpans(shares(point))) {
      if (span.lo < min) min = span.lo
      if (span.hi > max) max = span.hi
    }
  }
  return { min, max }
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
  const domain = shareDomain(points)
  if (points.length < 2 || bandCount === 0) return { paths: [], domain, xs: [] }

  const { width, height, pad } = box
  const dates = points.map((p) => p.date)
  const minD = Math.min(...dates)
  const maxD = Math.max(...dates)
  const spanD = maxD - minD || 1
  const spanV = domain.max - domain.min || 1

  const x = (d: number): number => pad.left + ((d - minD) / spanD) * (width - pad.left - pad.right)
  const y = (v: number): number =>
    height - pad.bottom - ((v - domain.min) / spanV) * (height - pad.top - pad.bottom)

  const xs = dates.map(x)
  const spansPerPoint = points.map((p) => stackSpans(shares(p)))

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
