import { describe, it, expect, vi, beforeEach } from 'vitest'
import { portfolioService } from './portfolioService'
import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import { portfolioRepository } from '@repositories/portfolio/portfolioRepository'
import { IbkrNotConnectedError } from '@shared/errors'
import type { AccountBalances, Holding } from '@shared/domain/portfolio'

// Mock the repository so the service is tested in isolation (no gateway / network).
vi.mock('@repositories/portfolio/portfolioRepository', () => ({
  portfolioRepository: {
    getHoldings: vi.fn(),
    getBalances: vi.fn(),
    getCashByCurrency: vi.fn(),
    getExchangeRates: vi.fn(),
  },
}))

// The names come from imported Flex history rather than from the gateway, so the service reaches
// a second repository. Mocked for the same reason as the first: no SQLite in a unit test.
vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: { getInstrumentNames: vi.fn(() => []) },
}))

const mockRepo = vi.mocked(portfolioRepository)
const mockFlex = vi.mocked(flexReadRepository)

function holding(overrides: Partial<Holding> & Pick<Holding, 'conid' | 'symbol' | 'marketValue'>): Holding {
  return {
    description: overrides.symbol,
    companyName: null,
    quantity: 1,
    averageCost: null,
    marketPrice: null,
    unrealizedPnl: null,
    currency: 'USD',
    ...overrides,
  }
}

const balances: AccountBalances = {
  currency: 'USD',
  totalCashValue: 1000,
  netLiquidation: 101000,
  stockMarketValue: 100000,
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
      stockMarketValue: 4000,
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

  /**
   * The unrealized P&L converts, and does it here rather than in the repository or the renderer
   * (DDR-0007, Story #263). A gain is an *amount*, which is why it converts at all where
   * `marketPrice` and `averageCost` deliberately do not — a quote is a native-currency fact.
   */
  describe('unrealized P&L conversion', () => {
    it('converts it at the same rate as the market value beside it', async () => {
      mockRepo.getHoldings.mockResolvedValue([
        holding({ conid: 1, symbol: 'USD1', marketValue: 100, unrealizedPnl: 20, currency: 'USD' }),
      ])
      mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

      const overview = await portfolioService.getOverview('EUR')

      expect(overview.holdings[0]?.displayValue).toBe(90)
      expect(overview.holdings[0]?.displayUnrealizedPnl).toBe(18)
    })

    it('keeps a loss signed through the conversion', async () => {
      mockRepo.getHoldings.mockResolvedValue([
        holding({ conid: 1, symbol: 'USD1', marketValue: 100, unrealizedPnl: -50, currency: 'USD' }),
      ])
      mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

      const overview = await portfolioService.getOverview('EUR')

      expect(overview.holdings[0]?.displayUnrealizedPnl).toBe(-45)
    })

    it('reports null where the position has no available rate', async () => {
      mockRepo.getHoldings.mockResolvedValue([
        holding({ conid: 1, symbol: 'XYZ1', marketValue: 100, unrealizedPnl: 20, currency: 'XYZ' }),
      ])
      mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1 })

      const overview = await portfolioService.getOverview('EUR')

      expect(overview.holdings[0]?.displayUnrealizedPnl).toBeNull()
    })

    it('reports null where the native figure itself is unknown', async () => {
      mockRepo.getHoldings.mockResolvedValue([
        holding({ conid: 1, symbol: 'USD1', marketValue: 100, unrealizedPnl: null, currency: 'USD' }),
      ])
      mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

      const overview = await portfolioService.getOverview('EUR')

      // Not 0 — a rate that exists cannot manufacture a figure that does not.
      expect(overview.holdings[0]?.displayUnrealizedPnl).toBeNull()
    })

    it('leaves it absent on the native overview, like the market value', async () => {
      mockRepo.getHoldings.mockResolvedValue([
        holding({ conid: 1, symbol: 'USD1', marketValue: 100, unrealizedPnl: 20, currency: 'USD' }),
      ])

      const overview = await portfolioService.getOverview()

      expect(overview.holdings[0]?.displayUnrealizedPnl).toBeUndefined()
      expect(overview.holdings[0]?.unrealizedPnl).toBe(20)
    })
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

/**
 * The company name (Story #263 follow-up). The gateway has none to give — this build sends no
 * `ticker`, so a position's `description` is its symbol again — while the imported Flex
 * `SecurityInfo` rows do, for every instrument the owner has ever traded. The service joins the
 * two locally, which is why the Portfolio view can now name a holding the way Allocation does.
 */
describe('resolving the company name from imported history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRepo.getBalances.mockResolvedValue(balances)
    mockFlex.getInstrumentNames.mockReturnValue([])
  })

  it('names a holding by conid', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 43645865, symbol: 'IBKR', marketValue: 10 })])
    mockFlex.getInstrumentNames.mockReturnValue([
      { conid: 43645865, symbol: 'IBKR', description: 'INTERACTIVE BROKERS GRO-CL A' },
    ])

    const overview = await portfolioService.getOverview()

    expect(overview.holdings[0]!.companyName).toBe('INTERACTIVE BROKERS GRO-CL A')
  })

  /**
   * The conid wins where both could answer, and this is the case that shows why: one instrument
   * listed twice carries one conid and two tickers, and the live position may be held under a
   * third. Matching on the identifier gets the name; matching on the ticker would not.
   */
  it('prefers the conid over a symbol that says otherwise', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 389383088, symbol: 'NWL1', marketValue: 10 })])
    mockFlex.getInstrumentNames.mockReturnValue([
      { conid: 389383088, symbol: 'NWL', description: 'NEWPRINCES SPA' },
      { conid: 999, symbol: 'NWL1', description: 'SOMETHING ELSE PLC' },
    ])

    const overview = await portfolioService.getOverview()

    expect(overview.holdings[0]!.companyName).toBe('NEWPRINCES SPA')
  })

  /** Falls back to the ticker where history recorded no conid for the row. */
  it('falls back to the symbol when the imported row has no conid', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 7, symbol: 'GSY', marketValue: 10 })])
    mockFlex.getInstrumentNames.mockReturnValue([
      { conid: null, symbol: 'GSY', description: 'GOEASY LTD' },
    ])

    const overview = await portfolioService.getOverview()

    expect(overview.holdings[0]!.companyName).toBe('GOEASY LTD')
  })

  /**
   * A position bought since the last Flex import — and, by the same path, the whole view before
   * any import at all. The column falls back to the gateway's description and empties itself
   * rather than the view failing: an un-imported instrument is a missing name, not an error.
   */
  it('reports no name for an instrument history has never seen', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 5, symbol: 'NEW', marketValue: 10 })])
    mockFlex.getInstrumentNames.mockReturnValue([
      { conid: 43645865, symbol: 'IBKR', description: 'INTERACTIVE BROKERS GRO-CL A' },
    ])

    const overview = await portfolioService.getOverview()

    expect(overview.holdings[0]!.companyName).toBeNull()
  })

  it('leaves every name null when nothing has been imported', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 1, symbol: 'AAA', marketValue: 10 })])

    const overview = await portfolioService.getOverview()

    expect(overview.holdings[0]!.companyName).toBeNull()
  })

  /** An empty exported description is not a name, and must not shadow a symbol match that is. */
  it('ignores an empty description rather than storing it as a name', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 8, symbol: 'SBI', marketValue: 10 })])
    mockFlex.getInstrumentNames.mockReturnValue([
      { conid: 8, symbol: 'SBI', description: '' },
      { conid: null, symbol: 'SBI', description: 'SERABI GOLD PLC' },
    ])

    const overview = await portfolioService.getOverview()

    expect(overview.holdings[0]!.companyName).toBe('SERABI GOLD PLC')
  })

  /** The converted branch names the same rows — the view takes it whenever a currency is chosen. */
  it('names holdings on the display-currency path too', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 3, symbol: 'MMY', marketValue: 10, currency: 'CAD' })])
    mockRepo.getExchangeRates.mockResolvedValue({ CAD: 0.65, EUR: 1 })
    mockFlex.getInstrumentNames.mockReturnValue([
      { conid: 3, symbol: 'MMY', description: 'MONUMENT MINING LTD' },
    ])

    const overview = await portfolioService.getOverview('EUR')

    expect(overview.holdings[0]!.companyName).toBe('MONUMENT MINING LTD')
  })

  /**
   * The name is looked up, never *shortened*, here. Every view shortens at the point of drawing
   * through `instrumentName`, and a service that pre-shortened would be a second naming path —
   * the exact defect DDR-0066 closed.
   */
  it('carries the exported string through unshortened', async () => {
    mockRepo.getHoldings.mockResolvedValue([holding({ conid: 9, symbol: 'VBNK', marketValue: 10 })])
    mockFlex.getInstrumentNames.mockReturnValue([
      { conid: 9, symbol: 'VBNK', description: 'VERSABANK' },
    ])

    const overview = await portfolioService.getOverview()

    expect(overview.holdings[0]!.companyName).toBe('VERSABANK')
  })
})

describe('portfolioService.getExchangeRates (Bug #44)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes the currencies and target straight through to the repository', async () => {
    mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

    const rates = await portfolioService.getExchangeRates(['USD', 'EUR'], 'EUR')

    expect(rates).toEqual({ EUR: 1, USD: 0.9 })
    expect(mockRepo.getExchangeRates).toHaveBeenCalledWith(['USD', 'EUR'], 'EUR')
  })

  it('propagates a not-connected error so callers can degrade', async () => {
    mockRepo.getExchangeRates.mockRejectedValue(new IbkrNotConnectedError('gateway down'))

    await expect(portfolioService.getExchangeRates(['USD'], 'EUR')).rejects.toBeInstanceOf(
      IbkrNotConnectedError,
    )
  })
})

/**
 * Cash per currency, valued like a holding (Story #281, DDR-0095).
 *
 * `getOverview` reports cash as the one base-currency total the dashboard's tile shows. A
 * currency-exposure question is the one place that is the wrong shape, and the conversion has to
 * follow DDR-0007 exactly — which is why it lives in the service rather than the repository.
 */
describe('portfolioService.getCashPositions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('converts each balance at its own currency’s rate, keeping the native amount', async () => {
    mockRepo.getCashByCurrency.mockResolvedValue([
      { currency: 'USD', amount: 200 },
      { currency: 'EUR', amount: 100 },
    ])
    mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

    expect(await portfolioService.getCashPositions('EUR')).toEqual([
      { currency: 'USD', amount: 200, displayValue: 180 },
      { currency: 'EUR', amount: 100, displayValue: 100 },
    ])
  })

  /**
   * The rule the whole drift report rests on: **unconvertible is not zero** (DDR-0007). A cash
   * balance read as 0 would sit inside the denominator contributing nothing, quietly shrinking
   * every other weight; `null` takes it out and puts it in the unplaced block instead.
   */
  it('reports an unavailable rate as null rather than as zero', async () => {
    mockRepo.getCashByCurrency.mockResolvedValue([
      { currency: 'EUR', amount: 100 },
      { currency: 'ZWL', amount: 5000 },
    ])
    mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1 })

    const cash = await portfolioService.getCashPositions('EUR')
    expect(cash.find((c) => c.currency === 'ZWL')).toEqual({
      currency: 'ZWL',
      amount: 5000,
      displayValue: null,
    })
  })

  it('rounds the converted amount to cents, as every other money figure is', async () => {
    mockRepo.getCashByCurrency.mockResolvedValue([{ currency: 'USD', amount: 100 }])
    mockRepo.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.876543 })

    expect((await portfolioService.getCashPositions('EUR'))[0]!.displayValue).toBe(87.65)
  })

  /** An account holding no cash asks the gateway for no rates at all. */
  it('fetches no rates when there is no cash', async () => {
    mockRepo.getCashByCurrency.mockResolvedValue([])

    expect(await portfolioService.getCashPositions('EUR')).toEqual([])
    expect(mockRepo.getExchangeRates).not.toHaveBeenCalled()
  })
})
