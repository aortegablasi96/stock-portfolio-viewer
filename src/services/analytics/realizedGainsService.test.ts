import { describe, it, expect, vi, beforeEach } from 'vitest'
import { realizedGainsService } from './realizedGainsService'
import {
  flexReadRepository,
  type FifoSummaryRow,
  type TradeRowRaw,
} from '@repositories/flex/flexReadRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    hasStatements: vi.fn(),
    baseCurrency: vi.fn(),
    getFifoSummaries: vi.fn(),
    getTrades: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

function trade(overrides: Partial<TradeRowRaw>): TradeRowRaw {
  return {
    tradeKey: 'k',
    conid: 1,
    symbol: 'AAA',
    description: '',
    assetCategory: 'STK',
    currency: 'USD',
    fxRateToBase: 1,
    dateTime: 0,
    quantity: 10,
    tradePrice: 5,
    proceeds: 0,
    ibCommission: 0,
    fifoPnlRealized: 0,
    openCloseIndicator: 'O',
    ...overrides,
  }
}

/** End dates of the two statements the multi-statement cases below import. */
const EARLIER = Date.UTC(2025, 11, 31)
const LATER = Date.UTC(2026, 6, 22)

function fifo(overrides: Partial<FifoSummaryRow>): FifoSummaryRow {
  return {
    statementId: 1,
    statementToDate: EARLIER,
    conid: 1,
    symbol: 'AAA',
    description: 'Alpha',
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

describe('realizedGainsService.getRealizedGains', () => {
  it('returns needs_import when nothing has been imported', () => {
    repo.hasStatements.mockReturnValue(false)
    expect(realizedGainsService.getRealizedGains()).toEqual({ status: 'needs_import' })
  })

  it('derives side from signed quantity and converts realized P&L to base currency', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getFifoSummaries.mockReturnValue([])
    repo.getTrades.mockReturnValue([
      trade({ quantity: -65, fifoPnlRealized: -100, fxRateToBase: 0.6, openCloseIndicator: 'C' }),
      trade({ quantity: 20, fifoPnlRealized: 0, fxRateToBase: 0.6, openCloseIndicator: 'O' }),
    ])

    const result = realizedGainsService.getRealizedGains()
    if (result.status !== 'ok') throw new Error('expected ok')
    const [sell, buy] = result.report.trades
    expect(sell!.side).toBe('Sell')
    expect(sell!.quantity).toBe(65)
    expect(sell!.realizedBase).toBeCloseTo(-60) // -100 * 0.6
    expect(buy!.side).toBe('Buy')
  })

  it('classifies trade type: CASH → FX, otherwise the side (Story #33)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getFifoSummaries.mockReturnValue([])
    repo.getTrades.mockReturnValue([
      trade({ assetCategory: 'CASH', quantity: 1000 }), // an FX buy is still 'FX'
      trade({ assetCategory: 'CASH', quantity: -1000 }), // and an FX sell too
      trade({ assetCategory: 'STK', quantity: 10 }),
      trade({ assetCategory: 'STK', quantity: -10 }),
    ])

    const result = realizedGainsService.getRealizedGains()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.trades.map((t) => t.tradeType)).toEqual(['FX', 'FX', 'Buy', 'Sell'])
  })

  it('rolls realized P&L up per symbol with short/long-term split, largest total first', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getTrades.mockReturnValue([])
    repo.getFifoSummaries.mockReturnValue([
      fifo({ conid: 1, symbol: 'AAA', realizedStProfit: 100, realizedStLoss: -30, totalRealizedPnl: 70 }),
      // Second statement, same symbol — the realized rollup adds it in.
      fifo({ statementId: 2, statementToDate: LATER, conid: 1, symbol: 'AAA', realizedLtProfit: 50, totalRealizedPnl: 50 }),
      fifo({ conid: 2, symbol: 'BBB', realizedLtLoss: -200, totalRealizedPnl: -200 }),
      fifo({ statementId: 2, statementToDate: LATER, conid: 3, symbol: 'CCC', totalRealizedPnl: 0, totalUnrealizedPnl: 40 }), // no realized → excluded
    ])

    const result = realizedGainsService.getRealizedGains()
    if (result.status !== 'ok') throw new Error('expected ok')

    expect(result.report.bySymbol.map((r) => r.symbol)).toEqual(['AAA', 'BBB'])
    const aaa = result.report.bySymbol[0]!
    expect(aaa.realizedShortTerm).toBe(70) // 100 - 30
    expect(aaa.realizedLongTerm).toBe(50)
    expect(aaa.totalRealized).toBe(120) // 70 + 50 across statements

    expect(result.report.totalRealized).toBe(-80) // 70 + 50 - 200 + 0
    expect(result.report.totalRealizedShortTerm).toBe(70)
    expect(result.report.totalRealizedLongTerm).toBe(-150) // 50 - 200
    expect(result.report.totalUnrealized).toBe(40)
  })

  it('sums realized across statements but takes unrealized from the latest only (Bug #103)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getTrades.mockReturnValue([])
    repo.getFifoSummaries.mockReturnValue([
      // AAA is still held at the end of both statements, so both report its unrealized gain.
      fifo({ conid: 1, symbol: 'AAA', realizedStProfit: 100, totalRealizedPnl: 100, totalUnrealizedPnl: 800 }),
      fifo({ statementId: 2, statementToDate: LATER, conid: 1, symbol: 'AAA', realizedStLoss: -300, totalRealizedPnl: -300, totalUnrealizedPnl: 950 }),
      fifo({ statementId: 2, statementToDate: LATER, conid: 2, symbol: 'BBB', realizedLtProfit: 40, totalRealizedPnl: 40, totalUnrealizedPnl: 60 }),
    ])

    const result = realizedGainsService.getRealizedGains()
    if (result.status !== 'ok') throw new Error('expected ok')

    // Realized is a per-period flow over non-overlapping statements — unchanged by this fix.
    expect(result.report.totalRealized).toBe(-160) // 100 - 300 + 40
    expect(result.report.totalRealizedShortTerm).toBe(-200) // 100 - 300
    expect(result.report.totalRealizedLongTerm).toBe(40)
    expect(result.report.bySymbol.find((r) => r.symbol === 'AAA')!.totalRealized).toBe(-200)
    // Unrealized is an as-of balance: the latest statement's 950 + 60, not 1810.
    expect(result.report.totalUnrealized).toBe(1010)
  })

  it('excludes the IBKR "Total (All Assets)" aggregate row from totals and per-symbol rows', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getTrades.mockReturnValue([])
    repo.getFifoSummaries.mockReturnValue([
      fifo({ conid: 1, symbol: 'AAA', realizedStProfit: 100, totalRealizedPnl: 100 }),
      fifo({ conid: 2, symbol: 'BBB', realizedLtLoss: -300, totalRealizedPnl: -300 }),
      // The aggregate line: blank symbol/conid, P&L = sum of the instrument rows.
      fifo({ conid: null, symbol: '', description: 'Total (All Assets)', totalRealizedPnl: -200 }),
    ])

    const result = realizedGainsService.getRealizedGains()
    if (result.status !== 'ok') throw new Error('expected ok')

    // Only the two real instruments appear — no phantom "Total" row to pick as best/worst.
    expect(result.report.bySymbol.map((r) => r.symbol)).toEqual(['AAA', 'BBB'])
    // Totals sum the instruments once, not the doubled aggregate.
    expect(result.report.totalRealized).toBe(-200) // 100 - 300, not -400
  })
})
