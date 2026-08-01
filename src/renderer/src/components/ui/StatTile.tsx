import type { HTMLAttributes } from 'react'
import {
  DEFAULT_STAT_TONE,
  statPartClassName,
  statRowClassName,
  toneClassName,
  type StatTone,
} from '../../lib/statTileVariants'
import { Card } from './Card'

/**
 * The app's one headline figure (Story #129, DDR-0034), replacing the two the Epic #125 audit
 * found: the Portfolio dashboard's `.balance-tile` and the analytics views' `.stat-tile`. They
 * were the same component written twice — `.balance-label` and `.stat-label` byte-identical,
 * `.balance-value` and `.stat-value` differing only by `1.5rem` vs `1.4rem` — and the copy the
 * dashboard used had no gain/loss tone and no hint line, so a balance could never show either.
 *
 * The tile is a `Card` (DDR-0033) carrying a label, a figure and an optional hint. Its surface
 * is the card's default at `md`, fixed: what varies about a headline figure is its **polarity**,
 * not its surface, so `tone` is the tile's only axis.
 */
export function StatTile({
  label,
  value,
  hint,
  tone = DEFAULT_STAT_TONE,
}: {
  label: string
  value: string
  hint?: string
  tone?: StatTone
}): React.JSX.Element {
  return (
    <Card as="div">
      <p className={statPartClassName('label')}>{label}</p>
      <p className={statPartClassName('value', toneClassName(tone))}>{value}</p>
      {hint && <p className={statPartClassName('hint')}>{hint}</p>}
    </Card>
  )
}

/**
 * The row the tiles sit in: one responsive grid for both callers, `auto-fit` over `minmax(11rem,
 * 1fr)`. The dashboard's three balances previously used a fixed `repeat(3, 1fr)` plus a 720px
 * media query to collapse them; `auto-fit` reflows on the space actually available, which is why
 * the grid needs no breakpoint of its own and the analytics rows of three and four tiles share it.
 *
 * `as` exists for the same reason the card's does: the balances row is a labelled `<section>`
 * (`aria-label="Account balances"`), while an analytics stat row is an unlabelled `<div>` under
 * its view's heading.
 */
export function StatRow({
  as: Tag = 'div',
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { as?: 'div' | 'section' }): React.JSX.Element {
  return <Tag className={statRowClassName(className)} {...props} />
}
