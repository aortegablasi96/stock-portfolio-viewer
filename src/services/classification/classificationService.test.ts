import { describe, it, expect, vi, beforeEach } from 'vitest'
import { classificationService } from './classificationService'
import { classificationRepository } from '@repositories/classification/classificationRepository'
import { flexReadRepository, type LatestPositions, type OpenPositionRow } from '@repositories/flex/flexReadRepository'
import { IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'

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
  return { reportDate: 100, baseCurrency: 'EUR', navEndingValue: null, positions, securities: [] }
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
      partial: { fetched: 0, classified: 0, remaining: 1 },
    })
    expect(classifications.fetchClassification).not.toHaveBeenCalled()
  })

  it('reports a stalled gateway as not_responding, distinct from a closed one', async () => {
    // Story #104: the sequential loop ends at the first timed-out lookup, so a refresh costs
    // one bounded wait rather than one per instrument.
    flex.getLatestOpenPositions.mockReturnValue(
      latest([position({ conid: 1, symbol: 'AAA' }), position({ conid: 2, symbol: 'BBB' })]),
    )
    classifications.fetchClassification.mockRejectedValue(
      new IbkrTimeoutError('no response within 15s'),
    )

    await expect(classificationService.refreshClassifications()).resolves.toEqual({
      status: 'not_responding',
      message: 'no response within 15s',
      partial: { fetched: 0, classified: 0, remaining: 2 },
    })
    expect(classifications.fetchClassification).toHaveBeenCalledTimes(1)
  })

  it('reports an unexpected gateway failure as an error result', async () => {
    flex.getLatestOpenPositions.mockReturnValue(latest([position({})]))
    classifications.fetchClassification.mockRejectedValue(new Error('HTTP 500'))

    await expect(classificationService.refreshClassifications()).resolves.toEqual({
      status: 'error',
      message: 'HTTP 500',
      partial: { fetched: 0, classified: 0, remaining: 1 },
    })
  })

  // ---- partial progress (Story #105) ----------------------------------------

  it('persists the lookups made before a mid-loop failure', async () => {
    flex.getLatestOpenPositions.mockReturnValue(
      latest([
        position({ conid: 1, symbol: 'AAA' }),
        position({ conid: 2, symbol: 'BBB' }),
        position({ conid: 3, symbol: 'CCC' }),
        position({ conid: 4, symbol: 'DDD' }),
      ]),
    )
    classifications.fetchClassification
      .mockResolvedValueOnce({ sector: 'Financial', industry: 'Banks' })
      // The gateway has no sector for this one — still a completed lookup, still cached.
      .mockResolvedValueOnce({ sector: '', industry: '' })
      .mockRejectedValueOnce(new IbkrTimeoutError('no response within 15s'))

    const result = await classificationService.refreshClassifications()

    expect(result).toEqual({
      status: 'not_responding',
      message: 'no response within 15s',
      partial: { fetched: 2, classified: 1, remaining: 2 },
    })
    // The two successful lookups are written even though the run failed — the whole point.
    const saved = classifications.upsertMany.mock.calls[0]![0]
    expect(saved.map((row) => [row.conid, row.sector])).toEqual([
      [1, 'Financial'],
      [2, ''],
    ])
  })

  it('asks only for what is still missing after a partial run', async () => {
    // The cache as it stands after the mid-loop failure above: 1 and 2 saved, 3 and 4 not.
    flex.getLatestOpenPositions.mockReturnValue(
      latest([
        position({ conid: 1, symbol: 'AAA' }),
        position({ conid: 2, symbol: 'BBB' }),
        position({ conid: 3, symbol: 'CCC' }),
        position({ conid: 4, symbol: 'DDD' }),
      ]),
    )
    classifications.getAll.mockReturnValue([
      { conid: 1, symbol: 'AAA', sector: 'Financial', industry: 'Banks', fetchedAt: 1 },
      { conid: 2, symbol: 'BBB', sector: '', industry: '', fetchedAt: 1 },
    ])
    classifications.fetchClassification.mockResolvedValue({ sector: 'Energy', industry: 'Oil' })

    const result = await classificationService.refreshClassifications()

    expect(classifications.fetchClassification.mock.calls.map(([conid]) => conid)).toEqual([3, 4])
    expect(result).toEqual({
      status: 'ok',
      summary: { total: 4, fetched: 2, classified: 2, unclassified: 1 },
    })
  })

  it('reports progress before the first lookup and after each one', async () => {
    flex.getLatestOpenPositions.mockReturnValue(
      latest([position({ conid: 1, symbol: 'AAA' }), position({ conid: 2, symbol: 'BBB' })]),
    )
    classifications.fetchClassification.mockResolvedValue({ sector: 'Energy', industry: 'Oil' })
    const onProgress = vi.fn()

    await classificationService.refreshClassifications(onProgress)

    // The leading 0-of-2 tick is what lets the renderer show a total before any lookup returns.
    expect(onProgress.mock.calls.map(([p]) => p)).toEqual([
      { completed: 0, total: 2 },
      { completed: 1, total: 2 },
      { completed: 2, total: 2 },
    ])
  })

  it('carries on when a progress listener throws', async () => {
    flex.getLatestOpenPositions.mockReturnValue(latest([position({ conid: 1, symbol: 'AAA' })]))
    classifications.fetchClassification.mockResolvedValue({ sector: 'Energy', industry: 'Oil' })

    const result = await classificationService.refreshClassifications(() => {
      throw new Error('renderer went away')
    })

    expect(result).toEqual({
      status: 'ok',
      summary: { total: 1, fetched: 1, classified: 1, unclassified: 0 },
    })
  })
})
