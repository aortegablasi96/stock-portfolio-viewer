import { useId, useRef, useState } from 'react'
import type { ValuePoint } from '@shared/domain/performance'
import { PERFORMANCE_PLOT } from '../../lib/chartGeometry'
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
}: {
  points: ValuePoint[]
  formatValue: (v: number) => string
  formatDate: (epochMs: number) => string
  ariaLabel: string
  /** Names the series in the hover card. Omitted where the card's date is answer enough. */
  seriesLabel?: string
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
  const area = `${PAD.left},${y(minV)} ${line} ${x(maxD)},${y(minV)}`
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
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop className="chart-area-from" offset="0%" />
          <stop className="chart-area-to" offset="100%" />
        </linearGradient>
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

      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline className="chart-line" points={line} vectorEffect="non-scaling-stroke" />

      {points.length <= MAX_MARKERS &&
        points.map((p) => (
          <circle key={`${p.date}-${p.value}`} className="chart-dot" cx={x(p.date)} cy={y(p.value)} r={4}>
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
          <circle className="chart-hover-dot" cx={x(active.date)} cy={y(active.value)} r={4.5} />
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
