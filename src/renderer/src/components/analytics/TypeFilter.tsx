import { ALL_TYPES } from '../../lib/tableFilter'

/**
 * The toolbar for a type-filtered analytics table (Stories #32, #33): a "type" dropdown
 * plus a live count of how many rows are shown out of the total. Presentational only —
 * the owning view holds the selected value and derives the filtered rows (through
 * `lib/tableFilter`), so this control stays reusable across the dividends and trades
 * tables, whose columns differ.
 */
export function TypeFilter({
  id,
  label,
  types,
  value,
  onChange,
  shown,
  total,
}: {
  id: string
  /** Accessible label for the select and its "All …" option, e.g. "transaction type". */
  label: string
  /** Distinct type values to offer, already in display order. */
  types: string[]
  value: string
  onChange: (value: string) => void
  shown: number
  total: number
}): React.JSX.Element {
  const filtered = value !== ALL_TYPES
  return (
    <div className="panel-toolbar">
      <div className="field-inline">
        <label htmlFor={id}>Filter</label>
        <select
          id={id}
          className="select-control"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`Filter by ${label}`}
        >
          <option value={ALL_TYPES}>All {label}s</option>
          {types.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>
      <span className="panel-count" role="status">
        {filtered ? `${shown} of ${total}` : `${total}`} shown
      </span>
    </div>
  )
}
