# 0062. The Portfolio view's rail: the local store beside the live read, and one scale for both weight bars

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The Figma Make proposal Epic #179 adopts restructures the Portfolio view more than any other. It
puts the holdings table and a narrow right rail side by side, and the rail carries an **Allocation**
list of ticker + weight with a thin bar per row, and a **Data Sources** card stating the imported
coverage in a sentence over an import button and a clear button. Below the pair, a full-width
**Stored statements** table. The holdings table itself gains a **micro-bar under each row's weight**.

Every part of that exists here already — `HoldingsTable`, `AllocationPanel`, `BalancesSummary`,
`FlexImport`, `SnapshotHistory`, `ConfirmAction` — so Story #189 is composition and restyle rather
than new capability. What made it more than moving JSX is that the prototype's arrangement collides
with four things this repo has already decided, and two of its own drawings are wrong:

- **It has no snapshot history section at all.** `SnapshotHistory` is a real feature of this view.
- **It draws `Clear statements` as a bare red button**, which is exactly the shape
  [[0012-in-place-destructive-confirm]] exists to prevent.
- **Its import panel is one component**, and the redesign puts its controls in a 260px rail and its
  statement table full width — two different cells of the page's grid.
- **It scales both bar drawings against a hard-coded divisor** (`weight / 30` in the rail,
  `weight / 28` in the table). Two magic numbers that disagree with each other.

The fourth is the one worth stating plainly, because it looks like a detail and is a wrong picture.
`weight / 30` draws a 45% holding and a 32% holding as bars of the same length — both clamp at
full — and draws a portfolio of forty positions as forty stubs. It is the same class of error as
the FIFO aggregate row: a number that is right for the author's own account and wrong for the next
one.

## Decision

### The page is one block, and the Flex panel is inside it

`App.tsx` mounted `<PortfolioDashboard/>` and `<FlexImport/>` as siblings, which made the Portfolio
tab the only panel in the app with two page-length `.dashboard` columns stacked in it. They are now
one: header, KPI tiles, the table/rail pair, then the stored statements, then the history.

`FlexImport.tsx` becomes `DataSources.tsx`, restructured as **a hook plus three presentational
fragments** — `useFlexSources()`, `DataSourcesCard`, `ImportReceipt`, `StoredStatementsCard`. One
component cannot render into two cells of a grid, and hoisting the state into `PortfolioDashboard`
would have put the import's four outcomes into a component that already owns five live-read states.

**The `flexDataVersion` bump lives in the hook**, not in the fragment that kept the button. That is
the load-bearing half of the split: both write paths must keep bumping, because a mounted analytics
view learns that the store changed underneath it no other way ([[0027-analytics-views-persist-and-explicit-refresh]]),
and a bump sitting in whichever fragment happened to keep the control is one refactor from being
left behind by the control. `lib/portfolioLayout.test.ts` asserts both bumps are inside the hook's
own span of the file, not merely somewhere in it.

### The rail renders beside the live states, not inside the `ok` branch

The prototype draws the rail beside a populated table and says nothing about a disconnected
gateway. Folding it into `state.phase === 'ok'` reads as tidying and is the one arrangement that
costs the owner something real: **imported Flex history is local and has never needed the gateway**,
so a dashboard that hid the import button whenever IBKR was unreachable would hide it precisely on
the day importing is the useful thing to do.

So the grid is unconditional. The main column carries whatever the live read produced — a table, an
empty account, or one of `loading` / `not_connected` / `not_responding` / `error`, still four
distinct first-class states ([[0002-connection-state-as-ipc-result]], [[0022-gateway-timeout-and-not-responding-state]]) —
and the rail's data-sources card is beside it either way.

**The allocation list is the one thing in the rail that is gated**, because it is a reading of the
same positions the main column is showing. With nothing to weigh there is no list; with a gateway
that answered there is one.

### `SnapshotHistory` stays, last on the page, under Stored statements

The prototype's omission is an omission in a sketch, not a decision to delete a capability, and
removing one is not this Epic's business. Where it goes was the actual question, and the answer is
**directly below Stored statements**: the two are the app's two local stores, each with its own
`ConfirmAction` reset over the sanctioned whole-store exception (ADR-0006 in `docs/decisions/`), and pairing them puts "what history do I hold, and how do I clear it?" in one
band at the foot of the page.

The rail was the alternative and was rejected on measurement rather than taste: a snapshot row is a
timestamp, a converted total with a native chip and a holdings count on one line, and 260px holds
none of that.

### `Clear statements` keeps `ConfirmAction`, and its tone keeps the text token

Expand-in-place warning with Confirm and Cancel — no modal, no `window.confirm`
([[0012-in-place-destructive-confirm]]). The rail overrides the control's **alignment only**: it is
right-aligned and capped at 26rem where it sits in a card header, and both are wrong against a
column narrower than the cap. The tone, the buttons and the phases stay the primitive's, which is
what `className` is for ([[0032-button-primitive-variants-and-sizes]]).

The loss tone comes from `.btn-danger`, which colours **text** with `--neg-text`. `--neg` is the
fill token and picking the wrong one is silent ([[0046-contrast-split-tone-tokens]]), so the
guard test asserts the resting rule paints nothing rather than asserting it looks right.

### One weight-bar scale, floored, shared by both drawings

`lib/weightBars.ts` is the only place a weight becomes a length, and both the rail and the table go
through it. The denominator is **the larger of the set's own maximum and a 25% floor**:

- **Against the set's maximum**, a 45% holding and a 32% holding draw as 100% and 71% rather than
  as two identical full bars. The prototype's fixed divisor cannot do this.
- **Against a floor**, a portfolio whose largest position is 4% does not draw that 4% as a full
  bar. Max-scaling alone would, and a full bar says "this position is the portfolio".

25% is the point where "the largest holding" stops being a useful yardstick: at or above it, the
top bar filling its track says something; below it, filling the track would say the same thing
about a position that dominates nothing.

The two edge cases the story names fall out of the one rule rather than needing branches of their
own. **A single holding** weighs 1.0, which is its own maximum and far above the floor, so it fills
the track — and that is the honest drawing, because the position really is the whole portfolio and
there is no second bar for it to be compared against. **A tiny largest weight** divides by the
floor, so a 4% top holding draws at 16% of its track and the row reads as small. A non-zero weight
never draws as nothing (a 0.05% position is a hairline, not an empty track), and zero stays zero.

`.allocation-track` / `.allocation-bar` become **`.weight-track` / `.weight-fill`**. The names lose
the panel because the panel is no longer the only thing drawing them, and two class families for
one measure is how the app accumulated the families Epic #125 spent nine stories consolidating.
`.weight-track-micro` is the in-table variant: 3px rather than 8px, and a block so it takes the
cell's width under the right-aligned figure it belongs to.

**The `meter` reports the weight; the micro-bar is `aria-hidden`.** The rail's bar carries
`role="meter"` with the *weight* as its value — the accessible fact is the percentage, never the
scaled drawing of it. The in-table bar announces nothing at all: the figure it sits under is
already spelled out beside it, and a second meter per row would double the table's length to hear
for no information. Same reasoning as the tab icons ([[0048-tab-icons-as-a-second-channel]]).

### The rail is 260px, and it breaks at 1128px

`--rail-width: 260px`, a structural measure beside `--sidebar-width` and `--titlebar-height` for
the same reason those are: it is quoted by the grid that places it and by the media query that
decides when it stops fitting. Fixed rather than fractional because both cards in it are read at a
glance rather than scanned — a coverage sentence and a column of tickers — so a fraction would
widen them on a large monitor to no purpose while squeezing the six-column table on a small one.

The breakpoint is **derived, and the test does the arithmetic rather than trusting the comment**:
the sidebar at its expanded 220px + 2rem of content padding each side + the 260px rail + the
`--space-7` gap + 560px left for the holdings table, which is what its six columns need before the
table starts scrolling inside itself. 220 + 64 + 260 + 24 + 560 = **1128px**. Below it the rail
goes *under* the table and the table takes the full column — the direction matters more than the
number, because the alternative failure is a table squeezed to the point of scrolling inside a
window that had room.

Collapsing the sidebar buys 164px of that back, so the rail returns before the window has to grow —
the same relationship the Performance grid's two breakpoints have to one content column
([[0057-sidebar-collapse-and-the-frameless-corner]]).

## Consequences

- The Portfolio view holds every Portfolio-related control. Nothing else in `App.tsx` mounts a
  second page-length block, and the shell is back to one panel per tab.
- `.flex-import-intro` and `.flex-import-summary` leave the stylesheet with the card header and the
  inline summary they styled. The coverage sentence says in one line what the intro paragraph said
  in four, and the receipt is a card of its own.
- The import is reachable in every gateway state, which is a small behaviour change and the point
  of the placement.
- `lib/weightBars.ts` is a third pure renderer module in the shape `countryDonuts` and
  `chartGeometry` established: the arithmetic is unit-tested under Node and the component keeps
  only what needs a DOM.
- Two guards, split the way this repo splits them. `lib/portfolioLayout.test.ts` scans the sources
  with comments stripped — the fifth file to record that requirement — for the promises a later
  story could break silently: the reset's interaction, both `dataVersion` bumps, the snapshot
  section's survival, the rail's placement outside the branches, and the breakpoint's arithmetic.
  `e2e/portfolio-layout.spec.ts` covers what no Node test can see: that the sections are in that
  order *on screen*, that the rail is beside the table at the default size and under it at 1000px,
  that the page never scrolls sideways, and that no native dialog is raised.

## Alternatives considered

- **The rail inside the `ok` branch, as the prototype draws it.** Rejected above: it hides the
  import path exactly when the gateway is down.
- **`SnapshotHistory` in the rail.** Rejected on width — a snapshot row is three fields on a line.
- **Deleting `SnapshotHistory`, following the prototype literally.** Out of scope by the Epic's own
  terms, and the story says so explicitly.
- **Keeping `FlexImport` whole and rendering it below the pair.** This is the smallest change and
  loses the story: the data-sources card is what makes the rail worth having, and the coverage
  sentence answers "where does my history come from" at the place the owner is already looking.
- **Scaling both bars against the maximum with no floor.** Draws a 4% top holding as a full bar.
- **Scaling against a fixed divisor, as the prototype does.** Draws a 45% and a 32% holding
  identically, and is wrong for any account but the one it was tuned on.
- **A `meter` on the in-table micro-bar too.** Rejected: it announces a figure that is already read
  out beside it, once per row.
