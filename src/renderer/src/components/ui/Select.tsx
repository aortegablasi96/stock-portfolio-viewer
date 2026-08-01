import type { SelectHTMLAttributes } from 'react'
import { controlClassName } from '../../lib/fieldVariants'

/**
 * A native `<select>` in the app's shared control box (Story #130, DDR-0035).
 *
 * Native deliberately, and the story says so: the only select in the app offers a short static
 * list of currency codes, which the platform control handles correctly on every input method
 * with no dependency, no popup layer and no keyboard handling of our own. A custom listbox
 * would be a worse control and a new `lib/` module to keep it accessible.
 *
 * The primitive contributes exactly one thing — the box — so a select, a date input and a
 * button all agree on padding, border, radius, hover, disabled and focus. Pair it with `Field`
 * for the label; used bare it has no accessible name.
 */
export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return <select className={controlClassName('select', className)} {...props} />
}
