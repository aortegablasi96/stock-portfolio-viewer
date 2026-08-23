import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { PortfolioDashboard } from './components/PortfolioDashboard'
import { CurrencySelector } from './components/CurrencySelector'
import { GatewayBadge, SidebarBrand, SidebarToggle } from './components/SidebarRail'
import { PerformanceView } from './components/analytics/PerformanceView'
import { AllocationView } from './components/analytics/AllocationView'
import { DividendsView } from './components/analytics/DividendsView'
import { TradeHistoryView } from './components/analytics/TradeHistoryView'
import {
  AllocationIcon,
  DividendsIcon,
  PerformanceIcon,
  PortfolioIcon,
  TradesIcon,
} from './components/TabIcons'
import { nextTabIndex } from './lib/tabKeyboard'
import { isTextEntry, viewShortcutHint, viewShortcutIndex, viewShortcutKeys } from './lib/viewShortcut'
import { collapsedTitle, shellClassName, sidebarClassName } from './lib/sidebarCollapse'
import type { GatewayReading } from './lib/gatewayStatus'

/**
 * Application root. A lightweight tab shell (Milestone M3) switches between the live
 * Portfolio dashboard (M1/M2, which carries the Flex import controls) and the four analytics views
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
 * The list implements the full WAI-ARIA tabs pattern (Story #111, DDR-0029): every panel is a
 * `tabpanel` tied to its tab both ways, arrow keys move between tabs and activate as they go,
 * and a roving `tabindex` keeps the whole tablist a single stop in the Tab order.
 *
 * Since Story #182 (DDR-0055) the tablist is a **vertical sidebar** rather than a horizontal
 * strip. That is a change of orientation and skin, not of pattern: the tablist declares
 * `aria-orientation="vertical"` and `lib/tabKeyboard.ts` moves on Up/Down instead of Left/Right,
 * and every other part of the paragraph above is untouched — including the mounted-view rule,
 * which the redesign's own prototype would have discarded.
 *
 * Each tab also carries an icon (Story #168). It is a *second* channel: the label stays, and the
 * glyph is `aria-hidden`, so nothing about the pattern above — or about what a screen reader is
 * told — changes. See `components/TabIcons.tsx`.
 *
 * **Story #183 fills the column above and below that list**, and with it this component gains
 * the app's standing context (DDR-0056). Three pieces of state moved up here, and each moved for
 * the same reason: the sidebar outlives every view, while the Portfolio tab — the one component
 * that knew any of this — unmounts on every switch away.
 *
 *   - `displayCurrency` is now the *app's* selection rather than the dashboard's, so it survives
 *     a trip to Performance and back instead of resetting to EUR. The conversion itself is
 *     untouched (DDR-0007); only the control's home moved.
 *   - `heldCurrencies` is what the last overview reported holding, which is what the selector
 *     offers beyond the base currency.
 *   - `gateway` is the last thing the app learned about the gateway, which is what the badge
 *     reports. Nothing polls — see `lib/gatewayStatus.ts` for why that is the source of truth.
 *
 * All three are plain `useState` in the shell rather than a store or a context, because the
 * shell is already the only common ancestor of the sidebar and the dashboard. Both callbacks
 * handed down are stable, and that is load-bearing rather than tidy: the dashboard's load effect
 * depends on their identity, so a new function each render would re-run the read that produced
 * the report that caused the render.
 *
 * **Story #184 adds the fourth piece: how wide that column is** (DDR-0057). It is a *setting*
 * rather than a session fact, so unlike the three above it is read from and written to
 * `app_meta` — the mechanism the window's own bounds already use (DDR-0028). Two consequences
 * live here rather than in the sidebar. The state arrives asynchronously, so the width is applied
 * without animating until a frame has passed; and the flag is set once, on the root element, so
 * nothing in the rail takes a `collapsed` prop and no view below knows the sidebar moved.
 *
 * **Story #254 adds a second way into that list** (DDR-0083): `Ctrl`/`Cmd` and the digit drawn
 * beside a view's name select it from anywhere, without first walking focus back to the rail.
 * It is an addition to the tabs pattern, not a change to it — the tablist's own keys, its roving
 * `tabindex` and its automatic activation are untouched, and `nextTabIndex` still declines every
 * key it does not own. Two consequences live here: the listener is on `window` rather than on the
 * tablist (the whole point is that focus is elsewhere), and it moves focus onto the destination
 * tab, because the panel focus was standing in is about to be `hidden`.
 */
type Tab = 'portfolio' | 'performance' | 'allocation' | 'dividends' | 'trades'

const TABS: { id: Tab; label: string; icon: () => React.JSX.Element }[] = [
  { id: 'portfolio', label: 'Portfolio', icon: PortfolioIcon },
  { id: 'performance', label: 'Performance', icon: PerformanceIcon },
  { id: 'allocation', label: 'Allocation', icon: AllocationIcon },
  { id: 'dividends', label: 'Dividends', icon: DividendsIcon },
  { id: 'trades', label: 'Trades', icon: TradesIcon },
]

/** Display currency on first launch: the account's base currency (Story #28). */
const BASE_DISPLAY_CURRENCY = 'EUR'

/** Whether two currency lists hold the same codes, so a re-read that found nothing new re-renders nothing. */
function sameCodes(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((code, index) => code === b[index])
}

/** The two halves of each tab/panel pair, so `aria-controls` and `aria-labelledby` can't drift. */
const tabDomId = (id: Tab): string => `tab-${id}`
const panelDomId = (id: Tab): string => `panel-${id}`

/**
 * The id the visible "Views" label carries, so the tablist can be named by it (Story #234).
 * A constant rather than `useId()` for the reason `tabDomId` is one: there is exactly one
 * sidebar in the document, so there is nothing for a generated id to disambiguate — unlike
 * `Field`, whose three `RangeFilter`s are all mounted at once (DDR-0035).
 */
const NAV_LABEL_ID = 'app-nav-label'

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('portfolio')
  // Which analytics tabs have been opened at least once — the set of views that exist in the
  // tree. It only ever grows, so a view is mounted once per session and never re-mounted.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(() => new Set<Tab>())
  // The app's standing context (Story #183): what the sidebar reports, and what it controls.
  const [displayCurrency, setDisplayCurrency] = useState(BASE_DISPLAY_CURRENCY)
  const [heldCurrencies, setHeldCurrencies] = useState<readonly string[]>([])
  const [gateway, setGateway] = useState<GatewayReading | null>(null)
  // The sidebar's width, and whether it may animate to it yet. See the effect below.
  const [collapsed, setCollapsed] = useState(false)
  const [animated, setAnimated] = useState(false)
  // The buttons themselves, so a keyboard move can put focus on the tab it selected. A roving
  // tabindex means the tab being left is about to stop being focusable, so focus has to be
  // moved deliberately rather than left to the browser.
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement>())

  /**
   * The remembered sidebar width, read once on launch.
   *
   * The first paint is always the expanded column — there is no synchronous way to know
   * otherwise from the renderer — so a rail left collapsed is applied here, and the transition is
   * armed a frame later so that application is instant rather than a 120ms slide reporting a
   * decision the owner made on a previous launch. Every toggle after this one animates.
   */
  useEffect(() => {
    let live = true
    void window.api.getSidebarState().then((state) => {
      if (!live) return
      setCollapsed(state.collapsed)
      requestAnimationFrame(() => {
        if (live) setAnimated(true)
      })
    })
    return () => {
      live = false
    }
  }, [])

  /**
   * Collapse, and remember it.
   *
   * The write is a plain statement beside the state update rather than an effect on `collapsed`,
   * for two reasons: an effect would also fire on the read above and write back what it just
   * read, and a side effect inside a `setState` updater runs twice under StrictMode. Nothing
   * awaits the write — the rail has already moved, and a failed write costs a preference.
   */
  const setSidebarCollapsed = useCallback((next: boolean): void => {
    setCollapsed(next)
    void window.api.setSidebarState({ collapsed: next })
  }, [])

  const select = useCallback((id: Tab): void => {
    setTab(id)
    setVisited((prev) => (prev.has(id) ? prev : new Set(prev).add(id)))
  }, [])

  /**
   * What the dashboard found the account holding, reported after each overview read.
   *
   * The same-codes guard is not an optimisation for its own sake: without it every re-read
   * replaces an identical array, which re-renders the shell and every mounted view for nothing.
   */
  const onCurrenciesFound = useCallback((codes: readonly string[]): void => {
    setHeldCurrencies((prev) => (sameCodes(prev, codes) ? prev : codes))
  }, [])

  /** The base currency, whatever is selected, and every currency actually held. */
  const currencyOptions = useMemo(
    () => [...new Set([BASE_DISPLAY_CURRENCY, displayCurrency, ...heldCurrencies])].sort(),
    [displayCurrency, heldCurrencies],
  )

  /**
   * Select a view *and put focus on its row* — the landing spot both keyboard paths share.
   *
   * A roving `tabindex` means the tab being left is about to stop being focusable, so focus has to
   * be moved deliberately rather than left to the browser. The accelerator needs it for a second,
   * stronger reason: focus may be standing inside the panel that is about to become `hidden`, and
   * a `hidden` ancestor blurs its contents to `<body>` — so without this a jump would silently
   * cost the reader their place in the Tab order (DDR-0083).
   */
  const selectAndFocus = useCallback(
    (id: Tab): void => {
      select(id)
      tabRefs.current.get(id)?.focus()
    },
    [select],
  )

  /**
   * The accelerator: `Ctrl`/`Cmd` and a view's own digit, from anywhere in the app (Story #254).
   *
   * On `window` rather than on the tablist, because reaching the tablist is the whole problem —
   * `onTabKeyDown` below only ever fires once focus is already in it. The two do not overlap: a
   * digit's `event.key` is `'1'`, which `nextTabIndex` declines like every other key it does not
   * own, so the pattern's keys and this one pass each other untouched.
   *
   * It selects exactly its destination. Unlike arrowing, the views it passes over are neither
   * selected nor mounted (DDR-0027), which is what makes a jump to Trades cost one view rather
   * than four.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // The control's key before the app's: with focus in a Field, Select or DateInput, or in
      // anything editable, this keystroke is not ours to take (DDR-0035).
      if (isTextEntry(event.target as HTMLElement | null)) return

      const target = viewShortcutIndex(event, TABS.length)
      if (target === null) return

      // Only now: an unhandled combination has to stay the browser's.
      event.preventDefault()
      selectAndFocus(TABS[target]!.id)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectAndFocus])

  /**
   * Arrow / Home / End movement along the tablist.
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
      selectAndFocus(TABS[target]!.id)
    },
    [tab, selectAndFocus],
  )

  /**
   * An analytics tab's panel: rendered from first visit, then hidden while another tab is active.
   *
   * It wraps the view and nothing else. The page box and its header used to be added here, by an
   * `AnalyticsPage` component that was a second implementation of the dashboard's own header;
   * since Story #185 the view brings both with it through `AnalyticsShell`, which is what lets the
   * title render in the three branches that have no report (DDR-0058).
   */
  const panel = (id: Tab, view: React.ReactNode): React.JSX.Element | null =>
    visited.has(id) ? (
      <TabPanel id={id} hidden={tab !== id}>
        {view}
      </TabPanel>
    ) : null

  return (
    <div className={shellClassName(collapsed)}>
      {/* The title bar spans the full width *above* the sidebar rather than the sidebar running
          full height beside it, which is the corner Story #184 had to settle. With no OS frame
          the bar is the window's only grab handle, and DDR-0028 judges a restored window's
          reachability on it — so a sidebar beside it would carve 220px out of the drag region,
          and collapsing would then change how grabbable the window is as a side effect of a
          navigation preference (DDR-0011, DDR-0057). */}
      <TitleBar />
      {/* Sidebar beside content, under the full-width title bar. The panels sit in their own
          column rather than as siblings of the nav, so the content reflows to what is left of
          the window instead of running under the sidebar (DDR-0055). */}
      <div className="app-body">
        <nav id="app-sidebar" className={sidebarClassName(animated)} aria-label="Primary">
          {/* The context rail: what the app is, and whether the source behind it is answering
              (Story #183, DDR-0056). Above the list because both are true of the app rather than
              of any one view — and the list is the part that gives if the column ever runs short,
              so nothing here can be pushed out of sight. */}
          <div className="app-sidebar-head">
            {/* Brand and toggle on one row (Story #218). The control that changes the column's
                width now sits with the thing it changes, and it is the first stop in the sidebar's
                Tab order rather than the last — toggle → tabs → currency → panel (DDR-0068). */}
            <div className="app-sidebar-head-row">
              <SidebarBrand />
              <SidebarToggle
                collapsed={collapsed}
                onToggle={() => setSidebarCollapsed(!collapsed)}
              />
            </div>
            {/* The badge's own section, ruled off from the brand above it (Story #219, DDR-0069).
                What the app *is* and whether the source behind it is answering are two statements,
                and the proposal draws them as two blocks rather than as one column of text. The
                wrapper is what lets the rule between them span the sidebar while the boxed chip
                inside stays inset from its edges. */}
            <div className="app-sidebar-status">
              <GatewayBadge reading={gateway} />
            </div>
          </div>

          {/* The list's own title (Story #234). The tablist has carried the name "Views" since
              Story #182 — as an `aria-label`, so only a screen reader ever had it. The proposal
              draws it, so it stops being invisible and starts naming the region on screen as
              well as in the accessibility tree, which is why `aria-label` gives way to
              `aria-labelledby`: two names for one region is the redundancy this replaces, not a
              second label. It sits outside the tablist because a non-tab child inside one is
              invalid — every child of `role="tablist"` is a `role="tab"`. */}
          <p className="app-nav-label" id={NAV_LABEL_ID}>
            Views
          </p>

          <div
            className="app-sidebar-tabs"
            role="tablist"
            aria-labelledby={NAV_LABEL_ID}
            // The list runs down the sidebar, so Up/Down are the keys that move along it and
            // assistive technology has to be told which axis it is on (DDR-0055).
            aria-orientation="vertical"
            onKeyDown={onTabKeyDown}
          >
            {TABS.map((t, index) => {
              const isActive = tab === t.id
              const Icon = t.icon
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
                  // The binding, in the attribute the platform has for it (Story #254). The hint
                  // below is drawn for a sighted reader; this is the same fact for a reader who is
                  // listening, and it is why the accelerator does not need a legend somewhere else.
                  aria-keyshortcuts={viewShortcutKeys(index)}
                  // Roving tabindex: the tablist is one stop in the Tab order, and Tab from the
                  // selected tab moves on into its panel rather than along the other four.
                  tabIndex={isActive ? 0 : -1}
                  className={`app-tab ${isActive ? 'app-tab-active' : ''}`}
                  // An addition, never the mechanism: the row's accessible name is still the
                  // label below, which is clipped rather than removed when the rail collapses.
                  title={collapsedTitle(collapsed, t.label)}
                  onClick={() => select(t.id)}
                >
                  {/* Icon first, label second. The label is wrapped only so the collapsed rail
                      has something to clip (Story #184) — it is still one text node, so the
                      tab's `textContent` is still exactly its name. */}
                  <Icon />
                  <span className="app-tab-label">{t.label}</span>
                  {/* The digit that reaches this row, drawn where it is read: beside the name it
                      belongs to, so nothing has to be inferred from the row's position. It is
                      `aria-hidden` for the reason the icon is — the row's accessible name is still
                      the label alone, and `aria-keyshortcuts` above is how a reader who is
                      listening is told the same thing (DDR-0083). */}
                  <span className="app-tab-key" aria-hidden="true">
                    {viewShortcutHint(index)}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Pinned to the bottom of the column (Story #183). It drives `portfolio:getOverview`'s
              display currency exactly as it did from the dashboard header; what changed is that
              the selection now outlives the view it converts, since the Portfolio tab unmounts on
              every switch away (DDR-0007, DDR-0027). */}
          <div className="app-sidebar-foot">
            <CurrencySelector
              className="app-currency"
              value={displayCurrency}
              options={currencyOptions}
              onChange={setDisplayCurrency}
            />
          </div>
        </nav>

        <div className="app-content">
          {tab === 'portfolio' && (
            <TabPanel id="portfolio">
              {/* One block, not two. The Flex import panel used to sit here as a second
                  `.dashboard` beside the dashboard's own — which is why this panel was the one
                  place in the app with two page-length columns stacked. Story #189 folded it into
                  the view, where the redesign puts it. */}
              <PortfolioDashboard
                displayCurrency={displayCurrency}
                onCurrenciesFound={onCurrenciesFound}
                onGatewayReading={setGateway}
              />
            </TabPanel>
          )}
          {panel('performance', <PerformanceView />)}
          {panel('allocation', <AllocationView />)}
          {panel('dividends', <DividendsView />)}
          {panel('trades', <TradeHistoryView />)}
        </div>
      </div>
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
