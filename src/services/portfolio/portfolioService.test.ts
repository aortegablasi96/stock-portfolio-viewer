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
    getExchangeRates: vi.fn(),
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

  it('does not fetch FX rates when no display currency is requested', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 1, symbol: 'AAA', marketValue: 10 })])

    const overview = await portfolioService.getOverview()

    expect(mockRepo.getExchangeRates).not.toHaveBeenCalled()
    expect(overview.displayCurrency).toBeUndefined()
    expect(overview.holdings[0]?.displayValue).toBeUndefined()
  })
})

describe('portfolioService.getOverview — display currency (Story #28)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.getBalances.mockResolvedValue({
      currency: 'EUR',
      totalCashValue: 1000,
      netLiquidation: 5000,
    })
  })

  it('converts each holding and totals the converted values (mixed currencies)', async () => {
    mockRepo.getHoldings.mockResolvedValue([
      holding({ conid: 1, symbol: 'USD1', marketValue: 100, currency: 'USD' }),
      holding({ conid: 2, symbol: 'EUR1', marketValue: 100, currency: 'EUR' }),
    ])
    // 1 USD = 0.90 EUR; EUR → EUR = 1.
    mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

    const overview = await portfolioService.getOverview('EUR')

    expect(overview.displayCurrency).toBe('EUR')
    expect(overview.holdings[0]?.displayValue).toBe(90) // 100 USD → 90 EUR
    expect(overview.holdings[1]?.displayValue).toBe(100)
    // Native fields are retained for display.
    expect(overview.holdings[0]?.marketValue).toBe(100)
    expect(overview.holdings[0]?.currency).toBe('USD')
    // Total is the sum of the converted values, not the currency-mixed native sum.
    expect(overview.totalMarketValue).toBe(190)
    const weightSum = overview.allocation.reduce((s, a) => s + a.weight, 0)
    expect(weightSum).toBeCloseTo(1)
  })

  it('requests rates for every held currency plus the base currency', async () => {
    mockRepo.getHoldings.mockResolvedValue([
      holding({ conid: 1, symbol: 'USD1', marketValue: 100, currency: 'USD' }),
      holding({ conid: 2, symbol: 'GBP1', marketValue: 100, currency: 'GBP' }),
    ])
    mockRepo.getExchangeRates.mockResolvedValue({ USD: 1, GBP: 1.25, EUR: 1.08 })

    await portfolioService.getOverview('USD')

    const [currencies, target] = mockRepo.getExchangeRates.mock.calls[0] ?? []
    expect(target).toBe('USD')
    expect(currencies).toEqual(expect.arrayContaining(['USD', 'GBP', 'EUR']))
  })

  it('flags positions with no available rate as unconverted and excludes them from the total', async () => {
    mockRepo.getHoldings.mockResolvedValue([
      holding({ conid: 1, symbol: 'USD1', marketValue: 100, currency: 'USD' }),
      holding({ conid: 2, symbol: 'XYZ1', marketValue: 100, currency: 'XYZ' }),
    ])
    // No rate returned for XYZ (repository omits unavailable pairs).
    mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

    const overview = await portfolioService.getOverview('EUR')

    expect(overview.holdings[0]?.displayValue).toBe(90)
    expect(overview.holdings[1]?.displayValue).toBeNull()
    // Unconverted position excluded from the total and from allocation.
    expect(overview.totalMarketValue).toBe(90)
    expect(overview.allocation).toHaveLength(1)
    expect(overview.allocation[0]?.conid).toBe(1)
    expect(overview.allocation[0]?.weight).toBeCloseTo(1)
  })

  it('uses a rate of 1 when a holding is already in the display currency', async () => {
    mockRepo.getHoldings.mockResolvedValue([
      holding({ conid: 1, symbol: 'EUR1', marketValue: 250, currency: 'EUR' }),
    ])
    mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1 })

    const overview = await portfolioService.getOverview('EUR')

    expect(overview.holdings[0]?.displayValue).toBe(250)
    expect(overview.totalMarketValue).toBe(250)
  })

  it('converts the account balances into the display currency', async () => {
    mockRepo.getHoldings.mockResolvedValue([])
    // Rates convert each source into the target (USD); EUR → USD = 1.1, USD → USD = 1.
    mockRepo.getExchangeRates.mockResolvedValue({ USD: 1, EUR: 1.1 })

    const overview = await portfolioService.getOverview('USD')

    expect(overview.balances.currency).toBe('USD')
    expect(overview.balances.totalCashValue).toBe(1100) // 1000 EUR × 1.1
    expect(overview.balances.netLiquidation).toBe(5500) // 5000 EUR × 1.1
  })

  it('leaves balances native when the base currency rate is unavailable', async () => {
    mockRepo.getHoldings.mockResolvedValue([])
    // Base EUR rate missing from the map.
    mockRepo.getExchangeRates.mockResolvedValue({ USD: 1 })

    const overview = await portfolioService.getOverview('USD')

    expect(overview.balances.currency).toBe('EUR')
    expect(overview.balances.netLiquidation).toBe(5000)
  })
})
