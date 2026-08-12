import type {
  ContributionRow,
  DailyEquityRow,
  DailyMtmRow,
} from '@repositories/flex/flexReadRepository'
import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import { fromLatestStatement, isInstrumentSummary } from '@repositories/flex/fifoSummary'
import type {
  CompositionBand,
  CompositionSeries,
  NavPeriod,
  PerformanceResult,
  ValuePoint,
} from '@shared/domain/performance'

/**
 * Performance analytics (Milestone M3, Stories #21, #29). Turns the imported Flex
 * `ChangeInNAV` periods, FIFO summaries, and daily `PriorPeriodPosition` MTM series into
 * the day-by-day portfolio-value trend, headline returns, and the
 * realized/unrealized/contributions split the Performance view renders. All figures are in
 * the base currency (see DDR-0005; daily reconstruction in DDR-0008).
 *
 * Reaches data only through `flexReadRepository`, so it is a pure unit-test target
 * with the repository mocked.
 */

/** Chain-link per-period time-weighted returns (percent) into a cumulative TWR (percent). */
function chainLinkTwr(periods: NavPeriod[]): number {
  const growth = periods.reduce((acc, p) => acc * (1 + p.twr / 100), 1)
  return (growth - 1) * 100
}

/** Floor an epoch-ms timestamp to UTC midnight, so intraday flows bucket to their day. */
function utcDay(ms: number): number {
  return Date.UTC(
    new Date(ms).getUTCFullYear(),
    new Date(ms).getUTCMonth(),
    new Date(ms).getUTCDate(),
  )
}

/** Sum base-currency values into a Map keyed by UTC day. */
function sumByDay(entries: Array<{ day: number; value: number }>): Map<number, number> {
  const m = new Map<number, number>()
  for (const { day, value } of entries) m.set(day, (m.get(day) ?? 0) + value)
  return m
}

/**
 * The day-by-day portfolio-value trend, preferring IBKR's own daily NAV (Story #171,
 * DDR-0050 superseding DDR-0008's reconstruction).
 *
 * `EquitySummaryByReportDateInBase` reports NAV per report date directly, so where it exists
 * there is nothing to model: the curve *is* the broker's series. The reconstruction below
 * stays as the fallback for a statement imported without that section, because dropping it
 * would turn an older import into an empty chart.
 *
 * The swap is endpoint-preserving, which is why it does not move the stat tiles: the last
 * daily total equals `ChangeInNAV.endingValue` exactly, and the series opens on the day before
 * the period at `startingValue`. `flexStatementParser.test.ts` pins both identities against the
 * real exports. `returnSeries` is untouched — it is chain-linked from IBKR's per-period TWR
 * and the daily MTM shape, and never read value differences — so the daily-return bars built
 * on top of it (Story #170) are unaffected.
 */
function buildDailyValueSeries(
  periods: NavPeriod[],
  daily: DailyEquityRow[],
  dailyMtm: DailyMtmRow[],
  contributions: ContributionRow[],
): ValuePoint[] {
  if (daily.length > 0) return daily.map((r) => ({ date: r.reportDate, value: r.total }))
  return buildValueSeries(periods, dailyMtm, contributions)
}

/**
 * Build the day-by-day portfolio-value trend (DDR-0008). Per `ChangeInNAV` period, cumulate
 * daily MTM (Σ priorMtmPnl × fxRateToBase) and dated contributions from the period's
 * `startingValue`, then spread the residual to `endingValue` linearly in time so both
 * authoritative endpoints are exact and the interior carries the real shape. A period with
 * no daily MTM data degrades to its two endpoints (identical to the pre-#29 behaviour).
 * Oldest → newest; shared period boundaries are not duplicated.
 */
function buildValueSeries(
  periods: NavPeriod[],
  dailyMtm: DailyMtmRow[],
  contributions: ContributionRow[],
): ValuePoint[] {
  if (periods.length === 0) return []

  const mtmByDay = sumByDay(
    dailyMtm.map((r) => ({ day: utcDay(r.date), value: r.priorMtmPnl * r.fxRateToBase })),
  )
  const contribByDay = sumByDay(
    contributions
      .filter((c) => c.dateTime !== null)
      .map((c) => ({ day: utcDay(c.dateTime as number), value: c.amount * c.fxRateToBase })),
  )
  const flowDays = new Set<number>([...mtmByDay.keys(), ...contribByDay.keys()])

  const series: ValuePoint[] = []
  for (const p of periods) {
    // Explicit interior points: days with Flex data strictly inside the period.
    const interiorDays = [...flowDays].filter((d) => d > p.fromDate && d < p.toDate).sort((a, b) => a - b)

    let running = p.startingValue
    const raw: ValuePoint[] = [{ date: p.fromDate, value: running }]
    for (const d of interiorDays) {
      running += (mtmByDay.get(d) ?? 0) + (contribByDay.get(d) ?? 0)
      raw.push({ date: d, value: running })
    }
    // Fold any flows landing exactly on the end date into the raw end before anchoring.
    running += (mtmByDay.get(p.toDate) ?? 0) + (contribByDay.get(p.toDate) ?? 0)

    // Spread the unexplained residual (dividends, fees, FX translation, intraperiod opens…)
    // linearly in time, so fromDate → startingValue and toDate → endingValue exactly.
    const residual = p.endingValue - running
    const span = p.toDate - p.fromDate
    const anchored = raw.map((pt) => ({
      date: pt.date,
      value: pt.value + residual * (span > 0 ? (pt.date - p.fromDate) / span : 1),
    }))

    for (const pt of anchored) {
      const last = series[series.length - 1]
      if (last && last.date === pt.date) continue
      series.push(pt)
    }
    series.push({ date: p.toDate, value: p.endingValue })
  }
  return series
}

/**
 * Collapse the daily equity rows to one per report date (Story #171).
 *
 * `flex_equity_summaries` is the only *daily* statement-scoped table, so two overlapping
 * statements each carry a row for the same calendar day — a full-year export re-imported
 * beside a year-to-date one duplicates every shared day. The rows arrive ordered by report
 * date then by owning-statement end date ascending, so writing each into a Map by date leaves
 * the row from the statement that ends latest: the most recent restatement of that day.
 *
 * This is the daily analogue of the FIFO summaries' as-of half (Bug #103), where summing what
 * should have been scoped overstated the figure by 25%. Here the failure mode is different and
 * worse: duplicated days do not double a total, they put two points on one date, so the value
 * curve doubles back on itself and the composition chart draws two stacks in the same column.
 */
function latestPerDay(rows: DailyEquityRow[]): DailyEquityRow[] {
  const byDate = new Map<number, DailyEquityRow>()
  for (const row of rows) byDate.set(row.reportDate, row)
  return [...byDate.values()].sort((a, b) => a.reportDate - b.reportDate)
}

/** The bands, in stacking order (bottom first), and how to read each out of a daily row. */
const BAND_SPECS: Array<{ band: CompositionBand; valueOf: (r: DailyEquityRow) => number }> = [
  { band: { key: 'stock', label: 'Stocks' }, valueOf: (r) => r.stock },
  { band: { key: 'options', label: 'Options' }, valueOf: (r) => r.options },
  { band: { key: 'cash', label: 'Cash' }, valueOf: (r) => r.cash },
  {
    // Declared-but-unpaid dividends, accrued interest and accrued broker fees, summed into
    // one band. They are part of NAV and cannot be dropped without breaking the sum, but on
    // this account they run to ~0.13% of it — three separate hairline bands would cost three
    // legend entries to say nothing. Folding them into Cash was the other option and was
    // rejected: an accrued dividend is not cash, and the Dividends view treats it as its own
    // thing (Story #31).
    band: { key: 'accruals', label: 'Accruals' },
    valueOf: (r) => r.dividendAccruals + r.interestAccruals + r.brokerFeesAccruals,
  },
]

/**
 * Build the portfolio-composition series (Story #171, DDR-0050).
 *
 * The **`other` band is a residual, not a category**: `total − Σ components`. The Flex query
 * selects NAV categories per asset class held, so an owner who starts trading bonds gets a
 * `bonds` figure inside IBKR's `total` that this parser does not read — and silently
 * redistributing that gap across the bands it does read would misstate every one of them.
 * Surfacing it as an unnamed slice is the DDR-0015 lesson applied a second time: the cash
 * slice on the Allocation view is the NAV residual for exactly this reason, and deriving it
 * from the parts instead shipped broken once.
 *
 * A band is emitted only when it is non-zero on some day, so the legend never carries a flat
 * zero row. Proportions are not computed here — see `CompositionPoint`.
 */
function buildCompositionSeries(daily: DailyEquityRow[]): CompositionSeries {
  if (daily.length === 0) return { bands: [], points: [] }

  const residualOf = (r: DailyEquityRow): number =>
    r.total - BAND_SPECS.reduce((sum, s) => sum + s.valueOf(r), 0)

  // A float residual is never exactly 0. Judge it against the day's own NAV rather than an
  // absolute epsilon, so the threshold means the same thing on a €400 account and a €400k one.
  const isMaterial = (value: number, total: number): boolean =>
    Math.abs(value) > Math.max(Math.abs(total), 1) * 1e-9

  const specs = [
    ...BAND_SPECS,
    { band: { key: 'other', label: 'Other' } as CompositionBand, valueOf: residualOf },
  ].filter((spec) => daily.some((r) => isMaterial(spec.valueOf(r), r.total)))

  return {
    bands: specs.map((s) => s.band),
    points: daily.map((r) => ({
      date: r.reportDate,
      total: r.total,
      values: specs.map((s) => s.valueOf(r)),
    })),
  }
}

/**
 * Build the cumulative time-weighted-return curve, as a percentage (Story #45). Mirrors
 * `buildValueSeries`' anchoring philosophy: within each `ChangeInNAV` period the interior
 * shape comes from the daily MTM series, but the endpoints are anchored to IBKR's reported
 * per-period TWR and chain-linked across periods — so the boundaries are exact and the final
 * point equals `chainLinkTwr(periods)` (the headline). Contribution-adjusted by construction
 * (TWR excludes deposits/withdrawals), so it degrades to a straight line per period when a
 * period carries no daily MTM data. Oldest → newest; shared boundaries are not duplicated.
 */
function buildReturnSeries(periods: NavPeriod[], dailyMtm: DailyMtmRow[]): ValuePoint[] {
  if (periods.length === 0) return []

  const mtmByDay = sumByDay(
    dailyMtm.map((r) => ({ day: utcDay(r.date), value: r.priorMtmPnl * r.fxRateToBase })),
  )

  const series: ValuePoint[] = []
  let cumGrowth = 1 // chain-linked growth factor at the current period's start (1 = 0%)
  for (const p of periods) {
    // Emit the period's opening return (dedup a boundary shared with the previous period).
    const last = series[series.length - 1]
    if (!last || last.date !== p.fromDate) {
      series.push({ date: p.fromDate, value: (cumGrowth - 1) * 100 })
    }

    const periodGrowth = 1 + p.twr / 100
    const interiorDays = [...mtmByDay.keys()].filter((d) => d > p.fromDate && d < p.toDate).sort((a, b) => a - b)
    // Denominator for the within-period shape: total MTM across the whole period.
    const totalMtm =
      interiorDays.reduce((s, d) => s + (mtmByDay.get(d) ?? 0), 0) + (mtmByDay.get(p.toDate) ?? 0)
    const span = p.toDate - p.fromDate

    let cum = 0
    for (const d of interiorDays) {
      cum += mtmByDay.get(d) ?? 0
      // Fraction of the period's return achieved by day d — from the MTM shape, or (when the
      // period's net MTM is ~0 and the fraction would be unstable) linearly in time.
      const frac = Math.abs(totalMtm) > 1e-9 ? cum / totalMtm : span > 0 ? (d - p.fromDate) / span : 1
      const growth = cumGrowth * (1 + (periodGrowth - 1) * frac)
      series.push({ date: d, value: (growth - 1) * 100 })
    }

    cumGrowth *= periodGrowth
    series.push({ date: p.toDate, value: (cumGrowth - 1) * 100 })
  }
  return series
}

export const performanceService = {
  /** Assemble the performance report, or signal that no Flex data has been imported. */
  getPerformance(): PerformanceResult {
    if (!flexReadRepository.hasStatements()) return { status: 'needs_import' }

    const baseCurrency = flexReadRepository.baseCurrency() ?? 'EUR'
    const periods: NavPeriod[] = flexReadRepository.getNavPeriods()
    const summaries = flexReadRepository.getFifoSummaries().filter(isInstrumentSummary)
    const dailyMtm = flexReadRepository.getDailyMtm()
    const contributions = flexReadRepository.getContributionCashFlows()
    const daily = latestPerDay(flexReadRepository.getDailyEquitySummaries())

    // Realized P&L is a per-period flow — sum every (non-overlapping) statement. Unrealized
    // is an as-of balance, so it comes from the latest statement only (Bug #103).
    const totalRealizedPnl = summaries.reduce((sum, s) => sum + s.totalRealizedPnl, 0)
    const totalUnrealizedPnl = fromLatestStatement(summaries).reduce(
      (sum, s) => sum + s.totalUnrealizedPnl,
      0,
    )
    const totalDepositsWithdrawals = periods.reduce((sum, p) => sum + p.depositsWithdrawals, 0)

    return {
      status: 'ok',
      report: {
        baseCurrency,
        valueSeries: buildDailyValueSeries(periods, daily, dailyMtm, contributions),
        compositionSeries: buildCompositionSeries(daily),
        returnSeries: buildReturnSeries(periods, dailyMtm),
        periods,
        startingValue: periods[0]?.startingValue ?? 0,
        endingValue: periods[periods.length - 1]?.endingValue ?? 0,
        cumulativeTwr: chainLinkTwr(periods),
        totalDepositsWithdrawals,
        totalRealizedPnl,
        totalUnrealizedPnl,
      },
    }
  },
}
