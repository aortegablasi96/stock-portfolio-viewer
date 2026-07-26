# 0017. Analytics tables: time-range filter anchored to the data, composed with the type filter

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

Story #75 (Epic #4, M3) asks the dividends and trades tables for a time-range filter
"consistent with the Performance period presets", composing with the type filter each table
already has (#32, #33, #73), moving the "N shown" count, and restoring the full range when
cleared.

The presets already existed — Story #69 gave the Performance view 1M / 3M / 1Y / All / Custom
in `lib/performanceRange` ([[0013-performance-twr-curve-and-chart-tabs]]). But those helpers
window a *series*: they slice ascending `ValuePoint[]` and read carry-forward values at the
window edges. A table selects *rows*, which are newest-first, may be undated, and are already
being narrowed by a second filter. So the question was how much to share, and what a period
means for a row rather than a point.

## Decision

### One range vocabulary, shared by every view that offers periods

The view-agnostic half of `performanceRange` — `RangeId`, `RANGE_OPTIONS`, `Bounds`,
`boundsFor`, and the date-input conversions — moves to `lib/dateRange`, and
`performanceRange` keeps only what windows a series (`seriesExtent`, `valueAt`, `sliceSeries`,
`windowStats`). A `RangeFilter` component and a `useRangeSelection` hook join `TypeFilter` /
`useTypeSelection` as the shared controls, and the Performance view adopts both in place of its
own inline markup and state.

"1M" therefore means one thing across the app by construction, not because three
implementations agree. The alternative — importing presets from a module named
`performanceRange` into the trades table — works, but the name would be a lie within a release.

### Presets anchor to the newest row, not to today

`boundsFor` already trails back from the data's own latest point, and the tables keep that. The
app reads *imported* statements: an export made six weeks ago would leave a "today"-anchored 1M
window empty, which reads as a broken filter rather than as stale data. Anchoring to the newest
row means a preset always shows something whenever the table has rows at all.

### "All" is the absence of a window, not a window over everything

`windowFor` returns `null` for `all` (and when no row carries a date), and `filterByRange`
treats `null` as "keep every row". The distinction exists for undated rows: a trade IBKR reports
without a timestamp cannot be shown to fall inside a chosen period, so it drops out while a
period is active — but a window spanning the full extent would drop it too, which would make
"All" quietly lossy. Returning `null` keeps the story's fourth criterion literal: clearing back
to All restores every row, including the ones that can't be placed in time.

A custom window's end runs to the close of the chosen day. Trades carry a time of day, so a
window ending at midnight would exclude the very day the owner picked. This lives in `windowFor`
rather than `boundsFor` precisely so the Performance charts — which read a value *at* an
instant — keep the behaviour they shipped with.

### Period narrows first, types narrow that, the count reports both

The tables apply `filterByRange` then `filterByTypes`, so the two filters intersect. Two
consequences are deliberate:

- The type chips stay derived from **all** rows, not the in-range ones. Deriving them from the
  filtered rows would make a chip vanish while it is selected, leaving an active filter with no
  visible control to clear it.
- `TypeFilter`'s count switches from "are any types selected?" to "are any rows hidden?", so it
  reads "12 of 340 shown" when only the period is narrowing. The Clear button stays tied to the
  type chips alone — it is that control's own reset, and the range has its own "All" preset.

## Consequences

Benefits:

- Filtering stays pure presentation over already-loaded rows: no new IPC channel, no refetch,
  no service change, and the new logic is unit-tested in `lib/dateRange` without rendering a
  component (which the Node-environment test setup could not do anyway).
- The Performance view loses ~50 lines of inline markup and state to shared controls, so a
  future change to how periods look or behave lands in one place.

Tradeoffs:

- Both filters live in the table's panel header, which is now busier; on a narrow window the
  controls wrap onto a second line.
- Each table holds its own independent selection. Switching tabs does not carry the period
  across, and the aggregate panels above the tables (totals, charts, by-ticker breakdowns) stay
  whole-history — the story scopes the filter to the tables, and the Performance charts have
  their own range bar.
- The range is per-session state; it resets to "All" on reload, like the type filter.

## Alternatives Considered

### Have the tables import the presets from `performanceRange`

Zero refactoring, identical behaviour. Rejected on naming alone: after this story the presets
are not a Performance concept, and a module whose name says otherwise is the kind of thing that
gets duplicated later by someone who doesn't think to look there.

### Filter in the service, by passing the window over IPC

Would scale to histories too large to hold in the renderer. Rejected as premature: the rows are
already loaded and number in the hundreds, the analytics services return whole-history reports
by design ([[0005-analytics-read-model-and-base-currency-conversion]]), and a round trip per
click would make the filter feel slower than it is.

### Keep undated rows visible under every period

Simpler rule, no rows ever "disappear". Rejected: showing a row of unknown date inside a chosen
window asserts something the data doesn't support — the same honesty rule that makes an
unaccountable share count render "—" rather than a number ([[0016-dividend-shares-held-and-per-share]]).

### Derive the type chips from the rows in range

Would stop the chips offering types with no rows in the current period. Rejected because a chip
can then disappear while active, stranding a filter the owner can't see to undo; an empty result
with visible controls is easier to recover from than a missing control.

## References

- GitHub Story #75, Epic #4 (M3); references #32, #33, #69, #73
- [[0013-performance-twr-curve-and-chart-tabs]]
- [[0005-analytics-read-model-and-base-currency-conversion]]
- [[0016-dividend-shares-held-and-per-share]]
