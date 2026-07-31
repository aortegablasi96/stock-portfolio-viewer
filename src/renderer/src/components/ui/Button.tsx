import type { ButtonHTMLAttributes } from 'react'
import {
  buttonClassName,
  DEFAULT_BUTTON_SIZE,
  DEFAULT_BUTTON_VARIANT,
  type ButtonSize,
  type ButtonVariant,
} from '../../lib/buttonVariants'

/**
 * The app's one button (Story #127, DDR-0032), replacing the eight button families the Epic
 * #125 audit found — `.capture-button`, `.danger-button`, `.ghost-button`, `.retry-button`,
 * `.view-refresh`, `.type-filter-clear`, `.titlebar-button` and `.map-zoom-btn`. Three of
 * those were byte-identical apart from `color`.
 *
 * Adding a button to a view means naming its role, not writing CSS: `variant` says what kind
 * of action it is, `size` how dense the surface around it is. The variant/size prop contract
 * and the `className` forwarding are shadcn's API shape, adopted without the package
 * (ADR-0008); the values behind them are the project's own token scale (DDR-0031).
 *
 * Two things the primitive guarantees rather than leaves to the call site. `type` defaults to
 * `"button"`, so no caller can accidentally ship a submit button — every one of the app's
 * buttons wrote `type="button"` by hand. And no variant declares a focus ring: the
 * zero-specificity base rule in `app.css` supplies it, destructive actions included, which is
 * how forgetting produces the correct result (DDR-0031).
 *
 * Icon-only buttons (`size="icon"`) have no text to name them, so every such call site must
 * pass `aria-label` — the window controls and the map zoom stack are asserted by accessible
 * name in `e2e/app.spec.ts`.
 */
export function Button({
  variant = DEFAULT_BUTTON_VARIANT,
  size = DEFAULT_BUTTON_SIZE,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
}): React.JSX.Element {
  return <button type={type} className={buttonClassName(variant, size, className)} {...props} />
}
