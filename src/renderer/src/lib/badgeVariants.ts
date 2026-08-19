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
  /** The gain tone: a label naming something that put money in (Story #192, DDR-0064). */
  'positive',
  /** The loss tone, in `--neg-text` rather than the fill token (DDR-0046). */
  'negative',
] as const

/**
 * The two variants that carry a polarity, and the reason this union is a *superset* of
 * `STAT_TONES` rather than a parallel vocabulary (Story #192, DDR-0064).
 *
 * `toneOf()` in `statTileVariants` already answers "what is the polarity of this signed figure?"
 * for every toned figure in the app — a tile, a table cell, a map popup row. A dividend row's
 * type label is the same question asked of the same number, so the badge's names are the tile's
 * names and `toneOf()` can be handed straight to `variant`. `neutral` is what makes that work:
 * it is the default badge *and* the absence of a tone, so a zero-amount row falls through to the
 * bordered muted label with no branch at the call site.
 *
 * `badgeVariants.test.ts` asserts the containment, so the two unions cannot drift apart into a
 * pair that agrees on two names and disagrees on the third.
 */
export const TONED_BADGE_VARIANTS = ['positive', 'negative'] as const

/**
 * `sm | md` is where a badge *sits*, and the difference is structural rather than a taste for a
 * smaller box. `sm` is the inline form: a chip inside a run of text, following the value it
 * qualifies. It carries **no vertical padding**, because a padded inline-block grows the line
 * box it sits in — a native-currency chip with 4px above and below silently adds ~7px to every
 * row of the holdings table. `md` is the standalone form, alone in a table cell or a toolbar,
 * where nothing shares its line and the padding is free.
 */
export const BADGE_SIZES = ['sm', 'md'] as const

/**
 * The placement class for a badge that **opens its own table cell** (Story #192, DDR-0064).
 *
 * A badge in a dense table cell has to be `sm`: `md`'s vertical padding is 4px above and below a
 * `--text-xs` line, which is taller than the `--text-sm` line every other cell in the row draws,
 * so a `md` badge in the Type column grows every row of a 200-row transactions table. That is the
 * same arithmetic the size axis was written for, arriving from the other direction.
 *
 * What `sm` also carries is `margin-left` — the gap from the value it follows, which is right for
 * an inline chip and wrong for a badge that *is* the cell's contents: 6px of it would set the
 * column's only element in from its own uppercase header. CSS cannot tell the two apart, because
 * the inline chips follow a **text node** and `:first-child` counts elements only.
 *
 * So the gap stays on `sm` and the cell form is placement, which is what `className` is for
 * (ADR-0008). It is a constant rather than a literal so the one rule in `app.css` has one name
 * pointing at it, the way the primitives' axis values do.
 */
export const BADGE_CELL_CLASS = 'badge-cell'

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
