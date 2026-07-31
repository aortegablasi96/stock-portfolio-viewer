/**
 * The `Card` primitive's variant/size contract (Story #128, DDR-0033).
 *
 * Same split as the button's (DDR-0032), and for the same reason: Vitest runs Node-only, so
 * nothing inside a component is testable (DDR-0029). Keeping the unions and the class
 * composition in a pure module lets the test assert both halves of the contract — that a
 * variant/size pair composes the class list a caller expects, and that `app.css` actually
 * declares a rule for every member of every union. A variant added to a union with no rule
 * behind it renders as an unstyled surface and nothing else in the toolchain notices.
 *
 * A variant carries the surface colour only; a size carries the padding only. Nothing here
 * picks a raw length — the sizes *are* the `--surface-pad-*` steps from DDR-0031, so the
 * component API and the stylesheet share one vocabulary.
 */

/**
 * The two surfaces a card is drawn on. `default` is the panel sitting on the page
 * background; `nested` is a card *inside* another card, where repeating `--card` would draw
 * an invisible box — it recedes to the page background so it reads as an inset well. The
 * only nested card today is the realized-gains best/worst highlight, which sits inside a
 * panel. Names follow shadcn's `default`-plus-modifiers contract (ADR-0008 adopts the API,
 * not the package).
 */
export const CARD_VARIANTS = ['default', 'nested'] as const

/**
 * `sm | md | lg` is the same vocabulary as `--surface-pad-*` (DDR-0031) and as the button's
 * sizes, so "medium" means one thing across the app. `sm` is a nested card, `md` a panel or
 * tile, `lg` a full-width state panel.
 */
export const CARD_SIZES = ['sm', 'md', 'lg'] as const

/**
 * How a card header lines its title up against the control beside it. `center` is right when
 * both sides are one line tall (a title beside a filter toolbar); `start` when one side wraps
 * to two or more (a title with a lede beside a stacked pair of buttons), where centring would
 * float the heading down the block.
 */
export const CARD_HEADER_ALIGNMENTS = ['center', 'start'] as const

/** The card parts that are plain wrappers — no axis of their own, just a class. */
export const CARD_PARTS = ['title', 'content'] as const

export type CardVariant = (typeof CARD_VARIANTS)[number]
export type CardSize = (typeof CARD_SIZES)[number]
export type CardHeaderAlign = (typeof CARD_HEADER_ALIGNMENTS)[number]
export type CardPart = (typeof CARD_PARTS)[number]

export const DEFAULT_CARD_VARIANT = 'default' satisfies CardVariant
export const DEFAULT_CARD_SIZE = 'md' satisfies CardSize
export const DEFAULT_CARD_HEADER_ALIGN = 'center' satisfies CardHeaderAlign

/** Append a call site's `className` for placement, never for restyling (ADR-0008). */
function compose(parts: string[], className?: string): string {
  return className ? [...parts, className].join(' ') : parts.join(' ')
}

/** Compose the class list for a card surface. */
export function cardClassName(
  variant: CardVariant = DEFAULT_CARD_VARIANT,
  size: CardSize = DEFAULT_CARD_SIZE,
  className?: string,
): string {
  return compose(['card', `card-${variant}`, `card-${size}`], className)
}

/** Compose the class list for a card header. */
export function cardHeaderClassName(
  align: CardHeaderAlign = DEFAULT_CARD_HEADER_ALIGN,
  className?: string,
): string {
  return compose(['card-header', `card-header-${align}`], className)
}

/** Compose the class list for a single-class card part (`title`, `content`). */
export function cardPartClassName(part: CardPart, className?: string): string {
  return compose([`card-${part}`], className)
}
