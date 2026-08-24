# 0085. YTD anchors to the data, and joins the one vocabulary

- **Status:** Accepted

- **Date:** 2026-08-24

## Context

The time-range presets are `1M / 3M / 1Y / All / Custom`, and they are a **shared vocabulary**:
`RangeFilter` renders one list — `RANGE_OPTIONS` in `lib/dateRange.ts` — for Performance, Dividends
and Trades alike, so "1M" means one window everywhere by construction rather than by three
implementations agreeing. The module was extracted out of `performanceRange` for exactly that
reason when the tables adopted the presets ([[0017-analytics-table-time-range-filter]]).

Seeing the year so far currently means choosing `Custom` and typing two dates, one of which is
always 1 January. It is the most-typed custom window there is.

**Every existing preset is a trailing window**, and every one of them anchors to `extent.to` — the
latest *data point*, not today. That is deliberate and load-bearing: this app reads imported Flex
history, and a statement exported last month would leave a "1M" anchored to now completely empty.

YTD is the first **calendar-anchored** preset, which is why it does not fall out of the existing
arithmetic. Its start is 1 January of the year containing its anchor — and the anchor has to be
*stated*, because for the first time the two candidate anchors disagree in a way a reader can see.
They agree in the normal case. They diverge whenever the imported history stops in a previous year,
and there the difference is not a slightly different window but a window with nothing in it.

Two consequences follow whichever way it is decided: the control grows from five buttons to six,
and a range is consumed two ways — charts slice a series with `boundsFor`, tables filter rows with
`windowFor`.

## Decision

### The anchor is the latest data point, exactly like every other preset

`ytd` resolves to `[max(1 January of the year containing extent.to, extent.from), extent.to]`.

Two reasons, and both are about the anchor rather than the arithmetic.

The first is that `boundsFor` is a **pure function of its arguments**. Reading `Date.now()` inside
it would make the app's one range resolver depend on a clock, and its entire contract — six ids,
two consumers, four edge cases — is currently asserted with plain equality and no time to freeze.
Every preset would have paid for the one that needed it.

The second is what the divergent case actually looks like on screen. Anchored to the data, a
history ending 30 November 2023 gives `2023-01-01 → 2023-11-30`: the tail of the last year that has
data, which is the same thing `1M` and `3M` already do with the same history. Anchored to today it
gives an empty window — a chart drawing nothing and a table with no rows, from a control that
reports no error, with no way for a reader to tell a preset with no data from a portfolio with no
data. One of those is defensible and the other is a trap.

The label discloses this rather than papering over it. The button reads **YTD**; its `title` reads
**"Since 1 January"**, not "Year to date" — because in that same history the window is *that* year's
1 January, which "to date" would overclaim. The neighbouring titles ("Last month", "Last 3 months")
already describe the window rather than promise a relationship to now.

### It joins the vocabulary — all three views, no per-view mechanism

`RANGE_OPTIONS` grows by one entry and `RangeFilter` keeps rendering it unfiltered. Dividends and
Trades get YTD too, which is the point rather than a side effect: "dividends received this year" and
"trades this year" are the same question the Performance view is being asked, and both are natural
things to want from a table that already sorts and filters.

A Performance-only option was the alternative, and it costs a mechanism the app does not have —
either a `views` field on `RangeOption` or a filter prop on `RangeFilter`, plus the first case of
"1M is the same everywhere but YTD is not". That is a divergence in the one thing the module was
extracted to prevent, bought to withhold a useful window from two views.

### It sits after `1Y`, because the group is ordered by kind and not by length

`1M / 3M / 1Y / **YTD** / All / Custom`.

Length would put it between `3M` and `1Y`, and that was the first proposal. It is wrong for the
reason the run is legible at all: `1M`, `3M` and `1Y` are **one run of trailing windows**, read as a
sequence. Interleaving the single calendar-anchored preset breaks the run to make the odd one out
look like a member of it — and puts a window that is sometimes eight months and sometimes one day
between three that are always exactly what they say. After `1Y` it reads as what it is: a window of
its own, before the two entries that are not periods at all.

### `boundsFor`'s `switch` loses its `default`

It was `case 'all': default: return extent`. With a declared return type and no `default`, a missing
case is a **compile error** (TS2366, verified by removing one) rather than a new id silently
resolving to the full extent — which is the failure that ships, because a window over everything
looks like a plausible chart.

### Nothing else about a window moves

`windowFor` extends only `custom` to the close of its end day, and `ytd` is not extended: a custom
window's edges are days the owner typed, where a preset's `to` is a real timestamp off the data, and
pushing it past the latest row would claim a window the history does not cover. `1M`, `3M`, `1Y` and
`All` keep their anchors and their clamping, asserted alongside the new ones.

## Consequences

- **The year so far is one click**, in the three views that offer a range, instead of `Custom` and
  two typed dates.
- **A history ending in an earlier year has a defined outcome** — that year's 1 January through its
  last point — and it is the case with its own test, named as such.
- **`boundsFor` still needs no clock.** Every case below is an equality assertion, including the
  year boundary and the 1 January anchor, and none of them can rot on 1 January.
- **A seventh preset is a decision, not a diff.** The presets are at six of the roughly seven that
  fit at the minimum window width, and `e2e/range-presets.spec.ts` measures the seventh so the next
  story finds out before it ships two rows.
- **Every value is a token or a primitive axis.** The button is a `ToggleGroup` item in `single`
  mode wearing the control corner ([[0036-toggle-group-mode-axis-and-pressed-semantics]]); no CSS was written, the
  adoption ratchet's `BASELINE` stays empty and `EXEMPTIONS` does not grow
  ([[0031-design-token-scales]], [[0042-token-adoption-ratchet]]).
- **The vocabulary assertion moved to where it belongs.** `performanceLayout.test.ts` pinned the
  exact five-id list as a side effect of asserting that `Custom` is not a separate control; it now
  asserts that claim directly (`Custom` is last, and appears once) and `dateRange.test.ts` owns the
  list.
- **It is pinned where it can be seen.** Six labels have a width, and no Node test can measure one —
  Vitest runs with no jsdom. `.toggle-group` and `.range-bar` both wrap, so an overflowing group
  does not fail: it quietly becomes two rows and puts `Custom` under `1M`. The e2e spec measures
  distinct row tops at the window's **own** minimum width, read back off the live `BrowserWindow`
  rather than written as a literal, and carries a **negative control** — a run of deliberately wide
  labels that must report more than one row, because `rows` is derived from a rounded `top` and a
  broken measurement would report `1` for everything.

## Alternatives Considered

### Anchor YTD to today

Rejected, and it is the decision this record exists to state. It is what "year to date" means in
speech, and it is the reading that makes the control lie about the data: in a history that stops in
a previous year it resolves to an empty window, from a preset that reports success. It would also
put a clock inside the app's one range resolver, for the sake of the one preset that appears to want
it.

### Offer both — "YTD (data)" and "YTD (today)"

Rejected. Two buttons to express one idea, five words of tooltip to explain the difference, and the
second of them still resolves to nothing in the case that motivated the split.

### Performance-only, with a per-view mechanism on `RangeFilter`

Rejected. It buys a `views` field or a filter prop to *withhold* a window from two views that want
it, and it makes the shared vocabulary conditional — the exact divergence
[[0017-analytics-table-time-range-filter]] extracted the module to prevent.

### Place it between `3M` and `1Y`, ordered by length

Rejected on the owner's call, and the reasoning holds: the three trailing presets are one run, and
interleaving the calendar-anchored one makes it look like a member of that run rather than the
exception it is.

### Keep the `default` and add `case 'ytd'` beside it

Rejected. It works for this story and hides the next one: a seventh id added to `RangeId` and
forgotten in `boundsFor` would resolve to the full extent, which draws a chart rather than an error.

### A named-year or quarter picker

Out of scope by the story. One preset, not a calendar.

## References

* [[0017-analytics-table-time-range-filter]] — the shared vocabulary, and why `lib/dateRange` was
  extracted out of `performanceRange`.
* [[0036-toggle-group-mode-axis-and-pressed-semantics]] — the presets as a single-select `ToggleGroup` wearing the control
  corner; the axis this adds no member to.
* [[0035-field-and-form-control-primitives]] — the custom window's `Field`s and their generated ids, unchanged.
* [[0027-analytics-views-persist-and-explicit-refresh]] — why a range selection survives a view switch, and why all
  three `RangeFilter`s can be in the document at once.
* [[0013-performance-twr-curve-and-chart-hover]] — the performance curve is cumulative TWR, so a window slices it rather
  than recomputing it.
* [[0031-design-token-scales]] / [[0042-token-adoption-ratchet]] — the scale, and the ratchet.
* `renderer/src/lib/dateRange.ts`, `renderer/src/lib/dateRange.test.ts`,
  `renderer/src/components/analytics/RangeFilter.tsx`, `e2e/range-presets.spec.ts`.
* Story #256, Epic #253.
