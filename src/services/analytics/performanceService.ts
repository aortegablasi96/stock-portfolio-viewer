import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import type { NavPeriod, PerformanceResult, ValuePoint } from '@shared/domain/performance'

/**
 * Performance analytics (Milestone M3, Story #21). Turns the imported Flex
 * `ChangeInNAV` periods and FIFO summaries into the portfolio-value trend, headline
 * returns, and the realized/unrealized/contributions split the Performance view
 * renders. All figures are already in the base currency (see DDR-0005).
 *
 * Reaches data only through `flexReadRepository`, so it is a pure unit-test target
 * with the repository mocked.
 */

/** Chain-link per-period time-weighted returns (percent) into a cumulative TWR (percent). */
function chainLinkTwr(periods: NavPeriod[]): number {
  const growth = periods.reduce((acc, p) => acc * (1 + p.twr / 100), 1)
  return (growth - 1) * 100
}

/**
 * Build the value trend from period endpoints: the first period's starting value,
 * then each period's ending value. Oldest → newest.
 */
function buildValueSeries(periods: NavPeriod[]): ValuePoint[] {
  const [first] = periods
  if (!first) return []
  const series: ValuePoint[] = [{ date: first.fromDate, value: first.startingValue }]
  for (const p of periods) {
    series.push({ date: p.toDate, value: p.endingValue })
  }
  return series
}

export const performanceService = {
  /** Assemble the performance report, or signal that no Flex data has been imported. */
  getPerformance(): PerformanceResult {
    if (!flexReadRepository.hasStatements()) return { status: 'needs_import' }

    const baseCurrency = flexReadRepository.baseCurrency() ?? 'EUR'
    const periods: NavPeriod[] = flexReadRepository.getNavPeriods()
    const summaries = flexReadRepository.getFifoSummaries()

    const totalRealizedPnl = summaries.reduce((sum, s) => sum + s.totalRealizedPnl, 0)
    const totalUnrealizedPnl = summaries.reduce((sum, s) => sum + s.totalUnrealizedPnl, 0)
    const totalDepositsWithdrawals = periods.reduce((sum, p) => sum + p.depositsWithdrawals, 0)

    return {
      status: 'ok',
      report: {
        baseCurrency,
        valueSeries: buildValueSeries(periods),
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
