import { useRef, useState } from 'react'
import type { ValuePoint } from '@shared/domain/performance'

/**
 * A dependency-free line chart for a value-over-time series (Milestone M3, Stories #21,
 * #29, #45). Rendered as inline SVG so the app pulls in no charting library and stays
 * CSP-friendly. A single series needs no legend — the caller's heading names it.
 *
 * Hovering (or scrubbing) over the plot highlights the nearest point with a crosshair and
 * dot and floats a tooltip showing its date and formatted value (Story #45). A sparse
 * series (period endpoints) still marks each vertex; a dense daily series (DDR-0008) would
 * clutter with 140+ markers, so above a threshold only the line + area render.
 */
const W = 720
const H = 240
const PAD = { top: 16, right: 16, bottom: 28, left: 64 }

/** Above this many points the per-vertex markers are dropped (dense daily series). */
const MAX_MARKERS = 30

export function LineChart({
  points,
  formatValue,
  formatDate,
  ariaLabel,
}: {
  points: ValuePoint[]
  formatValue: (v: number) => string
  formatDate: (epochMs: number) => string
  ariaLabel: string
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) {
    return <p className="chart-empty">Not enough data points to plot a trend yet.</p>
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
      {ticks.map((t) => (
        <g key={t}>
          <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
          <text className="chart-axis-label" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
            {formatValue(t)}
          </text>
        </g>
      ))}

      <polygon className="chart-area" points={area} />
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

      {active && <HoverReadout point={active} px={x(active.date)} py={y(active.value)} formatValue={formatValue} formatDate={formatDate} />}
    </svg>
  )
}

/** Crosshair + highlighted dot + a floating date/value tooltip for the hovered point. */
function HoverReadout({
  point,
  px,
  py,
  formatValue,
  formatDate,
}: {
  point: ValuePoint
  px: number
  py: number
  formatValue: (v: number) => string
  formatDate: (epochMs: number) => string
}): React.JSX.Element {
  const dateLabel = formatDate(point.date)
  const valueLabel = formatValue(point.value)
  const boxW = Math.max(dateLabel.length, valueLabel.length) * 7 + 16
  const boxH = 36
  // Prefer placing the box to the right of the point; flip left near the edge.
  const bx = px + 12 + boxW > W - PAD.right ? px - 12 - boxW : px + 12
  const by = Math.min(Math.max(py - boxH - 8, PAD.top), H - PAD.bottom - boxH)
  const tx = bx + 8

  return (
    <g pointerEvents="none">
      <line className="chart-crosshair" x1={px} x2={px} y1={PAD.top} y2={H - PAD.bottom} />
      <circle className="chart-hover-dot" cx={px} cy={py} r={4.5} />
      <rect className="chart-tooltip-bg" x={bx} y={by} width={boxW} height={boxH} rx={6} />
      <text className="chart-tooltip-date" x={tx} y={by + 14}>
        {dateLabel}
      </text>
      <text className="chart-tooltip-value" x={tx} y={by + 29}>
        {valueLabel}
      </text>
    </g>
  )
}
