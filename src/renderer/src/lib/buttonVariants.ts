/**
 * The `Button` primitive's variant/size contract (Story #127, DDR-0032).
 *
 * The unions and the class composition live here rather than in `Button.tsx` for the reason
 * every other bit of renderer logic does: Vitest runs Node-only, so nothing inside a component
 * is testable (DDR-0029). Keeping them in a pure module lets the test assert both halves of the
 * contract — that a variant/size pair composes the class list a caller expects, and that
 * `app.css` actually declares a rule for every member of both unions. A variant added to the
 * union with no rule behind it is the failure mode worth catching; it renders as an unstyled
 * button and nothing else complains.
 *
 * A variant carries colour and border only; a size carries padding and type. Nothing here
 * picks a raw length — every value in the stylesheet comes from the scale in DDR-0031.
 */

/**
 * The seven roles a button actually plays in the app, in the order the stylesheet declares
 * them. Names follow shadcn's contract where the role matches (ADR-0008 adopts the API, not
 * the package); `surface` has no shadcn equivalent because no library ships a control meant
 * to float over someone else's canvas.
 */
export const BUTTON_VARIANTS = [
  /** The default bordered action — "Capture now", "Import statements…". */
  'outline',
  /** Filled accent: the one primary action a panel offers — "Retry", "Classify from IBKR". */
  'primary',
  /** Bordered but quieter, beside a louder sibling — "Cancel", "Refresh". */
  'secondary',
  /** Red label, red fill on hover — the destructive trigger and its confirm (DDR-0012). */
  'danger',
  /** Borderless and hover-tinted: window chrome, where a border would draw a box (DDR-0011). */
  'ghost',
  /** Underlined text — a quiet inline affordance, "Clear" on the type filter. */
  'link',
  /** Carries its own card surface and shadow: a control floating over the Mapbox basemap. */
  'surface',
] as const

/**
 * `sm | md | lg` is the same vocabulary as `--control-pad-*` (DDR-0031), so the component API
 * and the CSS agree by construction. `icon` is a shape rather than a step on that scale: a
 * square with no text box, for a button whose glyph is its label.
 */
export const BUTTON_SIZES = ['sm', 'md', 'lg', 'icon'] as const

export type ButtonVariant = (typeof BUTTON_VARIANTS)[number]
export type ButtonSize = (typeof BUTTON_SIZES)[number]

export const DEFAULT_BUTTON_VARIANT = 'outline' satisfies ButtonVariant
export const DEFAULT_BUTTON_SIZE = 'md' satisfies ButtonSize

/**
 * Compose the class list for a button. `className` is appended rather than merged, so a call
 * site extends the primitive with its own layout rule instead of forking it (ADR-0008) — the
 * title bar's full-height controls and the map's floating stack both work that way.
 */
export function buttonClassName(
  variant: ButtonVariant = DEFAULT_BUTTON_VARIANT,
  size: ButtonSize = DEFAULT_BUTTON_SIZE,
  className?: string,
): string {
  const parts = ['btn', `btn-${variant}`, `btn-${size}`]
  if (className) parts.push(className)
  return parts.join(' ')
}
