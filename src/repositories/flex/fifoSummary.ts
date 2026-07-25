import type { FifoSummaryRow } from './flexReadRepository'

/**
 * IBKR's FIFO Performance Summary carries a "Total (All Assets)" aggregate row (blank
 * symbol/conid) whose P&L equals the sum of the per-instrument rows. Analytics must skip
 * it: summing it in doubles realized/unrealized totals, and it surfaces as a phantom
 * "Total" entry (and best/worst pick) in the per-symbol views. Real instruments — cash
 * currencies (USD, CHF, …) included — always carry a symbol, so its absence marks the
 * aggregate line.
 *
 * Lives in its own DB-free module so services (and their unit tests) can apply the real
 * predicate without importing the SQLite-backed `flexReadRepository`.
 */
export function isInstrumentSummary(row: FifoSummaryRow): boolean {
  return row.symbol.trim() !== ''
}
