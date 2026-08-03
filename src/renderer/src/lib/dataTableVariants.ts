/**
 * The `DataTable` primitive's class contract (Story #134, DDR-0039).
 *
 * Same split as the rest of the family (DDR-0032 – DDR-0038): the unions and the class
 * composition live in a pure module so the test can assert them and `app.css` together, since
 * Vitest is Node-only (DDR-0029).
 *
 * The axes are deliberately **not** the button's `variant` × `size`. Every table in this app is
 * one table — the same cell padding, the same uppercase header, the same tabular figures — so a
 * colour axis would have one value and a size axis one value. What genuinely varies are two
 * properties of the *container*: whether the body is capped to a scrollable window, and whether
 * the table brings its own surface or sits in one that already exists.
 *
 * The three cell kinds are not an axis: a column is any combination of them (a numeric column
 * carrying a tone, a name column, a muted secondary column), so they compose rather than
 * exclude.
 */

/**
 * Whether the table brings its own surface. `inline` — the default, and eleven of the twelve
 * call sites — sits inside a `CardContent` that already draws one. `card` is the dashboard's
 * holdings table, the one that stands on its own.
 *
 * The vocabulary is `StatePanel`'s (DDR-0038) and means the same thing, but `card` is not a
 * `Card`: a card carries padding and a table's rows have to reach its edges, so the container
 * draws the surface itself. Naming it is what retires the `.card-content .table-scroll`
 * override — a table that says where it sits never has to be talked out of a border it drew on
 * the assumption it was somewhere else.
 *
 * `inline` has no class of its own, the same shape as `toneClassName('neutral')` (DDR-0034):
 * a table inside a card body is the bare container and nothing more.
 */
export const DATA_TABLE_SURFACES = ['inline', 'card'] as const

export type DataTableSurface = (typeof DATA_TABLE_SURFACES)[number]

export const DEFAULT_DATA_TABLE_SURFACE = 'inline' satisfies DataTableSurface

/** The class drawing the surface, or `''` where the surface is the surrounding card's. */
export function dataTableSurfaceClassName(surface: DataTableSurface): string {
  return surface === 'card' ? 'data-table-scroll-card' : ''
}

/**
 * Whether the table's body is capped. `auto` runs the table's full length inside the page's own
 * scroll; `capped` is the ~5-row window with a sticky header and the scroll-driven bottom fade
 * (Story #67) that the transaction and trade tables use.
 *
 * `auto` has no class of its own — the same shape as `toneClassName('neutral')` (DDR-0034) and
 * `statePanelSurfaceClassName('panel')` (DDR-0038). The uncapped table is the container with
 * nothing added, so a `.data-table-scroll-auto` rule would have nothing to declare.
 */
export const DATA_TABLE_HEIGHTS = ['auto', 'capped'] as const

export type DataTableHeight = (typeof DATA_TABLE_HEIGHTS)[number]

export const DEFAULT_DATA_TABLE_HEIGHT = 'auto' satisfies DataTableHeight

/** The class carrying the row cap, or `''` for the table that runs its full length. */
export function dataTableHeightClassName(height: DataTableHeight): string {
  return height === 'capped' ? 'data-table-scroll-capped' : ''
}

/**
 * Compose the scroll container's class list. `className` is appended rather than merged, so a
 * call site extends the primitive with a *placement* rule and never with a restyling — the same
 * rule the button and the state panel follow (ADR-0008).
 */
export function dataTableScrollClassName(
  surface: DataTableSurface = DEFAULT_DATA_TABLE_SURFACE,
  height: DataTableHeight = DEFAULT_DATA_TABLE_HEIGHT,
  className?: string,
): string {
  const parts = ['data-table-scroll']
  const surfaceClass = dataTableSurfaceClassName(surface)
  if (surfaceClass) parts.push(surfaceClass)
  const heightClass = dataTableHeightClassName(height)
  if (heightClass) parts.push(heightClass)
  if (className) parts.push(className)
  return parts.join(' ')
}

/**
 * The three things a cell can be, beyond an ordinary cell.
 *
 * - `num` — a figure: right-aligned and `tabular-nums`, so digits line up down the column.
 * - `name` — the row's own name, rendered as its `<th scope="row">`: the ticker, the slice, the
 *   period. Carries the weight that makes a row scannable.
 * - `note` — a secondary, muted cell that may be long enough to need truncating: a company
 *   description, a statement's period.
 */
export const DATA_TABLE_CELL_KINDS = ['num', 'name', 'note'] as const

export type DataTableCellKind = (typeof DATA_TABLE_CELL_KINDS)[number]

export function dataTableCellKindClassName(kind: DataTableCellKind): string {
  return `data-table-${kind}`
}

/**
 * Compose one cell's class list: the numeric treatment, then the column's own class, then
 * whatever the row contributes — which is how a signed figure wears its tone
 * (`toneClassName`, DDR-0034) without the table knowing what a tone is.
 *
 * Falsy parts are dropped rather than emitted as stray spaces, so a cell with nothing to add
 * carries no `class` attribute at all.
 */
export function dataTableCellClassName(...parts: (string | false | undefined)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ')
}
