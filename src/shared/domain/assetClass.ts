/**
 * The asset-class vocabulary, with **no dependencies** (Story #281, DDR-0095).
 *
 * It moved out of `allocationService` because a second service now has to speak it, and
 * "speak it" is stronger than it sounds: the investor profile stores an asset-class target under
 * the *key* the allocation report published, so the drift report must bucket by exactly the same
 * keys or a stored target joins with nothing and reads as 0% — the failure DDR-0094 named as the
 * one an owner cannot see. Two private copies of this table would be one edit away from that.
 *
 * Dependency-free like `investorProfileTerms.ts`, so the renderer could import it as values if a
 * later view needs the labels, without pulling Zod into that bundle.
 */

/**
 * IBKR's asset-category codes, as the Flex `SecurityInfo` / `OpenPosition` rows carry them.
 * A code with no entry falls back to the code itself.
 */
export const ASSET_CLASS_LABELS: Record<string, string> = {
  STK: 'Stocks',
  ETF: 'ETFs',
  FUND: 'Funds',
  BOND: 'Bonds',
  OPT: 'Options',
  FOP: 'Futures Options',
  FUT: 'Futures',
  CASH: 'Cash / FX',
  WAR: 'Warrants',
}

/**
 * Asset-class key for **uninvested cash** (Story #47).
 *
 * Deliberately distinct from the Flex `CASH` asset category, which is forex/FX *positions* and is
 * labelled 'Cash / FX' — the two must never merge, because one is money the owner has not invested
 * and the other is a currency position they have taken.
 *
 * It is a sentinel rather than a word, and that is on purpose: it cannot collide with a real IBKR
 * code, and it is a *key*, so an owner who sets a cash target sees only its label.
 */
export const CASH_ASSET_KEY = '__cash__'

/** The label uninvested cash carries wherever it appears as an asset class. */
export const CASH_ASSET_LABEL = 'Cash'

export function assetClassLabel(code: string): string {
  if (code === CASH_ASSET_KEY) return CASH_ASSET_LABEL
  return ASSET_CLASS_LABELS[code] ?? (code || 'Other')
}
