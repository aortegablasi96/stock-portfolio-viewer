import type { ValuePoint } from '@shared/domain/performance'

/**
 * A dependency-free line chart for a value-over-time series (Milestone M3, Story #21).
 * Rendered as inline SVG so the app pulls in no charting library and stays
 * CSP-friendly. A single series needs no legend — the caller's heading names it.
 * Each vertex carries a native `<title>` tooltip (the hover layer); a data table
 * accompanies the chart in the view for the non-visual path.
 */
const W = 720
const H = 240
const PAD = { top: 16, right: 16, bottom: 28, left: 64 }

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

  return (
    <svg
      className="chart"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
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

      {points.map((p) => (
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
    </svg>
  )
}
