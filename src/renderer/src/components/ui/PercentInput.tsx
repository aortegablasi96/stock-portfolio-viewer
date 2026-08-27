import type { InputHTMLAttributes } from 'react'
import { controlClassName } from '../../lib/fieldVariants'

/**
 * A typed percentage in the app's shared control box (Story #280, DDR-0094).
 *
 * The app's third form control, and the first that takes a number. It sits beside `Select` and
 * `DateInput` as a third `kind` rather than as a new family, so the box, the hover, the disabled
 * treatment and the focus ring are all still the ones DDR-0035 settled.
 *
 * **`type="text"` with `inputMode="decimal"`, not `type="number"`**, and the reasons are the
 * form's rather than a preference. A number input silently changes its value on a scroll wheel
 * passing over it, which on a page of eight of them is a way to alter a policy without noticing.
 * It reports a value the owner did not type as the empty string, so `12,5` typed on a keyboard
 * whose decimal key is a comma vanishes rather than parses — and `lib/investorProfile`'s
 * `parsePercent` accepts that comma deliberately. And its spinner is chrome the shared `.control`
 * box has no rule for. `inputMode` still asks a touch keyboard for digits, which is the only part
 * of `type="number"` worth having here.
 *
 * The trailing `%` is drawn by the row, not by this control: it labels the pair of inputs beside
 * it once rather than each of them, and a unit inside the box would be text the owner can select
 * but not edit.
 *
 * Pair it with `Field` for the label; used bare it has no accessible name.
 */
export function PercentInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>): React.JSX.Element {
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={controlClassName('percent', className)}
      {...props}
    />
  )
}
