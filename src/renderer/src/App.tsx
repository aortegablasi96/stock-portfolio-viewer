import { useCallback, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { PortfolioDashboard } from './components/PortfolioDashboard'
import { FlexImport } from './components/FlexImport'
import { PerformanceView } from './components/analytics/PerformanceView'
import { AllocationView } from './components/analytics/AllocationView'
import { DividendsView } from './components/analytics/DividendsView'
import { TradeHistoryView } from './components/analytics/TradeHistoryView'
import { nextTabIndex } from './lib/tabKeyboard'

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
 *
 * The bar implements the full WAI-ARIA tabs pattern (Story #111, DDR-0029): every panel is a
 * `tabpanel` tied to its tab both ways, arrow keys move between tabs and activate as they go,
 * and a roving `tabindex` keeps the whole tablist a single stop in the Tab order.
 */
type Tab = 'portfolio' | 'performance' | 'allocation' | 'dividends' | 'trades'

const TABS: { id: Tab; label: string }[] = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'performance', label: 'Performance' },
  { id: 'allocation', label: 'Allocation' },
  { id: 'dividends', label: 'Dividends' },
  { id: 'trades', label: 'Trades' },
]

/** The two halves of each tab/panel pair, so `aria-controls` and `aria-labelledby` can't drift. */
const tabDomId = (id: Tab): string => `tab-${id}`
const panelDomId = (id: Tab): string => `panel-${id}`

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
  // The buttons themselves, so a keyboard move can put focus on the tab it selected. A roving
  // tabindex means the tab being left is about to stop being focusable, so focus has to be
  // moved deliberately rather than left to the browser.
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>())

  const select = useCallback((id: Tab): void => {
    setTab(id)
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  /**
   * Arrow / Home / End movement across the tablist.
   *
   * Tabs activate as focus reaches them ("automatic activation"), which is the pattern's
   * default and the reason it reads well with a screen reader: what is announced and what is
   * shown never disagree. The APG's caveat — use manual activation when showing a panel is
   * slow — doesn't bite here, because every view renders its own loading or empty state
   * immediately; nothing waits on IPC before painting. Arrowing past an analytics tab does
   * mount it for the session, which is the same thing clicking it would do (DDR-0027).
   */
  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const target = nextTabIndex(
        event.key,
        TABS.findIndex((t) => t.id === tab),
        TABS.length,
      )
      if (target === null) return

      // Only now: an unhandled key (Tab above all) has to stay the browser's.
      event.preventDefault()
      const id = TABS[target]!.id
      select(id)
      tabRefs.current.get(id)?.focus()
    },
    [tab, select],
  )

  /** An analytics tab's panel: rendered from first visit, then hidden while another tab is active. */
  const panel = (id: Tab, title: string, view: React.ReactNode): React.JSX.Element | null =>
    visited.has(id) ? (
      <TabPanel id={id} hidden={tab !== id}>
        <AnalyticsPage title={title}>{view}</AnalyticsPage>
      </TabPanel>
    ) : null

  return (
    <div className="app">
      <TitleBar />
      <nav className="app-nav" aria-label="Primary">
        <div className="app-tabs" role="tablist" aria-label="Views" onKeyDown={onTabKeyDown}>
          {TABS.map((t) => {
            const isActive = tab === t.id
            return (
              <button
                key={t.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(t.id, node)
                  else tabRefs.current.delete(t.id)
                }}
                type="button"
                role="tab"
                id={tabDomId(t.id)}
                // Only the selected tab has a panel in the tree, so this is the only tab that
                // can point at one — `aria-controls` naming an element that isn't there is
                // exactly the broken promise this story is about.
                aria-controls={isActive ? panelDomId(t.id) : undefined}
                aria-selected={isActive}
                // Roving tabindex: the tablist is one stop in the Tab order, and Tab from the
                // selected tab moves on into its panel rather than along the other four.
                tabIndex={isActive ? 0 : -1}
                className={`app-tab ${isActive ? 'app-tab-active' : ''}`}
                onClick={() => select(t.id)}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </nav>

      {tab === 'portfolio' && (
        <TabPanel id="portfolio">
          <PortfolioDashboard />
          <FlexImport />
        </TabPanel>
      )}
      {panel('performance', 'Performance', <PerformanceView />)}
      {panel('allocation', 'Allocation', <AllocationView />)}
      {panel('dividends', 'Dividends', <DividendsView />)}
      {panel('trades', 'Trades & realized gains', <TradeHistoryView />)}
    </div>
  )
}

/**
 * The panel half of a tab pair. `tabIndex={0}` is deliberate: it gives Tab somewhere to land
 * after the tablist, so a keyboard reader moves tab → panel instead of tab → whatever control
 * happens to be first inside it. `hidden` takes the inactive panels back out of the tab order
 * and the accessibility tree, which is what keeps four mounted-but-invisible views from being
 * reachable at all (Story #109).
 */
function TabPanel({
  id,
  hidden,
  children,
}: {
  id: Tab
  hidden?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      className="tab-panel"
      id={panelDomId(id)}
      role="tabpanel"
      aria-labelledby={tabDomId(id)}
      tabIndex={0}
      hidden={hidden}
    >
      {children}
    </div>
  )
}
