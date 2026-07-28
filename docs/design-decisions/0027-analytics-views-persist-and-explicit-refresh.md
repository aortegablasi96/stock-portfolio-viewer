# 0027. Analytics tabs stay mounted; a re-read becomes an explicit, non-destructive action

- **Status:** Accepted
- **Date:** 2026-07-28
- **Extends:** [[0006-app-shell-tab-navigation]] (the tab shell itself is unchanged; this
  revises its "each view fetches on mount, switching re-fetches" clause)

## Context

[[0006-app-shell-tab-navigation]] rendered each tab conditionally
(`{tab === 'performance' && <PerformanceView />}`), so leaving a tab **unmounted** the view.
`useAnalytics` starts at `phase: 'loading'`, which meant every return to a tab replayed the
full sequence — loading panel, IPC read, re-render — and threw away everything the view held
that wasn't in the report: the selected time range, the type chips, the chart tab, the map's
colour mode. DDR-0006 called the re-fetch acceptable because the reads are cheap local
queries, and it is: the cost is not throughput, it's that navigating away silently discards a
filter selection the owner set up on purpose, and that the view flashes on the way back.

There was also no way to re-read a view *without* navigating. After importing on the Portfolio
tab, the only way to get the analytics views current was to visit each one — and the re-read
happened as a side effect of the tab switch rather than because anything was asked for. Story
#109 wants both halves fixed: returning should be instant, and re-reading should be something
the owner does deliberately.

## Decision

**An analytics tab mounts on first visit and stays mounted for the session**, hidden with the
`hidden` attribute while another tab is active. What the owner comes back to is not a restored
copy of the view — it is the same component instance, still holding its report and all of its
local state. Nothing is fetched up front: an unvisited tab has no component and issues no IPC,
so DDR-0006's "reports are not all loaded up front" property survives intact.

Three things follow from that, and they are the decision as much as the mounting is:

1. **A shared data-version signal** (`renderer/src/lib/dataVersion.ts`). Views that outlive
   their visit can be made stale by something happening on another tab, so every write path —
   `FlexImport`'s import and clear, the inline `NeedsImport` action — bumps a counter, and
   every view's `useAnalytics` re-reads when it changes. A module-level store subscribed to
   with `useSyncExternalStore`, not React context: one renderer window, one Flex store, a plain
   counter, no provider to thread through the shell, and it stays unit-testable under Vitest's
   Node environment. It signals *change*; it never holds data, so it cannot drift from a report.
2. **`loading` means the first load only.** A reload keeps the loaded report on screen and
   reports itself as `refreshing`, so neither the explicit refresh nor the re-read after an
   import blanks a view being read. Loading, error and `needs_import` are unchanged on first
   load — they are still first-class states, still rendered by the view itself.
3. **An explicit refresh in every analytics view** (`RefreshBar`): the time of the current
   reading plus a Refresh button, quietly right-aligned above the view's own controls. Data
   that persists is data that can go stale, and once a view no longer re-reads on every visit,
   "how current is this?" has to be answerable on screen.

**The Portfolio tab is deliberately excluded** and keeps unmounting on every switch. It reads
live IBKR data, which changes on its own; the four analytics views read imported Flex history,
which changes only when the owner imports or clears — and the version signal already covers
exactly those two events. Persisting a live view would mean showing prices that stopped being
true while the owner was on another tab, with nothing to signal it.

## Consequences

Benefits:

* Returning to a view is instant and complete — data, time range, type filter, chart tab, map
  colour mode — because none of it was ever discarded.
* Re-reading is deliberate and legible: a timestamp says when, a button does it, and the
  figures stay on screen while it happens.
* An import or clear reaches every mounted view at once, so no view can present history that
  has since changed as current.
* Renderer-only: no service, repository, IPC-contract or schema change, and no data-fetching
  dependency.

Tradeoffs:

* Every visited view stays in the DOM for the session, holding its report in memory. For four
  views over a personal portfolio's local history this is negligible; it would need revisiting
  if a view ever held something genuinely large.
* Hidden panels are out of the accessibility tree, which is correct, but it means DOM-level
  tests must locate them by class rather than by role.
* The Allocation view's Mapbox instance now survives hiding. A hidden frame measures 0×0, so
  its `ResizeObserver` ignores zero-size observations rather than fitting the world into no
  width; the observer fires again with the real size when the tab is shown, which is the
  resize that matters.
* Scroll position within a view is not restored — the document scroll is shared by the panels.
  Out of scope here; no worse than the unmounting behaviour it replaces.

Risks:

* A future view that needs to react to something *other* than an import or a clear must bump
  the version itself, or it will sit mounted and stale. The signal is only as complete as its
  callers — which is why it lives at the two write paths rather than inside a component.

## Alternatives Considered

### A renderer-side cache of the reports, keyed by view

Views keep unmounting; `useAnalytics` seeds itself from a module-level cache so the report is
already there on remount. It removes the loading flash, but not the second half of the problem:
a remounted component still starts with fresh `useState`, so the time range, type chips and
chart tab are all lost anyway. Restoring those would mean lifting every view's filter state
into the same store — a much larger change than not unmounting in the first place, and one that
puts view-local state somewhere the view no longer owns.

### Render all four views eagerly on launch

Simplest possible "always mounted", but it fires four analytics reads at startup for tabs the
owner may never open, which is exactly what DDR-0006 chose the tab shell to avoid.

### Refresh on a timer, or on window focus

Rejected as out of scope and wrong for the data: imported Flex history changes only when the
owner imports or clears, both of which are already signalled precisely. A timer would re-read
constantly to observe nothing.

## References

- [[0006-app-shell-tab-navigation]] — the tab shell this revises the fetch behaviour of
- [[0005-analytics-read-model-and-base-currency-conversion]] — the `ok | needs_import` results these views render
- [[0017-analytics-table-time-range-filter]] — the filter state a tab switch used to discard
- [[0020-allocation-map-position-bubbles]] — the map instance that now survives hiding
- GitHub Issues #109 (Story), #99 (Epic — Analytics views polish)
