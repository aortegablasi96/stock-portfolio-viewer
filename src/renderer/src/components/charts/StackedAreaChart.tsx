import { useRef, useState } from 'react'
import type { CompositionBand, CompositionPoint } from '@shared/domain/performance'
import { PERFORMANCE_PLOT } from '../../lib/chartGeometry'
import { formatPercent } from '../../lib/format'
import { compositionColors, nearestIndex, shares, stackGeometry } from '../../lib/composition'
import { StatePanel } from '../ui/StatePanel'

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
 * Colour comes from `compositionColors` (`lib/composition`), which both this chart and its legend
 * call so the two cannot disagree. Those hues are then **softened, and only here**: `.stack-band`
 * carries a lowered fill opacity, so eight saturated slabs covering most of a card read as a
 * background the curves beside them can be understood against. The classes are unchanged, so one
 * asset class still means one hue everywhere — this is the same colour, quieter. The legend
 * swatches are softened by the same amount, or the key would no longer match the thing it keys.
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
   matter more rather than less. */
const { width: W, height: H, pad: PAD } = PERFORMANCE_PLOT

/** Tooltip row metrics, in viewBox units. */
const ROW_H = 14
const HEAD_H = 18

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
  const [hover, setHover] = useState<number | null>(null)

  const { paths, domain, xs } = stackGeometry(points, bands.length, {
    width: W,
    height: H,
    pad: PAD,
  })

  if (paths.length === 0) {
    return <StatePanel surface="inline">{emptyMessage}</StatePanel>
  }

  const colors = compositionColors(bands)

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

      {paths.map((path, i) => (
        <path key={bands[i]?.key ?? i} className={`stack-band ${colors[i] ?? ''}`} d={path} />
      ))}

      <text className="chart-axis-label" x={PAD.left} y={H - 8} textAnchor="start">
        {formatDate(points[0]?.date ?? 0)}
      </text>
      <text className="chart-axis-label" x={W - PAD.right} y={H - 8} textAnchor="end">
        {formatDate(points[points.length - 1]?.date ?? 0)}
      </text>

        {activePoint && activeIndex !== null && (
        <HoverReadout
          point={activePoint}
          bands={bands}
          px={xs[activeIndex] ?? 0}
          formatValue={formatValue}
          formatDate={formatDate}
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
 * It draws its colours from `compositionColors`, the same call the chart makes, so the key cannot
 * drift from the bands it keys. Rendering nothing for an empty band list keeps the header a plain
 * title in the state where the chart is showing its empty message.
 */
export function CompositionLegend({ bands }: { bands: CompositionBand[] }): React.JSX.Element | null {
  if (bands.length === 0) return null
  const colors = compositionColors(bands)

  return (
    <p className="chart-legend chart-legend-header composition-legend">
      {bands.map((band, i) => (
        <span className="legend-item" key={band.key}>
          <span className={`legend-swatch ${colors[i] ?? ''}`} aria-hidden="true" />
          {band.label}
        </span>
      ))}
    </p>
  )
}

/**
 * Crosshair plus a tooltip listing every band on the hovered day. Unlike the line chart's
 * two-line readout this one grows with the band count, which is why the box height is computed
 * rather than fixed — four bands, a heading and a total do not fit a 36-unit box.
 *
 * Each row carries **both** the amount and the share of NAV, because the chart lost one of them
 * when it stopped being normalised (DDR-0052) and neither answers the other's question: the
 * amount says what the band is worth, the share says whether it matters. The **Total** row is new
 * with the cumulative stack — the top edge of the stack is now a number a reader will want to
 * read, and on a day when a band is negative it is not the top edge of anything drawn.
 */
function HoverReadout({
  point,
  bands,
  px,
  formatValue,
  formatDate,
}: {
  point: CompositionPoint
  bands: CompositionBand[]
  px: number
  formatValue: (v: number) => string
  formatDate: (epochMs: number) => string
}): React.JSX.Element {
  const pointShares = shares(point)
  const dateLabel = formatDate(point.date)

  const rows = bands.map(
    (band, i) =>
      `${band.label}: ${formatValue(point.values[i] ?? 0)} (${formatPercent(pointShares[i] ?? 0)})`,
  )
  const totalRow = `Total: ${formatValue(point.total)}`

  const widest = Math.max(dateLabel.length, totalRow.length, ...rows.map((r) => r.length))
  const boxW = widest * 7 + 16
  const boxH = HEAD_H + (rows.length + 1) * ROW_H + 8
  const bx = px + 12 + boxW > W - PAD.right ? px - 12 - boxW : px + 12
  const by = PAD.top
  const tx = bx + 8

  return (
    <g pointerEvents="none">
      <line className="chart-crosshair" x1={px} x2={px} y1={PAD.top} y2={H - PAD.bottom} />
      <rect className="chart-tooltip-bg" x={bx} y={by} width={boxW} height={boxH} rx={6} />
      <text className="chart-tooltip-date" x={tx} y={by + 13}>
        {dateLabel}
      </text>
      {rows.map((row, i) => (
        <text
          className="chart-tooltip-value"
          key={bands[i]?.key ?? i}
          x={tx}
          y={by + HEAD_H + 10 + i * ROW_H}
        >
          {row}
        </text>
      ))}
      {/* The total is separated from the bands it sums by taking the muted date treatment
          rather than a rule — a hairline inside a 7-unit-tall row reads as a rendering seam. */}
      <text className="chart-tooltip-date" x={tx} y={by + HEAD_H + 10 + rows.length * ROW_H}>
        {totalRow}
      </text>
    </g>
  )
}
