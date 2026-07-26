/**
 * The toolbar for a type-filtered analytics table (Stories #32, #33, #73): a group of
 * toggle chips — one per type — plus a live count of how many rows are shown out of the
 * total. Any number of chips can be active at once; each row matching *any* active type is
 * shown, and clearing every chip returns to showing all rows. Presentational only — the
 * owning view holds the selected set and derives the filtered rows (through
 * `lib/tableFilter`), so this control stays reusable across the dividends and trades
 * tables, whose columns differ.
 *
 * The count reports the table's whole filter stack, not just this control's: `shown` is
 * whatever survived every filter the view applies (since Story #75 that includes the time
 * range), so it reads "N of M" whenever rows are hidden for any reason. Only the Clear
 * button is tied to this control, and clears only the type chips.
 *
 * The chips are `aria-pressed` toggle buttons inside an `aria-label`led group, so the
 * control is labelled and fully keyboard-operable.
 */
export function TypeFilter({
  label,
  types,
  selected,
  onToggle,
  onClear,
  shown,
  total,
}: {
  /** Accessible label for the group, e.g. "transaction type". */
  label: string
  /** Distinct type values to offer, already in display order. */
  types: string[]
  /** Currently active types; an empty set means no filter (all rows shown). */
  selected: ReadonlySet<string>
  onToggle: (type: string) => void
  onClear: () => void
  shown: number
  total: number
}): React.JSX.Element {
  const typeFiltered = selected.size > 0
  const hidingRows = shown !== total
  return (
    <div className="panel-toolbar">
      <div className="type-filter" role="group" aria-label={`Filter by ${label}`}>
        {types.map((type) => {
          const active = selected.has(type)
          return (
            <button
              key={type}
              type="button"
              className={`chart-tab ${active ? 'chart-tab-active' : ''}`}
              aria-pressed={active}
              onClick={() => onToggle(type)}
            >
              {type}
            </button>
          )
        })}
        {typeFiltered && (
          <button type="button" className="type-filter-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      <span className="panel-count" role="status">
        {hidingRows ? `${shown} of ${total}` : `${total}`} shown
      </span>
    </div>
  )
}
