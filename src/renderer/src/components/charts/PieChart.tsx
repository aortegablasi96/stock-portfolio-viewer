import { groupTail, sliceColorClasses, toArcs, type PieDatum } from '../../lib/pie'

/**
 * A categorical donut chart (Milestone M3, Story #30). Slice angles come from the
 * base-currency market value; the legend and tooltips report each category's share of NAV.
 * Because every category's NAV share has the same denominator, angle order and relative
 * size are the same under either measure — only the denominator differs (NAV includes cash,
 * so the shown percentages don't sum to 100).
 *
 * Identity is never colour-alone: a legend is always present and every slice is direct-
 * labelled there with its value and percentage. Slices are separated by a 2px surface ring,
 * and the palette is the eight validated categorical slots — the tail folds into "Other"
 * rather than generating a ninth hue. Inline SVG, no charting dependency (DDR-0006).
 */
const SIZE = 200
const R_OUTER = 92
const R_INNER = 56

export function PieChart({
  data,
  formatValue,
  ariaLabel,
  emptyMessage = 'Nothing to plot yet.',
  showLegend = true,
  colorOffset = 0,
}: {
  data: PieDatum[]
  formatValue: (v: number) => string
  ariaLabel: string
  emptyMessage?: string
  /** When false, the donut renders without its legend — used where a composing-assets
   *  table already carries the labels/values (Story #48). */
  showLegend?: boolean
  /** Palette slots to skip — `SECTOR_SLOT_OFFSET` for the sector breakdown (Story #122). */
  colorOffset?: number
}): React.JSX.Element {
  const arcs = toArcs(groupTail(data), SIZE / 2, SIZE / 2, R_OUTER, R_INNER)

  if (arcs.length === 0) {
    return <p className="chart-empty">{emptyMessage}</p>
  }

  const seriesClass = sliceColorClasses(arcs, colorOffset)

  return (
    <figure className="chart-figure pie-figure">
      <svg
        className="pie"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={ariaLabel}
        preserveAspectRatio="xMidYMid meet"
      >
        {arcs.map((arc, i) => (
          <path key={arc.key} className={`pie-slice ${seriesClass[i]}`} d={arc.path}>
            <title>{`${arc.label} — ${formatValue(arc.value)} (${arc.percent.toFixed(1)}% of NAV)`}</title>
          </path>
        ))}
      </svg>
      {showLegend && (
        <figcaption className="chart-legend pie-legend">
          <ul className="pie-legend-list">
            {arcs.map((arc, i) => (
              <li key={arc.key} className="pie-legend-item">
                <span className={`legend-swatch ${seriesClass[i]}`} aria-hidden="true" />
                <span className="pie-legend-label">{arc.label}</span>
                <span className="pie-legend-value">
                  {formatValue(arc.value)}
                  <span className="bar-list-pct">{arc.percent.toFixed(1)}%</span>
                </span>
              </li>
            ))}
          </ul>
        </figcaption>
      )}
    </figure>
  )
}
