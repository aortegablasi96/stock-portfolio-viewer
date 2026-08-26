# 0093. The store's row owns its height, and the cards in it stop owning their own

- **Status:** Accepted. Amends [[0089-the-rail-comes-down-and-the-store-takes-a-row]] in one
  declaration. The row's columns, its 416px track, its gap, its `min-width: 0` and its 1204px
  stacking query are unchanged, and [[0062-portfolio-rail-and-weight-bars]]'s reason for a fixed
  measure still holds.
- **Date:** 2026-08-26

## Context

Story #266 put the app's two local-store cards in one row. `.dashboard-sources` is a two-column
grid — `minmax(0, 1fr)` for Stored statements, `var(--sources-width)` for Data sources — and it
carried `align-items: start`, copied from the two rows the idiom came from
([[0051-performance-chart-grid]]'s `.performance-charts` and `.breakdown-split`).

`start` sizes each card by its own content. On those two rows that is right, and for two different
reasons: a stacked card *should* be sized by its content, and the four performance charts agree on
a height because they hold identical content. **Neither reason reaches this row.** Its two contents
can never agree. Stored statements holds a table whose height follows the number of imported
statements; Data sources holds a fixed set of import controls whose height follows nothing. There
is no import count at which they match.

So whichever was taller set the row and the shorter one ended above it, leaving a ragged gap
against the page background — and *which* card was short flipped with the store. With the owner's
two statements imported, Data sources was 60px short of the table beside it. With an empty store,
the "No statements imported yet" panel is 82px short of the controls. The row read as two cards
that happened to start on the same line rather than as one row, in both directions.

`align-items: start` was never a decision here. It arrived with the idiom, and the idiom was
carrying it for cases this row is not one of.

## Decision

**`.dashboard-sources` is `align-items: stretch`. The height is the row's, and it is the taller
card's content that sets it.**

Stated rather than dropped. `stretch` is the initial value, so deleting the line would produce the
same picture — and would leave the next reader with nothing to distinguish "this row was thought
about" from "this row was never given an `align-items`", on a row that has now had both answers.
The declaration is what `portfolioLayout.test.ts` asserts, and what stops `start` coming back with
the next story that copies the idiom.

**The cards' contents do not stretch with them.** A `Card` is a block, so `CardContent` and
everything under it keep their own heights: the import controls stay at the top of the Data sources
card and the box grows underneath them. Nothing was added to make that true, and nothing may be
added that makes it false — a `display: flex` on the card, or a `height: 100%` on its content,
would spread the slack through the controls instead of leaving it below them. That is the half of
this decision a reader is most likely to "finish".

**Below 1204px nothing changes.** One column puts each card in its own implicit grid row, an
implicit row is auto-sized, and stretching to it is stretching to the card's own content. So the
stacked layout is exactly as Story #266 left it and the media query restates the columns and
nothing else — an `align-items` in there would mean the row above was being corrected twice.

**`.performance-charts` keeps `start`.** It is a different row with a different reason, and this
record is deliberately not a rule about grids of cards.

## Consequences

- The Portfolio view's foot reads as one row at any statement count, and the taller card is always
  the one with something to be tall about.
- The stretched card carries visible empty space below its content. That is the trade: a card with
  slack inside it, against two cards ending at different heights. The row is the thing the eye
  reads, so the slack goes inside the box rather than beside it.
- A future Data sources control lands in a card that already has room for it, and adding one no
  longer risks the two cards crossing over which is taller.

## Verification

A resolved height is exactly what a text-scanning guard cannot see, so it is split the way this
app splits every cascade it depends on:

- `lib/portfolioLayout.test.ts` asserts the *declaration* — `stretch` present, `start` gone, the
  breakpoint free of `align-items`, and `.performance-charts` still `start`.
- `e2e/portfolio-layout.spec.ts` asserts the *picture*, at 1280px, against an empty store: the two
  cards' heights are equal, the shorter content sits at the top of its card with the slack below
  it, and the taller card ends exactly where its own content does. Its stacked test gains the
  other half — that the two heights are *not* equal once the row breaks.
- The other direction, a full store, is not reachable from an e2e run with no import and was
  checked against the owner's own database with `run-app`'s capture: before, Data sources ended
  60px above the statements table; after, both end on the same line and the controls have not
  moved.

## Alternatives considered

- **Leave `align-items: start` and give one card a `min-height`.** A number that would be wrong at
  every statement count but one, and wrong in the other direction on an empty store.
- **Drop the declaration and let `stretch` come from the initial value.** Same picture, no record.
  See the Decision.
- **Change the idiom everywhere it appears.** `.performance-charts` and `.breakdown-split` have
  their own reasons for `start`; a rule about all rows of cards would be a decision made from one
  case.
