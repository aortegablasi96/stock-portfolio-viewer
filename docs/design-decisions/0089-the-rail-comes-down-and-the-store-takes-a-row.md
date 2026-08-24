# 0089. The rail comes down, and the imported store takes a row

- **Status:** Accepted
- **Date:** 2026-08-24
- **Amends:** [[0062-portfolio-rail-and-weight-bars]]

## Context

Story #189 gave the Portfolio view a `1fr / 260px` pair: the holdings table beside a rail carrying
an **Allocation** list and a **Data sources** card, with the stored statements full width below
([[0062-portfolio-rail-and-weight-bars]]). Story #266 takes the rail down. The owner asked for it
as two changes — the table should have the page's full width, and the Flex import should sit at the
same level as Stored statements — and reading the code before writing the issue turned up a better
argument for the first half than "wider is better".

**The allocation list had become a second drawing of a column already on screen.** Story #189 put a
weight percentage and a micro-bar in the table itself, scaled through the same `lib/weightBars`, so
the rail repeated per position exactly what the row beside it said. [[0062-portfolio-rail-and-weight-bars]]
records that as a feature — one scale, drawn twice — and it was the right call while the two
drawings said different things (a sorted table beside a largest-first list). What changed is the
table: Story #263 added a seventh column ([[0087-the-holdings-table-says-what-a-position-made]]) and
Story #266's own predecessor gave the second column real company names
([[0088-a-live-holding-is-named-by-imported-history]]). Seven columns is what was paying the rail's
260px, and the thing being paid for was a repeat.

**The data-sources card was in the rail for no reason of its own.** It was there because the rail
existed. Its subject is the imported store, which is exactly what Stored statements lists — the
same data described once as a coverage span with the two controls that change it, and once as the
rows behind that span. They were in different bands with the allocation list between them.

## Decision

### The holdings table takes the page, and the allocation list is deleted rather than moved

The grid goes; `.col-main` and `.col-side` go with it. Whatever the live read produced — the table,
an empty account, or one of `loading` / `not_connected` / `not_responding` / `error` — renders
directly into `.dashboard`, which is already a column, so a column of one is the width of the page.
A one-child grid left behind would be the removed arrangement drawn invisibly, which is why the
guard asserts all three names are gone from both the component and the stylesheet.

**No allocation figure is lost, which is the whole basis for deleting rather than relocating.**
Every position keeps its Weight percentage and its micro-bar, on the same scale, still derived from
`allocation` rather than from the rows on screen — a sortable table must not silently rescale its
bars. What the rail announced through a `role="meter"`, the table announces as a figure under a
`Weight` column header; the micro-bar stays `aria-hidden`, because a meter per row would double the
table's length to hear for a number already spelled out beside it
([[0048-tab-icons-as-a-second-channel]]).

`lib/weightBars` stays, narrowed: `weightBarScale` and `weightBarFill` are what the table calls, and
`weightBars()` — which ordered a whole set largest-first — goes with the list that needed an order.
The floor and the max-scaling rule are untouched, and the two edge cases
[[0062-portfolio-rail-and-weight-bars]] names are re-asserted over the two functions that remain, so
the rule keeps its tests after the helper that carried them is gone.

### The store's two cards are one row, and the row is a sibling of the live states

`.dashboard-sources` pairs **Stored statements** (flexible) with **Data sources** (fixed), the app's
third instance of an idiom it already had twice — `minmax(0, 1fr)` beside a fixed track, `align-items:
start`, a `--space-7` gap ([[0063-allocation-breakdown-pair-and-dark-basemap]] has the other). Fixed
for the reason [[0062-portfolio-rail-and-weight-bars]] gave: the card is read at a glance and stops
needing width, so every pixel the window gains goes to the half with figures to line up.

**The card is on the right, and the statements on the left.** It is where the eye last found it, and
it keeps the app's one convention about these tracks — the narrow fixed one is on the right, in both
existing cases.

[[0062-portfolio-rail-and-weight-bars]]'s load-bearing property survives *by construction* rather
than by placement. The rail rendered outside `state.phase === 'ok'` because imported Flex history is
local and has never needed the gateway, and a dashboard that hid the import button whenever IBKR was
unreachable would hide it precisely on the day importing is the useful thing to do. The row is a
sibling of the live-state block, so no branch can contain it; the guard is that the row's own span
of the source mentions no `state.phase` at all, and the Playwright spec still runs with **no
gateway** and clicks the import controls under a `not_connected` panel.

`SnapshotHistory` stays last on the page, and `ImportReceipt` moves to directly under the row whose
button produces it.

### The card's width is measured, not reasoned about

`--rail-width: 260px` is retired — a structural measure with no consumer is one a later story reaches
for and mis-reads — and `--sources-width: 416px` replaces it. It is the first of these four tokens
whose number comes from its **own content** rather than from the redesign: the two controls stand
beside each other now, because Story #189 stacked and stretched them only for the reason its own
stylesheet gives, *"in a 260px rail there is no beside"*.

400px was tried first and **wrapped**. "Import statements…" renders 190.4px and "Clear statements"
165.4px at `--control-pad-md`, which with the `--space-3` between them is 364px of content; inside
`--surface-pad-md` either side and the card's own hairline that is 406px. A glyph advance is not
something a comment can promise, so `e2e/portfolio-layout.spec.ts` measures the two buttons' tops
and fails if they ever stop sharing a line — the same class of check as
[[0051-performance-chart-grid]]'s derived gutter, and it caught the first number
rather than shipping it.

416px is 26rem, which is the cap `.confirm-action` has always carried. That is a coincidence rather
than a derivation — the buttons bind, not the cap — but it is the useful one: this is the first
place the shared confirm has fitted with **no `max-width` override fighting it**. Three of Story
#189's four overrides go, and the one that remains is the one width never answered: the card's copy
reads from the left where the control's home is a right-aligned card header
([[0012-in-place-destructive-confirm]]). `flex-wrap: wrap` is what makes a row work for an
expand-in-place control — armed, the confirm is a block of warning copy that cannot fit beside the
Import button, so it takes the next line, which is where the stacked column put it anyway.

The breakpoint is derived and the test does the arithmetic: 220 + 64 + 416 + 24 + 480 = **1204px**,
the sidebar expanded, both content paddings, the card, the gap, and 480px left for the
stored-statements table before it scrolls inside its own card. Below it the cards stack, statements
first, each taking the full column.

## Consequences

- The Portfolio page is one column of full-width blocks with a single two-column row in it. The
  holdings table gains 284px at the default window — the rail plus its gap — which is what a
  seven-column table with a Company name in it was short of.
- `AllocationPanel.tsx` is deleted, and `.allocation-list` / `-row` / `-head` / `-symbol` /
  `-weight` leave the stylesheet with it. `.allocation-weight` leaves the **figure role**, which is
  one rule listing its selectors ([[0053-bundled-typefaces-and-the-figure-role]]) — `figureRole.test.ts`
  enumerates that list, so the removal is stated there rather than discovered later.
- **Live per-position weights are now shown in exactly one place.** The Allocation *view* is
  untouched and is unrelated: it reads imported Flex history, not the live gateway.
- The stacking breakpoint rises from 1128px to 1204px, 76px under the window's default width. The
  page has no fixed 260px column any more, so the width that used to bind — a 560px table beside the
  rail — is not the one that binds now; the new spec checks the window's own **minimum** (940px,
  read off the live `BrowserWindow` rather than written as a literal) for sideways scroll and for
  both controls still being reachable.
- Four guards in `lib/portfolioLayout.test.ts` are **turned around, not deleted**. A guard that
  fails because the layout changed is doing its job, and the decisions underneath it — the import
  survives a dead gateway, one scale for the bars, one in-place confirm — are the same ones. Two are
  added: that the rail's three class names are gone from component *and* stylesheet, and that the
  controls no longer stack.
- Stated gap: the full-width **holdings table** is still not pinned on screen. It renders only in
  `ok` and the e2e suite deliberately runs with no gateway
  ([[0087-the-holdings-table-says-what-a-position-made]] records the same gap for its card strip).
  What the spec measures instead is the `not_connected` panel filling the same slot, which is the
  same measurement of the same column.

## Alternatives considered

- **Moving the allocation list somewhere else on the page.** It is a repeat of a column in the table
  above it; a repeat in a new place is still a repeat, and the one below the fold would be worse.
- **Keeping the rail and widening it.** The rail's remaining tenant is a card that stops needing
  width, and the table's problem was the 260px, not the arrangement.
- **Data sources on the left, statements on the right.** Reads as summary → detail, which is
  defensible, but it moves the card across the page and breaks the one convention these fixed tracks
  have (`.dashboard-columns` and `.breakdown-split` both put it on the right).
- **A fractional pair (`1fr 1fr`, or `2fr 1fr`).** Widens a coverage sentence and two buttons on a
  large monitor to no purpose, and takes it from the table — the argument
  [[0062-portfolio-rail-and-weight-bars]] and Story #191 both made for a fixed track.
- **Leaving the controls stacked in a wide card.** The stack was a consequence of the rail's width,
  stated as such in its own rule; carrying it into a 416px card would keep a workaround past the
  constraint that caused it.
- **Deriving the card's width from a character budget instead of measuring it.** The budget would
  have given 400px, which is the number that wrapped.
- **Deleting the four failing guards instead of re-stating them.** This is how a decision is lost:
  the tests were written for promises that outlive the layout expressing them.
