import { groupTail, sliceColorClasses, toArcs, type PieDatum } from '../../lib/pie'
import { sliceClassName, sliceEmphasis } from '../../lib/sliceHighlight'
import { StatePanel } from '../ui/StatePanel'

/**
 * A categorical donut chart (Milestone M3, Story #30). Slice angles come from the
 * base-currency market value; the legend and tooltips report each category's share of NAV.
 * Because every category's NAV share has the same denominator, angle order and relative
 * size are the same under either measure — only the denominator differs (NAV includes cash,
 * so the shown percentages don't sum to 100).
 *
 * Identity is never colour-alone: a legend is always present and every slice is direct-
 * labelled there with its name and its share. Slices are separated by a 2px surface ring,
 * and the palette is the eight validated categorical slots — the tail folds into "Other"
 * rather than generating a ninth hue. Inline SVG, no charting dependency (DDR-0006).
 *
 * The legend used to be optional, and off at its one call site: the breakdown's table said
 * everything it did and more (Story #48). Story #191 made it unconditional and cut it back to
 * a name and a percentage — the two things the table cannot supply, which are the hue's
 * meaning and what the arc under the cursor came to. Value stays in the slice's `<title>`
 * and in the table, each of them once.
 */
const SIZE = 200
const R_OUTER = 92
const R_INNER = 56

export function PieChart({
  data,
  formatValue,
  ariaLabel,
  emptyMessage = 'Nothing to plot yet.',
  colorOffset = 0,
  activeKey = null,
  onSliceActivate,
}: {
  data: PieDatum[]
  formatValue: (v: number) => string
  ariaLabel: string
  emptyMessage?: string
  /** Palette slots to skip — `SECTOR_SLOT_OFFSET` for the sector breakdown (Story #122). */
  colorOffset?: number
  /** The slice to emphasise — the table row under the pointer, where the two are linked
   *  (Story #147). Everything else mutes; `null` is the whole chart at rest. */
  activeKey?: string | null
  /** Reports the slice the pointer is on, and `null` when it leaves (Story #147). */
  onSliceActivate?: (key: string | null) => void
}): React.JSX.Element {
  const arcs = toArcs(groupTail(data), SIZE / 2, SIZE / 2, R_OUTER, R_INNER)

  if (arcs.length === 0) {
    return <StatePanel surface="inline">{emptyMessage}</StatePanel>
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
          <path
            key={arc.key}
            className={sliceClassName(seriesClass[i] ?? '', sliceEmphasis(activeKey, arc.key))}
            d={arc.path}
            onMouseEnter={onSliceActivate ? () => onSliceActivate(arc.key) : undefined}
            onMouseLeave={onSliceActivate ? () => onSliceActivate(null) : undefined}
          >
            {/* The native tooltip stays: it is what the donut says on its own, in the views
                that render it without a table beside it. */}
            <title>{`${arc.label} — ${formatValue(arc.value)} (${arc.percent.toFixed(1)}% of NAV)`}</title>
          </path>
        ))}
      </svg>
      <figcaption className="chart-legend pie-legend">
        <ul className="pie-legend-list">
          {arcs.map((arc, i) => (
            <li key={arc.key} className="pie-legend-item">
              <span className={`legend-swatch ${seriesClass[i]}`} aria-hidden="true" />
              <span className="pie-legend-label">{arc.label}</span>
              <span className="pie-legend-value">{arc.percent.toFixed(1)}%</span>
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  )
}
