/**
 * A stacked column chart over a time axis (Milestone M3, Story #23). Each column
 * stacks a `lower` segment on a `upper` segment (e.g. net income + withholding tax =
 * gross), so the full column height reads as the gross total. Two series, so a legend
 * is always present; each segment carries a native `<title>` tooltip that also reports
 * the stacked total when `totalLabel` is given (Story #31). Inline SVG, no charting
 * dependency. Values are assumed non-negative.
 */
export interface StackedColumn {
  key: string
  label: string
  lower: number
  upper: number
}

const H = 240
const PAD = { top: 16, right: 16, bottom: 30, left: 64 }

export function ColumnChart({
  columns,
  formatValue,
  lowerLabel,
  upperLabel,
  totalLabel,
  ariaLabel,
}: {
  columns: StackedColumn[]
  formatValue: (v: number) => string
  lowerLabel: string
  upperLabel: string
  /** When set, each segment's tooltip also reports the full column height under this name. */
  totalLabel?: string
  ariaLabel: string
}): React.JSX.Element {
  if (columns.length === 0) {
    return <p className="chart-empty">No income to plot over time yet.</p>
  }

  // Widen the viewBox with the column count so bars stay legible for long histories.
  const W = Math.max(720, PAD.left + PAD.right + columns.length * 56)
  const plotH = H - PAD.top - PAD.bottom
  const plotW = W - PAD.left - PAD.right
  const max = Math.max(...columns.map((c) => c.lower + c.upper), 0) || 1
  const band = plotW / columns.length
  const barW = Math.min(40, band * 0.62)
  const h = (v: number): number => (v / max) * plotH
  const ticks = [0, max / 2, max]

  return (
    <figure className="chart-figure">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((t) => {
          const yy = PAD.top + plotH - h(t)
          return (
            <g key={t}>
              <line className="chart-grid" x1={PAD.left} x2={W - PAD.right} y1={yy} y2={yy} />
              <text className="chart-axis-label" x={PAD.left - 8} y={yy} dy="0.32em" textAnchor="end">
                {formatValue(t)}
              </text>
            </g>
          )
        })}

        {columns.map((c, i) => {
          const cx = PAD.left + i * band + (band - barW) / 2
          const lowerH = h(Math.max(0, c.lower))
          const upperH = h(Math.max(0, c.upper))
          const baseY = PAD.top + plotH
          // Reading the net segment alone loses the total, so each tooltip repeats the
          // whole column: value, counterpart, and (optionally) the stacked total.
          const tip = (label: string, value: number): string =>
            [
              `${c.label} — ${label}: ${formatValue(value)}`,
              totalLabel ? `${totalLabel}: ${formatValue(c.lower + c.upper)}` : null,
            ]
              .filter((line) => line !== null)
              .join('\n')
          return (
            <g key={c.key}>
              <rect className="chart-bar-lower" x={cx} y={baseY - lowerH} width={barW} height={lowerH} rx={2}>
                <title>{tip(lowerLabel, c.lower)}</title>
              </rect>
              <rect
                className="chart-bar-upper"
                x={cx}
                y={baseY - lowerH - upperH}
                width={barW}
                height={upperH}
                rx={2}
              >
                <title>{tip(upperLabel, c.upper)}</title>
              </rect>
              <text className="chart-axis-label" x={cx + barW / 2} y={H - 10} textAnchor="middle">
                {c.label}
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="chart-legend">
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-lower" aria-hidden="true" /> {lowerLabel}
        </span>
        <span className="legend-item">
          <span className="legend-swatch legend-swatch-upper" aria-hidden="true" /> {upperLabel}
        </span>
      </figcaption>
    </figure>
  )
}
