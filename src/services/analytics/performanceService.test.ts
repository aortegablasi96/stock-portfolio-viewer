import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performanceService } from './performanceService'
import { flexReadRepository, type NavPeriodRow, type FifoSummaryRow } from '@repositories/flex/flexReadRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    hasStatements: vi.fn(),
    baseCurrency: vi.fn(),
    getNavPeriods: vi.fn(),
    getFifoSummaries: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

function navPeriod(overrides: Partial<NavPeriodRow>): NavPeriodRow {
  return {
    fromDate: 0,
    toDate: 0,
    startingValue: 0,
    endingValue: 0,
    mtm: 0,
    depositsWithdrawals: 0,
    dividends: 0,
    withholdingTax: 0,
    interest: 0,
    commissions: 0,
    twr: 0,
    ...overrides,
  }
}

function fifo(overrides: Partial<FifoSummaryRow>): FifoSummaryRow {
  return {
    conid: null,
    symbol: 'X',
    description: '',
    assetCategory: 'STK',
    realizedStProfit: 0,
    realizedStLoss: 0,
    realizedLtProfit: 0,
    realizedLtLoss: 0,
    totalRealizedPnl: 0,
    totalUnrealizedPnl: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.baseCurrency.mockReturnValue('EUR')
})

describe('performanceService.getPerformance', () => {
  it('returns needs_import when nothing has been imported', () => {
    repo.hasStatements.mockReturnValue(false)
    expect(performanceService.getPerformance()).toEqual({ status: 'needs_import' })
  })

  it('chain-links per-period TWR into a cumulative return', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: 1, toDate: 2, startingValue: 100, endingValue: 110, twr: 10 }),
      navPeriod({ fromDate: 2, toDate: 3, startingValue: 110, endingValue: 121, twr: 10 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // (1.10 * 1.10 - 1) * 100 = 21
    expect(result.report.cumulativeTwr).toBeCloseTo(21, 10)
    expect(result.report.startingValue).toBe(100)
    expect(result.report.endingValue).toBe(121)
  })

  it('builds the value series from the first start then each period end', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: 1, toDate: 2, startingValue: 100, endingValue: 110 }),
      navPeriod({ fromDate: 2, toDate: 3, startingValue: 110, endingValue: 121 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.valueSeries).toEqual([
      { date: 1, value: 100 },
      { date: 2, value: 110 },
      { date: 3, value: 121 },
    ])
  })

  it('sums deposits/withdrawals and realized/unrealized P&L across periods and summaries', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ depositsWithdrawals: 1000 }),
      navPeriod({ depositsWithdrawals: -250 }),
    ])
    repo.getFifoSummaries.mockReturnValue([
      fifo({ totalRealizedPnl: 300, totalUnrealizedPnl: -50 }),
      fifo({ totalRealizedPnl: 200, totalUnrealizedPnl: 75 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.totalDepositsWithdrawals).toBe(750)
    expect(result.report.totalRealizedPnl).toBe(500)
    expect(result.report.totalUnrealizedPnl).toBe(25)
  })

  it('handles an imported account with no NAV periods (empty series, zero returns)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([])
    repo.getFifoSummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.valueSeries).toEqual([])
    expect(result.report.startingValue).toBe(0)
    expect(result.report.cumulativeTwr).toBe(0)
  })
})
