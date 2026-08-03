/**
 * Column sorting for the `DataTable` primitive (Story #134, DDR-0039).
 *
 * Kept out of the component for the reason every other renderer helper in this folder is:
 * Vitest runs Node-only, so nothing inside a React component is testable (DDR-0029). The
 * comparator, the missing-value rule, the toggle and the direction a column opens in are the
 * parts worth pinning, so they live here and the component only holds the `useState`.
 *
 * Sorting sits *after* filtering, never instead of it: a view narrows its rows by time range
 * and type first (DDR-0017), and `sortRows` reorders whatever survives. That is what keeps the
 * "N of M shown" count correct — reordering a list cannot change its length.
 */

/**
 * What a column offers the comparator. `null`/`undefined` is a genuine absence — an
 * unconvertible holding's display value (DDR-0007), a trade IBKR reports without a timestamp,
 * a position with no sector — and is ordered by the missing-value rule below rather than by
 * the comparator. A column yields one type across all its rows; the mixed-type branch exists
 * so a stray value cannot make the order non-deterministic.
 */
export type SortValue = string | number | null | undefined

export type SortDirection = 'asc' | 'desc'

export interface SortState {
  /** The `key` of the `DataColumn` being sorted. */
  key: string
  direction: SortDirection
}

/**
 * Whether a value has nothing to compare. `NaN` counts: it comes out of arithmetic on absent
 * figures and would otherwise make every comparison return 0, freezing rows wherever they sat.
 * An empty string does *not* — a column that renders a blank as an em dash should hand this
 * module `null` for it, which is what the call sites do.
 */
export function isMissing(value: SortValue): boolean {
  return value == null || (typeof value === 'number' && Number.isNaN(value))
}

/**
 * Order two present values: numbers numerically (negatives included — this is a P&L app, and
 * `-1200` belongs below `-3`, not beside it as a string), text alphabetically and
 * case-insensitively, dates as the epoch-ms numbers the domain already carries.
 *
 * Numbers sort before text when a column somehow yields both, so the result is total rather
 * than merely consistent.
 */
export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b, undefined, { sensitivity: 'base' })
  }
  return typeof a === 'number' ? -1 : 1
}

/**
 * `rows` reordered by `sortValue`, with the rows that have no value always last — in **both**
 * directions.
 *
 * That asymmetry is the point. A missing value is not a small one and not a large one, so
 * letting the direction move it would put "—" at the top of every descending sort of a column
 * where some rate was unavailable, displacing the real figures the owner opened the column to
 * find. Parked at the bottom, an absence stays visible and never competes.
 *
 * The sort is stable (ES2019+), so rows sharing a value keep the order the service returned
 * them in, and sorting a column twice in the same direction is a no-op.
 */
export function sortRows<T>(
  rows: readonly T[],
  sortValue: (row: T) => SortValue,
  direction: SortDirection,
): T[] {
  const present: T[] = []
  const missing: T[] = []
  for (const row of rows) {
    if (isMissing(sortValue(row))) missing.push(row)
    else present.push(row)
  }
  const sign = direction === 'asc' ? 1 : -1
  present.sort((a, b) => sign * compareValues(sortValue(a), sortValue(b)))
  return [...present, ...missing]
}

/**
 * The direction a column opens in on its first click. A figure column opens **descending**
 * because that is the question being asked of it — the largest position, the biggest dividend,
 * the best trade are all at the top of a descending sort. Text opens ascending, which is what
 * A–Z means.
 */
export function defaultDirectionFor(numeric: boolean): SortDirection {
  return numeric ? 'desc' : 'asc'
}

/**
 * The state after clicking `key`. Clicking the sorted column flips it; clicking any other
 * column takes that column's own opening direction.
 *
 * There is deliberately no third click back to "unsorted": the header is a two-state toggle,
 * so a reader never has to guess which of three states a click will land on, and the order on
 * screen always has a visible explanation in the header.
 */
export function nextSortState(
  current: SortState | null,
  key: string,
  preferred: SortDirection,
): SortState {
  if (current !== null && current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  }
  return { key, direction: preferred }
}

/** The direction `key` is currently sorted in, or `null` if some other column holds the sort. */
export function directionFor(state: SortState | null, key: string): SortDirection | null {
  return state !== null && state.key === key ? state.direction : null
}

/**
 * The `aria-sort` value for a header cell. Every sortable header carries one — `none` on the
 * columns that could be sorted but are not, which is what tells a screen-reader user the
 * control is there before they activate it.
 */
export function ariaSortFor(
  state: SortState | null,
  key: string,
): 'ascending' | 'descending' | 'none' {
  const direction = directionFor(state, key)
  if (direction === null) return 'none'
  return direction === 'asc' ? 'ascending' : 'descending'
}

/**
 * The glyph in a sortable header. Direction is carried by the arrow's *shape*, not by the
 * accent colour the sorted header also wears — colour alone would fail the same test the tab
 * bar's underline (DDR-0029) and the toggle group's doubled stroke (DDR-0036) were added for.
 *
 * An unsorted sortable column shows the double-headed arrow rather than nothing, so the
 * affordance is discoverable without hovering and the header's width does not jump when the
 * sort moves to it.
 */
export function sortGlyph(direction: SortDirection | null): string {
  if (direction === 'asc') return '↑'
  if (direction === 'desc') return '↓'
  return '↕'
}
