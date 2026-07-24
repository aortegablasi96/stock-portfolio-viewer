import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dividendService } from './dividendService'
import type { UpcomingDividends } from '@shared/domain/dividends'
import {
  flexReadRepository,
  type CashTransactionRow,
  type DividendAccrualRow,
} from '@repositories/flex/flexReadRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    hasStatements: vi.fn(),
    baseCurrency: vi.fn(),
    getDividendCashTransactions: vi.fn(),
    getLatestOpenDividendAccruals: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

// 2026-01-15 and 2026-02-10 (UTC) as epoch ms.
const JAN = Date.UTC(2026, 0, 15)
const FEB = Date.UTC(2026, 1, 10)
const MAR = Date.UTC(2026, 2, 20)
/** "Now" for the upcoming-dividends cut-off: mid-day so the UTC-midnight rounding shows. */
const NOW = Date.UTC(2026, 1, 10, 13, 30)

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

function accrual(overrides: Partial<DividendAccrualRow>): DividendAccrualRow {
  return {
    symbol: 'AAA',
    description: '',
    currency: 'USD',
    fxRateToBase: 1,
    exDate: FEB,
    payDate: MAR,
    quantity: 100,
    grossRate: 0.5,
    grossAmount: 50,
    netAmount: 42.5,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.baseCurrency.mockReturnValue('EUR')
  repo.getLatestOpenDividendAccruals.mockReturnValue(undefined)
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

describe('dividendService.getDividends — upcoming dividends (Story #31)', () => {
  beforeEach(() => {
    repo.hasStatements.mockReturnValue(true)
    repo.getDividendCashTransactions.mockReturnValue([])
  })

  /** Run the service at a fixed "now" and return the upcoming block. */
  function upcoming(now: number = NOW): UpcomingDividends {
    const result = dividendService.getDividends(now)
    if (result.status !== 'ok') throw new Error('expected ok')
    return result.report.upcoming
  }

  it('converts accruals to base currency and derives withholding from gross minus net', () => {
    repo.getLatestOpenDividendAccruals.mockReturnValue({
      asOf: FEB,
      accruals: [accrual({ fxRateToBase: 0.8, grossAmount: 50, netAmount: 42.5 })],
    })

    const u = upcoming()
    expect(u.asOf).toBe(FEB)
    expect(u.sectionPresent).toBe(true)
    expect(u.items).toHaveLength(1)
    expect(u.items[0]?.grossBase).toBeCloseTo(40) // 50 * 0.8
    expect(u.items[0]?.netBase).toBeCloseTo(34) // 42.5 * 0.8
    expect(u.items[0]?.withholdingBase).toBeCloseTo(6)
    expect(u.totalGrossBase).toBeCloseTo(40)
    expect(u.totalWithholdingBase).toBeCloseTo(6)
    expect(u.totalNetBase).toBeCloseTo(34)
  })

  it('drops accruals whose pay date has already passed but keeps today’s', () => {
    repo.getLatestOpenDividendAccruals.mockReturnValue({
      asOf: FEB,
      accruals: [
        accrual({ symbol: 'PAID', payDate: JAN }),
        accrual({ symbol: 'TODAY', payDate: Date.UTC(2026, 1, 10) }),
        accrual({ symbol: 'LATER', payDate: MAR }),
      ],
    })

    expect(upcoming().items.map((i) => i.symbol)).toEqual(['TODAY', 'LATER'])
  })

  it('keeps accruals with no pay date and sorts them last', () => {
    repo.getLatestOpenDividendAccruals.mockReturnValue({
      asOf: FEB,
      accruals: [
        accrual({ symbol: 'UNDATED', payDate: null }),
        accrual({ symbol: 'SOON', payDate: MAR }),
      ],
    })

    expect(upcoming().items.map((i) => i.symbol)).toEqual(['SOON', 'UNDATED'])
  })

  it('reports the accruals section as absent when the latest statement carried none', () => {
    repo.getLatestOpenDividendAccruals.mockReturnValue({ asOf: FEB, accruals: [] })

    const u = upcoming()
    expect(u.sectionPresent).toBe(false)
    expect(u.asOf).toBe(FEB)
    expect(u.items).toEqual([])
  })

  it('distinguishes "section present but everything already paid" from "no section"', () => {
    repo.getLatestOpenDividendAccruals.mockReturnValue({
      asOf: FEB,
      accruals: [accrual({ payDate: JAN })],
    })

    const u = upcoming()
    // The section *was* in the import — the view must not tell the owner to enable it.
    expect(u.sectionPresent).toBe(true)
    expect(u.items).toEqual([])
    expect(u.totalNetBase).toBe(0)
  })
})
