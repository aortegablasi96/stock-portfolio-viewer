import type { AccountBalances, Holding } from '@shared/domain/portfolio'
import { ibkrGateway, type LedgerEntry, type RawPosition } from './ibkrGateway'

/**
 * Data access for the live portfolio, sourced from the Interactive Brokers Client
 * Portal Gateway (ADR-0004). This repository is the only place that knows the data
 * comes from IBKR: it maps raw gateway DTOs into domain models and exposes
 * domain-oriented methods. Services consume these without knowing the origin.
 *
 * In M2 this same seam will compose local SQLite snapshots alongside IBKR; nothing
 * about that is built here yet (no speculative abstraction).
 */

/** Map a raw IBKR position into the `Holding` domain model. */
function toHolding(p: RawPosition): Holding {
  return {
    conid: p.conid,
    symbol: p.ticker ?? p.contractDesc ?? String(p.conid),
    description: p.contractDesc ?? p.ticker ?? '',
    quantity: p.position ?? 0,
    averageCost: p.avgCost ?? null,
    marketPrice: p.mktPrice ?? null,
    marketValue: p.mktValue ?? 0,
    currency: p.currency ?? '',
  }
}

/** Pick the base-currency ledger entry (falls back to the first entry the gateway returns). */
function baseLedgerEntry(ledger: Record<string, LedgerEntry>): LedgerEntry | undefined {
  return ledger['BASE'] ?? Object.values(ledger)[0]
}

export const portfolioRepository = {
  /** Current open positions (zero-quantity/closed positions are excluded). */
  async getHoldings(): Promise<Holding[]> {
    await ibkrGateway.ensureAuthenticated()
    const accountId = await ibkrGateway.getAccountId()
    const positions = await ibkrGateway.getPositions(accountId)
    return positions.filter((p) => (p.position ?? 0) !== 0).map(toHolding)
  },

  /** Account cash and value figures in the base currency. */
  async getBalances(): Promise<AccountBalances> {
    await ibkrGateway.ensureAuthenticated()
    const accountId = await ibkrGateway.getAccountId()
    const ledger = await ibkrGateway.getLedger(accountId)
    const base = baseLedgerEntry(ledger)
    return {
      currency: base?.currency ?? 'BASE',
      totalCashValue: base?.cashbalance ?? 0,
      netLiquidation: base?.netliquidationvalue ?? 0,
    }
  },
}
