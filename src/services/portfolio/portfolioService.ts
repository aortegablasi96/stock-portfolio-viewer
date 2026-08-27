import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import {
  portfolioRepository,
  type CashBalance,
} from '@repositories/portfolio/portfolioRepository'
import type {
  AccountBalances,
  AllocationSlice,
  Holding,
  PortfolioOverview,
} from '@shared/domain/portfolio'

/**
 * Cash in one currency, valued in a display currency on a holding's terms (Story #281).
 *
 * `displayValue === null` means **unconvertible, not zero** — the rule DDR-0007 states for a
 * holding, and the reason this shape exists rather than a bare converted number.
 */
export interface CashPosition extends CashBalance {
  displayValue: number | null
}

/**
 * Portfolio business logic for the read-only dashboard (Milestone M1, refined in M3
 * Story #28). The service orchestrates the repository and owns the calculations — total
 * market value, allocation weights, and (optionally) display-currency conversion — that
 * turn raw holdings into the overview the UI renders.
 *
 * It is framework-agnostic (no Electron/IPC/React) and reaches data only through the
 * repository, so it is the primary unit-test target (repository mocked). Connection
 * failures raised by the repository propagate as typed errors; the IPC handler maps
 * them to the renderer's `not_connected` / `error` states.
 */

/**
 * Give each holding the instrument name imported Flex history knows it by (Story #263 follow-up).
 *
 * The live gateway has no name to give: this build sends no `ticker`, so a position's
 * `description` is `contractDesc` — the symbol again (DDR-0066). The imported `SecurityInfo`
 * rows do have one, and every position the owner holds has been traded, so the join is a **local
 * read of history the app already stores**, not a request. It costs one query per overview and
 * cannot fail the view: with nothing imported the index is empty and every name is `null`.
 *
 * Resolved **by conid, falling back to symbol** — the same resolver the dividend tables use, for
 * the same reason: a conid is stable where a ticker is not (`NWL` and `NWLm` are one instrument on
 * two listings, and this account holds it under a third symbol live). The raw exported string is
 * carried through; shortening happens once, in the renderer, through `instrumentName`.
 */
function nameHoldings(holdings: Holding[]): Holding[] {
  const byConid = new Map<number, string>()
  const bySymbol = new Map<string, string>()
  for (const n of flexReadRepository.getInstrumentNames()) {
    if (n.description === '') continue
    if (n.conid != null && !byConid.has(n.conid)) byConid.set(n.conid, n.description)
    if (n.symbol !== '' && !bySymbol.has(n.symbol)) bySymbol.set(n.symbol, n.description)
  }
  if (byConid.size === 0 && bySymbol.size === 0) return holdings
  return holdings.map((h) => ({
    ...h,
    companyName: byConid.get(h.conid) ?? bySymbol.get(h.symbol) ?? null,
  }))
}

/** Round a money amount to cents, so displayed per-position values sum exactly to the total. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Each holding's share of the total holdings market value; empty when there is nothing to weight. */
function computeAllocation(holdings: Holding[], totalMarketValue: number): AllocationSlice[] {
  if (totalMarketValue <= 0) return []
  return holdings.map((h) => ({
    conid: h.conid,
    symbol: h.symbol,
    marketValue: h.marketValue,
    weight: h.marketValue / totalMarketValue,
  }))
}

/**
 * Allocation over the *converted* values (Story #28). Positions that could not be
 * converted (`displayValue === null`) are excluded — they contribute no weight and are
 * absent from the total — so the remaining weights sum to 1.
 */
function computeDisplayAllocation(
  holdings: Holding[],
  totalMarketValue: number,
): AllocationSlice[] {
  if (totalMarketValue <= 0) return []
  return holdings
    .filter((h) => h.displayValue != null)
    .map((h) => ({
      conid: h.conid,
      symbol: h.symbol,
      marketValue: h.displayValue as number,
      weight: (h.displayValue as number) / totalMarketValue,
    }))
}

/** Convert the base-currency balances into `target`; left native if its rate is unavailable. */
function convertBalances(
  balances: AccountBalances,
  rates: Record<string, number>,
  target: string,
): AccountBalances {
  const rate = rates[balances.currency]
  if (rate === undefined) return balances
  return {
    currency: target,
    totalCashValue: round2(balances.totalCashValue * rate),
    netLiquidation: round2(balances.netLiquidation * rate),
    stockMarketValue: round2(balances.stockMarketValue * rate),
  }
}

export const portfolioService = {
  /**
   * Assemble the current read-only portfolio overview: holdings, balances, and allocation.
   *
   * When `displayCurrency` is omitted the overview is returned in each position's **native**
   * currency (the original M1 behaviour, and the shape the snapshot capture path persists).
   * When a `displayCurrency` is given, every holding's market value, the total, the
   * allocation, and the balances are converted into it using live FX rates from the
   * repository; per-position native amounts are retained and positions with no available
   * rate are flagged (`displayValue === null`) and excluded from the converted total. See
   * DDR-0007.
   */
  async getOverview(displayCurrency?: string): Promise<PortfolioOverview> {
    const [rawHoldings, balances] = await Promise.all([
      portfolioRepository.getHoldings(),
      portfolioRepository.getBalances(),
    ])
    // Both branches, so the view is named whichever one it took. The snapshot capture path reads
    // the native branch and simply ignores the field — `toHoldingValues` persists what a position
    // was worth, and a name is not that.
    const holdings = nameHoldings(rawHoldings)

    if (!displayCurrency) {
      const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)
      const allocation = computeAllocation(holdings, totalMarketValue)
      return { holdings, balances, allocation, totalMarketValue }
    }

    const rates = await portfolioRepository.getExchangeRates(
      [...holdings.map((h) => h.currency), balances.currency],
      displayCurrency,
    )

    const convertedHoldings: Holding[] = holdings.map((h) => {
      const rate = rates[h.currency]
      return {
        ...h,
        displayValue: rate === undefined ? null : round2(h.marketValue * rate),
        // A gain is an amount and converts, unlike the price and average cost beside it, which
        // stay native because a quote is a native-currency fact (DDR-0007). Same rate, so the
        // column agrees with the Market value beside it; `null` where either the rate or the
        // native figure is missing, which is what the table draws an em dash for (Story #263).
        displayUnrealizedPnl:
          rate === undefined || h.unrealizedPnl === null ? null : round2(h.unrealizedPnl * rate),
      }
    })

    const totalMarketValue = convertedHoldings.reduce((sum, h) => sum + (h.displayValue ?? 0), 0)
    const allocation = computeDisplayAllocation(convertedHoldings, totalMarketValue)
    const convertedBalances = convertBalances(balances, rates, displayCurrency)

    return {
      holdings: convertedHoldings,
      balances: convertedBalances,
      allocation,
      totalMarketValue: round2(totalMarketValue),
      displayCurrency,
    }
  },

  /**
   * Cash per currency, each valued in `displayCurrency` on the same terms as a holding
   * (Story #281, DDR-0095).
   *
   * `getOverview` reports cash as the one base-currency total the dashboard's tile shows. A
   * currency-exposure question is the one place that is the wrong shape: the total is the
   * base-currency *equivalent* of cash held across several currencies, so attributing it to the
   * base currency would invent an exposure the owner may not have.
   *
   * `displayValue` follows DDR-0007 exactly, which is the whole reason this lives here rather
   * than in the repository: an unavailable rate is `null` — **unconvertible, not zero** — so a
   * cash balance the gateway could not price leaves every total instead of quietly landing in
   * one at face value. Native `amount` is retained beside it, as a holding's is.
   *
   * It reuses the ledger read `getOverview` already made and the rates it already fetched, both
   * coalesced by the repository's cache, so calling both costs one gateway round trip (DDR-0024).
   */
  async getCashPositions(displayCurrency: string): Promise<CashPosition[]> {
    const cash = await portfolioRepository.getCashByCurrency()
    if (cash.length === 0) return []

    const rates = await portfolioRepository.getExchangeRates(
      cash.map((c) => c.currency),
      displayCurrency,
    )
    return cash.map((c) => {
      const rate = rates[c.currency]
      return {
        ...c,
        displayValue: rate === undefined ? null : round2(c.amount * rate),
      }
    })
  },

  /**
   * Live gateway FX rates converting each of `currencies` into `target`, as a `source → rate`
   * map (`target` maps to `1`; unavailable pairs are omitted). Exposed so other services can
   * apply the *same* live-FX convention as the Portfolio view (Bug #44: converting stored
   * snapshot totals for the history section). A thin pass-through to the repository — a
   * disconnected gateway still propagates `IbkrNotConnectedError`. See DDR-0007.
   */
  async getExchangeRates(
    currencies: readonly string[],
    target: string,
  ): Promise<Record<string, number>> {
    return portfolioRepository.getExchangeRates(currencies, target)
  },
}
