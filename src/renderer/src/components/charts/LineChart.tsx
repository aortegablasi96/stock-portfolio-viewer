import { useId, useRef, useState } from 'react'
import type { ValuePoint } from '@shared/domain/performance'
import { PERFORMANCE_PLOT } from '../../lib/chartGeometry'
import { signedBands } from '../../lib/signedCurve'
import { StatePanel } from '../ui/StatePanel'
import { ChartTooltip } from './ChartTooltip'

/**
 * A dependency-free line chart for a value-over-time series (Milestone M3, Stories #21,
 * #29, #45). Rendered as inline SVG so the app pulls in no charting library and stays
 * CSP-friendly. A single series needs no legend — the caller's heading names it.
 *
 * Hovering (or scrubbing) over the plot highlights the nearest point with a crosshair and
 * dot and floats a tooltip showing its date and formatted value (Story #45). A sparse
 * series (period endpoints) still marks each vertex; a dense daily series (DDR-0008) would
 * clutter with 140+ markers, so above a threshold only the line + area render.
 *
 * The area under the curve is a **vertical gradient**, from a quarter-opacity series colour at the
 * curve to nothing at the baseline (Story #188, DDR-0061). It replaces a flat 12% wash, and it is
 * the redesign's one genuinely new mark here: the wash was one opacity all the way down, so it had
 * an edge of its own along the bottom of the plot and read as a second, paler series. The stops
 * live in `app.css`, so the colour is still a token; only the `<defs>` is in here, because a
 * gradient is referenced by id and the two curves in the Performance grid are two elements on one
 * page — hence `useId()` rather than a constant that would paint the second from the first's stops.
 */
/* The plot's aspect ratio lives in `lib/chartGeometry` now (Story #172, DDR-0051): this chart
   shares a 2×2 grid with the bar and stacked-area charts, all three are read against each other,
   and three private copies of the same 1080×240 is how they would stop agreeing. 500×180 is what
   half a column needs — see that module for why the width halved and the ratio shortened. */
const { width: W, height: H, pad: PAD } = PERFORMANCE_PLOT

/** Above this many points the per-vertex markers are dropped (dense daily series). */
const MAX_MARKERS = 30

export function LineChart({
  points,
  formatValue,
  formatDate,
  ariaLabel,
  seriesLabel,
  tone = 'series',
}: {
  points: ValuePoint[]
  formatValue: (v: number) => string
  formatDate: (epochMs: number) => string
  ariaLabel: string
  /** Names the series in the hover card. Omitted where the card's date is answer enough. */
  seriesLabel?: string
  /**
   * How the curve is coloured (Story #229, DDR-0071).
   *
   * `series` is one indigo end to end — right for a quantity, which has no sign to report: the
   * portfolio's value is never "negative", it is only larger or smaller than it was.
   *
   * `sign` splits the curve at break-even and tones the halves with the daily-return bars' own
   * pair. It is for a chart whose zero is a *level the series crosses* rather than the floor it
   * sits on, which is the same test that decides whether the emphasised zero rule is drawn at
   * all. Defaulted rather than required, so a new caller gets the plain curve unless it says
   * otherwise.
   */
  tone?: 'series' | 'sign'
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) {
    return <StatePanel surface="inline">Not enough data points to plot a trend yet.</StatePanel>
  }

  const values = points.map((p) => p.value)
  const dates = points.map((p) => p.date)
  const minV = Math.min(...values, 0)
  const maxV = Math.max(...values)
  const minD = Math.min(...dates)
  const maxD = Math.max(...dates)
  const spanV = maxV - minV || 1
  const spanD = maxD - minD || 1

  const x = (d: number): number => PAD.left + ((d - minD) / spanD) * (W - PAD.left - PAD.right)
  const y = (v: number): number => H - PAD.bottom - ((v - minV) / spanV) * (H - PAD.top - PAD.bottom)

  const line = points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ')
  /* The wash is anchored at the level it is measuring *from*, and the two charts measure from
     different places (Story #229). A value curve's baseline is the bottom of its domain — the
     area says "this much portfolio". A signed curve's baseline is **zero**, because the area says
     "this far from break-even"; anchored at `minV` instead, a stretch spent entirely under water
     would fill downward from the curve and be drawn exactly the way a gain is. */
  const areaBase = tone === 'sign' ? y(0) : y(minV)
  const area = `${PAD.left},${areaBase} ${line} ${x(maxD)},${areaBase}`
  const ticks = [minV, minV + spanV / 2, maxV]
  // The return curve is a signed percentage and spends whole periods below zero; the value curve
  // never does, because `minV` floors at 0 and the baseline *is* the zero line. So the emphasised
  // rule is drawn only where zero is a level the series crosses rather than the floor it sits on,
  // which is the same test the two column charts apply (Story #188).
  const showZero = minV < 0

  /** Map a pointer event to the nearest data point index (viewBox-space nearest by date). */
  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vbX = ((e.clientX - rect.left) / rect.width) * W
    let nearest = 0
    let best = Infinity
    for (let i = 0; i < points.length; i++) {
      const dist = Math.abs(x(dates[i] as number) - vbX)
      if (dist < best) {
        best = dist
        nearest = i
      }
    }
    setHover(nearest)
  }

  const active = hover !== null ? points[hover] : undefined

  /* The two clipped halves and the ids that address them. `useId()` already mints one unique
     string for this instance; deriving the rest from it keeps the two curves in the grid from
     pointing at each other's clips, which is the same trap DDR-0061 recorded for the gradient. */
  const bands = signedBands(y(0), PERFORMANCE_PLOT)
  const aboveId = `${gradientId}-above`
  const belowId = `${gradientId}-below`
  const posGradientId = `${gradientId}-pos`
  const negGradientId = `${gradientId}-neg`
  /** A mark's tone on a signed curve; `undefined` leaves it the curve's own colour. */
  const markTone = (value: number): string =>
    tone !== 'sign' ? '' : value < 0 ? ' chart-mark-neg' : ' chart-mark-pos'

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
      <defs>
        {tone === 'series' ? (
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop className="chart-area-from" offset="0%" />
            <stop className="chart-area-to" offset="100%" />
          </linearGradient>
        ) : (
          <>
            {/* `userSpaceOnUse`, so each gradient spans its own band rather than the shape it
                happens to be painting. An objectBoundingBox gradient would be measured against the
                polygon — one shape covering both halves — and the two fades would meet somewhere
                other than the zero line, which is the one place they have to meet. */}
            <linearGradient
              id={posGradientId}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={PAD.top}
              x2={0}
              y2={bands.zeroY}
            >
              <stop className="chart-area-pos-from" offset="0%" />
              <stop className="chart-area-pos-to" offset="100%" />
            </linearGradient>
            <linearGradient
              id={negGradientId}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={bands.zeroY}
              x2={0}
              y2={H - PAD.bottom}
            >
              <stop className="chart-area-neg-from" offset="0%" />
              <stop className="chart-area-neg-to" offset="100%" />
            </linearGradient>
            <clipPath id={aboveId}>
              <rect {...bands.above} />
            </clipPath>
            <clipPath id={belowId}>
              <rect {...bands.below} />
            </clipPath>
          </>
        )}
      </defs>

      {ticks.map((t) => (
        <g key={t}>
          <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text className="chart-axis-label" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {formatValue(t)}
          </text>
        </g>
      ))}

      {showZero && (
        <line className="chart-zero" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
      )}

      {tone === 'series' ? (
        <>
          <polygon points={area} fill={`url(#${gradientId})`} />
          <polyline className="chart-line" points={line} vectorEffect="non-scaling-stroke" />
        </>
      ) : (
        /* One polygon and one polyline, each drawn twice under complementary clips. Not two
           series: splitting the data at the crossing would mean inventing a point the report
           never sampled, and the chart would stop plotting what it was handed (DDR-0071). */
        <>
          <g clipPath={`url(#${aboveId})`}>
            <polygon points={area} fill={`url(#${posGradientId})`} />
            <polyline
              className="chart-line chart-line-pos"
              points={line}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          <g clipPath={`url(#${belowId})`}>
            <polygon points={area} fill={`url(#${negGradientId})`} />
            <polyline
              className="chart-line chart-line-neg"
              points={line}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </>
      )}

      {points.length <= MAX_MARKERS &&
        points.map((p) => (
          <circle
            key={`${p.date}-${p.value}`}
            className={`chart-dot${markTone(p.value)}`}
            cx={x(p.date)}
            cy={y(p.value)}
            r={4}
          >
            <title>{`${formatDate(p.date)}: ${formatValue(p.value)}`}</title>
          </circle>
        ))}

      <text className="chart-axis-label" x={PAD.left} y={H - 8} textAnchor="start">
        {formatDate(minD)}
      </text>
      <text className="chart-axis-label" x={W - PAD.right} y={H - 8} textAnchor="end">
        {formatDate(maxD)}
      </text>

      {active && (
        <>
          {/* The dot is drawn outside the card so it stays on the mark while the card is pinned to
              the top of the plot: the card says which day, the dot says where on the curve. */}
          <circle
            className={`chart-hover-dot${markTone(active.value)}`}
            cx={x(active.date)}
            cy={y(active.value)}
            r={4.5}
          />
          <ChartTooltip
            anchorX={x(active.date)}
            title={formatDate(active.date)}
            rows={[{ label: seriesLabel, value: formatValue(active.value) }]}
          />
        </>
      )}
    </svg>
  )
}
