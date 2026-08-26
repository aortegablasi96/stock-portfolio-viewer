import { useId, useRef, useState } from 'react'
import type { CompositionBand, CompositionPoint } from '@shared/domain/performance'
import { PERFORMANCE_PLOTS } from '../../lib/chartGeometry'
import { formatPercent } from '../../lib/format'
import {
  bandPaint,
  nearestIndex,
  orderComposition,
  shares,
  stackGeometry,
  stackOrder,
  type StackBand,
} from '../../lib/composition'
import type { TooltipRow } from '../../lib/chartTooltip'
import { StatePanel } from '../ui/StatePanel'
import { ChartTooltip } from './ChartTooltip'

/**
 * A dependency-free **cumulative** stacked area chart for portfolio composition over time
 * (Story #171, DDR-0050; restacked onto absolute NAV by DDR-0052). Inline SVG like every other
 * chart here, so the app pulls in no charting library and stays CSP-friendly.
 *
 * Bands stack in base currency and the top edge of the stack is the day's total NAV, so the chart
 * says how the portfolio was split *and* how big it was. All of the maths — the signed stack, the
 * currency domain and its ticks, the ribbon paths — lives in `lib/composition`, which is where the
 * interesting cases (negative cash, a zero-NAV day, a band that appears partway through) are
 * actually tested. What is left here is the DOM: pointer tracking and the markup.
 *
 * **Order and colour both come from `stackOrder` (`lib/composition`)**, which this chart, its
 * legend and its hover card all call, so the three cannot disagree about either. Since Story #222
 * the stack is drawn with the *most* invested band on top — Stocks under the value curve's own
 * line, the hairline accrual band down on the baseline — which is no longer the order the report
 * emits its bands in; that array orders the palette instead, so inverting the picture repainted
 * nothing (DDR-0073).
 *
 * Those hues are **softened, and only here** — the palette itself does not move, so one asset
 * class still means one hue everywhere; this is the same colour, quieter. Since Story #235 the
 * softening is in the *hue* rather than in the alpha: a band's fill is its slot mixed toward
 * `--card` (`--band-tint`), and the alphas are the proposal's own 0.7 / 0.8→0.5. The point of the
 * split is that a mix is a value `lib/contrast.ts` can measure, and the measurement is what the
 * treatment rests on: **the edge carries the band and the fill only decorates it**, so the
 * hairline stroke stays at full strength and clears 3:1 on every slot while the fill is held
 * below it (DDR-0076). That stroke is not the separating stroke DDR-0052 removed — that one was
 * drawn in `--card` and painted straight over the slivers it was meant to delimit. The top band
 * takes the proposal's vertical **gradient** instead of a flat fill, stops in `app.css` and the id
 * from `useId()`, because two charts on this page mint gradients (DDR-0061).
 *
 * **The legend is not in here.** It is `CompositionLegend` below, rendered by the view into the
 * card's *header* — so this component emits a bare `<svg>`, exactly like `LineChart` and
 * `BarChart`, and all four cards in the 2×2 grid are the same height. A `<figcaption>` under the
 * plot made this card taller than the three beside it (DDR-0052).
 */

/* The plot's aspect ratio, shared with the value and return curves it is read against — a
   different height would make the same date range look like a different span. Story #172 revisited
   it for the 2×2 grid and moved it to `lib/chartGeometry` (DDR-0051); this chart no longer shares
   a *card* with those curves, only a row and a `RangeFilter`, which makes agreeing on the geometry
   matter more rather than less.

   Its axis is money (DDR-0052), so it takes the currency gutter — the wider of the two, and the
   one Story #190 measured `€80,000.00` against on this very chart. Fixed here rather than passed
   in, for the same reason `BarChart`'s is: the axis is the chart's, not the caller's (#269). */
const PLOT = PERFORMANCE_PLOTS.currency
const { width: W, height: H, pad: PAD } = PLOT

export function StackedAreaChart({
  bands,
  points,
  formatValue,
  formatDate,
  ariaLabel,
  emptyMessage,
}: {
  bands: CompositionBand[]
  points: CompositionPoint[]
  /** Base-currency formatter — the axis is money now, not percent (DDR-0052). */
  formatValue: (v: number) => string
  formatDate: (epochMs: number) => string
  ariaLabel: string
  emptyMessage: string
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  // Bottom-first, and the only place the drawing order is decided. `orderComposition` puts each
  // point's values into that order so `stackGeometry` still takes one flat array per point.
  const stack = stackOrder(bands)
  const { paths, domain, xs } = stackGeometry(orderComposition(points, stack), stack.length, {
    width: W,
    height: H,
    pad: PAD,
  })

  if (paths.length === 0) {
    return <StatePanel surface="inline">{emptyMessage}</StatePanel>
  }

  const paint = bandPaint(stack, gradientId)

  const spanV = domain.top - domain.bottom || 1
  const y = (v: number): number =>
    H - PAD.bottom - ((v - domain.bottom) / spanV) * (H - PAD.top - PAD.bottom)

  // The ticks come with the domain, evenly stepped and always including zero (`columnDomain`).
  // The old fixed 0/50/100% set went with the normalised chart: a currency axis has no landmark
  // to hard-code, and a round step is what makes one readable.
  const ticks = domain.ticks

  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    setHover(nearestIndex(xs, ((e.clientX - rect.left) / rect.width) * W))
  }

  const activeIndex = hover
  const activePoint = activeIndex !== null ? points[activeIndex] : undefined

  return (
    <svg
      ref={svgRef}
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
      onMouseMove={onMove}
      onMouseLeave={() => setHover(null)}
    >
      {/* The top band's gradient. Its stops read `--series-hue` off the class on the gradient
          itself, so the ramp is the band's own token rather than a second copy of the palette —
          and `objectBoundingBox` (the default) runs it down the *band*, top edge to bottom edge,
          which is the surface the proposal ramps. */}
      <defs>
        <linearGradient
          id={gradientId}
          className={paint[paint.length - 1]?.hue}
          x1="0"
          y1="0"
          x2="0"
          y2="1"
        >
          <stop className="stack-top-from" offset="0%" />
          <stop className="stack-top-to" offset="100%" />
        </linearGradient>
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          {/* The zero line is the baseline a negative band hangs below, so it reads heavier
              than the other gridlines — the same treatment the column charts give it. */}
          <line
            className={t === 0 ? 'chart-zero' : 'chart-grid'}
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(t)}
            y2={y(t)}
          />
          <text
            className="chart-axis-label"
            x={PAD.left - 8}
            y={y(t)}
            dy="0.32em"
            textAnchor="end"
          >
            {formatValue(t)}
          </text>
        </g>
      ))}

      {/* One group per ribbon, carrying nothing but the band's palette class. Everything the band
          is painted with reads `--series-hue` off it — the stroke, the flat tint, the gradient's
          stops — which is what leaves the top band's `fill` free to be a `url(#…)` attribute; a
          class setting `fill` on the path itself would out-rank it. */}
      {paths.map((path, i) => (
        <g key={stack[i]?.band.key ?? i} className={paint[i]?.hue}>
          <path className={paint[i]?.className} d={path} fill={paint[i]?.fill} />
        </g>
      ))}

      <text className="chart-axis-label" x={PAD.left} y={H - 8} textAnchor="start">
        {formatDate(points[0]?.date ?? 0)}
      </text>
      <text className="chart-axis-label" x={W - PAD.right} y={H - 8} textAnchor="end">
        {formatDate(points[points.length - 1]?.date ?? 0)}
      </text>

      {activePoint && activeIndex !== null && (
        <ChartTooltip
          anchorX={xs[activeIndex] ?? 0}
          plot={PLOT}
          title={formatDate(activePoint.date)}
          rows={compositionRows(activePoint, stack, formatValue)}
        />
      )}
    </svg>
  )
}

/**
 * The stack's key, rendered into the composition card's **header** rather than under the plot.
 *
 * Two reasons it lives there. It puts the legend at the top right, beside the title, where it is
 * read before the chart rather than after it; and it means `StackedAreaChart` emits a bare `<svg>`
 * like the other three, so every card in the 2×2 grid is exactly the same height — a `<figcaption>`
 * below the plot made this one taller than its neighbours, which is precisely the misalignment
 * DDR-0051 built the grid to avoid.
 *
 * It draws its order *and* its colours from `stackOrder`, the same call the chart makes, so the key
 * cannot drift from the bands it keys. It reads **top-down** — the stack reversed — so a reader
 * moving between the key and the picture finds them in the same sequence, which since Story #222
 * means it opens on the band under the value curve's line rather than the sliver on the baseline.
 * Rendering nothing for an empty band list keeps the header a plain title in the state where the
 * chart is showing its empty message.
 */
export function CompositionLegend({ bands }: { bands: CompositionBand[] }): React.JSX.Element | null {
  if (bands.length === 0) return null

  return (
    <p className="chart-legend chart-legend-header composition-legend">
      {topDown(stackOrder(bands)).map((s) => (
        <span className="legend-item" key={s.band.key}>
          <span className={`legend-swatch ${s.color}`} aria-hidden="true" />
          {s.band.label}
        </span>
      ))}
    </p>
  )
}

/** The stack read the way it is looked at: from the band on top down to the one on the baseline. */
function topDown(stack: readonly StackBand[]): StackBand[] {
  return [...stack].reverse()
}

/**
 * One card row per band, plus the stack's total (Story #188, DDR-0061).
 *
 * The card itself is `ChartTooltip`, shared with the two curves this chart sits beside. The row
 * count was the only thing that ever really differed between the three readouts, and a card that
 * sizes to its rows absorbs that; what is left here is the part only this chart knows, which is
 * which figures a composition day is made of.
 *
 * Each row carries **both** the amount and the share of NAV, because the chart lost one of them
 * when it stopped being normalised (DDR-0052) and neither answers the other's question: the
 * amount says what the band is worth, the share says whether it matters. The **Total** row is the
 * cumulative stack's, and on a day when a band is negative it is not the top edge of anything
 * drawn — which is why it is stated rather than left to be read off the chart.
 *
 * Each band's row is **inked with that band's own colour** (Story #220), and the class handed
 * over is the one `stackOrder` already gave the ribbon and the legend swatch — so the row, the
 * band and the key agree because they are literally the same string, not because three call sites
 * were kept in step. The full-strength hue would fail AA as text on the card's fill, so `app.css`
 * resolves it through the `--series-ink-*` ramp; DDR-0046's split, applied to the categorical
 * palette.
 *
 * The rows read **top-down**, like the legend and for the same reason (Story #222): a reader
 * scrubbing the stack matches rows to bands by their order, and a card that listed them upside
 * down would be the one thing on the card that had to be read against the picture.
 *
 * **The Total row stays untinted.** It is the stack, not a band, and the one hue that would be
 * available for it is the neutral residual's, which already means "other".
 */
function compositionRows(
  point: CompositionPoint,
  stack: readonly StackBand[],
  formatValue: (v: number) => string,
): TooltipRow[] {
  const pointShares = shares(point)
  return [
    ...topDown(stack).map((s) => ({
      label: s.band.label,
      value: `${formatValue(point.values[s.index] ?? 0)} (${formatPercent(pointShares[s.index] ?? 0)})`,
      ink: s.color,
    })),
    { label: 'Total', value: formatValue(point.total) },
  ]
}
