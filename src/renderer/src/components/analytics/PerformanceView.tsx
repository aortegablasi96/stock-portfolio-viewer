import { useState } from 'react'
import type { PerformanceResult } from '@shared/domain/performance'
import {
  formatCurrency,
  formatDate,
  formatSignedCurrency,
  formatSignedPercent,
} from '../../lib/format'
import type { Bounds, RangeId } from '../../lib/performanceRange'
import {
  boundsFor,
  fromDateInput,
  RANGE_OPTIONS,
  seriesExtent,
  sliceSeries,
  toDateInput,
  windowStats,
} from '../../lib/performanceRange'
import { LineChart } from '../charts/LineChart'
import { useAnalytics } from './useAnalytics'
import { NeedsImport } from './NeedsImport'
import { StatTile, toneOf } from './StatTile'

/** The two switchable Performance charts (Story #45). */
const CHART_TABS = [
  { id: 'value', label: 'Portfolio value over time' },
  { id: 'return', label: 'Performance change over time' },
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
 */
export function PerformanceView(): React.JSX.Element {
  const { state, reload } = useAnalytics<PerformanceResult>(window.api.getPerformance)
  const [chartTab, setChartTab] = useState<ChartTab>('value')
  const [range, setRange] = useState<RangeId>('all')
  // Custom window; `null` until the user first edits it, when it defaults to the full extent.
  const [custom, setCustom] = useState<Bounds | null>(null)

  if (state.phase === 'loading') {
    return (
      <p className="state-panel" role="status">
        Loading performance…
      </p>
    )
  }
  if (state.phase === 'error') {
    return (
      <section className="state-panel state-error" role="alert">
        <h2>Couldn’t load performance</h2>
        <p>{state.message}</p>
        <button type="button" className="retry-button" onClick={() => void reload()}>
          Retry
        </button>
      </section>
    )
  }
  if (state.result.status === 'needs_import') {
    return <NeedsImport onImported={() => void reload()} />
  }

  const r = state.result.report
  const c = (v: number): string => formatCurrency(v, r.baseCurrency)

  const extent = seriesExtent(r.valueSeries)
  const customBounds = custom ?? extent ?? { from: 0, to: 0 }
  const bounds = extent ? boundsFor(range, extent, customBounds) : null

  const valueSeries = bounds ? sliceSeries(r.valueSeries, bounds) : r.valueSeries
  const returnSeries = bounds ? sliceSeries(r.returnSeries, bounds) : r.returnSeries
  const stats = bounds
    ? windowStats(r.valueSeries, r.returnSeries, bounds)
    : { endValue: r.endingValue, changeAbs: 0, changePct: null, twr: r.cumulativeTwr }

  const periodLabel = range === 'all' ? 'Full history' : 'Selected period'

  /** Update one edge of the custom window, seeding from the full extent on first edit. */
  function editCustom(edge: 'from' | 'to', value: string): void {
    const ms = fromDateInput(value)
    if (ms === null) return
    setCustom((prev) => ({ ...(prev ?? customBounds), [edge]: ms }))
  }

  return (
    <div className="analytics-view">
      <div className="range-bar">
        <div className="chart-tabs" role="group" aria-label="Performance time range">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              title={opt.title}
              aria-pressed={range === opt.id}
              className={`chart-tab ${range === opt.id ? 'chart-tab-active' : ''}`}
              onClick={() => setRange(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {range === 'custom' && extent && (
          <div className="range-custom">
            <label className="field-inline">
              <span>From</span>
              <input
                type="date"
                className="select-control"
                value={toDateInput(customBounds.from)}
                min={toDateInput(extent.from)}
                max={toDateInput(extent.to)}
                onChange={(e) => editCustom('from', e.target.value)}
              />
            </label>
            <label className="field-inline">
              <span>To</span>
              <input
                type="date"
                className="select-control"
                value={toDateInput(customBounds.to)}
                min={toDateInput(extent.from)}
                max={toDateInput(extent.to)}
                onChange={(e) => editCustom('to', e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      <div className="stat-row">
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
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title" id="perf-chart-title">
            {chartTab === 'value' ? 'Portfolio value over time' : 'Performance change over time'}
          </h2>
          <div className="chart-tabs" role="tablist" aria-label="Performance chart">
            {CHART_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={chartTab === t.id}
                className={`chart-tab ${chartTab === t.id ? 'chart-tab-active' : ''}`}
                onClick={() => setChartTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        {chartTab === 'value' ? (
          <LineChart
            key="value"
            points={valueSeries}
            formatValue={c}
            formatDate={formatDate}
            ariaLabel="Portfolio value over time"
          />
        ) : (
          <LineChart
            key="return"
            points={returnSeries}
            formatValue={formatSignedPercent}
            formatDate={formatDate}
            ariaLabel="Cumulative time-weighted return over time"
          />
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Returns by period</h2>
        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col" className="num">Start</th>
                <th scope="col" className="num">End</th>
                <th scope="col" className="num">TWR</th>
                <th scope="col" className="num">Market P&L</th>
                <th scope="col" className="num">Deposits</th>
                <th scope="col" className="num">Dividends</th>
                <th scope="col" className="num">Commissions</th>
              </tr>
            </thead>
            <tbody>
              {r.periods.map((p) => (
                <tr key={`${p.fromDate}-${p.toDate}`}>
                  <th scope="row" className="symbol">
                    {formatDate(p.fromDate)} – {formatDate(p.toDate)}
                  </th>
                  <td className="num">{c(p.startingValue)}</td>
                  <td className="num">{c(p.endingValue)}</td>
                  <td className={`num stat-${toneOf(p.twr)}`}>{formatSignedPercent(p.twr)}</td>
                  <td className={`num stat-${toneOf(p.mtm)}`}>{formatSignedCurrency(p.mtm, r.baseCurrency)}</td>
                  <td className="num">{formatSignedCurrency(p.depositsWithdrawals, r.baseCurrency)}</td>
                  <td className="num">{c(p.dividends)}</td>
                  <td className="num">{c(p.commissions)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
