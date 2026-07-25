import { describe, it, expect, vi, beforeEach } from 'vitest'
import { allocationService } from './allocationService'
import {
  flexReadRepository,
  type LatestPositions,
  type OpenPositionRow,
} from '@repositories/flex/flexReadRepository'
import { classificationRepository } from '@repositories/classification/classificationRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    getLatestOpenPositions: vi.fn(),
  },
}))

vi.mock('@repositories/classification/classificationRepository', () => ({
  classificationRepository: { getAll: vi.fn() },
}))

const repo = vi.mocked(flexReadRepository)
const classifications = vi.mocked(classificationRepository)

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

beforeEach(() => {
  vi.clearAllMocks()
  classifications.getAll.mockReturnValue([])
})

describe('allocationService.getAllocation', () => {
  it('returns needs_import when nothing has been imported', () => {
    repo.getLatestOpenPositions.mockReturnValue(undefined)
    expect(allocationService.getAllocation()).toEqual({ status: 'needs_import' })
  })

  it('converts market value, cost basis and unrealized P&L to base currency via fxRateToBase', () => {
    const latest: LatestPositions = {
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: null,
      positions: [position({ position: 10, markPrice: 5, costBasisMoney: 40, fifoPnlUnrealized: 10, fxRateToBase: 0.5 })],
      securities: [{ conid: 1, symbol: 'AAA', issuerCountryCode: 'US' }],
    }
    repo.getLatestOpenPositions.mockReturnValue(latest)

    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')
    const p = result.report.positions[0]!
    expect(p.marketValueBase).toBeCloseTo(25) // 10*5*0.5
    expect(p.costBasisBase).toBeCloseTo(20) // 40*0.5
    expect(p.unrealizedPnlBase).toBeCloseTo(5) // 10*0.5
    expect(p.issuerCountry).toBe('US')
    expect(result.report.totalMarketValueBase).toBeCloseTo(25)
  })

  it('falls back to cost + unrealized when mark price is missing', () => {
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: null,
      positions: [position({ markPrice: null, costBasisMoney: 100, fifoPnlUnrealized: 20, fxRateToBase: 1 })],
      securities: [],
    })
    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.positions[0]!.marketValueBase).toBeCloseTo(120)
  })

  it('groups by asset class, currency and country, summing value and NAV weight, largest first', () => {
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: null,
      positions: [
        position({ conid: 1, symbol: 'AAA', assetCategory: 'STK', currency: 'USD', position: 10, markPrice: 10, percentOfNav: 20, fxRateToBase: 1 }),
        position({ conid: 2, symbol: 'BBB', assetCategory: 'STK', currency: 'EUR', position: 10, markPrice: 5, percentOfNav: 10, fxRateToBase: 1 }),
        position({ conid: 3, symbol: 'CCC', assetCategory: 'ETF', currency: 'USD', position: 1, markPrice: 30, percentOfNav: 30, fxRateToBase: 1 }),
      ],
      securities: [
        { conid: 1, symbol: 'AAA', issuerCountryCode: 'US' },
        { conid: 2, symbol: 'BBB', issuerCountryCode: 'DE' },
        { conid: 3, symbol: 'CCC', issuerCountryCode: 'US' },
      ],
    })

    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')

    // STK: 100 + 50 = 150; ETF: 30. No NAV figure, so no cash slice; sorted by value.
    expect(result.report.byAssetClass.map((s) => [s.label, s.marketValueBase])).toEqual([
      ['Stocks', 150],
      ['ETFs', 30],
    ])
    // Currency USD: 100 + 30 = 130 (weight 20+30=50); EUR: 50
    expect(result.report.byCurrency[0]!).toMatchObject({ key: 'USD', marketValueBase: 130, percentOfNav: 50 })
    // Country US: 130; DE: 50
    expect(result.report.byCountry.map((s) => s.key)).toEqual(['US', 'DE'])
  })

  it('joins sector from the classification cache, by conid then symbol (Story #30)', () => {
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: null,
      positions: [
        position({ conid: 1, symbol: 'AAA', position: 10, markPrice: 10, percentOfNav: 20 }),
        // No conid on the position — must fall back to the symbol.
        position({ conid: null, symbol: 'BBB', position: 10, markPrice: 5, percentOfNav: 10 }),
      ],
      securities: [],
    })
    classifications.getAll.mockReturnValue([
      { conid: 1, symbol: 'AAA', sector: 'Financial', industry: 'Banks', fetchedAt: 1 },
      { conid: 2, symbol: 'BBB', sector: 'Financial', industry: 'Insurance', fetchedAt: 1 },
    ])

    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')

    expect(result.report.positions.map((p) => [p.symbol, p.sector, p.industry])).toEqual([
      ['AAA', 'Financial', 'Banks'],
      ['BBB', 'Financial', 'Insurance'],
    ])
    // Both positions share a sector, so they collapse into one slice: 100 + 50, weight 30.
    expect(result.report.bySector).toEqual([
      { key: 'Financial', label: 'Financial', marketValueBase: 150, percentOfNav: 30 },
    ])
    expect(result.report.unclassifiedCount).toBe(0)
  })

  it('collects positions with no cached sector into an Unclassified slice', () => {
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: null,
      positions: [
        position({ conid: 1, symbol: 'AAA', position: 10, markPrice: 10, percentOfNav: 20 }),
        position({ conid: 2, symbol: 'BBB', position: 10, markPrice: 5, percentOfNav: 10 }),
      ],
      securities: [],
    })
    // Only AAA is classified; BBB was looked up but the source had no sector.
    classifications.getAll.mockReturnValue([
      { conid: 1, symbol: 'AAA', sector: 'Technology', industry: 'Software', fetchedAt: 1 },
      { conid: 2, symbol: 'BBB', sector: '', industry: '', fetchedAt: 1 },
    ])

    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')

    expect(result.report.bySector.map((s) => [s.label, s.marketValueBase])).toEqual([
      ['Technology', 100],
      ['Unclassified', 50],
    ])
    expect(result.report.unclassifiedCount).toBe(1)
  })

  it('labels a missing issuer country as Unknown', () => {
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: null,
      positions: [position({ conid: 9, symbol: 'ZZZ' })],
      securities: [],
    })
    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.byCountry[0]!.label).toBe('Unknown')
  })

  it('adds a Cash asset class from the residual of NAV over invested value (Story #47)', () => {
    // Invested value 150 (100 + 50); ending NAV 250 → cash residual of 100 (40% of NAV).
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: 250,
      positions: [
        position({ conid: 1, symbol: 'AAA', assetCategory: 'STK', position: 10, markPrice: 10, percentOfNav: 40, fxRateToBase: 1 }),
        position({ conid: 2, symbol: 'BBB', assetCategory: 'STK', position: 10, markPrice: 5, percentOfNav: 20, fxRateToBase: 1 }),
      ],
      securities: [],
    })

    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')

    const cash = result.report.byAssetClass.find((s) => s.label === 'Cash')
    expect(cash).toMatchObject({ key: '__cash__', label: 'Cash', marketValueBase: 100, percentOfNav: 40 })
    // Invested slices are rebased against the full NAV, so the classes sum to 100%.
    const stocks = result.report.byAssetClass.find((s) => s.label === 'Stocks')
    expect(stocks).toMatchObject({ marketValueBase: 150, percentOfNav: 60 })
    expect(result.report.byAssetClass.reduce((sum, s) => sum + s.percentOfNav, 0)).toBeCloseTo(100)
    // Cash lives only in the asset-class breakdown, not the others or the positions table.
    expect(result.report.byCurrency.some((s) => s.label === 'Cash')).toBe(false)
    expect(result.report.positions).toHaveLength(2)
    // Invested total still counts positions only.
    expect(result.report.totalMarketValueBase).toBeCloseTo(150)
  })

  it('shows no cash slice when the portfolio is fully invested (Story #47)', () => {
    // Ending NAV equals the invested market value — no residual, so no cash.
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: 150,
      positions: [
        position({ conid: 1, symbol: 'AAA', assetCategory: 'STK', position: 10, markPrice: 10, percentOfNav: 70, fxRateToBase: 1 }),
        position({ conid: 2, symbol: 'BBB', assetCategory: 'ETF', position: 10, markPrice: 5, percentOfNav: 30, fxRateToBase: 1 }),
      ],
      securities: [],
    })

    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.byAssetClass.some((s) => s.label === 'Cash')).toBe(false)
  })

  it('treats a sub-0.1% NAV residual as rounding noise, not cash (Story #47)', () => {
    // Invested 100, ending NAV 100.05 → a 0.05% residual: valuation noise, not a real balance.
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: 100.05,
      positions: [position({ conid: 1, symbol: 'AAA', assetCategory: 'STK', position: 10, markPrice: 10, percentOfNav: 100, fxRateToBase: 1 })],
      securities: [],
    })
    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.byAssetClass.some((s) => s.label === 'Cash')).toBe(false)
  })

  it('ignores a negative NAV residual (margin balance), never a negative cash slice (Story #47)', () => {
    // Invested 150 but ending NAV only 140 (leverage) → negative residual, no slice.
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      navEndingValue: 140,
      positions: [position({ conid: 1, symbol: 'AAA', assetCategory: 'STK', position: 10, markPrice: 15, percentOfNav: 100, fxRateToBase: 1 })],
      securities: [],
    })
    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.byAssetClass.some((s) => s.label === 'Cash')).toBe(false)
  })
})
