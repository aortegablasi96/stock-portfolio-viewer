import { useState } from 'react'
import type { AllocationSlice } from '@shared/domain/allocation'
import { groupTail, sliceColorClasses, type PieDatum } from '../../lib/pie'
import { PieChart } from '../charts/PieChart'
import { StatePanel } from '../ui/StatePanel'
import { DataTable, type DataColumn } from '../ui/DataTable'

/**
 * One allocation breakdown (Milestone M3, Story #48): the composing slices as a table on
 * the left and the matching donut on the right. Both are driven by the same grouped slice
 * set (`groupTail` + `sliceColorClasses`), so a slice wears the same colour in the table
 * and the chart and the two reconcile — the table is, in effect, the donut's legend spread
 * out with tabular numbers.
 *
 * The redesign fixes the donut's column at 280px and puts a name + percentage legend back
 * under it (Story #191, DDR-0063). The pair is the story's whole point: the arc is where a
 * share is *seen*, the row beside it is where the exact figure is *read*, and both are on
 * screen at once. What links them is the slice's `key` and never its position — the table
 * sorts by any column, so row order and arc order have no reason to agree (DDR-0040).
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
  // The slice the pointer or keyboard is on, shared by both halves (Story #147). It lives here
  // rather than in either child because neither owns the pairing — the table and the donut are
  // the same slice set rendered twice, and this is the one thing they have to agree about.
  // `AllocationView` remounts this component per breakdown tab (`key={tab}`), so switching tabs
  // clears it without anything having to reset it.
  const [activeKey, setActiveKey] = useState<string | null>(null)

  const items = groupTail(toItems(slices))
  const colors = sliceColorClasses(items, colorOffset)

  if (items.length === 0) {
    return <StatePanel surface="inline">{emptyMessage}</StatePanel>
  }

  // The swatch is looked up by the slice's position in `items`, which is the order the donut
  // paints and the order the palette was assigned in — so it has to survive a re-sort. Resolving
  // it to a class per row here means the table can reorder freely and a slice keeps its colour.
  const colorByKey = new Map(items.map((item, i) => [item.key, colors[i]]))

  const columns: DataColumn<PieDatum>[] = [
    {
      key: 'label',
      header: 'Slice',
      rowHeader: true,
      className: 'data-table-swatch',
      cell: (item) => (
        <>
          <span className={`legend-swatch ${colorByKey.get(item.key)}`} aria-hidden="true" />
          {item.label}
        </>
      ),
      sortValue: (item) => item.label,
    },
    {
      key: 'value',
      header: 'Value',
      numeric: true,
      cell: (item) => formatValue(item.value),
      sortValue: (item) => item.value,
    },
    {
      key: 'percent',
      header: '% of NAV',
      numeric: true,
      cell: (item) => `${item.percent.toFixed(1)}%`,
      sortValue: (item) => item.percent,
    },
  ]

  return (
    <div className="breakdown-split">
      <DataTable
        caption={ariaLabel}
        columns={columns}
        rows={items}
        rowKey={(item) => item.key}
        activeRowKey={activeKey}
        onRowActivate={(key) => setActiveKey(typeof key === 'string' ? key : null)}
      />
      <div className="breakdown-chart">
        <PieChart
          data={items}
          formatValue={formatValue}
          ariaLabel={ariaLabel}
          colorOffset={colorOffset}
          activeKey={activeKey}
          onSliceActivate={setActiveKey}
        />
      </div>
    </div>
  )
}
