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
 *
 * Story #187 restyled the three lines to the redesign's KPI tile — an 11px micro-label over a 26px
 * monospaced figure — and added no axis doing it (DDR-0060). The markup did not move: the parts
 * were already the redesign's three, which is why this is a stylesheet change with a component
 * comment rather than the reverse.
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
 * The row the tiles sit in: one responsive grid for both callers, `auto-fit` over `minmax(14.5rem,
 * 1fr)`. The dashboard's three balances previously used a fixed `repeat(3, 1fr)` plus a 720px
 * media query to collapse them; `auto-fit` reflows on the space actually available, which is why
 * the grid needs no breakpoint of its own and the analytics rows of three and four tiles share it.
 *
 * The column minimum is set by the figure, not by the label — see `app.css`, where the arithmetic
 * that ties 14.5rem to `--text-xl`'s 26px is written down (Story #187, DDR-0060).
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
