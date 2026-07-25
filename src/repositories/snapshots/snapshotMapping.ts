import type { Holding } from '@shared/domain/portfolio'
import type { NewSnapshotInput, SnapshotSummary } from '@shared/domain/snapshot'
import type { SnapshotRow, SnapshotHoldingRow, NewSnapshotHoldingRow } from '@db/schema'

/**
 * Pure mapping between the snapshot domain (decimal `number` money) and stored
 * rows (integer minor units). Kept free of `@db/client` so it is unit-testable
 * under plain Node — the `better-sqlite3` native driver is built for Electron's
 * ABI and cannot load in the Vitest/Node process (see CLAUDE.md). The repository
 * wires these mappers to Drizzle. See DDR-0003.
 *
 * Type-only imports from `@db/schema` are safe here: that module pulls in only
 * `drizzle-orm/sqlite-core` (pure JS), never the native binding.
 */

export const toMinor = (value: number): number => Math.round(value * 100)
export const fromMinor = (value: number): number => value / 100
export const toMinorOrNull = (value: number | null): number | null =>
  value === null ? null : toMinor(value)
export const fromMinorOrNull = (value: number | null): number | null =>
  value === null ? null : fromMinor(value)

/** Header column values for a new snapshot (money in minor units). */
export function toHeaderValues(
  input: NewSnapshotInput,
  createdAt: number,
): Omit<SnapshotRow, 'id'> {
  const { overview } = input
  return {
    capturedAt: input.capturedAt,
    source: input.source,
    baseCurrency: overview.balances.currency,
    // Base-currency holdings value from the ledger, not `overview.totalMarketValue` — the
    // latter is a mixed-currency sum on the native (unconverted) overview the capture path
    // uses, which would store a meaningless total (Bug #68). Sourced from `balances` like the
    // other two totals, so all three reconcile to `baseCurrency`.
    totalMarketValue: toMinor(overview.balances.stockMarketValue),
    netLiquidation: toMinor(overview.balances.netLiquidation),
    totalCash: toMinor(overview.balances.totalCashValue),
    holdingsCount: overview.holdings.length,
    createdAt,
  }
}

/** Detail-row values for one holding (money in minor units), given its parent id. */
export function toHoldingValues(holding: Holding, snapshotId: number): NewSnapshotHoldingRow {
  return {
    snapshotId,
    conid: holding.conid,
    symbol: holding.symbol,
    description: holding.description,
    quantity: holding.quantity,
    averageCost: toMinorOrNull(holding.averageCost),
    marketPrice: toMinorOrNull(holding.marketPrice),
    marketValue: toMinor(holding.marketValue),
    currency: holding.currency,
  }
}

/** Stored header row → domain summary (money back to decimal). */
export function rowToSummary(row: SnapshotRow): SnapshotSummary {
  return {
    id: row.id,
    capturedAt: row.capturedAt,
    source: row.source,
    baseCurrency: row.baseCurrency,
    totalMarketValue: fromMinor(row.totalMarketValue),
    netLiquidation: fromMinor(row.netLiquidation),
    totalCash: fromMinor(row.totalCash),
    holdingsCount: row.holdingsCount,
  }
}

/** Stored detail row → domain holding (money back to decimal). */
export function rowToHolding(row: SnapshotHoldingRow): Holding {
  return {
    conid: row.conid,
    symbol: row.symbol,
    description: row.description,
    quantity: row.quantity,
    averageCost: fromMinorOrNull(row.averageCost),
    marketPrice: fromMinorOrNull(row.marketPrice),
    marketValue: fromMinor(row.marketValue),
    currency: row.currency,
  }
}
