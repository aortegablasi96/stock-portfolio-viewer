import { PERFORMANCE_PLOT } from '../../lib/chartGeometry'
import { tooltipLayout, type TooltipRow } from '../../lib/chartTooltip'

/**
 * The hover card the three time-series charts float over a scrubbed point (Story #188, DDR-0061).
 *
 * One component replacing three private `HoverReadout`s that had drifted apart while claiming to
 * be the same card. It draws the crosshair too, because a card without one names a point it does
 * not mark, and having the two in one place is what stops a chart from shipping half the readout.
 *
 * It renders **inside the plot's `<svg>`**, in viewBox units, and that is the substantive choice
 * (DDR-0061). The redesign's own tooltip is a `position: fixed` panel at the cursor, which in a
 * 2×2 grid hangs over the chart next door; a card in the `viewBox` cannot leave its own plot, so
 * the constraint is met by construction rather than by an offset someone has to keep tuned. It
 * also means the card scales with the chart, like every other mark (DDR-0018).
 *
 * The card is `pointerEvents="none"`, so it never interrupts the scrub it is reporting on — the
 * band beneath it stays hit-testable while the pointer crosses the card (DDR-0052).
 */
export function ChartTooltip({
  anchorX,
  title,
  rows,
}: {
  /** The scrubbed point's x, in viewBox units. The crosshair is drawn here. */
  anchorX: number
  /** The card's heading — the date, in every caller. */
  title: string
  /** One line per series. A row without a label is a single-series chart's bare figure. */
  rows: readonly TooltipRow[]
}): React.JSX.Element {
  const { pad: PAD, height: H } = PERFORMANCE_PLOT
  const box = tooltipLayout(anchorX, title, rows, PERFORMANCE_PLOT)

  return (
    <g className="chart-tooltip" pointerEvents="none">
      <line className="chart-crosshair" x1={anchorX} x2={anchorX} y1={PAD.top} y2={H - PAD.bottom} />
      <rect
        className="chart-tooltip-bg"
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        rx={8}
      />
      <text className="chart-tooltip-date" x={box.textX} y={box.titleY}>
        {title}
      </text>
      {rows.map((row, i) => (
        <g key={row.label ?? `row-${i}`}>
          {row.label !== undefined && (
            <text className="chart-tooltip-label" x={box.textX} y={box.rowYs[i]}>
              {row.label}
            </text>
          )}
          {/* A labelled row is two columns, so its figure is right-aligned and the decimal points
              line up down the card. A bare figure has no second column to align against and stays
              on the left margin, under the date. */}
          <text
            className="chart-tooltip-value"
            x={row.label === undefined ? box.textX : box.valueX}
            y={box.rowYs[i]}
            textAnchor={row.label === undefined ? 'start' : 'end'}
          >
            {row.value}
          </text>
        </g>
      ))}
    </g>
  )
}
