import { useState } from 'react'
import type { AllocationReport, AllocationResult, AllocationSlice } from '@shared/domain/allocation'
import { formatCurrency, formatDate, formatSignedCurrency } from '../../lib/format'
import { BubbleMap } from '../charts/BubbleMap'
import { AllocationBreakdown } from './AllocationBreakdown'
import { useAnalytics } from './useAnalytics'
import { ClassifySectors } from './ClassifySectors'
import { NeedsImport } from './NeedsImport'
import { StatTile, toneOf } from './StatTile'

/**
 * Allocation analysis (Milestone M3, Stories #22, #30 and #48). Breaks the latest imported
 * positions down by asset class, sector, issuer country and currency. A tab selector
 * switches between the breakdowns; each renders as a composing-slices table beside its
 * donut (`AllocationBreakdown`). Below, a world map locates the holdings and a positions
 * table lists each holding's base-currency market value, cost basis, and unrealized P&L.
 *
 * Sector is the one dimension not present in Flex statements; it comes from the locally
 * cached IBKR classification, so positions can legitimately be unclassified until the
 * owner runs the (opt-in, gateway-backed) classification action.
 */
const BREAKDOWN_TABS = [
  { id: 'assetClass', label: 'Asset class', title: 'By asset class' },
  { id: 'sector', label: 'Sector', title: 'By sector' },
  { id: 'country', label: 'Country', title: 'By geography (issuer country)' },
  { id: 'currency', label: 'Currency', title: 'By currency' },
] as const
type BreakdownTab = (typeof BREAKDOWN_TABS)[number]['id']

function slicesFor(report: AllocationReport, tab: BreakdownTab): AllocationSlice[] {
  switch (tab) {
    case 'assetClass':
      return report.byAssetClass
    case 'sector':
      return report.bySector
    case 'country':
      return report.byCountry
    case 'currency':
      return report.byCurrency
  }
}

export function AllocationView(): React.JSX.Element {
  const { state, reload } = useAnalytics<AllocationResult>(window.api.getAllocation)
  const [tab, setTab] = useState<BreakdownTab>('assetClass')

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
  const activeTab = BREAKDOWN_TABS.find((t) => t.id === tab)!

  return (
    <div className="analytics-view">
      <div className="stat-row">
        <StatTile label="Invested value" value={c(r.totalMarketValueBase)} hint={r.reportDate ? `As of ${formatDate(r.reportDate)}` : undefined} />
        <StatTile label="Positions" value={String(r.positions.length)} />
        {top && <StatTile label="Largest holding" value={top.symbol} hint={`${top.percentOfNav.toFixed(1)}% of NAV`} />}
      </div>

      <section className="panel">
        <h2 className="panel-title">By geography &amp; sector (world map)</h2>
        <BubbleMap
          positions={r.positions}
          bySector={r.bySector}
          formatValue={c}
          ariaLabel="Holdings by country and sector, world map"
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title" id="allocation-breakdown-title">{activeTab.title}</h2>
          <div className="chart-tabs" role="tablist" aria-label="Allocation breakdown">
            {BREAKDOWN_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`chart-tab ${tab === t.id ? 'chart-tab-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <AllocationBreakdown
          key={tab}
          slices={slicesFor(r, tab)}
          formatValue={c}
          ariaLabel={`Allocation ${activeTab.title.toLowerCase()}`}
          emptyMessage={tab === 'sector' ? 'No sector data yet.' : 'Nothing to plot yet.'}
        />
        {tab === 'sector' && r.unclassifiedCount > 0 && (
          <ClassifySectors unclassifiedCount={r.unclassifiedCount} onClassified={() => void reload()} />
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">Positions</h2>
        <div className="table-scroll">
          <table className="holdings-table">
            <thead>
              <tr>
                <th scope="col">Ticker</th>
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
