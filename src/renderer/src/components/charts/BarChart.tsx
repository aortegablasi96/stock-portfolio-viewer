import { useRef, useState } from 'react'
import type { ValuePoint } from '@shared/domain/performance'
import { PERFORMANCE_PLOT } from '../../lib/chartGeometry'
import { bandIndexAt, columnDomain } from '../../lib/column'
import { StatePanel } from '../ui/StatePanel'
import { ChartTooltip } from './ChartTooltip'

/**
 * A dense single-series bar chart over a signed value, drawn either side of a zero baseline
 * (Story #170). Built for the Performance view's daily-return chart: several hundred trading days,
 * one bar each, above the line for an up day and below it for a down day.
 *
 * **Why this is not `ColumnChart`.** That chart models two *stacked* series (`lower` + `upper`),
 * so it always carries a legend; it labels every column with its own `<text>`; and it widens its
 * `viewBox` by 56 units per column. Those are all correct for twelve months of dividend income and
 * all wrong here — 191 trading days would give a 10,800-unit-wide plot (a 45:1 strip) under 191
 * overlapping date labels, for a chart with one series and nothing to put in a legend. Making one
 * component serve both would mean conditioning the legend, the per-column labels, the width policy
 * and the fill policy on four flags: a fork wearing a shared name. So this is its own component,
 * and it reuses `columnDomain` — the part that genuinely is shared — for its value axis.
 *
 * **Density: thinner bars, never aggregation** (DDR-0049). The chart exists to show how often and
 * how hard the value moved, and rolling days up into weeks destroys exactly that: a week of
 * +3%/−3% swings nets out to a calm bar. So the `viewBox` is fixed and the bars thin with the
 * series, from a 24-unit slab for a handful of points down to a hairline for a multi-year window,
 * where the chart reads as a volatility envelope rather than a row of bars. That is the honest
 * degradation — still the shape of the ride, just at a distance.
 *
 * **Scrubbing is what gives the individual day back.** That density is the whole reason the chart
 * needs a hover readout and not the `<title>` element it shipped with: a native tooltip has to be
 * *aimed*, waits half a second, and at a hairline bar there is nothing left to aim at. Hit-testing
 * the band instead (`bandIndexAt`) means every x inside the plot names a day, so dragging across
 * the chart reads out the series continuously — which is how a reader finds the worst day of a
 * drawdown rather than the day they happened to click on. The card that readout is drawn in is
 * `ChartTooltip`, shared with the two curves beside it since Story #188; the hit-testing, the
 * clamping and the outlined active bar are unchanged by that move.
 */

/* The plot's aspect ratio, shared with the two other charts in the grid (Story #172, DDR-0051).
   Sharing it was already deliberate when the three sat in one switcher — nothing should jump when
   the selection changes — and it is load-bearing now that they sit side by side: two charts in one
   row plotting the same date range at different heights would read as different spans. */
const { width: W, height: H, pad: PAD } = PERFORMANCE_PLOT

/** Share of its band a bar occupies. The gap closes on its own as the series densifies. */
const BAR_FILL = 0.7
/**
 * A bar never thins past this, so one day in a multi-year window is still visible.
 *
 * Scaled with the plot in Story #172 (0.75 → 0.4): it is a floor on the *bar*, but a floor wider
 * than the band it sits in makes neighbouring bars overlap, and the plot is now 436 units wide
 * rather than 1000. At 0.4 that starts past 1,090 points — four years of trading days — where
 * DDR-0049's volatility envelope is what the chart is anyway.
 */
const MIN_BAR_W = 0.4
/** Widest a bar gets, so a five-point window renders bars rather than slabs. Also plot-relative. */
const MAX_BAR_W = 10

export function BarChart({
  points,
  formatValue,
  formatDate,
  ariaLabel,
  emptyMessage,
  seriesLabel,
}: {
  /** Signed values, oldest → newest. `value` is drawn against a zero baseline. */
  points: ValuePoint[]
  formatValue: (v: number) => string
  formatDate: (epochMs: number) => string
  ariaLabel: string
  emptyMessage: string
  /** Names the series in the hover card. Omitted where the card's date is answer enough. */
  seriesLabel?: string
}): React.JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  if (points.length === 0) {
    return <StatePanel surface="inline">{emptyMessage}</StatePanel>
  }

  const plotH = H - PAD.top - PAD.bottom
  const plotW = W - PAD.left - PAD.right
  // `columnDomain` already rounds outward to nice steps, always spans zero, and always puts a tick
  // on it — everything this axis needs. A single series is the degenerate stack: no upper segment.
  const { top, bottom, ticks } = columnDomain(points.map((p) => ({ lower: p.value, upper: 0 })))
  const span = top - bottom || 1

  // One band per point rather than a date-proportional axis: trading days are irregular, and
  // spacing bars by calendar distance would leave a gap every weekend and shrink the bars around
  // a holiday. Even bands are what "one bar per trading day" means.
  const band = plotW / points.length
  const barW = Math.min(MAX_BAR_W, Math.max(MIN_BAR_W, band * BAR_FILL))
  // Round the corner in proportion to the bar, so a hairline stays a hairline instead of a lozenge.
  const rx = Math.min(2, barW / 3)

  const y = (v: number): number => PAD.top + plotH - ((v - bottom) / span) * plotH
  const zeroY = y(0)

  const first = points[0]!
  const last = points[points.length - 1]!

  /** Map a pointer event to the day whose band it falls in (see `bandIndexAt`). */
  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const vbX = ((e.clientX - rect.left) / rect.width) * W
    setHover(bandIndexAt(vbX, PAD.left, plotW, points.length))
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
      {ticks.map((t, i) => {
        // The zero line is emphasised because it is the chart's second channel: a bar's side of it
        // states the sign without the reader having to resolve the colour (DDR-0021).
        const isZero = t === 0
        return (
          <g key={`${t}-${i}`}>
            <line
              className={isZero ? 'chart-zero' : 'chart-grid'}
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(t)}
              y2={y(t)}
            />
            <text className="chart-axis-label" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {formatValue(t)}
            </text>
          </g>
        )
      })}

      {/* No per-bar `<title>`: the readout below replaces it, and leaving both in place would
          float a slow native tooltip over the one that already answered the question. */}
      {points.map((p, i) => (
        <rect
          key={p.date}
          className={`${p.value < 0 ? 'chart-bar-loss' : 'chart-bar-gain'}${
            i === hover ? ' chart-bar-active' : ''
          }`}
          x={PAD.left + i * band + (band - barW) / 2}
          y={Math.min(zeroY, y(p.value))}
          width={barW}
          height={Math.abs(y(p.value) - zeroY)}
          rx={rx}
        />
      ))}

      {/* Only the endpoints are labelled. A label per bar is what makes `ColumnChart` unusable at
          this density, and the bars are evenly spaced, so the two ends give the reader the span. */}
      <text className="chart-axis-label" x={PAD.left} y={H - 8} textAnchor="start">
        {formatDate(first.date)}
      </text>
      {last.date !== first.date && (
        <text className="chart-axis-label" x={W - PAD.right} y={H - 8} textAnchor="end">
          {formatDate(last.date)}
        </text>
      )}

      {active && hover !== null && (
        <ChartTooltip
          anchorX={PAD.left + (hover + 0.5) * band}
          title={formatDate(active.date)}
          rows={[{ label: seriesLabel, value: formatValue(active.value) }]}
        />
      )}
    </svg>
  )
}
