import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classificationService } from './classificationService'
import { classificationRepository } from '@repositories/classification/classificationRepository'
import { flexReadRepository, type LatestPositions, type OpenPositionRow } from '@repositories/flex/flexReadRepository'
import { IbkrNotConnectedError } from '@shared/errors'

vi.mock('@repositories/classification/classificationRepository', () => ({
  classificationRepository: {
    getAll: vi.fn(),
    ensureConnected: vi.fn(),
    fetchClassification: vi.fn(),
    upsertMany: vi.fn(),
  },
}))

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: { getLatestOpenPositions: vi.fn() },
}))

const classifications = vi.mocked(classificationRepository)
const flex = vi.mocked(flexReadRepository)

function position(overrides: Partial<OpenPositionRow>): OpenPositionRow {
  return {
    conid: 1,
    symbol: 'AAA',
    description: 'Alpha',
    assetCategory: 'STK',
    currency: 'USD',
    fxRateToBase: 1,
    position: 10,
    markPrice: 5,
    costBasisMoney: 40,
    percentOfNav: 10,
    fifoPnlUnrealized: 10,
    ...overrides,
  }
}

function latest(positions: OpenPositionRow[]): LatestPositions {
  return { reportDate: 100, baseCurrency: 'EUR', positions, securities: [] }
}

beforeEach(() => {
  vi.clearAllMocks()
  classifications.getAll.mockReturnValue([])
  classifications.ensureConnected.mockResolvedValue(undefined)
})

describe('classificationService.refreshClassifications', () => {
  it('returns needs_import when nothing has been imported', async () => {
    flex.getLatestOpenPositions.mockReturnValue(undefined)
    await expect(classificationService.refreshClassifications()).resolves.toEqual({
      status: 'needs_import',
    })
    expect(classifications.fetchClassification).not.toHaveBeenCalled()
  })

  it('fetches and caches classifications for uncached instruments', async () => {
    flex.getLatestOpenPositions.mockReturnValue(
      latest([position({ conid: 1, symbol: 'AAA' }), position({ conid: 2, symbol: 'BBB' })]),
    )
    classifications.fetchClassification.mockResolvedValue({ sector: 'Financial', industry: 'Banks' })

    const result = await classificationService.refreshClassifications()

    expect(result).toEqual({
      status: 'ok',
      summary: { total: 2, fetched: 2, classified: 2, unclassified: 0 },
    })
    const saved = classifications.upsertMany.mock.calls[0]![0]
    expect(saved.map((row) => [row.conid, row.symbol, row.sector])).toEqual([
      [1, 'AAA', 'Financial'],
      [2, 'BBB', 'Financial'],
    ])
  })

  it('skips instruments already in the cache, including resolved-but-unknown ones', async () => {
    flex.getLatestOpenPositions.mockReturnValue(
      latest([position({ conid: 1, symbol: 'AAA' }), position({ conid: 2, symbol: 'BBB' })]),
    )
    classifications.getAll.mockReturnValue([
      { conid: 1, symbol: 'AAA', sector: 'Technology', industry: 'Software', fetchedAt: 1 },
      // Previously looked up and the source had no sector — must not be re-queried.
      { conid: 2, symbol: 'BBB', sector: '', industry: '', fetchedAt: 1 },
    ])

    const result = await classificationService.refreshClassifications()

    expect(classifications.fetchClassification).not.toHaveBeenCalled()
    expect(result).toEqual({
      status: 'ok',
      summary: { total: 2, fetched: 0, classified: 0, unclassified: 1 },
    })
  })

  it('de-duplicates repeated conids and counts positions without a conid as unclassified', async () => {
    flex.getLatestOpenPositions.mockReturnValue(
      latest([
        position({ conid: 1, symbol: 'AAA' }),
        position({ conid: 1, symbol: 'AAA' }),
        position({ conid: null, symbol: 'CASH' }),
      ]),
    )
    classifications.fetchClassification.mockResolvedValue({ sector: 'Energy', industry: 'Oil' })

    const result = await classificationService.refreshClassifications()

    expect(classifications.fetchClassification).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      status: 'ok',
      summary: { total: 2, fetched: 1, classified: 1, unclassified: 1 },
    })
  })

  it('reports a closed gateway as data, without querying instruments', async () => {
    flex.getLatestOpenPositions.mockReturnValue(latest([position({})]))
    classifications.ensureConnected.mockRejectedValue(new IbkrNotConnectedError('Gateway is closed.'))

    await expect(classificationService.refreshClassifications()).resolves.toEqual({
      status: 'not_connected',
      message: 'Gateway is closed.',
    })
    expect(classifications.fetchClassification).not.toHaveBeenCalled()
  })

  it('reports an unexpected gateway failure as an error result', async () => {
    flex.getLatestOpenPositions.mockReturnValue(latest([position({})]))
    classifications.fetchClassification.mockRejectedValue(new Error('HTTP 500'))

    await expect(classificationService.refreshClassifications()).resolves.toEqual({
      status: 'error',
      message: 'HTTP 500',
    })
  })
})
