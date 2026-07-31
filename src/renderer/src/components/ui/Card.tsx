import type { HTMLAttributes } from 'react'
import {
  cardClassName,
  cardHeaderClassName,
  cardPartClassName,
  DEFAULT_CARD_HEADER_ALIGN,
  DEFAULT_CARD_SIZE,
  DEFAULT_CARD_VARIANT,
  type CardHeaderAlign,
  type CardSize,
  type CardVariant,
} from '../../lib/cardVariants'

/**
 * The app's one surface (Story #128, DDR-0033), replacing the five the Epic #125 audit found —
 * `.state-panel`, `.panel`, `.allocation`, `.snapshot-history` and `.highlight-card` — each of
 * which restated `background`/`border`/`border-radius` and then disagreed about the padding.
 *
 * Two axes, the same shape as the button (DDR-0032): `variant` says which surface the card is
 * drawn on, `size` how much padding it carries. Adding a panel means naming those two things,
 * not writing CSS.
 *
 * `as` exists because the surfaces being replaced were not all the same element — most are a
 * `<section>`, the realized-gains highlight is a `<div>`, and the one-line loading states are a
 * `<p>`, whose UA margins are part of how the dashboard's flex column spaces them. Changing the
 * element would move the page, so the element stays the caller's decision.
 */
type CardElement = 'section' | 'div' | 'article' | 'aside' | 'p'

export function Card({
  as: Tag = 'section',
  variant = DEFAULT_CARD_VARIANT,
  size = DEFAULT_CARD_SIZE,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: CardElement
  variant?: CardVariant
  size?: CardSize
}): React.JSX.Element {
  return <Tag className={cardClassName(variant, size, className)} {...props} />
}

/**
 * A title beside whatever the card offers to do with itself — a filter toolbar, a Clear
 * action, an import button. `align` is the one thing the two superseded header rules
 * genuinely disagreed about, so it is a prop rather than a second class.
 */
export function CardHeader({
  align = DEFAULT_CARD_HEADER_ALIGN,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { align?: CardHeaderAlign }): React.JSX.Element {
  return <div className={cardHeaderClassName(align, className)} {...props} />
}

/**
 * The card's heading. One treatment for every card in the app: sentence case at the body
 * size, muted. Uppercase-with-letter-spacing stays reserved for a *label* naming a single
 * figure (`.balance-label`, `.stat-label`, `.highlight-label`) — a different job.
 */
export function CardTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>): React.JSX.Element {
  return <h2 className={cardPartClassName('title', className)} {...props} />
}

/**
 * The card's body, below its title or header.
 *
 * It looks like an empty wrapper and is not: it is the *scope* the superseded `.panel` class
 * used to provide. The two descendant overrides a panel declared — a table that fills the body
 * drops its own border, and a lede line under the title sits tighter — now hang off the body
 * rather than off the surface. That is what keeps a card whose content is prose (a state
 * panel) out of their reach.
 */
export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cardPartClassName('content', className)} {...props} />
}
