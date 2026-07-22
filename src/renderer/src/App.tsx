import { useState } from 'react'
import { PortfolioDashboard } from './components/PortfolioDashboard'
import { FlexImport } from './components/FlexImport'
import { PerformanceView } from './components/analytics/PerformanceView'
import { AllocationView } from './components/analytics/AllocationView'
import { DividendsView } from './components/analytics/DividendsView'
import { TradeHistoryView } from './components/analytics/TradeHistoryView'

/**
 * Application root. A lightweight tab shell (Milestone M3) switches between the live
 * Portfolio dashboard (M1/M2, with the Flex import panel) and the four analytics views
 * built on imported Flex data (Stories #21–#24). All data flows over the typed IPC
 * bridge (`window.api`); the renderer holds no business logic and never reaches data
 * sources directly. See DDR-0006 for the navigation model.
 */
type Tab = 'portfolio' | 'performance' | 'allocation' | 'dividends' | 'trades'

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'performance', label: 'Performance' },
  { id: 'allocation', label: 'Allocation' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'trades', label: 'Trades' },
]

/** Header + layout wrapper for an analytics tab, matching the dashboard chrome. */
function AnalyticsPage({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <main className="dashboard">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Stock Portfolio Viewer</p>
          <h1>{title}</h1>
        </div>
        <p className="source-note">From imported Flex Query data</p>
      </header>
      {children}
    </main>
  )
}

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('portfolio')

  return (
    <div className="app">
      <nav className="app-nav" aria-label="Primary">
        <span className="app-brand">Portfolio Viewer</span>
        <div className="app-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`app-tab ${tab === t.id ? 'app-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'portfolio' && (
        <>
          <PortfolioDashboard />
          <FlexImport />
        </>
      )}
      {tab === 'performance' && (
        <AnalyticsPage title="Performance">
          <PerformanceView />
        </AnalyticsPage>
      )}
      {tab === 'allocation' && (
        <AnalyticsPage title="Allocation">
          <AllocationView />
        </AnalyticsPage>
      )}
      {tab === 'dividends' && (
        <AnalyticsPage title="Dividends">
          <DividendsView />
        </AnalyticsPage>
      )}
      {tab === 'trades' && (
        <AnalyticsPage title="Trades & realized gains">
          <TradeHistoryView />
        </AnalyticsPage>
      )}
    </div>
  )
}
