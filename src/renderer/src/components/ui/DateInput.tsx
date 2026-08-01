import type { InputHTMLAttributes } from 'react'
import { controlClassName } from '../../lib/fieldVariants'

/**
 * A native `<input type="date">` in the app's shared control box (Story #130, DDR-0035).
 *
 * `type` is fixed rather than defaulted — the same guarantee `Button` makes with
 * `type="button"`, one step firmer. A caller cannot pass a different type, because a text or
 * number input would silently lose the `min`/`max` bounds' meaning: on a date input those are
 * ISO dates the browser enforces in its own picker, which is what stops the custom range from
 * offering a day the imported history does not cover (DDR-0017). Callers still supply
 * `min`/`max`; the type they apply to is not theirs to change.
 *
 * Pair it with `Field` for the label; used bare it has no accessible name.
 */
export function DateInput({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>): React.JSX.Element {
  return <input type="date" className={controlClassName('date', className)} {...props} />
}
