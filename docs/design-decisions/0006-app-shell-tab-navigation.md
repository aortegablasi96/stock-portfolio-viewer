# 0006. App shell: client-side tab navigation for analytics views

- **Status:** Accepted (extended by 0027 — analytics tabs no longer unmount on switch; and by 0029 — the ARIA tabs pattern completed)
- **Date:** 2026-07-21

## Context

Through M2 the renderer was a single scrolling page (`PortfolioDashboard` + the M3 Story #20
`FlexImport` panel). M3 adds four sizeable analytics views (Performance, Allocation,
Dividends, Trades). Stacking them all on one page would be unwieldy and would fetch four
analytics reports on every load. The app is a single-user desktop app with no deep-linking or
URL requirements.

## Decision

Introduce a **lightweight tab shell** in `App.tsx`: a sticky top nav with one tab per area —
Portfolio · Performance · Allocation · Dividends · Trades — switching the active view via
local `useState`. No router library is added (none is warranted for five in-app tabs, and it
would be a new dependency against the "avoid dependencies" principle).

- The **Portfolio** tab keeps the existing `PortfolioDashboard` (live IBKR) and the
  `FlexImport` panel unchanged.
- Each analytics tab renders inside an `AnalyticsPage` wrapper that reuses the dashboard
  chrome (`.dashboard` layout + header) so the views are visually consistent.
- Each analytics view **fetches its own report on mount** (via a shared `useAnalytics` hook),
  so only the active tab's IPC call runs — reports are not all loaded up front.
- Tabs use `role="tab"` / `aria-selected` for accessibility. *(Completed by
  [[0029-tab-shell-aria-pattern-and-keyboard-navigation]]: real `tabpanel`s wired both ways,
  arrow/Home/End movement with automatic activation, and a roving `tabindex`.)*

## Consequences

Benefits:

* Each view is isolated and loads only when opened; the Portfolio tab is untouched.
* No routing dependency; the shell is ~40 lines and trivially testable.
* Consistent chrome across live and imported-data views.

Tradeoffs:

* No URL/deep-linking or back-button history — acceptable for a single-window desktop app; a
  router can be introduced later if navigation needs grow (e.g. drill-down from a holding).
* Switching tabs re-fetches (no cross-tab cache). Reports are cheap local reads, so this is
  fine; memoization can be added if it ever isn't. *(Revised by
  [[0027-analytics-views-persist-and-explicit-refresh]]: an analytics tab now mounts on first
  visit and stays mounted, so returning to it neither re-fetches nor loses its filters. Tabs
  are still not loaded up front, and the Portfolio tab still re-reads on every visit.)*

## Alternatives Considered

### Keep one long scrolling page

Rejected: four analytics sections plus the dashboard is too much on one page, and it would
run all four analytics queries on every load.

### Add a routing library (e.g. React Router)

Rejected for now: a new dependency for five static tabs with no deep-linking need. Revisit if
in-view drill-down or shareable locations become requirements.

## References

- [[0001-dashboard-layout-and-load-states]] — the dashboard chrome the analytics pages reuse
- [[0005-analytics-read-model-and-base-currency-conversion]] — the views this shell hosts
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the tabs pattern completed
- GitHub Issues #4 (Epic M3), #21–#24 (Stories)
