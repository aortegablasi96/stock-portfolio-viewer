import { Field } from './ui/Field'
import { Select } from './ui/Select'

/**
 * Display-currency selector for the Portfolio view (Story #28, DDR-0007). Presentational only:
 * the parent owns the value and the refetch.
 *
 * What is left here after Story #130 is the domain half — which codes to offer, and what the
 * control is called. The label pairing, the identity and the box belong to `Field` and `Select`
 * (DDR-0035), which is why this no longer takes an `id`: `Field` generates one, so no two
 * instances can collide.
 */
export function CurrencySelector({
  label = 'Display currency',
  value,
  options,
  disabled = false,
  onChange,
}: {
  label?: string
  value: string
  options: readonly string[]
  disabled?: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <Field label={label}>
      {(id) => (
        <Select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}
