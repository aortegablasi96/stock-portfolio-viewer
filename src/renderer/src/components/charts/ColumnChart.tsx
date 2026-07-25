import { columnDomain } from '../../lib/column'

/**
 * A stacked column chart over a time axis (Milestone M3, Story #23). Each column stacks a
 * `lower` segment and a non-negative `upper` segment (e.g. net income + withholding tax =
 * gross), so the full column height reads as the gross total. Two series, so a legend is
 * always present; each segment carries a native `<title>` tooltip reporting the whole
 * breakdown, including the stacked total when `totalLabel` is given (Story #31).
 *
 * The `lower` value may be negative: when a month's withholding exceeds the dividends
 * received, its net bar extends below a labelled zero baseline instead of clamping at zero
 * (Story #49). `upper` is still assumed non-negative. Inline SVG, no charting dependency.
 */
export interface StackedColumn {
  key: string
  label: string
  /** Signed lower segment (net); drawn below the zero line when negative. */
  lower: number
  /** Non-negative upper segment (withholding), stacked above a positive lower. */
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
  const { top, bottom, ticks } = columnDomain(columns)
  const span = top - bottom || 1
  const band = plotW / columns.length
  const barW = Math.min(40, band * 0.62)
  // Map a value to its y pixel; the domain spans zero so bars can sit either side of it.
  const y = (v: number): number => PAD.top + plotH - ((v - bottom) / span) * plotH
  const zeroY = y(0)

  return (
    <figure className="chart-figure">
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((t, i) => {
          const yy = y(t)
          // The zero line is emphasised so positive and negative months read as either side of it.
          const isZero = t === 0
          return (
            <g key={`${t}-${i}`}>
              <line
                className={isZero ? 'chart-zero' : 'chart-grid'}
                x1={PAD.left}
                x2={W - PAD.right}
                y1={yy}
                y2={yy}
              />
              <text className="chart-axis-label" x={PAD.left - 8} y={yy} dy="0.32em" textAnchor="end">
                {formatValue(t)}
              </text>
            </g>
          )
        })}

        {columns.map((c, i) => {
          const cx = PAD.left + i * band + (band - barW) / 2
          const gross = c.lower + c.upper
          // The net (lower) segment runs from the zero line to `lower` — upward when positive,
          // downward past the baseline when negative. Its rect is anchored by the higher edge.
          const lowerTop = Math.min(zeroY, y(c.lower))
          const lowerH = Math.abs(y(c.lower) - zeroY)
          // Withholding stacks on top of a positive net (`lower` → `gross`). A negative-net
          // month can't stack across zero without overlapping the downward bar, so it's shown
          // through the tooltip alone rather than a second rect.
          const stackUpper = c.lower >= 0 && c.upper > 0
          const upperH = stackUpper ? y(c.lower) - y(gross) : 0
          // Each tooltip repeats the whole column so reading one segment never loses the rest.
          const tip = (): string =>
            [
              c.label,
              `${lowerLabel}: ${formatValue(c.lower)}`,
              `${upperLabel}: ${formatValue(c.upper)}`,
              totalLabel ? `${totalLabel}: ${formatValue(gross)}` : null,
            ]
              .filter((line) => line !== null)
              .join('\n')
          return (
            <g key={c.key}>
              <rect className="chart-bar-lower" x={cx} y={lowerTop} width={barW} height={lowerH} rx={2}>
                <title>{tip()}</title>
              </rect>
              {stackUpper && (
                <rect
                  className="chart-bar-upper"
                  x={cx}
                  y={y(gross)}
                  width={barW}
                  height={upperH}
                  rx={2}
                >
                  <title>{tip()}</title>
                </rect>
              )}
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
