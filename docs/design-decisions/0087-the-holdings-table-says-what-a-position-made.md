# 0087. The holdings table says what a position made, and names itself while doing it

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

Story #189 built the Portfolio view's layout from the Figma proposal and put one line under *Not
Included*: **"New columns in the holdings table."** Story #263 is that column, and reading the
proposal's `PortfolioView` against the shipped view turned up three smaller gaps beside it — a card
with no visible name, a column showing nothing, and two KPI tiles with an unused hint line.

The column is the substance and it carried the story's only real risk. The other three are each a
standing rule of this app applied to the one place that had escaped it.

### The risk was a number that would have looked right

`averageCost` has been on `Holding` since M1 and **displayed nowhere**, so nothing in the app
depended on knowing what it means. Two readings were open — a per-share cost, or the position's
total — and they differ by a factor of the quantity. At 7,790 shares of one holding the wrong
reading gives €8,054 where the right one gives €1,086: not obviously broken, just wrong, in a
column whose whole job is to be believed.

That was **settled against the live gateway** rather than reasoned from the field name — the
lesson #211 filed, where a story's own premise survived until someone queried the real data. A read
of `/portfolio/{acct}/positions/0` (Build 10.46.2d, 2026-08-24, eight positions) settled three
things at once:

| What the read showed | Consequence |
| --- | --- |
| `avgCost` equalled `avgPrice` on all eight rows | It is **per share**. |
| `multiplier` was absent on all eight | No contract in this account carries one. |
| `unrealizedPnl` was **present on every row** | IBKR reports it; nothing has to be derived. |
| It equalled `mktValue − avgCost × position` to the cent on seven of eight, and differed by one on the eighth | The broker's figure is the account's truth, not a cross-check. |

The one-cent disagreement is the useful part. `IBKR` reports `131.42` where the derivation gives
`131.4127`. Either is defensible in isolation; only one of them matches what the broker's own
statements will say, and a viewer that quietly disagrees with the broker by a cent is a viewer the
owner has to reconcile by hand.

## Decision

### The figure is IBKR's, and the derivation is the fallback

```ts
function toUnrealizedPnl(p: RawPosition): number | null {
  if (p.unrealizedPnl !== undefined) return p.unrealizedPnl
  if (p.avgCost === undefined || p.mktValue === undefined || p.position === undefined) return null
  return p.mktValue - p.avgCost * p.position
}
```

In the **repository**, because which fields a source offers is the repository's knowledge and
nobody else's ([[0024-gateway-read-coalescing-and-freshness-window]]'s layer, not its policy). `rawPositionSchema` is
already `.passthrough()`, so this is a schema line and not a request: the figure arrives in the
positions payload the overview reads, one of the four calls `gatewayCache` already coalesces.
**The column costs nothing at the wire** — no new endpoint, no per-item loop, and therefore none of
[[0022-gateway-timeout-and-not-responding-state]]'s per-item timeout exposure.

The fallback needs **no multiplier term** even for a contract that has one, and that is arithmetic
rather than luck: IBKR states `avgCost` per share *including* the multiplier and `mktValue`
includes it too, so `(mktPrice·m − avgPrice·m)·position` cancels it. Writing one in would
double-count it.

`null` is a real answer. A gateway build offering neither its own figure nor an `avgCost` says "not
known", and the table draws that rather than a zero.

### It converts, unlike the price beside it

In the **service**, at the same rate and in the same pass as `displayValue`
([[0007-portfolio-display-currency-and-live-fx]]). This is the line that needed drawing, because the
neighbouring fields go the other way: `marketPrice` and `averageCost` are deliberately left native,
on the reasoning that *a quote is a native-currency fact*. A gain is not a quote — it is an
**amount**, the same kind of thing as the market value it is computed from, and an amount converts.

The unconvertible row lands on `null` and the cell draws an em dash. It does **not** repeat the
Market value cell's "no exchange rate" badge: that row already carries the flag once and the table
carries the notice, and a second badge on the same line in the next column says nothing new. The
row stays out of every total by never being in one — there is no P&L total on this view.

### The cell is a bare toned figure, and that is a decision

`formatSignedCurrency` under `cellClassName: toneClassName(unrealizedPnlTone(…))` — the route the
realized-gains table's three signed columns already take
([[0034-stat-tile-primitive-tone-axis]], [[0039-data-table-primitive-and-column-sorting]]). Not a
`Badge`. [[0086-the-side-badge-takes-the-tone-it-was-refused]] toned the Trades side badge one story
ago and its argument was that **the box, not the hue, is what separates a chip from the figures
around it** — polarity in this app is always a signed figure in tabular digits. This *is* one of
those figures. Putting it in a box would spend the distinction DDR-0086 had just bought.

The rules live in `renderer/src/lib/holdingPnl.ts` because Vitest has no jsdom, and the one worth
extracting is the smaller: **an unknown P&L is neutral, not a loss**. The natural spelling at a
call site is `toneOf(value ?? 0)`, which is correct and reads like a coincidence; get the coalesce
wrong, or reach for a truthiness check, and an em dash ships in the loss tone — a statement, and a
false one.

### A snapshot reports it as unknown, on purpose

`rowToHolding` returns `null`. The store has every figure needed to derive one — `marketValue`,
`averageCost`, `quantity` — which is exactly why the omission is written down here and asserted in
a test of its own rather than left to be inferred. Deriving it would date a live-only column to a
capture. Back-filling a historical P&L is a story, not a side effect of this one.

`unrealizedPnl` is required-and-nullable rather than optional, so every construction site had to
state its answer; that is what surfaced the snapshot path as a decision instead of a default.

### It is a different number from the Trades view's, and both are right

Trades' KPI row already shows an "Unrealized P&L". That one is the **Flex FIFO summary's**: a
base-currency balance, as of the latest statement's end date, which must not be summed across
statements (the trap that shipped 25% overstated in Bug #103). This one is **live, per position, at
current market prices**. They are measured on different days from different sources and are not
expected to agree. The domain schema says so where a reader will meet it; the view does not, because
the two figures are never on screen together and a caveat about an absent number is noise.

### The standalone table gets the card's strip, not a second one

The proposal draws the holdings table in a card with `padding: 0`, a ruled *Holdings* strip, and
rows reaching both edges. The shipped table's only name was an `sr-only` `caption`, making it the
one table card in the app a reader could not name.

[[0039-data-table-primitive-and-column-sorting]] states that **`card` is not a `Card`** — "a card
carries padding and a table's rows have to reach its edges, so the container draws it." That reason
is still good, and the proposal agrees with it. So the strip goes **onto the container** rather than
the table into a `Card`: `surface="card"` keeps its meaning and its only caller, and the rows keep
the edges.

```css
.data-table-scroll-card > .card-header {
  position: sticky;
  left: 0;
  margin: 0;
  padding: var(--space-5);
}
```

It is the **same `.card-header` element and the same rule**, so this card cannot be told apart from
the fifteen inside a `Card` — the property [[0033-card-primitive-variants-and-sizes]] protects by
serving two selectors from one rule, and the property a new class here would have destroyed.

What it cannot inherit is the **geometry**. The strip's job inside a card is a bleed: cancel the
card's inline padding with a negative margin, re-apply it as its own ([[0059-card-strip-and-table-density]]).
This container has no padding and never defines `--card-pad`, so the inherited
`calc(-1 * var(--card-pad))` is an invalid length and the browser **drops the declaration** — the
same silent-failure class as DDR-0084's half-finished strip, in the other direction. The two
properties are therefore restated: no margin, because the rule already reaches both edges, and a
cell's own inline padding, so the title sits over the Ticker column rather than half a step left of
it.

`sticky` is not decoration. This container **is** the horizontal scroller, so an unpinned title
slides out of view exactly where the columns are hardest to read. Verified rather than assumed: at
an 820px viewport the table overflows by 159px, and scrolled fully right the first body cell sits
at −70px while the title holds at 89px.

The title is a **slot, not an axis** — `surface` and `height` remain DDR-0039's two, and the guard
asserts both unions are unchanged and that no `.data-table-title` class exists. `caption` stays and
still names the *table*; the strip names the *card*, which is what `StoredStatementsCard` already
does with a `CardTitle` beside a `caption`.

### Description goes through `instrumentName`, which empties it

The proposal calls this column *Company*. It is not one, and the rename is what exposed why.

On the live gateway the column was **rendering the ticker a second time on every row**. Build
10.46.2d sends no `ticker` field at all, and puts the symbol in `contractDesc`; the repository's
`symbol: ticker ?? contractDesc` and `description: contractDesc ?? ticker` therefore resolve to the
same string, and every row read `IBKR · IBKR`. It cost 132px of 859 to say nothing.

That is precisely what [[0066-one-instrument-name-across-the-views]] and
[[0067-shortening-a-name-to-a-name]] describe, and `instrumentName` is the predicate already
written for it — answering from the row rather than from an asset-class vocabulary, which is why it
transfers from Flex rows to gateway rows unchanged. The column now shows an em dash in
`.data-table-dim` where the description says nothing the symbol does not, and **sorts on the
resolved name**, so the nameless rows are the missing values the comparator parks at the bottom in
both directions rather than a run of identical tickers.

The visible result is a column of em dashes on this account, which is the honest state and was the
owner's call between that, dropping the column, and leaving the duplication. It is kept because a
gateway build that sends real names still fills it, and because fetching names is a new request
this story ruled out.

The header stays **Description**. *Company* would assert something about every row that this data
does not support.

### Two hints ship and one is refused

`StatTile` has accepted a `hint` since Story #129 and this row never passed one. *Net liquidation*
takes **"Holdings plus cash"** — the Bug #68 definition, and the thing that distinguishes it from
IBKR's own `netliquidationvalue`, which folds in accruals and does not reconcile with the two tiles
beside it. *Holdings value* takes **"At current market prices"**, separating a valuation from the
cost basis a reader might assume.

*Cash* gets none. The proposal captions it **"Available margin"**, and `totalCashValue` is not that
— it is the ledger's total cash across currencies and says nothing about buying power. A hint that
is not true of the figure above it is worse than the blank space, so the tile keeps the blank space
until there is something true to put in it.

## Consequences

- The Portfolio view answers "what has this position done?" without leaving it, from the broker's
  own figure, at no additional cost at the gateway.
- **`averageCost` now has a documented meaning.** It was carried and persisted for four milestones
  with nothing depending on its interpretation; anything reading it next has a verified answer and
  a test that fails on the other one.
- The seven columns fit. Measured with the sidebar **expanded** — the criterion #189 set — at a
  1440px window: `scrollWidth === clientWidth` at 859px and no horizontal page scroll. The
  `--font-figure` width premium [[0053-bundled-typefaces-and-the-figure-role]] warns about was paid out
  of the slack the Description column stopped using.
- **The Description column is empty on this gateway build**, and visibly so. That is the finding
  rendered rather than hidden; it will fill itself on a build that sends names.
- The strip is **not pinned by Playwright**, and that is a stated gap rather than an oversight: the
  holdings table renders only in the `ok` state, and the e2e suite deliberately runs with no
  gateway (`portfolio-layout.spec.ts` tests the `not_connected` path for that reason). The
  declarations are held by `dataTableVariants.test.ts`, the geometry and the sticky pin by the
  measurements above, and the rendering by the screenshot in the PR.
- A third host now wears `.card-header`. A fourth should ask whether the strip is still a card's
  property or has become the app's, the way `sidebarRail.test.ts` counts `SURFACE_EDGE`'s users
  ([[0069-boxed-gateway-chip-and-the-raised-surface]]).

(extends [[0039-data-table-primitive-and-column-sorting]], [[0033-card-primitive-variants-and-sizes]],
[[0059-card-strip-and-table-density]], [[0007-portfolio-display-currency-and-live-fx]],
[[0024-gateway-read-coalescing-and-freshness-window]], [[0034-stat-tile-primitive-tone-axis]],
[[0086-the-side-badge-takes-the-tone-it-was-refused]],
[[0066-one-instrument-name-across-the-views]],
[[0067-shortening-a-name-to-a-name]], [[0053-bundled-typefaces-and-the-figure-role]])
