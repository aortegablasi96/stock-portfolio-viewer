import type { ReactNode } from 'react'
import type { NavPeriod, PerformanceReport, PerformanceResult } from '@shared/domain/performance'
import {
  formatCurrency,
  formatDate,
  formatSignedCurrency,
  formatSignedPercent,
} from '../../lib/format'
import { boundsFor } from '../../lib/dateRange'
import { dailyReturns } from '../../lib/dailyReturns'
import { sliceComposition } from '../../lib/composition'
import { rebaseSeries, seriesExtent, sliceSeries, windowStats } from '../../lib/performanceRange'
import { BarChart } from '../charts/BarChart'
import { LineChart } from '../charts/LineChart'
import { CompositionLegend, StackedAreaChart } from '../charts/StackedAreaChart'
import { useAnalytics } from './useAnalytics'
import { AnalyticsShell } from './AnalyticsShell'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/Card'
import { DataTable, type DataColumn } from '../ui/DataTable'
import { RangeFilter } from './RangeFilter'
import { StatRow, StatTile } from '../ui/StatTile'
import { toneClassName, toneOf } from '../../lib/statTileVariants'
import { useRangeSelection } from './useRangeSelection'

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
 * A fourth (Story #171, DDR-0050) answers the question none of the three can: whether a return
 * came from a portfolio held all year or one that changed shape underneath it. It reads IBKR's own
 * daily NAV breakdown — the same series the value curve above now comes from — and stacks it
 * **cumulatively**, in base currency, so a band's thickness is an amount rather than a proportion
 * (DDR-0052, superseding DDR-0050 on that point).
 *
 * All four render **at once, in a 2×2 grid** (Story #172, DDR-0051), because they are most useful
 * read against each other: a drawdown in the value curve means one thing beside a run of red daily
 * bars and another beside a shift in composition. The switcher that showed one at a time is gone
 * with them, and so is the state it needed — four charts under one `RangeFilter` is one selection,
 * not four. The narrower column is why the charts' `viewBox` changed shape; see
 * `lib/chartGeometry`.
 *
 * The view stays mounted once visited (Story #109), so the range selection below survives a trip
 * to another tab; the `RefreshBar` gives the re-read that leaving and returning used to perform by
 * accident.
 */
export function PerformanceView(): React.JSX.Element {
  const analytics = useAnalytics<PerformanceResult>(window.api.getPerformance)
  const { range, setRange, custom, editCustom } = useRangeSelection()

  // The range selection stays above the shell: it is the view's own state, and the shell holds
  // none, so it survives a tab switch exactly as it did (DDR-0027).
  return (
    <AnalyticsShell<PerformanceReport>
      title="Performance"
      subject="performance"
      analytics={analytics}
    >
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

        // Composition is sliced, never rebased or carried forward: each point is a
        // simultaneous observation of every band, so the window shows the days it really
        // contains (Story #171).
        const compositionPoints = bounds
          ? sliceComposition(r.compositionSeries.points, bounds)
          : r.compositionSeries.points
        const compositionBands = r.compositionSeries.bands
        // Named from the bands actually drawn, so a reader who cannot see the legend still
        // learns what the stack is split into — and an account that has never held options is
        // not told about an options band that isn't there.
        const compositionChartLabel =
          compositionPoints.length === 0
            ? 'Portfolio composition over time'
            : `Portfolio composition over time in ${r.baseCurrency}, stacked to total net asset value and split into ${compositionBands
                .map((b) => b.label.toLowerCase())
                .join(', ')}, over ${compositionPoints.length} days`

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

            {/* Row 1 is the two cumulative curves, row 2 the two charts that break them apart:
                the daily bars say how the curve was travelled, composition says what was held
                while it was. Reading order matches, so a screen reader gets the same argument. */}
            <div className="performance-charts">
              <ChartCard title="Portfolio value over time">
                <LineChart
                  points={valueSeries}
                  formatValue={c}
                  formatDate={formatDate}
                  ariaLabel="Portfolio value over time"
                />
              </ChartCard>

              <ChartCard title={returnChartTitle}>
                <LineChart
                  points={returnSeries}
                  formatValue={formatSignedPercent}
                  formatDate={formatDate}
                  ariaLabel={returnChartLabel}
                />
              </ChartCard>

              <ChartCard title="Daily return">
                <BarChart
                  points={dailyPoints}
                  formatValue={formatSignedPercent}
                  formatDate={formatDate}
                  ariaLabel={dailyChartLabel}
                  emptyMessage="Not enough data points to plot daily returns yet."
                />
              </ChartCard>

              <ChartCard
                title="Composition over time"
                aside={<CompositionLegend bands={compositionBands} />}
              >
                <StackedAreaChart
                  bands={compositionBands}
                  points={compositionPoints}
                  formatValue={c}
                  formatDate={formatDate}
                  ariaLabel={compositionChartLabel}
                  emptyMessage="Composition over time needs a Flex export that includes the Net Asset Value (NAV) in Base section."
                />
              </ChartCard>
            </div>

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
 * One chart in the 2×2 grid: a card, a header carrying its title and anything the chart needs
 * named at the top right, and the chart itself (Story #172).
 *
 * **Every card uses `CardHeader`, including the three with nothing to put in it.** That is what
 * makes the four exactly the same height: a bare `CardTitle` and a `CardHeader` around one are
 * near-identical but not identical, and a grid built to be read across its rows cannot afford
 * "near". The header is centred, so a legend shorter than the title does not change its height
 * either.
 *
 * The daily-return and composition cards used to carry a `source-note` paragraph explaining how
 * their numbers were derived. Both are gone: four charts on one screen meant four bodies of prose
 * competing with the plots they annotated, and a card whose note ran to seven lines was taller
 * than the chart it belonged to. The derivations they described have not changed and are not
 * lost — they are in `lib/dailyReturns` and `lib/composition`, and in DDR-0049 / DDR-0050, which
 * is where a reader who wants the method is better served than by a caption. What the reader of
 * the *view* needs is on the chart itself: the axis, the legend and the hover readout.
 *
 * Not a shared primitive: this is the Performance grid's own composition of `Card`, and a second
 * view wanting chart cards would be the moment to ask whether it wants *these* (DDR-0033).
 */
function ChartCard({
  title,
  aside,
  children,
}: {
  title: string
  /** Rendered at the header's right edge — the composition stack's legend, today. */
  aside?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader align="center" className="chart-card-header">
        <CardTitle>{title}</CardTitle>
        {aside}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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
