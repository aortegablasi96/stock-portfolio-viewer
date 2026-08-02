/**
 * The `Badge` primitive's variant/size contract (Story #132, DDR-0037).
 *
 * Same split as the button's, the card's, the tile's, the field's and the toggle group's
 * (DDR-0032 – DDR-0036), for the same reason: Vitest runs Node-only, so nothing inside a
 * component is testable (DDR-0029). Keeping the unions and the class composition in a pure
 * module lets the test assert both halves of the contract — that a call composes the class list
 * a caller expects, and that `app.css` declares a rule behind every member of both unions.
 *
 * Two axes, the button's shape: a `variant` carries the boundary and the ink, a `size` carries
 * the type and the box padding. Nothing here picks a raw length — every value in the stylesheet
 * comes from the scale in DDR-0031.
 */

/**
 * What sets the badge off from its surroundings. The four rules this primitive replaced used
 * exactly three treatments between them, and only one of them meant anything.
 */
export const BADGE_VARIANTS = [
  /** A bordered label in muted ink — the native-currency chip, an import row's status. */
  'neutral',
  /** Accent border, accent ink, heavier weight: the one status that is *news* (a new import). */
  'accent',
  /** No boundary at all — a count or a qualifier, set off by being small and muted. */
  'plain',
] as const

/**
 * `sm | md` is where a badge *sits*, and the difference is structural rather than a taste for a
 * smaller box. `sm` is the inline form: a chip inside a run of text, following the value it
 * qualifies. It carries **no vertical padding**, because a padded inline-block grows the line
 * box it sits in — a native-currency chip with 4px above and below silently adds ~7px to every
 * row of the holdings table. `md` is the standalone form, alone in a table cell or a toolbar,
 * where nothing shares its line and the padding is free.
 */
export const BADGE_SIZES = ['sm', 'md'] as const

export type BadgeVariant = (typeof BADGE_VARIANTS)[number]
export type BadgeSize = (typeof BADGE_SIZES)[number]

export const DEFAULT_BADGE_VARIANT = 'neutral' satisfies BadgeVariant
export const DEFAULT_BADGE_SIZE = 'md' satisfies BadgeSize

/**
 * Compose the class list for a badge. `className` is appended rather than merged, so a call site
 * extends the primitive with its own layout rule instead of forking it (ADR-0008).
 */
export function badgeClassName(
  variant: BadgeVariant = DEFAULT_BADGE_VARIANT,
  size: BadgeSize = DEFAULT_BADGE_SIZE,
  className?: string,
): string {
  const parts = ['badge', `badge-${variant}`, `badge-${size}`]
  if (className) parts.push(className)
  return parts.join(' ')
}
