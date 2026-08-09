# 0043. One shell for the analytics views' four states: a render prop, not a base component

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

Epic #125 consolidated the recurring *elements* — button, card, tile, field, toggle, badge, state
panel, table. The same duplication existed one tier up, in composition, and no primitive addresses
it: all four analytics views opened with a byte-equivalent four-branch guard, differing only in one
noun.

```tsx
if (state.phase === 'loading')  return <StatePanel variant="loading">Loading {subject}…</StatePanel>
if (state.phase === 'error')    return <StatePanel variant="error" heading={`Couldn’t load ${subject}`} action={<Retry/>}>…
if (state.result.status === 'needs_import') return <NeedsImport />
return <div className="analytics-view"><RefreshBar label={subject} …/> …
```

Four copies of the retry button, its `disabled={refreshing}`, its "Retrying…" label, the wrapper
element and the `RefreshBar` prop set. `DividendsView` had **five**: its "no dividend income
recorded" path restated the wrapper and the refresh bar a second time, which is the drift starting —
that path was one edit away from disagreeing with the other four about what a refresh bar looks
like on a page that has none of the data it describes.

This is the shape the Epic's audit called "a control invented twice", at the view level rather than
the control level, and it is the tier where the Node-only Vitest constraint
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]) bites hardest: nothing inside a component
can be asserted, so four hand-written copies of one guard had nothing checking they stayed the same.

## Decision

**`AnalyticsShell` renders all four states, and a view supplies a subject noun and a function of the
report.**

```tsx
<AnalyticsShell<PerformanceReport> subject="performance" analytics={analytics}>
  {(r) => <>…</>}
</AnalyticsShell>
```

The shell owns the guard, the three unloaded states, the retry action, the `.analytics-view` wrapper
and the `RefreshBar`. A fifth analytics view inherits all of it.

### A render prop, because the loaded branch must not evaluate early

The children are a **function of the report**, not elements. A `children: ReactNode` shell would
force every view to compute its loaded body — formatting, windowing, chart geometry — before the
shell decides whether there is a report at all, on a `state.result.report` that does not exist in
three of the four states. The function is what defers that, and it is also what hands the view a
`Report` rather than an `ok | needs_import` envelope it would have to re-unwrap.

### The branch mapping is a pure module, and so is the wording

`lib/analyticsShell.ts` flattens the two nested discriminants — the hook's `phase`, then the
result's `status` — into one `AnalyticsBranch`, and derives the three strings from the noun. That is
the only logic the shell has, so it is the only part that can be got wrong, and it is now the part
under test. `analyticsShell.test.ts` pins the mapping and the exact characters, including the
typographic apostrophe in "Couldn’t" and the ellipsis in "Loading …" — the first things four hand-
written copies drift on.

The test also reads the four views as text and fails if any of them re-declares `phase === 'loading'`,
`status === 'needs_import'`, `<NeedsImport`, `className="analytics-view"` or `<RefreshBar`. That is
the same shape as the primitives' "a superseded selector must not reappear" assertions
([[0032-button-primitive-variants-and-sizes]] and the seven that follow), one tier up: the guard
against re-inventing what was just consolidated.

### `subject` and `refreshLabel` are two axes, because they disagree once

The unloaded states are written from the subject ("Loading trade history…"), and the refresh bar
names what it refreshes ("Refresh trades and realized gains"). Those coincide for three views and
differ for the fourth, so `refreshLabel` defaults to `subject` and `TradeHistoryView` is the one
call site that passes both. Collapsing them would have silently renamed one of the two.

### The shell holds no state, which is what keeps DDR-0027 intact

Analytics tabs stay mounted ([[0027-analytics-views-persist-and-explicit-refresh]]), and every bit
of view-local state — range selection, chart tab, type chips, map colour mode — stays in the view
**above** the shell, exactly where it was. The shell adds no `useState`, no `useEffect` and no
memoization, so there is nothing new that could discard it: `loading` still means the first load
only, `refreshing` still drives the non-destructive re-read, and a returning tab still shows what it
showed.

### The view still calls `useAnalytics`; the shell does not fetch

The fetcher and the report type are the view's. Folding the hook into the shell would have made the
shell decide *what* to read, which is the one thing that genuinely differs between the four. What
moved into `lib/analyticsShell.ts` is only the hook's *types* (`AnalyticsState`, `AnalyticsLoad`),
so the pure module can name its own input; `useAnalytics` re-exports them and its behaviour is
untouched.

### `DividendsView`'s empty path composes inside the shell

"No dividend income recorded" is a state of the *report*, not of the read — a dividend can be
announced before one has ever been paid — so it is an early return inside the render prop, above the
rest of the view. It keeps its documented behaviour: the upcoming panel still renders there. What it
loses is its private copy of the wrapper and the refresh bar.

## Consequences

- Adding a fifth analytics view means naming a subject and rendering a report. The four states, the
  retry, the wrapper and the freshness bar arrive with it.
- The four views shed ~120 lines between them, and every string a state shows exists once.
- A view's body is now indented inside a callback. That is the visible cost of the render prop, and
  it is why each view keeps a one-line comment saying what stayed above the shell and why.
- The `AnalyticsShell<Report>` type argument is written explicitly at all four call sites: inferring
  `Report` out of a union member (`{ status: 'ok'; report: Report }`) is exactly where TypeScript's
  inference is weakest, and an explicit argument makes the mismatch an error at the call site rather
  than a widened `unknown` inside the callback.
- Verified by pixel diff at 1400×1000 against the owner's real imported history, since no test can
  see a layout shift. All four views are byte-identical in size, and the only differing pixels
  (102 of ~2.7M, on every view, in the same 9-pixel band) are the clock inside "Updated 2:08 PM" —
  the two runs were five minutes apart. The `.analytics-view` wrapper's children — tag, class and
  height — are identical across every view.

## Not Included

- **The Portfolio dashboard.** It is deliberately outside the analytics staleness model
  ([[0027-analytics-views-persist-and-explicit-refresh]]) and re-reads on every visit because it
  shows live IBKR data. Folding it into an analytics shell would blur exactly that distinction, and
  it has no `needs_import` state to render.
- **`useAnalytics`' behaviour.** The hook already existed and was already shared; this is about what
  the views do with its result.
- **Any change to the four result contracts**, the `ok | needs_import` variants, or the IPC channels
  behind them.
- **A shared page header.** The `<h1>` and the "From imported Flex Query data" lede live in `App`,
  above the panel, and are already declared once.

## Alternatives Considered

### A base component the four views extend, or a HOC

Rejected. Inheritance and `withAnalytics(...)` both hide where the report enters, and a HOC would
have to thread the fetcher, the report type and the subject through a wrapper's props anyway. The
render prop states the same thing with the data flow visible at the call site.

### `children: ReactNode`, with the view computing its body first

Rejected on correctness, not taste: three of the four states have no `report`, so every view would
have to guard *again* before building the children it passes in — which is the duplication this
removes, moved one line up.

### Fold `useAnalytics` into the shell, so the view passes only a fetcher

Rejected. It reads well until a view needs the hook's result for something other than rendering —
`AllocationView` passes `reload` to `ClassifySectors`, which is not part of any of the four states —
and the shell would then be handing back through the render prop what the view had just given it.

### Give the shell a `variant`/`size` axis pair, like the primitives

Rejected. Those axes describe how one element *looks*; this composes four states of a page, and both
axes would have exactly one value. The axes that earn their place here are `subject` and the one
place it disagrees with `refreshLabel`.

### Let `DividendsView`'s empty path stay outside the shell

Rejected — it is the specific drift the story names. Its wrapper and refresh bar were a second copy,
and a second copy of the thing being consolidated is the thing being consolidated.

## References

- Story #153, Epic #125.
- [[0027-analytics-views-persist-and-explicit-refresh]] — mounted views, `loading` vs `refreshing`,
  and why the Portfolio tab is excluded.
- [[0038-state-panel-primitive-variant-and-surface-axes]] — the four states as one primitive, and
  which of them announce.
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — why view logic lands in
  `renderer/src/lib/`.
- [[0032-button-primitive-variants-and-sizes]] — the "a superseded thing must not reappear" test
  shape this borrows.
- [[0022-gateway-timeout-and-not-responding-state]] — why a failure is a result variant the shell
  can render, not an exception.
- `src/renderer/src/lib/analyticsShell.ts`,
  `src/renderer/src/components/analytics/AnalyticsShell.tsx`.
