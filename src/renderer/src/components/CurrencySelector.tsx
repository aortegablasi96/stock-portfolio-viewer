import { Field } from './ui/Field'
import { Select } from './ui/Select'

/**
 * The app's display-currency selector (Story #28, DDR-0007). Presentational only: the parent
 * owns the value and whatever re-reads because of it.
 *
 * What is left here after Story #130 is the domain half — which codes to offer, and what the
 * control is called. The label pairing, the identity and the box belong to `Field` and `Select`
 * (DDR-0035), which is why this takes no `id`: `Field` generates one, so no two instances can
 * collide.
 *
 * Since Story #183 it sits in the sidebar's footer rather than in the Portfolio dashboard's
 * header, which changed two things about it (DDR-0056). It is the *app's* selection now, so it
 * outlives the view it converts — the Portfolio tab unmounts on every switch away (DDR-0027).
 * And it lost its `disabled` prop: the dashboard used to disable it while a conversion was in
 * flight, which cannot work from out here, because the control has to stay usable while the tab
 * that reads it is not even mounted. The race that guarded is now handled where it belongs, by
 * the dashboard ignoring the results of reads its selection has moved on from.
 *
 * `className` is for placement only, per the primitives' contract (DDR-0032): the sidebar stacks
 * the label over the control, which is a layout the 220px column needs and not a new variant.
 */
export function CurrencySelector({
  label = 'Display currency',
  value,
  options,
  className,
  onChange,
}: {
  label?: string
  value: string
  options: readonly string[]
  className?: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <Field label={label} className={className}>
      {(id) => (
        <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
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
