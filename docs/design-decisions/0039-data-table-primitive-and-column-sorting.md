# 0039. One `DataTable`: `surface` × `height` on the container, sorting opt-in per column

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

Twelve tables across five views, and four rules between them:

| Rule | What it declared | Who wore it |
| --- | --- | --- |
| `.holdings-table` | cell padding, uppercase sticky header, `.num` / `.symbol` / `.description` | **all twelve** — named for the Portfolio dashboard |
| `.table-scroll` | horizontal overflow **and** a card surface | all twelve |
| `.card-content .table-scroll` | undoes that surface | eleven of them, invisibly |
| `.table-scroll-rows` | a five-row cap, a sticky header worth having, a scroll-driven fade | three of them |
| `.breakdown-table` | `min-width: 0` on a grid child, plus a swatch layout | one |

Two things are wrong here and only one of them looks like a problem.

**The container drew a surface it usually had to be talked out of.** `.table-scroll` declared
`background` / `border` / `border-radius` because the first table to exist — the dashboard's
holdings — stands on its own. Every table added afterwards sits inside a card body, so
`.card-content .table-scroll` existed to unpaint it. Eleven call sites relied on a descendant
override to undo a decision their own markup had made.

**Nothing sorted.** Every table rendered in whatever order its service returned, and
`TradeHistoryView.tsx` said so in a comment: *"`bySymbol` arrives sorted largest total first."*
Finding the largest position, the biggest dividend or the worst trade meant reading every row. The
`ui-designer` skill names sorting first among the baseline expectations for this app's data-heavy
views, and with the time-range filter ([[0017-analytics-table-time-range-filter]]) and the multi-select
type filter already in place, it was the missing third axis. Meanwhile `.table-scroll-rows` handed
a useful cap-and-fade to three tables and not the others for no stated reason — which is the
Epic's thesis in miniature: not a bug, a decision nobody made.

## Decision

**One `DataTable` under `components/ui/`, with two axes on its *container* — `surface` and
`height` — and sorting opted into per column.**

```tsx
<DataTable
  caption="Current holdings"
  surface="card"            // the one table that stands outside a card body
  columns={columns}
  rows={holdings}
  rowKey={(h) => h.conid}
/>

<DataTable caption="Trade history" columns={tradeColumns(sc)} rows={rows}
           rowKey={(t) => t.tradeKey} height="capped" />
```

A column is a description rather than markup:

```ts
{
  key: 'value',
  header: `Market value${displayCurrency ? ` (${displayCurrency})` : ''}`,
  numeric: true,
  cellClassName: (h) => toneClassName(toneOf(h.unrealizedPnlBase)),
  cell: (h) => <MarketValueCell holding={h} displayCurrency={displayCurrency} />,
  sortValue: (h) => (displayCurrency != null ? h.displayValue ?? null : h.marketValue),
}
```

### The axes are the container's, because the table has none

Every table in this app is one table: the same cell padding, the same uppercase header, the same
tabular figures. A `variant` axis would have had one value and a `size` axis one value — the
mistake [[0038-state-panel-primitive-variant-and-surface-axes]] avoided by asking what actually
varies rather than copying the button's pair. What varies is two properties of the box the table
sits in, and both were already being expressed, badly:

- **`surface`** — `inline` (default, eleven call sites) sits in a `CardContent` that already draws
  a surface; `card` brings one. Naming it is what retires `.card-content .table-scroll`: a table
  that says where it sits never has to be undone by a descendant selector. It borrows
  `StatePanel`'s vocabulary and means the same thing, but `card` is **not** a `Card` — a card
  carries padding and a table's rows have to reach its edges, so the container draws it. `inline`
  has no class, the same statement as `toneClassName('neutral')`
  ([[0034-stat-tile-primitive-tone-axis]]).
- **`height`** — `auto` runs the table's full length; `capped` is the ~5-row window with the
  sticky header and the scroll-driven fade from Story #67, now available to any table rather than
  the three that happened to have it.

The three cell kinds — `num`, `name`, `note` — are deliberately **not** an axis. A column is any
combination of them, so they compose rather than exclude.

### Sorting is opt-in per column, and it composes rather than replaces

A column with a `sortValue` gets a header button; one without gets the plain header it always had.
That keeps the axis honest: the import summary is the receipt for one action, listing the files the
owner just picked in the order they picked them, and it grows no controls that answer nothing. The
stored-statement list above it sorts, because "which period am I missing?" is a question of order.

Sorting sits **after** filtering, never instead of it. A view narrows its rows by period and type
first ([[0017-analytics-table-time-range-filter]]), and the table reorders whatever survives — which is
why the chips' "N of M shown" count is untouched: reordering a list cannot change its length.

Sort state is `useState` inside the primitive and nothing more, which is all it takes to survive a
tab switch: an analytics tab mounts on first visit and then stays mounted
([[0027-analytics-views-persist-and-explicit-refresh]]), so the state is never discarded and never
has to be restored. Nothing is persisted across launches — an order you asked for is not a mode
you live in, the same reasoning as the map's colour toggle ([[0030-allocation-map-country-donut-pairs]]).

### A missing value sorts last in both directions

The rule that makes a figure column usable. A missing value is neither large nor small: an
unconvertible holding carries `displayValue === null` ([[0007-portfolio-display-currency-and-live-fx]]), a
trade IBKR reports without a timestamp has no date, an unclassified position has no sector, and an
opening buy has no realized P&L — which is *not* the same as having realized zero. Letting the
direction move those rows would put "—" at the top of every descending sort of a column where a
rate was unavailable, displacing the figures the owner opened the column to find. Parked at the
bottom, an absence stays visible and never competes.

The rest of the comparator is unremarkable and worth stating anyway: numbers numerically
(`-1200` belongs below `-3`, not beside it as text), dates as the epoch-ms integers the domain
already carries, text case-insensitively, and the sort is **stable**, so rows sharing a value keep
the order the service returned them in.

### A figure column opens descending

The first click on a numeric header sorts largest-first, because that is the question being asked
of it — the largest position, the biggest dividend, the best trade. Text opens ascending, which is
what A–Z means. Afterwards the header is a **two-state toggle**: there is no third click back to
"unsorted", so a reader never has to guess which of three states a click lands on, and the order on
screen always has a visible explanation in the header.

### The sort control is not a `Button`, and direction is not a colour

The header cell already **is** the box — it carries the padding, the sticky background and the
uppercase label — so a `.btn` inside it would draw a second box within that one.
[[0032-button-primitive-variants-and-sizes]]'s variants carry colour and a border and a column
header has neither; what it needs is to fill its cell. `font: inherit` and no box of its own is
what makes a sortable header identical to the plain header beside it. Same reasoning that keeps
the real tablist out of `ToggleGroup` ([[0036-toggle-group-mode-axis-and-pressed-semantics]]).

Direction is carried by the **arrow's shape** as well as the accent the sorted header wears —
[[0029-tab-shell-aria-pattern-and-keyboard-navigation]]'s "both cues are colour" rule applied to a
header. An unsorted sortable column keeps a held-back `↕`, so the affordance is discoverable without
hovering and the header's width does not jump when the sort lands on it. `aria-sort` is on the
cell, including `none` on the sortable columns that are not sorted — that is what tells a
screen-reader user the control exists before they activate it.

`caption` is **required**, rendered `sr-only`. A table of figures with sortable headers that
announces itself as "table" and nothing else is a table nobody can navigate to; only the dashboard's
holdings had one.

## Consequences

- Adding a table means naming its columns, not writing CSS — and a new table sorts by default
  wherever its columns say what they hold.
- `app.css` loses `.holdings-table` (six rules), `.table-scroll`, `.table-scroll-rows`,
  `.breakdown-table` (two rules) and the `.card-content .table-scroll` override, and gains one
  section. `lib/dataTableVariants.test.ts` fails if any of the five reappears, if the bare
  container starts drawing a surface again, if an axis value has no rule, if the sort control
  acquires a box, or if the sorted state stops carrying its arrow.
- **Two deliberate visual changes**, both named here. Cell padding moves from a hand-picked
  `0.7rem` to `--space-4` (0.75rem), the step [[0031-design-token-scales]] says it always meant —
  about 1.6px per row — and the five-row cap is re-measured from `17rem` to `18rem` to keep the
  sixth row's peek that the original arithmetic was chosen for. Sortable headers are also a little
  wider, by the arrow.
- The cell classes are renamed to the primitive's namespace: `.num` → `.data-table-num`,
  `.symbol` → `.data-table-name`, `.description` → `.data-table-note`. `.flex-import-file` and
  `.flex-import-dim` are untouched — they colour content inside a cell, not the cell.
- **Two traps found on screen, not by any assertion**, both now pinned by
  `lib/dataTableVariants.test.ts`. The three cell classes must stay **scoped to the table**
  (`.data-table .data-table-num`): the base `.data-table th, .data-table td` rule is worth two
  selectors, so an unscoped `.data-table-num` silently loses its `text-align` to it — which is
  why `.holdings-table .num` was scoped all along, and exactly what flattening the names into a
  namespace would have dropped. And the sort control has to **restate `text-transform`,
  `letter-spacing` and `text-align` as `inherit`**: a `<button>` does not inherit the three
  properties that *are* this header's treatment, so a sortable header renders in sentence case,
  unspaced and centred beside its uppercase neighbours. Neither shows up in a class-name test;
  both are obvious in a screenshot, which is the argument for taking one.
- `RealizedHighlights` reads the service's array, not the table's view of it, so re-sorting the
  realized table by short-term gain does not silently redefine "best".
- The breakdown's swatch layout becomes `.data-table-swatch`, a cell shape a column asks for by
  name, and `.breakdown-split > *` carries the `min-width: 0` that `.breakdown-table` was a whole
  class for.

## Not Included

- **Pagination.** The cap plus scroll already handles these volumes; paging is a separate
  decision.
- **Multi-column sort, column show/hide/reorder, column resizing.** None of the twelve tables has
  a case for them, and each would add a second piece of state to the axis this story opened.
- **A table dependency (TanStack Table and friends).** ADR-0008's constraint stands: one
  comparator and a `useState` do not warrant one, and it would land in the same Node-only-Vitest
  hole that `lib/tabKeyboard.ts` exists to avoid.
- **Changing the order services return data in.** Sorting is a view concern; the arriving order
  stays the sensible default and is what the highlights read.

## Alternatives Considered

### Composition (`<DataTable><DataTableHead>…`) instead of a column config

Rejected. The sort control has to live in the header cell, so a call site handing over its
`<thead>` would rebuild it twelve times — and the twelve would drift, which is the failure this
Epic exists to undo. The config also puts the sort accessor beside the cell renderer, where a
mismatch between what a column shows and what it sorts by is visible in one place.

### A boolean `capped` prop instead of a `height` axis

Rejected, for the reason [[0038-state-panel-primitive-variant-and-surface-axes]] rejected
`inline={false}`: `height="capped"` names what the container is, a flag names the absence of the
other thing, and the axis reads at the call site as a noun beside `surface`.

### Keeping `.table-scroll`'s surface and the `.card-content` override

Rejected. It is the override the story was asked to remove, and it inverts the dependency: a
primitive drawing something on the assumption of where it sits, corrected by a selector describing
where it actually sits. Naming the surface moves the decision to the one call site that differs.

### Sorting the sorted column back to "unsorted" on a third click

Rejected. Three states on one control means a reader has to remember which one a click lands on,
and the "unsorted" state is the only one with no visible explanation in the header. The arriving
order is still one refresh away and is what the highlights and the charts read.

### Making every column sortable, including the import summary's

Rejected. A control that answers no question is noise, and the opt-in is what lets the primitive
say so. Ten of the twelve tables sort every column; the import receipt sorts none.

## References

- Story #134, Epic #125 — the last story in the Epic.
- [[0031-design-token-scales]] — the padding, radius and type steps; the `:where()` focus base.
- [[0032-button-primitive-variants-and-sizes]] — why the sort control is not one.
- [[0033-card-primitive-variants-and-sizes]] — `CardContent` as the scope the override hung off.
- [[0034-stat-tile-primitive-tone-axis]] — a default with no class as a design statement.
- [[0038-state-panel-primitive-variant-and-surface-axes]] — the `surface` vocabulary.
- [[0017-analytics-table-time-range-filter]] — the filters sorting composes with.
- [[0027-analytics-views-persist-and-explicit-refresh]] — why `useState` is enough.
- [[0007-portfolio-display-currency-and-live-fx]] — the null display value the comparator parks.
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — "both cues are colour".
- ADR-0008 — shadcn's API adopted, the package declined.
- `src/renderer/src/components/ui/DataTable.tsx`, `src/renderer/src/lib/tableSort.ts`,
  `src/renderer/src/lib/dataTableVariants.ts`.
