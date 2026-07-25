import { describe, it, expect, vi, beforeEach } from 'vitest'
import { snapshotService, DEDUPE_WINDOW_MS } from './snapshotService'
import { snapshotRepository } from '@repositories/snapshots/snapshotRepository'
import { portfolioService } from '@services/portfolio/portfolioService'
import { IbkrNotConnectedError } from '@shared/errors'
import type { PortfolioOverview } from '@shared/domain/portfolio'
import type { SnapshotSummary } from '@shared/domain/snapshot'

vi.mock('@repositories/snapshots/snapshotRepository', () => ({
  snapshotRepository: {
    latestCapturedAt: vi.fn(),
    append: vi.fn(),
    listSummaries: vi.fn(),
    clearAll: vi.fn(),
  },
}))
vi.mock('@services/portfolio/portfolioService', () => ({
  portfolioService: { getOverview: vi.fn(), getExchangeRates: vi.fn() },
}))

const mockRepo = vi.mocked(snapshotRepository)
const mockPortfolio = vi.mocked(portfolioService)

const overview: PortfolioOverview = {
  holdings: [],
  balances: { currency: 'USD', totalCashValue: 100, netLiquidation: 100, stockMarketValue: 0 },
  allocation: [],
  totalMarketValue: 0,
}

const summary: SnapshotSummary = {
  id: 1,
  capturedAt: 10_000,
  source: 'ibkr',
  baseCurrency: 'USD',
  totalMarketValue: 0,
  netLiquidation: 100,
  totalCash: 100,
  holdingsCount: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockRepo.append.mockReturnValue(summary)
  mockPortfolio.getOverview.mockResolvedValue(overview)
})

describe('snapshotService.captureOnOpen', () => {
  it('captures when no prior snapshot exists', async () => {
    mockRepo.latestCapturedAt.mockReturnValue(undefined)

    const result = await snapshotService.captureOnOpen(1_000)

    expect(result).toEqual({ status: 'captured', summary })
    expect(mockRepo.append).toHaveBeenCalledWith({ capturedAt: 1_000, source: 'ibkr', overview })
  })

  it('skips when a snapshot exists within the 12-hour window', async () => {
    const now = 100_000_000
    mockRepo.latestCapturedAt.mockReturnValue(now - (DEDUPE_WINDOW_MS - 1))

    const result = await snapshotService.captureOnOpen(now)

    expect(result.status).toBe('skipped_recent')
    expect(mockRepo.append).not.toHaveBeenCalled()
    expect(mockPortfolio.getOverview).not.toHaveBeenCalled()
  })

  it('captures again once the window has fully elapsed (boundary is inclusive)', async () => {
    const now = 100_000_000
    mockRepo.latestCapturedAt.mockReturnValue(now - DEDUPE_WINDOW_MS)

    const result = await snapshotService.captureOnOpen(now)

    expect(result.status).toBe('captured')
    expect(mockRepo.append).toHaveBeenCalledTimes(1)
  })

  it('skips silently (no write) when not connected', async () => {
    mockRepo.latestCapturedAt.mockReturnValue(undefined)
    mockPortfolio.getOverview.mockRejectedValue(new IbkrNotConnectedError('gateway down'))

    const result = await snapshotService.captureOnOpen(1_000)

    expect(result).toEqual({ status: 'not_connected' })
    expect(mockRepo.append).not.toHaveBeenCalled()
  })

  it('propagates unexpected errors', async () => {
    mockRepo.latestCapturedAt.mockReturnValue(undefined)
    mockPortfolio.getOverview.mockRejectedValue(new Error('boom'))

    await expect(snapshotService.captureOnOpen(1_000)).rejects.toThrow('boom')
  })
})

describe('snapshotService.captureNow', () => {
  it('always writes, even when a recent snapshot exists (bypasses de-dupe)', async () => {
    mockRepo.latestCapturedAt.mockReturnValue(5_000) // recent, but irrelevant to manual capture

    const result = await snapshotService.captureNow(5_100)

    expect(result).toEqual(summary)
    expect(mockRepo.latestCapturedAt).not.toHaveBeenCalled()
    expect(mockRepo.append).toHaveBeenCalledWith({ capturedAt: 5_100, source: 'ibkr', overview })
  })

  it('propagates a not-connected error', async () => {
    mockPortfolio.getOverview.mockRejectedValue(new IbkrNotConnectedError('gateway down'))

    await expect(snapshotService.captureNow()).rejects.toBeInstanceOf(IbkrNotConnectedError)
    expect(mockRepo.append).not.toHaveBeenCalled()
  })
})

describe('snapshotService.getHistory', () => {
  it('returns the stored native summaries when no display currency is requested', async () => {
    mockRepo.listSummaries.mockReturnValue([summary])

    await expect(snapshotService.getHistory()).resolves.toEqual([summary])
    // No display currency → no FX round-trip.
    expect(mockPortfolio.getExchangeRates).not.toHaveBeenCalled()
  })

  it('returns early (no FX round-trip) when there is no history to convert', async () => {
    mockRepo.listSummaries.mockReturnValue([])

    await expect(snapshotService.getHistory('USD')).resolves.toEqual([])
    expect(mockPortfolio.getExchangeRates).not.toHaveBeenCalled()
  })

  it('converts each total into the display currency with live gateway FX', async () => {
    const usd = { ...summary, id: 1, baseCurrency: 'USD', netLiquidation: 100 }
    const eur = { ...summary, id: 2, baseCurrency: 'EUR', netLiquidation: 50 }
    mockRepo.listSummaries.mockReturnValue([usd, eur])
    mockPortfolio.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.9 })

    const history = await snapshotService.getHistory('EUR')

    expect(mockPortfolio.getExchangeRates).toHaveBeenCalledWith(['USD', 'EUR'], 'EUR')
    expect(history).toEqual([
      { ...usd, displayCurrency: 'EUR', displayValue: 90 },
      { ...eur, displayCurrency: 'EUR', displayValue: 50 },
    ])
  })

  it('converts the total portfolio value (netLiquidation = holdings + cash), not the holdings-only total (Bug #68)', async () => {
    // holdings 100, cash 20 → net 120. History must convert the net (total incl. cash).
    const row = { ...summary, id: 1, baseCurrency: 'USD', totalMarketValue: 100, netLiquidation: 120 }
    mockRepo.listSummaries.mockReturnValue([row])
    mockPortfolio.getExchangeRates.mockResolvedValue({ EUR: 1, USD: 0.5 })

    const history = await snapshotService.getHistory('EUR')

    expect(history[0]?.displayValue).toBe(60) // 120 × 0.5, not 100 × 0.5
  })

  it('flags rows with no available rate as unconverted (displayValue null) rather than mis-converting', async () => {
    const usd = { ...summary, id: 1, baseCurrency: 'USD', netLiquidation: 100 }
    mockRepo.listSummaries.mockReturnValue([usd])
    // The USD→EUR pair is unavailable, so the repository omits it from the map.
    mockPortfolio.getExchangeRates.mockResolvedValue({ EUR: 1 })

    const history = await snapshotService.getHistory('EUR')

    expect(history).toEqual([{ ...usd, displayCurrency: 'EUR', displayValue: null }])
  })

  it('degrades when the gateway is disconnected: history stays visible, unconvertible rows flagged', async () => {
    const usd = { ...summary, id: 1, baseCurrency: 'USD', netLiquidation: 100 }
    const eur = { ...summary, id: 2, baseCurrency: 'EUR', netLiquidation: 50 }
    mockRepo.listSummaries.mockReturnValue([usd, eur])
    mockPortfolio.getExchangeRates.mockRejectedValue(new IbkrNotConnectedError('gateway down'))

    const history = await snapshotService.getHistory('EUR')

    // Rows already in the display currency still convert (rate 1); the rest are flagged.
    expect(history).toEqual([
      { ...usd, displayCurrency: 'EUR', displayValue: null },
      { ...eur, displayCurrency: 'EUR', displayValue: 50 },
    ])
  })

  it('propagates unexpected errors from the rate lookup', async () => {
    mockRepo.listSummaries.mockReturnValue([summary])
    mockPortfolio.getExchangeRates.mockRejectedValue(new Error('boom'))

    await expect(snapshotService.getHistory('EUR')).rejects.toThrow('boom')
  })
})

describe('snapshotService.clearHistory', () => {
  it('delegates the full reset to the repository and reports how many snapshots were removed', () => {
    mockRepo.clearAll.mockReturnValue(5)

    expect(snapshotService.clearHistory()).toEqual({ removedSnapshots: 5 })
    expect(mockRepo.clearAll).toHaveBeenCalledTimes(1)
  })

  it('reports zero when there was no history to clear', () => {
    mockRepo.clearAll.mockReturnValue(0)

    expect(snapshotService.clearHistory()).toEqual({ removedSnapshots: 0 })
  })
})
