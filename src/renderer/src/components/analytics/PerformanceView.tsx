import type { PerformanceResult } from '@shared/domain/performance'
import {
  formatCurrency,
  formatDate,
  formatSignedCurrency,
  formatSignedPercent,
} from '../../lib/format'
import { LineChart } from '../charts/LineChart'
import { useAnalytics } from './useAnalytics'
import { NeedsImport } from './NeedsImport'
import { StatTile, toneOf } from './StatTile'

/**
 * Performance over time (Milestone M3, Story #21). Shows the portfolio-value trend,
 * headline time-weighted return, the realized/unrealized P&L split, and net
 * contributions — all in the account base currency, read from imported Flex data.
 */
export function PerformanceView(): React.JSX.Element {
  const { state, reload } = useAnalytics<PerformanceResult>(window.api.getPerformance)

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

  return (
    <div className="analytics-view">
      <div className="stat-row">
        <StatTile label="Portfolio value" value={c(r.endingValue)} hint="Latest imported period end" />
        <StatTile
          label="Time-weighted return"
          value={formatSignedPercent(r.cumulativeTwr)}
          hint="Chain-linked across periods"
          tone={toneOf(r.cumulativeTwr)}
        />
        <StatTile
          label="Realized P&L"
          value={formatSignedCurrency(r.totalRealizedPnl, r.baseCurrency)}
          tone={toneOf(r.totalRealizedPnl)}
        />
        <StatTile
          label="Unrealized P&L"
          value={formatSignedCurrency(r.totalUnrealizedPnl, r.baseCurrency)}
          tone={toneOf(r.totalUnrealizedPnl)}
        />
        <StatTile
          label="Net deposits"
          value={formatSignedCurrency(r.totalDepositsWithdrawals, r.baseCurrency)}
          hint="Contributions, not gains"
        />
      </div>

      <section className="panel">
        <h2 className="panel-title">Portfolio value over time</h2>
        <LineChart
          points={r.valueSeries}
          formatValue={c}
          formatDate={formatDate}
          ariaLabel="Portfolio value over time"
        />
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
