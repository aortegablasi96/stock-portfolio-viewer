# 0058. One page header, owned by the shell that already owns the states

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The Figma Make proposal Epic #179 adopts opens every view with the same block: a page title on the
left, and on the right a provenance line — *Live from Interactive Brokers* for Portfolio, *From
imported Flex Query data* for the four analytics views — over the reading time and the view's
primary action.

Story #185 was written on the premise that only one view had a title at all. That is not quite what
the code said, and the correction is worth recording because it changes what the story is *for*.
The four analytics views did have a title: `App.tsx` wrapped each analytics panel in a local
`AnalyticsPage` component that rendered `<main className="dashboard">`, an eyebrow, an `<h1>` and a
provenance line — a byte-for-byte second implementation of `PortfolioDashboard`'s own
`.dashboard-header`. So the defect was not a missing header. It was **the same header written
twice, in two components, in two files, neither of which is the one that decides what a view
renders** — the shape [[0043-analytics-view-shell]] had already found one tier down and fixed, left
standing one tier up.

Three things followed from where those two copies sat.

**The reading time was not in either of them.** `RefreshBar` drew it in a row of its own
(`.view-toolbar`) *below* the header, inside the shell's loaded branch, and carried a negative
bottom margin to stop that row reading as a band of its own — a workaround for being in the wrong
place.

**The Portfolio view had no reading time at all.** `RefreshBar` is an analytics control, and the one
view that reads live data — the one where "how old is this?" is least obvious — was the one view
that never answered it.

**A header outside the shell cannot see the shell's states.** `AnalyticsPage` happened to render the
title in all four branches because it wrapped the shell from outside. Nothing said it had to, and
nothing would have failed if a later story had moved it inward.

## Decision

**One `PageHeader` primitive, rendered by `AnalyticsShell` for the four analytics views and by
`PortfolioDashboard` for the fifth. `AnalyticsPage` and `RefreshBar` are deleted.**

```tsx
<PageHeader title="Performance" source={IMPORTED_SOURCE} loadedAt={…} refreshing={…} action={…} />
```

### The shell owns the page box, not just the header

`AnalyticsShell` now renders `<main className="dashboard">` and the header *above* its four-way
switch, so the header is outside the branch rather than inside it. That is the mechanism behind the
story's sharpest criterion — **the title renders in every branch, including `error` and
`needs_import`** — and it is a mechanism rather than a convention: there is no branch a view could
be in where the title is not already on the page. A view that failed to load still says which view
it is.

Taking the `<main>` is what makes that possible, and it is also what lets `App.tsx` stop knowing
anything about how a view is laid out. `panel()` now wraps the view and nothing else.

### The status row is optional, and the unloaded states deliberately have no action

`title` and `source` are what a view always knows about itself. `loadedAt` and `action` are what
only a *loaded* read has, so the three unloaded branches pass neither and the row is absent rather
than empty.

That is a judgement, not a fallout. The header could carry a Refresh button in the error branch —
but the error branch already carries Retry inside the `StatePanel` that explains the failure, and
`needs_import` carries its own import action, so a header action there would be a second control for
one job. [[0038-state-panel-primitive-variant-and-surface-axes]] puts the recovery action in the panel that explains the
state, and this keeps it there.

### Three nouns, because one view disagrees with itself three ways

[[0043-analytics-view-shell]] already split `subject` from `refreshLabel` because they coincide for
three views and differ for the fourth. `title` is the third axis and the same argument: trade
history is titled *Trades & realized gains*, loads *trade history*, and refreshes *trades and
realized gains*. Deriving any of the three from another would silently rename one of them, which is
precisely what happened to the pair before them.

### `RefreshBar` is dissolved rather than nested

The alternative — keep `RefreshBar` and give `PageHeader` a slot for it — would have left two
components able to render a reading time, which is the duplication this story exists to remove one
tier up. Its two elements moved intact: the `role="status"` live region, the `Refresh` button's
`aria-label`, its `disabled={refreshing}`, and the non-destructive re-read behind it are unchanged
([[0027-analytics-views-persist-and-explicit-refresh]]). What it lost is a row of its own and the
negative margin holding that row against the content.

### `readingLine` tests `loadedAt` before `refreshing`, which is a generalisation

`RefreshBar` asked `refreshing` first, and could: it only ever rendered from the loaded branch,
where `loadedAt` is never null. Portfolio has no such branch — it renders one header over all five
of its own states — so it is busy *before* anything has been read, and "Refreshing…" there would
report on a reading that does not exist. Empty until there is one.

### The shell still holds no state

Nothing about the header is stateful. `AnalyticsShell` adds no `useState`, no `useEffect` and no
memoization, so [[0027-analytics-views-persist-and-explicit-refresh]] is untouched: `loading` is
still the first load only, a re-read still keeps the figures on screen, and every bit of view-local
state — range selection, chips, map mode — is still in the view above the shell.

`PortfolioDashboard` does gain one `useState`: `loadedAt`, written only where `state` is set to
`ok`. That is the rule `useAnalytics` already follows, and it matters — a failed read tells you
nothing about how old the last good one is, and dating an error would age figures that never
arrived. The sidebar's gateway badge is the counterpart that *does* report failures
([[0056-sidebar-context-rail]]): it answers "is the source answering?", where this answers "how old
is what I am reading?".

### The eyebrow is dropped

The prototype prints `STOCK PORTFOLIO VIEWER` in accent caps above every page title. The title bar
is the app's banner and carries the app name ([[0011-custom-frameless-window-shell]]), and since
[[0056-sidebar-context-rail]] the sidebar's brand tile carries it again. A third copy would name the
app three times per screen and the view once. `.eyebrow` leaves the stylesheet with it; the
`--accent` call-site count in `app.css` and `contrast.ts`'s pairing description are amended in place
rather than recounted, since the ratio that settled that token's value is what those record.

### Heading levels

One `<h1>` per view — the panel's heading — with `CardTitle` and `StatePanel` staying `<h2>` beneath
it. The title bar's app name is a `<span>`, not a heading, so nothing sits above the view title.
Four of the five `<h1>`s are inside `hidden` panels and therefore out of the accessibility tree, so
a heading list reads exactly one view at a time even with five mounted.

## Consequences

Benefits:

- The header exists once. A sixth view inherits it by naming itself.
- The title is unconditional by construction, so no future branch can lose it.
- The Portfolio view answers "how old is this?" for the first time, in the same words and the same
  place as the other four.
- `.view-toolbar` and its negative margin are gone; the header is one block, not a block and a
  trailing row.

Tradeoffs:

- `AnalyticsShell` now takes three nouns. Three string props is more surface than two, and the
  reason lives in one view's disagreement with itself.
- The shell owning `<main>` means an analytics view can no longer choose its own page container.
  Nothing wanted to, and `App.tsx` deciding it was the arrangement this story removed.

Risks:

- The provenance line is a *claim about a data source*, written in the shell rather than by the view
  that reads it. `lib/pageHeader.test.ts` pins both sentences and fails if any view spells either
  out again, so a view that changes what it reads cannot quietly disagree with its own header — but
  nothing can check that the sentence is *true*.

### Guards

Three, at the three tiers the codebase already uses:

- `lib/pageHeader.test.ts` — the wording (`readingLine`, both provenance sentences), plus a
  comment-stripped scan of all six files for a re-declared sentence.
- `lib/analyticsShell.test.ts` — the composition guard from [[0043-analytics-view-shell]], extended
  to `<PageHeader`, `<main`, `<h1>` and `className="dashboard"`, and to `App.tsx` itself.
  **It now strips comments first**, which it did not before, and it walked straight into that trap
  the moment these guards were added: `App.tsx` explains in prose that `AnalyticsPage` is gone, and
  an unstripped read failed on the sentence saying so. Recorded twice already
  ([[0042-token-adoption-ratchet]], [[0047-allocation-map-is-a-group]]) and now a third time.
- `e2e/page-header.spec.ts` — what only a real document can show: five views with one header each,
  the title surviving a branch with no report, `role="status"` where a reading exists and no second
  action where none does, exactly one exposed `<h1>`, and the app named twice rather than five
  times.

## Alternatives Considered

### Keep the header in `App.tsx`, and give it the reading time

`App` would have to know each view's `loadedAt` and `refreshing`, which live inside the view's
`useAnalytics`. Lifting them means the shell — or the app — holds view state, and that is the one
thing [[0043-analytics-view-shell]] and [[0027-analytics-views-persist-and-explicit-refresh]]
between them forbid.

### Keep `RefreshBar`, nested inside the header

Less churn, and rejected: two components able to draw a reading time is the duplication being
removed, and Portfolio's action is `Capture now` rather than `Refresh`, so the bar would have had to
grow a slot for its own button and stop being a refresh bar.

### Derive the title from `subject`

`'performance'` → `'Performance'` works for three views and produces *"Trade history"* for the
fourth, whose page is called *Trades & realized gains*. A rule that is right three times out of four
is a rename waiting to happen.

## References

- Story #185, Epic #179 — the redesign's shared surfaces
- [[0043-analytics-view-shell]] — the shell this extends, and the tier the duplication sat above
- [[0027-analytics-views-persist-and-explicit-refresh]] — `loading` vs `refreshing`, and why the
  shell holds no state
- [[0038-state-panel-primitive-variant-and-surface-axes]] — the recovery action belongs to the panel that explains the state
- [[0056-sidebar-context-rail]] — the gateway badge, the counterpart question to the reading time
- [[0011-custom-frameless-window-shell]] — the title bar as the app's banner
- [[0031-design-token-scales]], [[0042-token-adoption-ratchet]] — the scale the header's spacing comes from
