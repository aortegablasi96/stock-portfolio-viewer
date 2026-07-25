import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performanceService } from './performanceService'
import { parseFlexStatements } from '@repositories/flex/flexStatementParser'
import {
  flexReadRepository,
  type ContributionRow,
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
})

/** Read a numeric field off a value point at an index, narrowing away `undefined`. */
function valAt2(series: ValuePoint[], i: number, key: 'date' | 'value'): number {
  const p = series[i]
  if (p === undefined) throw new Error(`no value point at index ${i}`)
  return p[key]
}
