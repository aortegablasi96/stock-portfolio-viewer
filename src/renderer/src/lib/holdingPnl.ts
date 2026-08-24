import type { Holding } from '@shared/domain/portfolio'
import { toneOf, type StatTone } from './statTileVariants'

/**
 * What the holdings table's Unrealized P&L cell shows, and how it is toned (Story #263).
 *
 * It lives here rather than inside `HoldingsTable` because Vitest runs with no jsdom, so a rule
 * written inside a component is a rule no test can see. The two rules are small and both have a
 * quiet failure mode, which is exactly the pair worth extracting.
 */
export interface UnrealizedPnl {
  /** The figure to show, or `null` where there is none to show and the cell draws an em dash. */
  value: number | null
  /** The currency `value` is stated in — the display currency once converted, else the position's. */
  currency: string
}

/**
 * Pick the figure for one row, mirroring the Market value column's `valueOf`: the converted
 * amount when the overview was read in a display currency, the native one when it was not.
 *
 * A position the gateway could not price a rate for carries `displayUnrealizedPnl === null`, and
 * so does one whose native figure was never known. Both land on `null` on purpose — the row's
 * Market value cell already carries the "no exchange rate" badge and the table its notice, so
 * repeating that flag in a second money column on the same line says nothing new (DDR-0007).
 *
 * The `?? null` matters: `displayUnrealizedPnl` is *absent* on a native overview and on a
 * snapshot-sourced holding, and an `undefined` reaching the caller would be drawn as an empty
 * cell rather than as the em dash that says "not known".
 */
export function unrealizedPnlOf(holding: Holding, displayCurrency?: string): UnrealizedPnl {
  if (displayCurrency !== undefined) {
    return { value: holding.displayUnrealizedPnl ?? null, currency: displayCurrency }
  }
  return { value: holding.unrealizedPnl, currency: holding.currency }
}

/**
 * The cell's tone. A figure with no value is **neutral**, not a loss.
 *
 * `toneOf` takes a number, so the obvious spelling at the call site is `toneOf(value ?? 0)` — which
 * happens to be right and reads like a coincidence. Naming it here is what makes "an unknown P&L
 * is not a red one" a thing a test can hold. Neutral resolves to no class at all, so the cell keeps
 * the table's own ink (DDR-0034).
 */
export function unrealizedPnlTone(pnl: UnrealizedPnl): StatTone {
  return pnl.value === null ? 'neutral' : toneOf(pnl.value)
}
