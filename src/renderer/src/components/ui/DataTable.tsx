import { useState, type ReactNode } from 'react'
import { CardHeader, CardTitle } from './Card'
import {
  DEFAULT_DATA_TABLE_HEIGHT,
  DEFAULT_DATA_TABLE_SURFACE,
  dataTableCellClassName,
  dataTableCellKindClassName,
  dataTableRowClassName,
  dataTableScrollClassName,
  type DataTableHeight,
  type DataTableSurface,
} from '../../lib/dataTableVariants'
import {
  ariaSortFor,
  defaultDirectionFor,
  directionFor,
  nextSortState,
  sortGlyph,
  sortRows,
  type SortState,
  type SortValue,
} from '../../lib/tableSort'

/**
 * One column. A column is a *description* rather than markup, which is what lets the table own
 * the header — the sort control has to live in the header cell, and a call site handing over
 * `<thead>` would have to build it twelve times.
 *
 * Sorting is opt-in per column: a column with a `sortValue` gets a header button, one without
 * gets the plain header it always had. That keeps the axis honest — the receipt of an import
 * has nothing worth reordering, while a positions table has seven columns that do.
 */
export interface DataColumn<T> {
  /** Stable identity: the React key and the key the sort state names. */
  key: string
  /** The header's label. Interpolated units belong here — `Net in ${baseCurrency}`. */
  header: ReactNode
  /** A figure: right-aligned, `tabular-nums`, and opening descending when first sorted. */
  numeric?: boolean
  /** The row's own name, rendered as its `<th scope="row">`. At most one column per table. */
  rowHeader?: boolean
  /** A class on every body cell in the column — `data-table-note` for a muted secondary cell. */
  className?: string
  /** A class this row contributes to its own cell: the tone of a signed figure (DDR-0034). */
  cellClassName?: (row: T) => string
  cell: (row: T) => ReactNode
  /**
   * The value the comparator sees, or absent for a column that does not sort. Return `null`
   * for a row that has no value — it is ordered by the missing-value rule rather than as a
   * zero or an empty string (see `lib/tableSort`).
   */
  sortValue?: (row: T) => SortValue
}

/**
 * The app's one data table (Story #134, DDR-0039), replacing the four rules the Epic #125 audit
 * found for it: `.holdings-table` and `.breakdown-table`, which declared their own cell padding
 * and header treatment, and `.table-scroll` / `.table-scroll-rows`, which added a scroll
 * container, a sticky header, a five-row cap and a scroll fade to some tables and not others
 * for no stated reason. The `.card-content .table-scroll` override that undid the container's
 * border inside a panel goes with them: the container no longer draws one.
 *
 * It also closes the gap the audit named — **no table in the app sorted**. Every table rendered
 * in whatever order its service returned, so finding the largest position or the worst trade
 * meant reading every row. Sorting is the third axis beside the time range and type filters
 * already in place (DDR-0017), and it composes with them rather than replacing them: the view
 * filters, the table reorders what survives, and the "N of M shown" count is unaffected because
 * reordering a list cannot change its length.
 *
 * Sort state is `useState` here and nothing more, which is all it takes to survive a tab switch:
 * an analytics tab mounts on first visit and then stays mounted (DDR-0027), so the state is
 * never discarded and never has to be restored.
 *
 * The header's sort control is not a `Button`. The header cell already *is* the box — it carries
 * the padding, the sticky background and the uppercase label — and a `.btn` inside it would draw
 * a second box within that one. DDR-0032's variants carry colour and a border, and a column
 * header has neither; what it needs is to fill its cell, which is the same reasoning that keeps
 * the real tablist out of `ToggleGroup` (DDR-0036).
 */
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  surface = DEFAULT_DATA_TABLE_SURFACE,
  height = DEFAULT_DATA_TABLE_HEIGHT,
  activeRowKey = null,
  onRowActivate,
  notice,
  title,
  className,
}: {
  /** Names the table for a screen reader. Required: a table of figures with sortable headers
   *  that announces itself as "table" and nothing else is a table nobody can navigate to. */
  caption: string
  columns: DataColumn<T>[]
  rows: readonly T[]
  rowKey: (row: T, index: number) => string | number
  surface?: DataTableSurface
  height?: DataTableHeight
  /**
   * The row linked to something outside the table — the donut slice under the pointer, in the
   * one view that pairs them (Story #147). Keyed, never positional, so the link stays correct
   * after the table is re-sorted.
   */
  activeRowKey?: string | number | null
  /**
   * Reports the row the pointer or keyboard focus is on, and `null` when it leaves. Supplying
   * it is what makes rows focusable — the pairing must not be pointer-only.
   */
  onRowActivate?: (key: string | number | null) => void
  /** A line above the table, inside its container — the dashboard's unconverted-rows notice. */
  notice?: ReactNode
  /**
   * A visible name, on the ruled strip every card in the app states its title on (Story #263).
   *
   * Only the table that brings its own surface has anywhere to put one: the other eleven sit in a
   * `CardContent` whose card has already drawn the strip above them, and a second title inside the
   * body would be the same name twice. So this is not an axis — it is the slot that makes
   * `surface="card"` a whole card rather than a bordered box, and it composes with `caption`
   * rather than replacing it. `caption` still names the *table* for a screen reader; this names
   * the *card*, exactly as `CardTitle` does beside a `caption` in `StoredStatementsCard`.
   */
  title?: string
  /** Placement only: how the container sits in the layout around it (ADR-0008). */
  className?: string
}): React.JSX.Element {
  const [sort, setSort] = useState<SortState | null>(null)

  // A sort naming a column that no longer exists — or one that stopped being sortable — falls
  // back to the order the service returned, rather than rendering an order nothing explains.
  const sortedColumn = sort === null ? undefined : columns.find((c) => c.key === sort.key)
  const sortValue = sortedColumn?.sortValue
  const visible =
    sort !== null && sortValue !== undefined ? sortRows(rows, sortValue, sort.direction) : rows

  const toggle = (column: DataColumn<T>): void => {
    setSort((current) =>
      nextSortState(current, column.key, defaultDirectionFor(column.numeric === true)),
    )
  }

  return (
    <div className={dataTableScrollClassName(surface, height, className)}>
      {title !== undefined && (
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
      )}
      {notice}
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <HeaderCell key={column.key} column={column} sort={sort} onSort={toggle} />
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => {
            const key = rowKey(row, index)
            // Rows become a tab stop only where the view links them to something else, so an
            // ordinary table adds nothing to the tab order. `onFocus`/`onBlur` sit beside the
            // pointer handlers rather than replacing them: the pairing has to be reachable
            // without a mouse, and reading it is the whole point of the link.
            const linked = onRowActivate !== undefined
            return (
              <tr
                key={key}
                className={dataTableRowClassName(key === activeRowKey) || undefined}
                tabIndex={linked ? 0 : undefined}
                onMouseEnter={linked ? () => onRowActivate(key) : undefined}
                onMouseLeave={linked ? () => onRowActivate(null) : undefined}
                onFocus={linked ? () => onRowActivate(key) : undefined}
                onBlur={linked ? () => onRowActivate(null) : undefined}
              >
                {columns.map((column) => (
                  <BodyCell key={column.key} column={column} row={row} />
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * A header cell, with a sort button where the column offers one. `aria-sort` is on the cell —
 * including `none` on a sortable column that is not the sorted one, which is what tells a
 * screen-reader user the control exists before they activate it.
 */
function HeaderCell<T>({
  column,
  sort,
  onSort,
}: {
  column: DataColumn<T>
  sort: SortState | null
  onSort: (column: DataColumn<T>) => void
}): React.JSX.Element {
  // Only the numeric treatment reaches the header: a column's own class is a body-cell rule
  // (the truncation on a description) and applying it to the label would narrow the header too.
  const className = column.numeric === true ? dataTableCellKindClassName('num') : undefined

  if (column.sortValue === undefined) {
    return (
      <th scope="col" className={className}>
        {column.header}
      </th>
    )
  }

  const direction = directionFor(sort, column.key)
  return (
    <th scope="col" className={className} aria-sort={ariaSortFor(sort, column.key)}>
      <button
        type="button"
        className={dataTableCellClassName('data-table-sort', direction !== null && 'is-sorted')}
        onClick={() => onSort(column)}
      >
        {column.header}
        <span className="data-table-sort-glyph" aria-hidden="true">
          {sortGlyph(direction)}
        </span>
      </button>
    </th>
  )
}

/** A body cell: the row's name as a `<th scope="row">`, everything else a `<td>`. */
function BodyCell<T>({ column, row }: { column: DataColumn<T>; row: T }): React.JSX.Element {
  const className =
    dataTableCellClassName(
      column.numeric === true && dataTableCellKindClassName('num'),
      column.rowHeader === true && dataTableCellKindClassName('name'),
      column.className,
      column.cellClassName?.(row),
    ) || undefined

  if (column.rowHeader === true) {
    return (
      <th scope="row" className={className}>
        {column.cell(row)}
      </th>
    )
  }
  return <td className={className}>{column.cell(row)}</td>
}
