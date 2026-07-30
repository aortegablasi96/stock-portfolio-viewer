import type { AllocationSlice } from '@shared/domain/allocation'
import { groupTail, sliceColorClasses, type PieDatum } from '../../lib/pie'
import { PieChart } from '../charts/PieChart'

/**
 * One allocation breakdown (Milestone M3, Story #48): the composing slices as a table on
 * the left and the matching donut on the right. Both are driven by the same grouped slice
 * set (`groupTail` + `sliceColorClasses`), so a slice wears the same colour in the table
 * and the chart and the two reconcile — the table is, in effect, the donut's legend spread
 * out with tabular numbers, which is why the donut here renders without its own legend.
 */
function toItems(slices: AllocationSlice[]): PieDatum[] {
  return slices.map((s) => ({
    key: s.key,
    label: s.label,
    value: s.marketValueBase,
    percent: s.percentOfNav,
  }))
}

export function AllocationBreakdown({
  slices,
  formatValue,
  ariaLabel,
  colorOffset = 0,
  emptyMessage = 'Nothing to plot yet.',
}: {
  slices: AllocationSlice[]
  formatValue: (v: number) => string
  ariaLabel: string
  /** Palette slots to skip — `SECTOR_SLOT_OFFSET` for the sector breakdown (Story #122). */
  colorOffset?: number
  emptyMessage?: string
}): React.JSX.Element {
  const items = groupTail(toItems(slices))
  const colors = sliceColorClasses(items, colorOffset)

  if (items.length === 0) {
    return <p className="chart-empty">{emptyMessage}</p>
  }

  return (
    <div className="breakdown-split">
      <div className="table-scroll breakdown-table">
        <table className="holdings-table">
          <thead>
            <tr>
              <th scope="col">Slice</th>
              <th scope="col" className="num">Value</th>
              <th scope="col" className="num">% of NAV</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.key}>
                <th scope="row" className="symbol">
                  <span className={`legend-swatch ${colors[i]}`} aria-hidden="true" />
                  {item.label}
                </th>
                <td className="num">{formatValue(item.value)}</td>
                <td className="num">{item.percent.toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="breakdown-chart">
        <PieChart
          data={items}
          formatValue={formatValue}
          ariaLabel={ariaLabel}
          showLegend={false}
          colorOffset={colorOffset}
        />
      </div>
    </div>
  )
}
