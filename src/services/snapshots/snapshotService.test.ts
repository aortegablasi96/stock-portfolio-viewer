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
  },
}))
vi.mock('@services/portfolio/portfolioService', () => ({
  portfolioService: { getOverview: vi.fn() },
}))

const mockRepo = vi.mocked(snapshotRepository)
const mockPortfolio = vi.mocked(portfolioService)

const overview: PortfolioOverview = {
  holdings: [],
  balances: { currency: 'USD', totalCashValue: 100, netLiquidation: 100 },
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
  it('returns the repository summaries', () => {
    mockRepo.listSummaries.mockReturnValue([summary])
    expect(snapshotService.getHistory()).toEqual([summary])
  })
})
