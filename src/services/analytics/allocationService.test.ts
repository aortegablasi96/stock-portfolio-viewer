import { describe, it, expect, vi, beforeEach } from 'vitest'
import { allocationService } from './allocationService'
import {
  flexReadRepository,
  type LatestPositions,
  type OpenPositionRow,
} from '@repositories/flex/flexReadRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    getLatestOpenPositions: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

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

beforeEach(() => vi.clearAllMocks())

describe('allocationService.getAllocation', () => {
  it('returns needs_import when nothing has been imported', () => {
    repo.getLatestOpenPositions.mockReturnValue(undefined)
    expect(allocationService.getAllocation()).toEqual({ status: 'needs_import' })
  })

  it('converts market value, cost basis and unrealized P&L to base currency via fxRateToBase', () => {
    const latest: LatestPositions = {
      reportDate: 100,
      baseCurrency: 'EUR',
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

    // STK: 100 + 50 = 150; ETF: 30 → STK first
    expect(result.report.byAssetClass.map((s) => [s.label, s.marketValueBase])).toEqual([
      ['Stocks', 150],
      ['ETFs', 30],
    ])
    // Currency USD: 100 + 30 = 130 (weight 20+30=50); EUR: 50
    expect(result.report.byCurrency[0]!).toMatchObject({ key: 'USD', marketValueBase: 130, percentOfNav: 50 })
    // Country US: 130; DE: 50
    expect(result.report.byCountry.map((s) => s.key)).toEqual(['US', 'DE'])
  })

  it('labels a missing issuer country as Unknown', () => {
    repo.getLatestOpenPositions.mockReturnValue({
      reportDate: 100,
      baseCurrency: 'EUR',
      positions: [position({ conid: 9, symbol: 'ZZZ' })],
      securities: [],
    })
    const result = allocationService.getAllocation()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.byCountry[0]!.label).toBe('Unknown')
  })
})
