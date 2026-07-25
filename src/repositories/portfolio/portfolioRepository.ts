import type { AccountBalances, Holding } from '@shared/domain/portfolio'
import { IbkrGatewayError } from '@shared/errors'
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

/**
 * Resolve the account's base **ISO** currency from the ledger. The aggregate entry is keyed
 * `BASE` and carries `currency: 'BASE'` — a placeholder, not an ISO code — so it must not be
 * used as a currency label or passed to FX conversion (it has no `BASE→X` rate). The real
 * base currency is the per-currency entry whose rate to base is `1`. Falls back to the
 * aggregate entry's own currency, then `BASE`, when it cannot be identified.
 */
function resolveBaseCurrency(ledger: Record<string, LedgerEntry>): string {
  for (const [code, entry] of Object.entries(ledger)) {
    if (code !== 'BASE' && entry.currency !== 'BASE' && entry.exchangerate === 1) return code
  }
  return baseLedgerEntry(ledger)?.currency ?? 'BASE'
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
      // Use the resolved ISO base currency, never the ledger's `BASE` placeholder — the
      // display-currency conversion (DDR-0007) looks this up in the FX-rate map, and there
      // is no `BASE→X` rate (it comes back as 0 and would zero the cash / net-liquidation).
      currency: resolveBaseCurrency(ledger),
      totalCashValue: base?.cashbalance ?? 0,
      netLiquidation: base?.netliquidationvalue ?? 0,
      // Holdings value already in base currency (BASE ledger entry) — the figure snapshots
      // persist, so history never sums positions across mixed native currencies (Bug #68).
      stockMarketValue: base?.stockmarketvalue ?? 0,
    }
  },

  /**
   * FX rates converting each of `currencies` into `target`, as a `source → rate` map
   * (Story #28, DDR-0007). `target` maps to `1`. A currency whose rate cannot be fetched
   * (an `IbkrGatewayError` — e.g. an unsupported pair) is **omitted**, so the service can
   * flag those positions as unconverted rather than corrupt a total. A disconnected
   * gateway (`IbkrNotConnectedError`) still propagates, degrading the whole view to
   * `not_connected`. Conversion itself is the service's job — this only fetches rates.
   */
  async getExchangeRates(
    currencies: readonly string[],
    target: string,
  ): Promise<Record<string, number>> {
    const rates: Record<string, number> = { [target]: 1 }
    const distinct = [...new Set(currencies)].filter((c) => c && c !== target)
    for (const source of distinct) {
      try {
        const rate = await ibkrGateway.getExchangeRate(source, target)
        // A non-positive / non-finite rate is a bogus quote (e.g. the gateway returns 0 for
        // an unsupported pair). Treat it as unavailable rather than letting `value × 0` zero
        // a figure — the same "rate-unavailable as data" rule as a thrown error (DDR-0007).
        if (Number.isFinite(rate) && rate > 0) rates[source] = rate
      } catch (err) {
        // Rate unavailable for this pair → omit it (position shown unconverted). A
        // not-connected error is not an IbkrGatewayError, so it propagates.
        if (err instanceof IbkrGatewayError) continue
        throw err
      }
    }
    return rates
  },
}
