import { portfolioRepository } from '@repositories/portfolio/portfolioRepository'
import type { AllocationSlice, Holding, PortfolioOverview } from '@shared/domain/portfolio'

/**
 * Portfolio business logic for the read-only dashboard (Milestone M1). The service
 * orchestrates the repository and owns the calculations — total market value and
 * allocation weights — that turn raw holdings into the overview the UI renders.
 *
 * It is framework-agnostic (no Electron/IPC/React) and reaches data only through the
 * repository, so it is the primary unit-test target (repository mocked). Connection
 * failures raised by the repository propagate as typed errors; the IPC handler maps
 * them to the renderer's `not_connected` / `error` states.
 */

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

export const portfolioService = {
  /** Assemble the current read-only portfolio overview: holdings, balances, and allocation. */
  async getOverview(): Promise<PortfolioOverview> {
    const [holdings, balances] = await Promise.all([
      portfolioRepository.getHoldings(),
      portfolioRepository.getBalances(),
    ])

    const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)
    const allocation = computeAllocation(holdings, totalMarketValue)

    return { holdings, balances, allocation, totalMarketValue }
  },
}
