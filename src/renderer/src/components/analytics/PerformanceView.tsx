import { useState } from 'react'
import type { NavPeriod, PerformanceReport, PerformanceResult } from '@shared/domain/performance'
import {
  formatCurrency,
  formatDate,
  formatSignedCurrency,
  formatSignedPercent,
} from '../../lib/format'
import { boundsFor } from '../../lib/dateRange'
import { dailyReturns } from '../../lib/dailyReturns'
import { rebaseSeries, seriesExtent, sliceSeries, windowStats } from '../../lib/performanceRange'
import { BarChart } from '../charts/BarChart'
import { LineChart } from '../charts/LineChart'
import { useAnalytics } from './useAnalytics'
import { AnalyticsShell } from './AnalyticsShell'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { DataTable, type DataColumn } from '../ui/DataTable'
import { RangeFilter } from './RangeFilter'
import { StatRow, StatTile } from '../ui/StatTile'
import { ToggleGroup } from '../ui/ToggleGroup'
import { toneClassName, toneOf } from '../../lib/statTileVariants'
import { useRangeSelection } from './useRangeSelection'

/**
 * The switchable Performance charts (Story #45; the daily bar chart joined them in Story #170).
 * Story #172 retires this switcher for a 2×2 grid, so the labels are written to work as card
 * titles rather than only as chips.
 */
const CHART_TABS = [
  { id: 'value', label: 'Portfolio value over time' },
  { id: 'return', label: 'Performance change over time' },
  { id: 'daily', label: 'Daily return' },
] as const
type ChartTab = (typeof CHART_TABS)[number]['id']

/**
 * Performance over time (Milestone M3, Stories #21, #29, #45, #69). Shows the portfolio-value
 * trend, the cumulative time-weighted return, and headline stats — all in the account base
 * currency, read from imported Flex data.
 *
 * A time-range filter (Story #69) reframes both charts and recomputes the top stats to a
 * chosen window: trailing 1M / 3M / 1Y, the full history, or a custom date range. Windowing is
 * pure presentation over the already-loaded daily series (`lib/performanceRange`), so switching
 * ranges is instant and never refetches. The per-period returns table stays whole-history
 * (table filters are out of scope for this story).
 *
 * The return curve is *rebased* to the window rather than merely sliced (Story #169): it opens
 * at 0% and closes on the Time-weighted return tile, because a 1M heading over an
 * inception-to-date baseline left the reader doing the subtraction the tile had already done.
 *
 * A third chart (Story #170) breaks that cumulative curve back into its individual days, because
 * neither line answers "what does a normal day look like?" — a curve that rises 40% over a year
 * looks the same whether it climbed in steady steps or in a dozen violent swings.
 *
 * The view stays mounted once visited (Story #109), so the range selection and chart tab below
 * survive a trip to another tab; the `RefreshBar` gives the re-read that leaving and returning
 * used to perform by accident.
 */
export function PerformanceView(): React.JSX.Element {
  const analytics = useAnalytics<PerformanceResult>(window.api.getPerformance)
  const [chartTab, setChartTab] = useState<ChartTab>('value')
  const { range, setRange, custom, editCustom } = useRangeSelection()

  // The range selection and chart tab stay above the shell: they are the view's own state, and
  // the shell holds none, so they survive a tab switch exactly as they did (DDR-0027).
  return (
    <AnalyticsShell<PerformanceReport> subject="performance" analytics={analytics}>
      {(r) => {
        const c = (v: number): string => formatCurrency(v, r.baseCurrency)

        const extent = seriesExtent(r.valueSeries)
        const customBounds = custom ?? extent ?? { from: 0, to: 0 }
        const bounds = extent ? boundsFor(range, extent, customBounds) : null

        const valueSeries = bounds ? sliceSeries(r.valueSeries, bounds) : r.valueSeries
        // The value chart is sliced; the return chart is sliced *and rebased* to open at 0%, so
        // it ends exactly on the Time-weighted return tile beside it (Story #169). The value
        // series is deliberately left alone — rebasing a value curve is a different decision.
        const returnSeries = bounds ? rebaseSeries(r.returnSeries, bounds) : r.returnSeries
        const stats = bounds
          ? windowStats(r.valueSeries, r.returnSeries, bounds)
          : { endValue: r.endingValue, changeAbs: 0, changePct: null, twr: r.cumulativeTwr }

        const periodLabel = range === 'all' ? 'Full history' : 'Selected period'
        // Rebasing is invisible on an axis, so the title and the chart's accessible name both
        // say which baseline the curve is drawn from. Full history is the identity case: it
        // already opens at 0%, and its wording is unchanged.
        const returnChartTitle =
          range === 'all'
            ? 'Performance change over time'
            : 'Performance change over the selected period'
        const returnChartLabel =
          range === 'all'
            ? 'Cumulative time-weighted return over time, from 0% at the start of the history'
            : 'Time-weighted return over the selected period, from 0% at the start of the period'

        // Daily returns come off the *unwindowed* curve so the window's opening bar is measured
        // against the trading day that really preceded it, not against the synthetic point
        // `sliceSeries` anchors at the edge (Story #170). Rebasing is irrelevant here — the base
        // cancels out of consecutive ratios, so these bars agree with the rebased curve either way.
        const dailyPoints = dailyReturns(r.returnSeries, bounds ?? undefined)
        // Named from the bars actually drawn, not from the selected bounds: the window's first
        // *point* carries no bar when it opens the history, so a label reading off `bounds` would
        // promise a day the chart does not show — and disagree with its own axis labels.
        const dailyChartLabel =
          dailyPoints.length === 0
            ? 'Daily return for each trading day'
            : `Daily return for each of ${dailyPoints.length} trading days, ${formatDate(dailyPoints[0]!.date)} to ${formatDate(dailyPoints[dailyPoints.length - 1]!.date)}`

        const chartTitle =
          chartTab === 'value'
            ? 'Portfolio value over time'
            : chartTab === 'return'
              ? returnChartTitle
              : 'Daily return'

        return (
          <>
            <RangeFilter
              label="Performance time range"
              range={range}
              onSelect={setRange}
              extent={extent}
              custom={customBounds}
              onEditCustom={(edge, value) => editCustom(edge, value, customBounds)}
            />

            <StatRow>
              <StatTile label="Portfolio value" value={c(stats.endValue)} hint="At period end" />
              <StatTile
                label="Value change"
                value={formatSignedCurrency(stats.changeAbs, r.baseCurrency)}
                hint={periodLabel}
                tone={toneOf(stats.changeAbs)}
              />
              <StatTile
                label="Value change %"
                value={stats.changePct === null ? '—' : formatSignedPercent(stats.changePct)}
                hint={periodLabel}
                tone={stats.changePct === null ? 'neutral' : toneOf(stats.changePct)}
              />
              <StatTile
                label="Time-weighted return"
                value={formatSignedPercent(stats.twr)}
                hint={range === 'all' ? 'Chain-linked across periods' : 'Over selected period'}
                tone={toneOf(stats.twr)}
              />
            </StatRow>

            <Card>
              <CardHeader>
                <CardTitle id="perf-chart-title">{chartTitle}</CardTitle>
                <ToggleGroup
                  label="Performance chart"
                  options={CHART_TABS}
                  value={chartTab}
                  onSelect={setChartTab}
                />
              </CardHeader>
              <CardContent>
                {chartTab === 'value' && (
                  <LineChart
                    key="value"
                    points={valueSeries}
                    formatValue={c}
                    formatDate={formatDate}
                    ariaLabel="Portfolio value over time"
                  />
                )}
                {chartTab === 'return' && (
                  <LineChart
                    key="return"
                    points={returnSeries}
                    formatValue={formatSignedPercent}
                    formatDate={formatDate}
                    ariaLabel={returnChartLabel}
                  />
                )}
                {chartTab === 'daily' && (
                  <>
                    <p className="source-note">
                      Each bar is one trading day’s time-weighted return, chain-linked from the
                      cumulative return curve rather than differenced from portfolio value — so a
                      deposit or withdrawal never shows up as a gain. Inside a statement period the
                      day-to-day shape is apportioned by each day’s share of the period’s
                      mark-to-market result; the period’s own endpoints are the returns IBKR
                      reports, so the boundaries are exact and the days between them are modelled.
                    </p>
                    <BarChart
                      key="daily"
                      points={dailyPoints}
                      formatValue={formatSignedPercent}
                      formatDate={formatDate}
                      ariaLabel={dailyChartLabel}
                      emptyMessage="Not enough data points to plot daily returns yet."
                    />
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardTitle>Returns by period</CardTitle>
              <CardContent>
                <PeriodsTable periods={r.periods} baseCurrency={r.baseCurrency} />
              </CardContent>
            </Card>
          </>
        )
      }}
    </AnalyticsShell>
  )
}

/**
 * One row per statement period. The Period column sorts on `fromDate` rather than on the
 * rendered "from – to" string: chronological order is what a date column means, and the
 * formatted label would sort by whatever the locale puts first.
 */
function PeriodsTable({
  periods,
  baseCurrency,
}: {
  periods: NavPeriod[]
  baseCurrency: string
}): React.JSX.Element {
  const c = (v: number): string => formatCurrency(v, baseCurrency)

  const columns: DataColumn<NavPeriod>[] = [
    {
      key: 'period',
      header: 'Period',
      rowHeader: true,
      cell: (p) => `${formatDate(p.fromDate)} – ${formatDate(p.toDate)}`,
      sortValue: (p) => p.fromDate,
    },
    {
      key: 'startingValue',
      header: 'Start',
      numeric: true,
      cell: (p) => c(p.startingValue),
      sortValue: (p) => p.startingValue,
    },
    {
      key: 'endingValue',
      header: 'End',
      numeric: true,
      cell: (p) => c(p.endingValue),
      sortValue: (p) => p.endingValue,
    },
    {
      key: 'twr',
      header: 'TWR',
      numeric: true,
      cellClassName: (p) => toneClassName(toneOf(p.twr)),
      cell: (p) => formatSignedPercent(p.twr),
      sortValue: (p) => p.twr,
    },
    {
      key: 'mtm',
      header: 'Market P&L',
      numeric: true,
      cellClassName: (p) => toneClassName(toneOf(p.mtm)),
      cell: (p) => formatSignedCurrency(p.mtm, baseCurrency),
      sortValue: (p) => p.mtm,
    },
    {
      key: 'deposits',
      header: 'Deposits',
      numeric: true,
      cell: (p) => formatSignedCurrency(p.depositsWithdrawals, baseCurrency),
      sortValue: (p) => p.depositsWithdrawals,
    },
    {
      key: 'dividends',
      header: 'Dividends',
      numeric: true,
      cell: (p) => c(p.dividends),
      sortValue: (p) => p.dividends,
    },
    {
      key: 'commissions',
      header: 'Commissions',
      numeric: true,
      cell: (p) => c(p.commissions),
      sortValue: (p) => p.commissions,
    },
  ]

  return (
    <DataTable
      caption="Returns by period"
      columns={columns}
      rows={periods}
      rowKey={(p) => `${p.fromDate}-${p.toDate}`}
    />
  )
}
