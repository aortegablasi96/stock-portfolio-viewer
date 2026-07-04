/**
 * Pure display formatters for the portfolio UI. Kept out of components so the
 * number/locale logic can be unit-tested directly (ui-builder guidance).
 */

/**
 * Format a monetary value. Interactive Brokers' base-currency ledger reports the
 * pseudo-code `BASE` (and positions may lack a currency); in those cases we fall
 * back to a plain 2-decimal number rather than a currency symbol.
 */
export function formatCurrency(value: number, currency: string): string {
  if (currency && currency !== 'BASE') {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value)
    } catch {
      // Not a valid ISO currency code — fall through to plain formatting.
    }
  }
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** Format a share/contract quantity (fractional shares allowed, no forced decimals). */
export function formatQuantity(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

/** Format an allocation weight expressed as a fraction in [0, 1] as a percentage. */
export function formatPercent(fraction: number): string {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(fraction)
}
