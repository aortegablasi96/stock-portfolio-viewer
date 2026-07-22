import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dividendService } from './dividendService'
import {
  flexReadRepository,
  type CashTransactionRow,
} from '@repositories/flex/flexReadRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    hasStatements: vi.fn(),
    baseCurrency: vi.fn(),
    getDividendCashTransactions: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

// 2026-01-15 and 2026-02-10 (UTC) as epoch ms.
const JAN = Date.UTC(2026, 0, 15)
const FEB = Date.UTC(2026, 1, 10)

function cash(overrides: Partial<CashTransactionRow>): CashTransactionRow {
  return {
    symbol: 'AAA',
    description: '',
    type: 'Dividends',
    currency: 'USD',
    fxRateToBase: 1,
    dateTime: JAN,
    exDate: null,
    amount: 100,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.baseCurrency.mockReturnValue('EUR')
})

describe('dividendService.getDividends', () => {
  it('returns needs_import when nothing has been imported', () => {
    repo.hasStatements.mockReturnValue(false)
    expect(dividendService.getDividends()).toEqual({ status: 'needs_import' })
  })

  it('converts to base currency and nets withholding against gross per symbol', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ symbol: 'AAA', type: 'Dividends', amount: 100, fxRateToBase: 0.5 }),
      cash({ symbol: 'AAA', type: 'Withholding Tax', amount: -15, fxRateToBase: 0.5 }),
    ])

    const result = dividendService.getDividends()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.totalGrossBase).toBeCloseTo(50) // 100*0.5
    expect(result.report.totalWithholdingBase).toBeCloseTo(7.5) // magnitude of 15*0.5
    expect(result.report.totalNetBase).toBeCloseTo(42.5)
    expect(result.report.bySymbol[0]).toMatchObject({ key: 'AAA', grossBase: 50, withholdingBase: 7.5, netBase: 42.5 })
  })

  it('counts payment-in-lieu as gross income', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ type: 'Payment In Lieu Of Dividends', amount: 40, fxRateToBase: 1 }),
    ])
    const result = dividendService.getDividends()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.totalGrossBase).toBeCloseTo(40)
    expect(result.report.totalNetBase).toBeCloseTo(40)
  })

  it('groups by calendar month (UTC) using ex-date when present, oldest first', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ symbol: 'AAA', amount: 10, fxRateToBase: 1, exDate: FEB, dateTime: JAN }),
      cash({ symbol: 'BBB', amount: 20, fxRateToBase: 1, exDate: JAN, dateTime: FEB }),
    ])
    const result = dividendService.getDividends()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.byMonth.map((m) => m.key)).toEqual(['2026-01', '2026-02'])
    expect(result.report.byMonth[0]!).toMatchObject({ key: '2026-01', grossBase: 20 })
  })

  it('sorts events newest first and includes native + base amounts', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ symbol: 'OLD', exDate: JAN, amount: 10, fxRateToBase: 2 }),
      cash({ symbol: 'NEW', exDate: FEB, amount: 5, fxRateToBase: 2 }),
    ])
    const result = dividendService.getDividends()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.events[0]!.symbol).toBe('NEW')
    expect(result.report.events[0]!.amountBase).toBeCloseTo(10) // 5*2
    expect(result.report.events[1]!.amountNative).toBe(10)
  })

  it('returns an empty (non-needs_import) report when statements exist but no dividends', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getDividendCashTransactions.mockReturnValue([])
    const result = dividendService.getDividends()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.totalNetBase).toBe(0)
    expect(result.report.events).toEqual([])
  })
})
