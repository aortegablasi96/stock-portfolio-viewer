import { useRef, useState } from 'react'
import type { CompositionBand, CompositionPoint } from '@shared/domain/performance'
import { PERFORMANCE_PLOT } from '../../lib/chartGeometry'
import { formatPercent } from '../../lib/format'
import { nearestIndex, shares, stackGeometry } from '../../lib/composition'
import { OTHER_KEY, sliceColorClasses } from '../../lib/pie'
import { StatePanel } from '../ui/StatePanel'

/**
 * A dependency-free 100%-stacked area chart for portfolio composition over time (Story #171,
 * DDR-0050). Inline SVG like every other chart here, so the app pulls in no charting library
 * and stays CSP-friendly.
 *
 * All of the maths — proportions, the signed stack, the vertical domain, the ribbon paths —
 * lives in `lib/composition`, which is where the interesting cases (negative cash, a zero-NAV
 * day, a band that appears partway through) are actually tested. What is left here is the DOM:
 * pointer tracking and the markup.
 *
 * Colour comes from the shared categorical palette via `sliceColorClasses`, at **no offset**:
 * `SECTOR_SLOT_OFFSET` reserves slot 1 for the Allocation map's weight donut and applies to
 * *sectors* only (DDR-0030), and an asset class is not a sector — so this chart keeps all eight
 * slots. The residual `other` band is mapped onto `OTHER_KEY` so it takes the palette's neutral
 * gray rather than consuming a hue, since it is not a category anyone named.
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
  formatDate,
  ariaLabel,
  emptyMessage,
}: {
  bands: CompositionBand[]
  points: CompositionPoint[]
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

  // `other` is a residual, not a named category, so it takes the neutral swatch the donuts
  // give their aggregated tail rather than a categorical hue.
  const colors = sliceColorClasses(
    bands.map((b) => ({ key: b.key === 'other' ? OTHER_KEY : b.key })),
  )

  const spanV = domain.max - domain.min || 1
  const y = (v: number): number =>
    H - PAD.bottom - ((v - domain.min) / spanV) * (H - PAD.top - PAD.bottom)

  // Always 0/50/100%, plus the domain edges when a negative band has pushed past them — so the
  // reader can see that stock is above 100% rather than just that the stack is taller.
  const ticks = [
    ...(domain.min < 0 ? [domain.min] : []),
    0,
    0.5,
    1,
    ...(domain.max > 1 ? [domain.max] : []),
  ]

  function onMove(e: React.MouseEvent<SVGSVGElement>): void {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    setHover(nearestIndex(xs, ((e.clientX - rect.left) / rect.width) * W))
  }

  const activeIndex = hover
  const activePoint = activeIndex !== null ? points[activeIndex] : undefined

  return (
    <figure className="chart-figure">
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
              {formatPercent(t)}
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
            formatDate={formatDate}
          />
        )}
      </svg>

      <figcaption className="chart-legend">
        {bands.map((band, i) => (
          <span className="legend-item" key={band.key}>
            <span className={`legend-swatch ${colors[i] ?? ''}`} aria-hidden="true" />
            {band.label}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

/**
 * Crosshair plus a tooltip listing every band's share on the hovered day. Unlike the line
 * chart's two-line readout this one grows with the band count, which is why the box height is
 * computed rather than fixed — four bands and a heading do not fit a 36-unit box.
 */
function HoverReadout({
  point,
  bands,
  px,
  formatDate,
}: {
  point: CompositionPoint
  bands: CompositionBand[]
  px: number
  formatDate: (epochMs: number) => string
}): React.JSX.Element {
  const pointShares = shares(point)
  const dateLabel = formatDate(point.date)

  const widest = Math.max(dateLabel.length, ...bands.map((b) => b.label.length + 8))
  const boxW = widest * 7 + 16
  const boxH = HEAD_H + bands.length * ROW_H + 8
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
      {bands.map((band, i) => (
        <text className="chart-tooltip-value" key={band.key} x={tx} y={by + HEAD_H + 10 + i * ROW_H}>
          {`${band.label}: ${formatPercent(pointShares[i] ?? 0)}`}
        </text>
      ))}
    </g>
  )
}
