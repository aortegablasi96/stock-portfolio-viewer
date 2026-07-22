/**
 * Display-currency selector for the Portfolio view (Story #28, DDR-0007). A labelled
 * native `<select>` — the app's first — kept generic so later filter controls (the
 * dividends/trade type filters, Stories #32/#33) can reuse it rather than each inventing
 * their own dropdown. Presentational only: the parent owns the value and the refetch.
 */
export function CurrencySelector({
  id = 'display-currency',
  label = 'Display currency',
  value,
  options,
  disabled = false,
  onChange,
}: {
  id?: string
  label?: string
  value: string
  options: readonly string[]
  disabled?: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <div className="field-inline">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        className="select-control"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
    </div>
  )
}
