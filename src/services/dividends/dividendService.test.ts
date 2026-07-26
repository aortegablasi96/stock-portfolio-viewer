import { describe, it, expect, vi, beforeEach } from 'vitest'
import { dividendService } from './dividendService'
import type { UpcomingDividends } from '@shared/domain/dividends'
import {
  flexReadRepository,
  type CashTransactionRow,
  type DividendAccrualRow,
  type TradeRowRaw,
} from '@repositories/flex/flexReadRepository'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    hasStatements: vi.fn(),
    baseCurrency: vi.fn(),
    getDividendCashTransactions: vi.fn(),
    getInstrumentNames: vi.fn(),
    getLatestOpenDividendAccruals: vi.fn(),
    getTrades: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

// 2026-01-15 and 2026-02-10 (UTC) as epoch ms.
const JAN = Date.UTC(2026, 0, 15)
const FEB = Date.UTC(2026, 1, 10)
const MAR = Date.UTC(2026, 2, 20)
/** Before all of the above — a purchase predating the dividends under test. */
const DEC = Date.UTC(2025, 11, 5)
/** "Now" for the upcoming-dividends cut-off: mid-day so the UTC-midnight rounding shows. */
const NOW = Date.UTC(2026, 1, 10, 13, 30)

function cash(overrides: Partial<CashTransactionRow>): CashTransactionRow {
  return {
    conid: null,
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

function trade(overrides: Partial<TradeRowRaw>): TradeRowRaw {
  return {
    tradeKey: 'k',
    conid: 11,
    symbol: 'AAA',
    description: '',
    assetCategory: 'STK',
    currency: 'USD',
    fxRateToBase: 1,
    dateTime: JAN,
    quantity: 100,
    tradePrice: 10,
    proceeds: -1000,
    ibCommission: -1,
    fifoPnlRealized: 0,
    openCloseIndicator: 'O',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  repo.baseCurrency.mockReturnValue('EUR')
  repo.getInstrumentNames.mockReturnValue([])
  repo.getLatestOpenDividendAccruals.mockReturnValue(undefined)
  repo.getTrades.mockReturnValue([])
})

describe('dividendService.getDividends', () => {
  it('returns needs_import when nothing has been imported', () => {
    repo.hasStatements.mockReturnValue(false)
    expect(dividendService.getDividends()).toEqual({ status: 'needs_import' })
  })

  it('converts to base currency and nets withholding against gross per symbol', () => {
    repo.hasStatements.mockReturnValue(true)
    // The cash description is the verbose transaction string; the clean instrument name
    // comes from SecurityInfo, resolved by conid.
    repo.getInstrumentNames.mockReturnValue([{ conid: 11, symbol: 'AAA', description: 'Alpha Corp' }])
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ conid: 11, symbol: 'AAA', description: 'AAA(...) CASH DIVIDEND', type: 'Dividends', amount: 100, fxRateToBase: 0.5 }),
      cash({ conid: 11, symbol: 'AAA', description: 'AAA(...) - TAX', type: 'Withholding Tax', amount: -15, fxRateToBase: 0.5 }),
    ])

    const result = dividendService.getDividends()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.totalGrossBase).toBeCloseTo(50) // 100*0.5
    expect(result.report.totalWithholdingBase).toBeCloseTo(7.5) // magnitude of 15*0.5
    expect(result.report.totalNetBase).toBeCloseTo(42.5)
    expect(result.report.bySymbol[0]).toMatchObject({
      key: 'AAA',
      description: 'Alpha Corp', // clean SecurityInfo name, shown beneath the ticker in "By Ticker"
      grossBase: 50,
      withholdingBase: 7.5,
      netBase: 42.5,
    })
    // The detail-table event carries the clean name too, not the verbose cash description.
    expect(result.report.events[0]?.description).toBe('Alpha Corp')
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

describe('dividendService.getDividends — shares held & per share (Story #74)', () => {
  beforeEach(() => {
    repo.hasStatements.mockReturnValue(true)
  })

  /** Run the service and return the single event it produced. */
  function onlyEvent(): {
    sharesHeld: number | null
    perShareNative: number | null
  } {
    const result = dividendService.getDividends(NOW)
    if (result.status !== 'ok') throw new Error('expected ok')
    const event = result.report.events[0]
    if (!event) throw new Error('expected one event')
    return { sharesHeld: event.sharesHeld, perShareNative: event.perShareNative }
  }

  it('sums trades dated before the ex-date and divides the per-share out of the amount', () => {
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ conid: 11, symbol: 'AAA', exDate: FEB, amount: 25 }),
    ])
    repo.getTrades.mockReturnValue([
      trade({ conid: 11, symbol: 'AAA', dateTime: DEC, quantity: 100 }),
      // Bought on the ex-date itself — too late to be entitled, so it must not count.
      trade({ conid: 11, symbol: 'AAA', dateTime: FEB, quantity: 50 }),
    ])

    expect(onlyEvent()).toEqual({ sharesHeld: 100, perShareNative: 0.25 })
  })

  it('matches trades by conid even when the cash row carries a different ticker', () => {
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ conid: 11, symbol: 'RENAMED', exDate: FEB, amount: 50 }),
    ])
    repo.getTrades.mockReturnValue([trade({ conid: 11, symbol: 'AAA', dateTime: DEC, quantity: 200 })])

    expect(onlyEvent()).toEqual({ sharesHeld: 200, perShareNative: 0.25 })
  })

  it('falls back to the ticker when Flex reports no conid', () => {
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ conid: null, symbol: 'AAA', exDate: FEB, amount: 10 }),
    ])
    repo.getTrades.mockReturnValue([trade({ conid: null, symbol: 'AAA', dateTime: DEC, quantity: 40 })])

    expect(onlyEvent()).toEqual({ sharesHeld: 40, perShareNative: 0.25 })
  })

  it('reports the same share count and a tax-per-share on withholding rows', () => {
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ conid: 11, exDate: FEB, type: 'Withholding Tax', amount: -7.5 }),
    ])
    repo.getTrades.mockReturnValue([trade({ conid: 11, dateTime: DEC, quantity: 100 })])

    expect(onlyEvent()).toEqual({ sharesHeld: 100, perShareNative: -0.075 })
  })

  it('degrades to null when the instrument has no imported trades', () => {
    repo.getDividendCashTransactions.mockReturnValue([cash({ conid: 99, exDate: FEB, amount: 25 })])
    repo.getTrades.mockReturnValue([trade({ conid: 11, dateTime: DEC, quantity: 100 })])

    expect(onlyEvent()).toEqual({ sharesHeld: null, perShareNative: null })
  })

  it('degrades to null when the running quantity is not positive by the ex-date', () => {
    // Sold out before the ex-date, yet a dividend was paid — the imported history must
    // start after the position was opened, so any number here would be wrong.
    repo.getDividendCashTransactions.mockReturnValue([cash({ conid: 11, exDate: FEB, amount: 25 })])
    repo.getTrades.mockReturnValue([
      trade({ conid: 11, dateTime: DEC, quantity: 100 }),
      trade({ conid: 11, dateTime: JAN, quantity: -100 }),
    ])

    expect(onlyEvent()).toEqual({ sharesHeld: null, perShareNative: null })
  })

  it('degrades to null when a trade for the instrument cannot be placed in time', () => {
    repo.getDividendCashTransactions.mockReturnValue([cash({ conid: 11, exDate: FEB, amount: 25 })])
    repo.getTrades.mockReturnValue([
      trade({ conid: 11, dateTime: DEC, quantity: 100 }),
      trade({ conid: 11, dateTime: null, quantity: 20 }),
    ])

    expect(onlyEvent()).toEqual({ sharesHeld: null, perShareNative: null })
  })

  it('degrades to null when the cash row has no date to cut the history at', () => {
    repo.getDividendCashTransactions.mockReturnValue([
      cash({ conid: 11, exDate: null, dateTime: null, amount: 25 }),
    ])
    repo.getTrades.mockReturnValue([trade({ conid: 11, dateTime: DEC, quantity: 100 })])

    expect(onlyEvent()).toEqual({ sharesHeld: null, perShareNative: null })
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
