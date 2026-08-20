import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performanceService } from './performanceService'
import { parseFlexStatements } from '@repositories/flex/flexStatementParser'
import {
  flexReadRepository,
  type ContributionRow,
  type DailyEquityRow,
  type FifoSummaryRow,
  type NavPeriodRow,
} from '@repositories/flex/flexReadRepository'
import type { ValuePoint } from '@shared/domain/performance'

vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: {
    hasStatements: vi.fn(),
    baseCurrency: vi.fn(),
    getNavPeriods: vi.fn(),
    getFifoSummaries: vi.fn(),
    getDailyMtm: vi.fn(),
    getContributionCashFlows: vi.fn(),
    getDailyEquitySummaries: vi.fn(),
  },
}))

const repo = vi.mocked(flexReadRepository)

/** A UTC-midnight epoch-ms date, so day bucketing matches the parser's date handling. */
const day = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d)

/** Indexed access that narrows away `undefined` (strict noUncheckedIndexedAccess). */
function valAt(series: ValuePoint[], i: number): number {
  const p = series[i]
  if (p === undefined) throw new Error(`no value point at index ${i}`)
  return p.value
}

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
    statementId: 1,
    statementToDate: Date.UTC(2025, 11, 31),
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
  // Default: no daily MTM / contribution data → periods fall back to their endpoints.
  repo.getDailyMtm.mockReturnValue([])
  repo.getContributionCashFlows.mockReturnValue([])
  // Default: the optional EquitySummaryInBase section was never imported, so the value curve
  // takes the DDR-0008 reconstruction path the cases below were written against (DDR-0050).
  repo.getDailyEquitySummaries.mockReturnValue([])
})

/** A daily equity-summary row, defaulting the categories this account does not hold. */
function equityDay(overrides: Partial<DailyEquityRow>): DailyEquityRow {
  return {
    statementToDate: Date.UTC(2026, 11, 31),
    reportDate: 0,
    cash: 0,
    stock: 0,
    options: 0,
    dividendAccruals: 0,
    interestAccruals: 0,
    brokerFeesAccruals: 0,
    total: 0,
    ...overrides,
  }
}

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

  it('sums deposits/withdrawals and realized/unrealized P&L across periods and instruments', () => {
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

  it('excludes the IBKR "Total (All Assets)" aggregate row so P&L totals are not doubled', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([
      fifo({ symbol: 'AAA', totalRealizedPnl: 300, totalUnrealizedPnl: -50 }),
      fifo({ symbol: 'BBB', totalRealizedPnl: 200, totalUnrealizedPnl: 75 }),
      // The aggregate line (blank symbol) mirrors the instrument sums; must be skipped.
      fifo({ symbol: '', description: 'Total (All Assets)', totalRealizedPnl: 500, totalUnrealizedPnl: 25 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.totalRealizedPnl).toBe(500) // not 1000
    expect(result.report.totalUnrealizedPnl).toBe(25) // not 50
  })

  it('sums realized across statements but takes unrealized from the latest only (Bug #103)', () => {
    const older = Date.UTC(2025, 11, 31)
    const newer = Date.UTC(2026, 6, 22)
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({}), navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([
      // AAA is held through both statements, so it reports its unrealized gain in both.
      fifo({ statementId: 1, statementToDate: older, symbol: 'AAA', totalRealizedPnl: 100, totalUnrealizedPnl: 800 }),
      fifo({ statementId: 2, statementToDate: newer, symbol: 'AAA', totalRealizedPnl: -300, totalUnrealizedPnl: 950 }),
      fifo({ statementId: 2, statementToDate: newer, symbol: 'BBB', totalRealizedPnl: 40, totalUnrealizedPnl: 60 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    // Realized is a per-period flow over non-overlapping statements: 100 - 300 + 40.
    expect(result.report.totalRealizedPnl).toBe(-160)
    // Unrealized is an as-of balance: the latest statement's 950 + 60, not 1810.
    expect(result.report.totalUnrealizedPnl).toBe(1010)
  })

  it('densifies the value series with daily MTM points anchored to the endpoints (#29)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({
        fromDate: day(2026, 1, 1),
        toDate: day(2026, 1, 4),
        startingValue: 100,
        endingValue: 130,
      }),
    ])
    repo.getFifoSummaries.mockReturnValue([])
    repo.getDailyMtm.mockReturnValue([
      { date: day(2026, 1, 2), fxRateToBase: 1, priorMtmPnl: 10 },
      { date: day(2026, 1, 3), fxRateToBase: 1, priorMtmPnl: 10 },
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const s = result.report.valueSeries
    // One point per day: start + two interior + end.
    expect(s.map((p) => p.date)).toEqual([
      day(2026, 1, 1),
      day(2026, 1, 2),
      day(2026, 1, 3),
      day(2026, 1, 4),
    ])
    // Endpoints are the authoritative ChangeInNAV figures, exactly.
    expect(valAt(s, 0)).toBe(100)
    expect(valAt(s, s.length - 1)).toBe(130)
    // Interior carries the MTM shape plus the linear residual (raw 110 + 10·1/3).
    expect(valAt(s, 1)).toBeCloseTo(113.333, 3)
    expect(valAt(s, 2)).toBeCloseTo(126.667, 3)
  })

  it('converts daily MTM to base currency with the per-row FX rate (#29)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: day(2026, 1, 1), toDate: day(2026, 1, 3), startingValue: 0, endingValue: 20 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])
    // Native +40 at rate 0.5 → +20 base on the interior day; residual 0, so exact.
    repo.getDailyMtm.mockReturnValue([{ date: day(2026, 1, 2), fxRateToBase: 0.5, priorMtmPnl: 40 }])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.valueSeries[1]).toEqual({ date: day(2026, 1, 2), value: 20 })
  })

  it('places a contribution step on its transaction date (#29)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: day(2026, 1, 1), toDate: day(2026, 1, 3), startingValue: 100, endingValue: 150 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])
    repo.getContributionCashFlows.mockReturnValue([
      { dateTime: day(2026, 1, 2), fxRateToBase: 1, amount: 50 },
    ] as ContributionRow[])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    // Step lands exactly on the deposit day (residual 0), then flat to the end.
    expect(result.report.valueSeries).toEqual([
      { date: day(2026, 1, 1), value: 100 },
      { date: day(2026, 1, 2), value: 150 },
      { date: day(2026, 1, 3), value: 150 },
    ])
  })

  it('ignores MTM dates outside a period and folds end-date flows into the anchor (#29)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: day(2026, 1, 2), toDate: day(2026, 1, 4), startingValue: 100, endingValue: 200 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])
    repo.getDailyMtm.mockReturnValue([
      { date: day(2026, 1, 1), fxRateToBase: 1, priorMtmPnl: 999 }, // before period → ignored
      { date: day(2026, 1, 3), fxRateToBase: 1, priorMtmPnl: 10 }, // interior → one point
      { date: day(2026, 1, 4), fxRateToBase: 1, priorMtmPnl: 5 }, // on end date → folded, no extra point
      { date: day(2026, 1, 5), fxRateToBase: 1, priorMtmPnl: 999 }, // after period → ignored
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const s = result.report.valueSeries
    expect(s.map((p) => p.date)).toEqual([day(2026, 1, 2), day(2026, 1, 3), day(2026, 1, 4)])
    expect(valAt(s, 0)).toBe(100)
    expect(valAt(s, s.length - 1)).toBe(200)
  })

  it('builds a cumulative TWR curve whose final point equals the headline TWR (#45)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: 1, toDate: 2, startingValue: 100, endingValue: 110, twr: 10 }),
      navPeriod({ fromDate: 2, toDate: 3, startingValue: 110, endingValue: 121, twr: 10 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const s = result.report.returnSeries
    // Start at 0%, chain-link each period's TWR; shared boundary (date 2) is not duplicated.
    expect(s.map((p) => p.date)).toEqual([1, 2, 3])
    expect(valAt(s, 0)).toBeCloseTo(0, 10)
    expect(valAt(s, 1)).toBeCloseTo(10, 10)
    expect(valAt(s, 2)).toBeCloseTo(21, 10)
    // The final point reconciles with the headline exactly.
    expect(valAt(s, s.length - 1)).toBeCloseTo(result.report.cumulativeTwr, 10)
  })

  it('densifies the TWR curve with interior points anchored to the period TWR (#45)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: day(2026, 1, 1), toDate: day(2026, 1, 4), twr: 30 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])
    // MTM shape 10 / 10 / 20 over the three days (the end-date MTM folds into the anchor
    // but still counts toward the shape denominator, total 40).
    repo.getDailyMtm.mockReturnValue([
      { date: day(2026, 1, 2), fxRateToBase: 1, priorMtmPnl: 10 },
      { date: day(2026, 1, 3), fxRateToBase: 1, priorMtmPnl: 10 },
      { date: day(2026, 1, 4), fxRateToBase: 1, priorMtmPnl: 20 },
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const s = result.report.returnSeries
    expect(s.map((p) => p.date)).toEqual([
      day(2026, 1, 1),
      day(2026, 1, 2),
      day(2026, 1, 3),
      day(2026, 1, 4),
    ])
    // Endpoints: 0% at the start, the reported +30% at the end (exact).
    expect(valAt(s, 0)).toBe(0)
    expect(valAt(s, s.length - 1)).toBeCloseTo(30, 10)
    // Interior follows the MTM shape: 10/40 of the way (+7.5%), then 20/40 (+15%).
    expect(valAt(s, 1)).toBeCloseTo(7.5, 10)
    expect(valAt(s, 2)).toBeCloseTo(15, 10)
  })

  it('degrades the TWR curve to a per-period straight line without daily MTM (#45)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: 1, toDate: 2, twr: 5 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const s = result.report.returnSeries
    expect(s.map((p) => p.date)).toEqual([1, 2])
    expect(valAt(s, 0)).toBeCloseTo(0, 10)
    expect(valAt(s, 1)).toBeCloseTo(5, 10)
  })

  it('handles an imported account with no NAV periods (empty series, zero returns)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([])
    repo.getFifoSummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.valueSeries).toEqual([])
    expect(result.report.returnSeries).toEqual([])
    expect(result.report.startingValue).toBe(0)
    expect(result.report.cumulativeTwr).toBe(0)
  })

  it('takes the value series from the daily equity summaries when they exist (#171)', () => {
    repo.hasStatements.mockReturnValue(true)
    // Periods whose reconstruction would give a *different* answer, so the assertion below
    // can only pass if the daily NAV won rather than the DDR-0008 interpolation.
    repo.getNavPeriods.mockReturnValue([
      navPeriod({
        fromDate: day(2026, 1, 1),
        toDate: day(2026, 1, 3),
        startingValue: 100,
        endingValue: 130,
      }),
    ])
    repo.getFifoSummaries.mockReturnValue([])
    repo.getDailyEquitySummaries.mockReturnValue([
      equityDay({ reportDate: day(2026, 1, 1), stock: 90, cash: 10, total: 100 }),
      equityDay({ reportDate: day(2026, 1, 2), stock: 105, cash: 10, total: 115 }),
      equityDay({ reportDate: day(2026, 1, 3), stock: 120, cash: 10, total: 130 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.valueSeries).toEqual([
      { date: day(2026, 1, 1), value: 100 },
      { date: day(2026, 1, 2), value: 115 },
      { date: day(2026, 1, 3), value: 130 },
    ])
  })

  it('keeps one row per report date when statements overlap, preferring the latest (#171)', () => {
    const older = Date.UTC(2026, 5, 30)
    const newer = Date.UTC(2026, 11, 31)
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([])
    // The same calendar day arrives from two overlapping statements. Rows come ordered by
    // report date then statement end date ascending, as the repository guarantees.
    repo.getDailyEquitySummaries.mockReturnValue([
      equityDay({ statementToDate: older, reportDate: day(2026, 1, 2), stock: 10, total: 10 }),
      equityDay({ statementToDate: newer, reportDate: day(2026, 1, 2), stock: 99, total: 99 }),
      equityDay({ statementToDate: newer, reportDate: day(2026, 1, 3), stock: 50, total: 50 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    // One point per day, and the restated value — not two points on one date, and not 10.
    expect(result.report.valueSeries).toEqual([
      { date: day(2026, 1, 2), value: 99 },
      { date: day(2026, 1, 3), value: 50 },
    ])
    expect(result.report.compositionSeries.points).toHaveLength(2)
  })

  it('emits composition bands only for asset classes the account actually holds (#171)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([])
    repo.getDailyEquitySummaries.mockReturnValue([
      equityDay({ reportDate: day(2026, 1, 1), stock: 900, cash: 100, dividendAccruals: 5, total: 1005 }),
      equityDay({ reportDate: day(2026, 1, 2), stock: 950, cash: 50, dividendAccruals: 5, total: 1005 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const { bands, points } = result.report.compositionSeries
    // No options band — the account has never held one, so a flat zero row is not offered.
    // This order is the *palette's*, not the stack's: the chart draws Stocks on top and Accruals
    // on the baseline, and decides that for itself (Story #222, DDR-0073).
    expect(bands.map((b) => b.key)).toEqual(['stock', 'cash', 'accruals'])
    expect(points[0]?.values).toEqual([900, 100, 5])
    expect(points[0]?.total).toBe(1005)
  })

  it('folds the three accrual components into one band (#171)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([])
    repo.getDailyEquitySummaries.mockReturnValue([
      equityDay({
        reportDate: day(2026, 1, 1),
        stock: 1000,
        dividendAccruals: 5,
        interestAccruals: 3,
        brokerFeesAccruals: -2,
        total: 1006,
      }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const { bands, points } = result.report.compositionSeries
    expect(bands.map((b) => b.key)).toEqual(['stock', 'accruals'])
    // 5 + 3 − 2, signed: a negative fee accrual reduces the band rather than being dropped.
    expect(points[0]?.values).toEqual([1000, 6])
  })

  it('surfaces NAV the parsed components do not account for as an "other" band (#171)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([])
    // An owner who starts holding bonds gets a category inside IBKR's `total` that this
    // parser does not read. It must appear as a residual, never be redistributed (DDR-0015).
    repo.getDailyEquitySummaries.mockReturnValue([
      equityDay({ reportDate: day(2026, 1, 1), stock: 800, cash: 100, total: 1000 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const { bands, points } = result.report.compositionSeries
    expect(bands.map((b) => b.key)).toEqual(['stock', 'cash', 'other'])
    expect(points[0]?.values).toEqual([800, 100, 100])
  })

  it('does not invent an "other" band from floating-point residue (#171)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([])
    // Real IBKR figures: the components sum to the total only to within float precision.
    repo.getDailyEquitySummaries.mockReturnValue([
      equityDay({
        reportDate: day(2026, 1, 1),
        cash: 40.185955492,
        stock: 38420.766223,
        dividendAccruals: 50.0301716,
        total: 38510.982350092,
      }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.compositionSeries.bands.map((b) => b.key)).toEqual([
      'stock',
      'cash',
      'accruals',
    ])
  })

  it('keeps a negative cash band signed rather than clamping it (#171)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([navPeriod({})])
    repo.getFifoSummaries.mockReturnValue([])
    // Buying on margin: stock exceeds NAV and cash is negative.
    repo.getDailyEquitySummaries.mockReturnValue([
      equityDay({ reportDate: day(2026, 1, 1), stock: 45_000, cash: -5000, total: 40_000 }),
    ])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const { bands, points } = result.report.compositionSeries
    expect(bands.map((b) => b.key)).toEqual(['stock', 'cash'])
    expect(points[0]?.values).toEqual([45_000, -5000])
    // The signed values still reconcile to NAV, which is what the chart's 100% depends on.
    expect(points[0]?.values.reduce((a, b) => a + b, 0)).toBe(points[0]?.total)
  })

  it('leaves the composition series empty when the optional section was never imported (#171)', () => {
    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue([
      navPeriod({ fromDate: 1, toDate: 2, startingValue: 100, endingValue: 110 }),
    ])
    repo.getFifoSummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    expect(result.report.compositionSeries).toEqual({ bands: [], points: [] })
    // …and the rest of the report is unaffected: the value curve falls back to DDR-0008.
    expect(result.report.valueSeries).toEqual([
      { date: 1, value: 100 },
      { date: 2, value: 110 },
    ])
  })

  // End-to-end reconstruction over the real Portfolio Analyst exports (git-ignored, so
  // skipped in a clean checkout — the synthetic cases above are the portable coverage).
  const FLEX_DIR = join(process.cwd(), 'docs', 'flex-queries')
  const REAL_FILES = ['portfolio-analyst-2025.xml', 'portfolio-analyst-2026.xml']
  const hasRealExports = REAL_FILES.every((f) => existsSync(join(FLEX_DIR, f)))

  it.skipIf(!hasRealExports)('reconstructs a dense, anchored daily curve from the real exports (#29)', () => {
    // Parse the real files and feed what the read repository would return, oldest → newest.
    const statements = REAL_FILES.flatMap((f) =>
      parseFlexStatements(readFileSync(join(FLEX_DIR, f), 'utf8')),
    ).sort((a, b) => a.fromDate - b.fromDate)

    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue(
      statements.flatMap((s) => (s.navChange ? [{ ...s.navChange }] : [])),
    )
    repo.getFifoSummaries.mockReturnValue([])
    repo.getDailyMtm.mockReturnValue(
      statements.flatMap((s) =>
        s.priorPeriodPositions.map((p) => ({
          date: p.date,
          fxRateToBase: p.fxRateToBase,
          priorMtmPnl: p.priorMtmPnl,
        })),
      ),
    )
    repo.getContributionCashFlows.mockReturnValue(
      statements.flatMap((s) =>
        s.cashTransactions
          .filter((c) => c.type === 'Deposits/Withdrawals')
          .map((c) => ({ dateTime: c.dateTime, fxRateToBase: c.fxRateToBase, amount: c.amount })),
      ),
    )
    // Deliberately left empty: this case exercises the DDR-0008 *reconstruction*, which the
    // real exports would otherwise bypass now that they carry a daily NAV. The authoritative
    // path gets its own real-export case below.
    repo.getDailyEquitySummaries.mockReturnValue([])

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')
    const s = result.report.valueSeries

    // Dense: far more than the ~3 statement endpoints.
    expect(s.length).toBeGreaterThan(100)
    // Strictly increasing dates, all finite values.
    for (let i = 1; i < s.length; i++) {
      expect(valAt2(s, i - 1, 'date')).toBeLessThan(valAt2(s, i, 'date'))
      expect(Number.isFinite(valAt(s, i))).toBe(true)
    }
    // Endpoints match the authoritative ChangeInNAV figures exactly.
    expect(valAt(s, 0)).toBeCloseTo(result.report.startingValue, 6)
    expect(valAt(s, s.length - 1)).toBeCloseTo(result.report.endingValue, 6)

    // The TWR curve (#45) is equally dense, starts at 0%, stays finite, and its final
    // point reconciles with the headline cumulative TWR.
    const rs = result.report.returnSeries
    expect(rs.length).toBeGreaterThan(100)
    for (let i = 1; i < rs.length; i++) {
      expect(valAt2(rs, i - 1, 'date')).toBeLessThan(valAt2(rs, i, 'date'))
      expect(Number.isFinite(valAt(rs, i))).toBe(true)
    }
    expect(valAt(rs, 0)).toBeCloseTo(0, 6)
    expect(valAt(rs, rs.length - 1)).toBeCloseTo(result.report.cumulativeTwr, 6)
  })

  it.skipIf(!hasRealExports)('builds the authoritative curve and composition from the real exports (#171)', () => {
    const statements = REAL_FILES.flatMap((f) =>
      parseFlexStatements(readFileSync(join(FLEX_DIR, f), 'utf8')),
    ).sort((a, b) => a.fromDate - b.fromDate)

    repo.hasStatements.mockReturnValue(true)
    repo.getNavPeriods.mockReturnValue(
      statements.flatMap((s) => (s.navChange ? [{ ...s.navChange }] : [])),
    )
    repo.getFifoSummaries.mockReturnValue([])
    // Ordered as the repository guarantees: report date, then owning statement's end date.
    repo.getDailyEquitySummaries.mockReturnValue(
      statements
        .flatMap((s) => s.equitySummaries.map((e) => ({ ...e, statementToDate: s.toDate })))
        .sort((a, b) => a.reportDate - b.reportDate || a.statementToDate - b.statementToDate),
    )

    const result = performanceService.getPerformance()
    if (result.status !== 'ok') throw new Error('expected ok')

    // The two exports overlap, so de-duping is what keeps the curve single-valued per day.
    const s = result.report.valueSeries
    expect(s.length).toBeGreaterThan(250)
    for (let i = 1; i < s.length; i++) {
      expect(valAt2(s, i - 1, 'date')).toBeLessThan(valAt2(s, i, 'date'))
    }
    // Ends exactly on the authoritative ChangeInNAV figure — the identity the swap rests on.
    expect(valAt(s, s.length - 1)).toBeCloseTo(result.report.endingValue, 6)

    const { bands, points } = result.report.compositionSeries
    // This account holds stocks and cash and accrues dividends; it has never held options.
    expect(bands.map((b) => b.key)).toEqual(['stock', 'cash', 'accruals'])
    expect(points).toHaveLength(s.length)

    // The invariant the chart's sum-to-100% guarantee rests on, over every real day.
    for (const p of points) {
      expect(p.values.reduce((a, b) => a + b, 0)).toBeCloseTo(p.total, 6)
    }
    // …and the composition's totals are the value curve, point for point.
    points.forEach((p, i) => {
      expect(p.date).toBe(valAt2(s, i, 'date'))
      expect(p.total).toBeCloseTo(valAt(s, i), 10)
    })
  })
})

/** Read a numeric field off a value point at an index, narrowing away `undefined`. */
function valAt2(series: ValuePoint[], i: number, key: 'date' | 'value'): number {
  const p = series[i]
  if (p === undefined) throw new Error(`no value point at index ${i}`)
  return p[key]
}
