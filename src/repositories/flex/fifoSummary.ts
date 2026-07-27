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

/**
 * Narrow FIFO summary rows to the **latest** imported statement (Bug #103).
 *
 * A FIFO summary mixes two kinds of number. Realized P&L is a per-period *flow*: statements
 * cover non-overlapping periods, so summing it across all of them is correct. Unrealized P&L
 * is an *as-of balance* on the positions still held at the statement's end date — an
 * instrument held through two statements reports its unrealized gain in both, and summing
 * them counts the same gain twice (measured at 25% overstated on a two-statement import).
 * This is the same rule DDR-0010 states for `getLatestOpenPositions` /
 * `getLatestOpenDividendAccruals`; FIFO summaries were missed when it was applied.
 *
 * "Latest" is the largest statement end date — statement ids are assigned in *import* order,
 * which need not match period order — with the id breaking a tie between statements that end
 * on the same day. Returns every row of that one statement, so per-instrument as-of figures
 * stay consistent with the totals derived from them.
 */
export function fromLatestStatement(rows: FifoSummaryRow[]): FifoSummaryRow[] {
  if (rows.length === 0) return []
  const latest = rows.reduce((a, b) =>
    b.statementToDate > a.statementToDate ||
    (b.statementToDate === a.statementToDate && b.statementId > a.statementId)
      ? b
      : a,
  )
  return rows.filter((r) => r.statementId === latest.statementId)
}
