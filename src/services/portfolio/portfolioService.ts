import { portfolioRepository } from '@repositories/portfolio/portfolioRepository'
import type {
  AccountBalances,
  AllocationSlice,
  Holding,
  PortfolioOverview,
} from '@shared/domain/portfolio'

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
    const [holdings, balances] = await Promise.all([
      portfolioRepository.getHoldings(),
      portfolioRepository.getBalances(),
    ])

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
      return { ...h, displayValue: rate === undefined ? null : round2(h.marketValue * rate) }
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
}
