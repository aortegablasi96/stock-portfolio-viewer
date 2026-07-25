import type { AllocationResult, AllocationSlice } from '@shared/domain/allocation'
import { formatCurrency, formatDate, formatSignedCurrency } from '../../lib/format'
import { PieChart } from '../charts/PieChart'
import { BubbleMap } from '../charts/BubbleMap'
import type { PieDatum } from '../../lib/pie'
import { useAnalytics } from './useAnalytics'
import { ClassifySectors } from './ClassifySectors'
import { NeedsImport } from './NeedsImport'
import { StatTile, toneOf } from './StatTile'

/**
 * Allocation analysis (Milestone M3, Stories #22 and #30). Breaks the latest imported
 * positions down by asset class, issuer country, currency and sector — each as a donut
 * chart — and lists each position with its base-currency market value, cost basis, and
 * unrealized P&L.
 *
 * Sector is the one dimension not present in Flex statements; it comes from the locally
 * cached IBKR classification, so positions can legitimately be unclassified until the
 * owner runs the (opt-in, gateway-backed) classification action.
 */
function toItems(slices: AllocationSlice[]): PieDatum[] {
  return slices.map((s) => ({ key: s.key, label: s.label, value: s.marketValueBase, percent: s.percentOfNav }))
}

export function AllocationView(): React.JSX.Element {
  const { state, reload } = useAnalytics<AllocationResult>(window.api.getAllocation)

  if (state.phase === 'loading') {
    return (
      <p className="state-panel" role="status">
        Loading allocation…
      </p>
    )
  }
  if (state.phase === 'error') {
    return (
      <section className="state-panel state-error" role="alert">
        <h2>Couldn’t load allocation</h2>
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
  const top = r.positions[0]

  return (
    <div className="analytics-view">
      <div className="stat-row">
        <StatTile label="Invested value" value={c(r.totalMarketValueBase)} hint={r.reportDate ? `As of ${formatDate(r.reportDate)}` : undefined} />
        <StatTile label="Positions" value={String(r.positions.length)} />
        {top && <StatTile label="Largest holding" value={top.symbol} hint={`${top.percentOfNav.toFixed(1)}% of NAV`} />}
      </div>

      <section className="panel">
        <h2 className="panel-title">By geography (world map)</h2>
        <BubbleMap data={r.byCountry} formatValue={c} ariaLabel="Holdings by country, world map" />
      </section>

      <div className="breakdown-grid">
        <section className="panel">
          <h2 className="panel-title">By asset class</h2>
          <PieChart data={toItems(r.byAssetClass)} formatValue={c} ariaLabel="Allocation by asset class" />
        </section>
        <section className="panel">
          <h2 className="panel-title">By geography (issuer country)</h2>
          <PieChart data={toItems(r.byCountry)} formatValue={c} ariaLabel="Allocation by issuer country" />
        </section>
        <section className="panel">
          <h2 className="panel-title">By currency</h2>
          <PieChart data={toItems(r.byCurrency)} formatValue={c} ariaLabel="Allocation by currency" />
        </section>
        <section className="panel">
          <h2 className="panel-title">By sector</h2>
          <PieChart
            data={toItems(r.bySector)}
            formatValue={c}
            ariaLabel="Allocation by sector"
            emptyMessage="No sector data yet."
          />
          {r.unclassifiedCount > 0 && (
            <ClassifySectors
              unclassifiedCount={r.unclassifiedCount}
              onClassified={() => void reload()}
            />
          )}
        </section>
      </div>

      <section className="panel">
        <h2 className="panel-title">Positions</h2>
        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Class</th>
                <th scope="col">Country</th>
                <th scope="col">Sector</th>
                <th scope="col" className="num">Market value</th>
                <th scope="col" className="num">Cost basis</th>
                <th scope="col" className="num">Unrealized P&L</th>
                <th scope="col" className="num">% of NAV</th>
              </tr>
            </thead>
            <tbody>
              {r.positions.map((p) => (
                <tr key={p.conid ?? p.symbol}>
                  <th scope="row" className="symbol">
                    {p.symbol}
                    <span className="flex-import-file">{p.description}</span>
                  </th>
                  <td>{p.assetCategory}</td>
                  <td>{p.issuerCountry || '—'}</td>
                  <td>{p.sector || '—'}</td>
                  <td className="num">{c(p.marketValueBase)}</td>
                  <td className="num">{c(p.costBasisBase)}</td>
                  <td className={`num stat-${toneOf(p.unrealizedPnlBase)}`}>
                    {formatSignedCurrency(p.unrealizedPnlBase, r.baseCurrency)}
                  </td>
                  <td className="num">{p.percentOfNav.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
