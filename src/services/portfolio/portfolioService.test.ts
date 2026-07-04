import { describe, it, expect, vi, beforeEach } from 'vitest'
import { portfolioService } from './portfolioService'
import { portfolioRepository } from '@repositories/portfolio/portfolioRepository'
import { IbkrNotConnectedError } from '@shared/errors'
import type { AccountBalances, Holding } from '@shared/domain/portfolio'

// Mock the repository so the service is tested in isolation (no gateway / network).
vi.mock('@repositories/portfolio/portfolioRepository', () => ({
  portfolioRepository: {
    getHoldings: vi.fn(),
    getBalances: vi.fn(),
  },
}))

const mockRepo = vi.mocked(portfolioRepository)

function holding(overrides: Partial<Holding> & Pick<Holding, 'conid' | 'symbol' | 'marketValue'>): Holding {
  return {
    description: overrides.symbol,
    quantity: 1,
    averageCost: null,
    marketPrice: null,
    currency: 'USD',
    ...overrides,
  }
}

const balances: AccountBalances = {
  currency: 'USD',
  totalCashValue: 1000,
  netLiquidation: 101000,
}

describe('portfolioService.getOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.getBalances.mockResolvedValue(balances)
  })

  it('totals market value and computes allocation weights that sum to 1', async () => {
    mockRepo.getHoldings.mockResolvedValue([
      holding({ conid: 1, symbol: 'AAA', marketValue: 60 }),
      holding({ conid: 2, symbol: 'BBB', marketValue: 40 }),
    ])

    const overview = await portfolioService.getOverview()

    expect(overview.totalMarketValue).toBe(100)
    expect(overview.allocation).toHaveLength(2)
    expect(overview.allocation[0]?.weight).toBeCloseTo(0.6)
    expect(overview.allocation[1]?.weight).toBeCloseTo(0.4)
    const weightSum = overview.allocation.reduce((s, a) => s + a.weight, 0)
    expect(weightSum).toBeCloseTo(1)
    expect(overview.balances).toEqual(balances)
  })

  it('handles an empty portfolio without dividing by zero', async () => {
    mockRepo.getHoldings.mockResolvedValue([])

    const overview = await portfolioService.getOverview()

    expect(overview.totalMarketValue).toBe(0)
    expect(overview.allocation).toEqual([])
    expect(overview.holdings).toEqual([])
  })

  it('allocation market values reconcile with the reported total', async () => {
    mockRepo.getHoldings.mockResolvedValue([
      holding({ conid: 1, symbol: 'AAA', marketValue: 250 }),
      holding({ conid: 2, symbol: 'BBB', marketValue: 750 }),
    ])

    const overview = await portfolioService.getOverview()

    const allocationTotal = overview.allocation.reduce((s, a) => s + a.marketValue, 0)
    expect(allocationTotal).toBe(overview.totalMarketValue)
  })

  it('propagates a not-connected error from the repository', async () => {
    mockRepo.getHoldings.mockRejectedValue(new IbkrNotConnectedError('gateway down'))

    await expect(portfolioService.getOverview()).rejects.toBeInstanceOf(IbkrNotConnectedError)
  })
})
