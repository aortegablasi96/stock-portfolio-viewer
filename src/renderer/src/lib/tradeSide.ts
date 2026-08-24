import type { TradeRow } from '@shared/domain/realizedGains'
import type { BadgeVariant } from './badgeVariants'

/**
 * Which badge tone a trade's side wears (Story #257, DDR-0086).
 *
 * The decision this module exists to hold is a **reversal**: DDR-0065 declined exactly this pair
 * of hues, on the argument that they already mean gain and loss in the same row's last cell and a
 * red `Sell` beside a red figure would read as though the side caused the number. DDR-0086 answers
 * that argument and adopts the pair; the reasoning is there rather than here, because a module
 * restating it would be the second place it could drift.
 *
 * It is a module rather than a ternary in the cell for the reason `closedSomething` is one
 * (DDR-0065): the view is where a colour decision gets made by accident. `tradesLayout.test.ts`
 * has failed on `=== 'Buy'` inside `TradeHistoryView.tsx` since Story #193 and **still does** —
 * what changed is not that branching became allowed but where the one branch is allowed to live,
 * and here it can be tested behaviourally rather than scanned for as text (DDR-0029: Vitest runs
 * in Node with no jsdom, so nothing inside a component is testable).
 */

/** The two sides `realizedGainsService` derives from a trade's quantity sign. */
export type TradeSide = TradeRow['side']

/**
 * The mapping, and the reason it is a `Record` rather than a function body.
 *
 * `Record<TradeSide, BadgeVariant>` is **total by construction**: a third side added to the shared
 * `z.enum(['Buy', 'Sell'])` makes this object a type error rather than a silent fall-through to
 * whatever the last branch was. The value type is `BadgeVariant` and not a wider string, so the
 * other half is compile-checked too — a tone here has to be a variant `app.css` declares a rule
 * for, which is what `badgeVariants.test.ts` guards from the other end (DDR-0037).
 *
 * Both members are drawn from `TONED_BADGE_VARIANTS`, so no variant is invented for this column:
 * `positive` and `negative` are the pair Story #192 added for the dividend type badge (DDR-0064),
 * used here for a second kind of question asked of the same table cell.
 */
export const SIDE_VARIANTS: Record<TradeSide, BadgeVariant> = {
  Buy: 'positive',
  Sell: 'negative',
}

/** The tone a side's badge wears. Total over both sides, so the call site never branches. */
export function sideVariant(side: TradeSide): BadgeVariant {
  return SIDE_VARIANTS[side]
}
