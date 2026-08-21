import { useRef, useState } from 'react'
import { bandIndexAt, columnDomain, columnPlot, stackedTooltipRows } from '../../lib/column'
import { StatePanel } from '../ui/StatePanel'
import { ChartTooltip } from './ChartTooltip'

/**
 * A stacked column chart over a time axis (Milestone M3, Story #23). Each column stacks a
 * `lower` segment and a non-negative `upper` segment (e.g. net income + withholding tax =
 * gross), so the full column height reads as the gross total. Two series, so a legend is
 * always present.
 *
 * The `lower` value may be negative: when a month's withholding exceeds the dividends
 * received, its net bar extends below a labelled zero baseline instead of clamping at zero,
 * drawn in the loss colour (red) rather than the positive "received" blue so a net-loss month
 * is unmistakable (Story #49). `upper` is still assumed non-negative. Inline SVG, no charting
 * dependency.
 *
 * **The legend moved into the card header** in Story #192 (DDR-0064), the same move DDR-0052
 * made for the composition stack and for the same two reasons: a key is read *before* the plot
 * rather than after it, and a `<figcaption>` under the plot is height the card's neighbours do
 * not have. `IncomeLegend` below is what the view renders there, so this component emits a bare
 * `<svg>`.
 *
 * **Story #236 took the native `<title>` off both segments and gave the chart the app's hover
 * card**, the last of the four to get it (#188, #220). Three things came with the move and each
 * of them is why it was worth making rather than restyling a `<title>`:
 *
 * - the hit target is the **band**, as it is in `BarChart` — so a month with nothing to draw is
 *   still hoverable, which a `<title>` on a zero-height rect never was;
 * - the card is **drawn in this plot's own `viewBox`**, which is why `columnPlot` exists: the
 *   three Performance charts share a fixed geometry and this one widens with its history, so the
 *   card has to be laid out against the plot it is actually in (DDR-0061);
 * - the card reports the whole column — total, upper, lower — where the `<title>` did, but
 *   **omits a row it has no figure for** and tones the signed one. `stackedTooltipRows` owns
 *   both rules, because neither can be seen from a test that cannot render (DDR-0029).
 *
 * The card renders smaller on screen at a long history, and that is the chart rather than the
 * card: the `viewBox` widens by 56 units a column while the card stays the size it is, so it
 * keeps exactly the relationship to the axis labels beside it that it has at twelve months. A
 * card fixed in page pixels is the version that misbehaves — it would grow against the plot as
 * the history lengthened until it covered the columns it was reporting on (DDR-0018).
 */
export interface StackedColumn {
  key: string
  label: string
  /** Signed lower segment (net); drawn below the zero line when negative. */
  lower: number
  /** Non-negative upper segment (withholding), stacked above a positive lower. */
  upper: number
}

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
  /** Names the lower segment in the hover card — the signed one, and the only toned row. */
  lowerLabel: string
  /** Names the segment stacked at the column's top, in the card and in the key beside it. */
  upperLabel: string
  /** When set, the hover card also reports the full column height under this name. */
  totalLabel?: string
  ariaLabel: string
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  if (columns.length === 0) {
    return <StatePanel surface="inline">No income to plot over time yet.</StatePanel>
  }

  const plot = columnPlot(columns.length)
  const { width: W, height: H, pad: PAD } = plot
  const plotH = H - PAD.top - PAD.bottom
  const plotW = W - PAD.left - PAD.right
  const { top, bottom, ticks } = columnDomain(columns)
  const span = top - bottom || 1
  const band = plotW / columns.length
  const barW = Math.min(40, band * 0.62)
  // Map a value to its y pixel; the domain spans zero so bars can sit either side of it.
  const y = (v: number): number => PAD.top + plotH - ((v - bottom) / span) * plotH
  const zeroY = y(0)

  /** Map a pointer event to the month whose band it falls in (see `bandIndexAt`). */
  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vbX = ((e.clientX - rect.left) / rect.width) * W
    setHover(bandIndexAt(vbX, PAD.left, plotW, columns.length))
  }

  const active = hover !== null ? columns[hover] : undefined

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
        // A below-zero net (withholding outweighed the dividends) is a loss, so its bar
        // switches from the positive "received" blue to the loss red (Story #49 refinement).
        const lowerClass = c.lower < 0 ? 'chart-bar-lower chart-bar-loss' : 'chart-bar-lower'
        return (
          <g key={c.key}>
            {/* No per-segment `<title>`: the hover card below replaces it, and leaving both would
                float a slow native tooltip over the one that already answered the question — the
                same note `BarChart` carries, arriving here two stories later (Story #236). */}
            <rect className={lowerClass} x={cx} y={lowerTop} width={barW} height={lowerH} rx={2} />
            {stackUpper && (
              <rect
                className="chart-bar-upper"
                x={cx}
                y={y(gross)}
                width={barW}
                height={upperH}
                rx={2}
              />
            )}
            <text className="chart-axis-label" x={cx + barW / 2} y={H - 10} textAnchor="middle">
              {c.label}
            </text>
          </g>
        )
      })}

      {/* The card is what carries a negative month's explanation now. Where withholding outweighs
          the dividends, the upper segment is not drawn at all — it cannot stack across zero
          without overlapping the downward bar — so the withholding is a figure the chart states
          and does not draw, which is exactly the job the `<title>` used to have (Story #49). */}
      {active && hover !== null && (
        <ChartTooltip
          plot={plot}
          anchorX={PAD.left + (hover + 0.5) * band}
          title={active.label}
          rows={stackedTooltipRows(
            active,
            { total: totalLabel, upper: upperLabel, lower: lowerLabel },
            formatValue,
          )}
        />
      )}
    </svg>
  )
}

/**
 * The stack's key, rendered into the income card's **header** rather than under the plot
 * (Story #192, DDR-0064) — the placement DDR-0052 settled for the composition stack.
 *
 * It takes the same labels the hover card uses, so the key cannot name one thing while the column
 * under the pointer names another. The swatches are `aria-hidden`: the label beside each is the
 * text, and a screen reader reading "square, Withholding tax" gains nothing.
 *
 * **The key names the column, not the segment** (Story #236). It read `Net received` /
 * `Withholding tax` — two segment names for a chart whose *height* is the figure the view is
 * about, so the one number the reader came for was named nowhere on the card and only inside a
 * native tooltip. `columnLabel` names the whole column and `upperLabel` the part stacked at its
 * top; what is left below is the net, which the hover card gives with the other two rather than
 * taking a third swatch here for a segment the reader can already see.
 */
export function IncomeLegend({
  columnLabel,
  upperLabel,
}: {
  /** Names the column's full height — the chart's headline figure. */
  columnLabel: string
  /** Names the segment stacked at the top of it. */
  upperLabel: string
}): React.JSX.Element {
  return (
    <p className="chart-legend chart-legend-header">
      <span className="legend-item">
        <span className="legend-swatch legend-swatch-lower" aria-hidden="true" /> {columnLabel}
      </span>
      <span className="legend-item">
        <span className="legend-swatch legend-swatch-upper" aria-hidden="true" /> {upperLabel}
      </span>
    </p>
  )
}
