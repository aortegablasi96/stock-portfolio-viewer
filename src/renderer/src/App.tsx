import { useCallback, useState } from 'react'
import { TitleBar } from './components/TitleBar'
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
 *
 * An analytics tab mounts the first time it is opened and then **stays mounted**, hidden
 * rather than unmounted, for the rest of the session (Story #109, DDR-0027). That is what
 * makes returning to a view instant: the report it read, its time range, its type filter and
 * its chart tab are all still there, because the component that held them never went away.
 * Nothing is fetched up front — an unvisited tab has no component and issues no IPC — and an
 * import or a clear pushes every mounted view into a re-read through `lib/dataVersion`.
 *
 * The **Portfolio** tab is deliberately the exception: it reads live IBKR data, which changes
 * on its own, so it keeps unmounting and re-reading on every visit.
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
  // Which analytics tabs have been opened at least once — the set of views that exist in the
  // tree. It only ever grows, so a view is mounted once per session and never re-mounted.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set<Tab>())

  const select = useCallback((id: Tab): void => {
    setTab(id)
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  /** An analytics tab's panel: rendered from first visit, then hidden while another tab is active. */
  const panel = (id: Tab, title: string, view: React.ReactNode): React.JSX.Element | null =>
    visited.has(id) ? (
      <div className="tab-panel" hidden={tab !== id}>
        <AnalyticsPage title={title}>{view}</AnalyticsPage>
      </div>
    ) : null

  return (
    <div className="app">
      <TitleBar />
      <nav className="app-nav" aria-label="Primary">
        <div className="app-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`app-tab ${tab === t.id ? 'app-tab-active' : ''}`}
              onClick={() => select(t.id)}
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
      {panel('performance', 'Performance', <PerformanceView />)}
      {panel('allocation', 'Allocation', <AllocationView />)}
      {panel('dividends', 'Dividends', <DividendsView />)}
      {panel('trades', 'Trades & realized gains', <TradeHistoryView />)}
    </div>
  )
}
