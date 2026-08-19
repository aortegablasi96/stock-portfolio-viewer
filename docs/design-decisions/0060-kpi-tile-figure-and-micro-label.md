# 0060. The KPI tile: a 26px figure that sets the column, and one micro-label for the whole app

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The Figma Make proposal Epic #179 adopts opens every screen with a row of three or four KPI tiles,
and each tile is three stacked parts: an 11px uppercase letter-spaced muted label, a 26px
monospaced figure with tight negative tracking, and an optional muted hint line.

That row already exists here, with those labels, in those views. `StatTile` / `StatRow`
([[0034-stat-tile-primitive-tone-axis]]) render exactly those three parts and the four analytics
views plus the Portfolio dashboard already call them. So Story #187 is a restyle of four rules,
and the markup did not move — which is worth stating first, because it is why the story's risk is
not in the component at all. It is in two places the stylesheet had already made a decision:

- **`--text-xl` is 1.4rem, not 1.5rem**, and [[0031-design-token-scales]] says why in one clause:
  "the stat grid packs tiles into 11rem columns where the larger figure would wrap." The redesign
  asks for 26px, which is 1.625rem — *larger* than the 1.5rem that decision rejected.
- **The micro-label already exists.** [[0059-card-strip-and-table-density]] dropped the table's
  column head to `--text-2xs` at `0.06em` one story earlier, and called the size and the tracking
  a pair. `.stat-label` was still at `--text-xs` / `0.04em`, one step larger and one step tighter.

## Decision

### The figure goes to 26px, and the column minimum moves with it

`--text-xl` becomes **1.625rem**. `.stat-row`'s column minimum becomes **14.5rem**. These are one
decision recorded as two declarations, and the arithmetic that ties them is asserted in
`lib/statTileVariants.test.ts` rather than left in a comment, so the pair cannot be split by a
later story that only reads one of the two rules:

- A monospaced digit is 0.6em wide — JetBrains Mono and every fallback in `--font-figure`.
- The longest figure a view must hold is twelve characters: `-€123,456.78`. That is deliberately
  wider than anything real. Measured in the running app against the owner's own data, the longest
  is Trades' `+€11,011.69` at eleven characters and 166px of ink.
- Twelve characters at 26px is 187px, and the tile spends two `--surface-pad-md` on the card's
  own padding, so the column must be at least 227px.
- 14.5rem is 232px.

**14.5rem is off the 4px grid, and both ends of the window are load-bearing.** Below ~14.2rem the
figure overruns the card at the point the grid reaches its minimum. Above ~14.6rem, Trades' four
tiles stop fitting one row in the 1280px default window — measured, not estimated: with the
sidebar open and the document scrollbar, `.stat-row` is 985px wide there, and four columns plus
three `--space-5` gaps leaves 234px each. 14.5rem is the middle of a 0.4rem window.

What this costs is a column at the narrowest window. At `WINDOW_MIN_WIDTH` (940px) with the
sidebar expanded, Trades' four tiles fall to 2×2 where they used to make three across. That is
accepted: reflowing is what `auto-fit` is for, overrunning a card is not, and the figure is the
thing the row exists to show. Collapsing the sidebar at that width gives three back.

Measured in the built app at all three widths, every figure in every view renders on one line.

### `--leading-tight` on the figure

At 26px the inherited body ratio opens a gap between the label and the figure that reads as a
dropped line. `--leading-tight` (1.2) is the scale's answer and the proposal's 1.15 rounds to it.

### One micro-label, not one per surface

`.stat-label` takes the treatment `.data-table thead th` took in #186: `--text-2xs`, `0.06em`,
weight 600. Three properties, applied together, for the reason DDR-0059 already argued — 11px
capitals set at a body face's tracking are what fails to read, and dropping the weight along with
the size makes them faint as well as small.

The proposal sets the KPI label at `0.08em` and the table head at `0.06em`. That two-thousandths
difference is not adopted. It is below the threshold at which a reader could tell the two apart,
and above the threshold at which a later story has to decide which of two micro-labels a new
surface wears. The test asserts the tile's label and the table's head are the *same* four
declarations, so the app has one.

### Nothing else about the tile changes

- **No axis is added.** `tone` remains the only one. The proposal's `KpiCard` carries an `accent`
  boolean that paints the figure indigo; nothing in the five views asks for it, and DDR-0034's
  argument against a one-value axis applies unchanged to a two-value one nobody calls.
- **No surface rule.** The tile is still a `Card`, and `statTileVariants.test.ts` still fails if
  any `.stat-*` rule declares a `background`, `border`, `padding` or `outline`.
- **The tone rules are untouched**, and so is `toneClassName('neutral') === ''`. That matters
  because `.stat-positive` / `.stat-negative` are worn by a table cell (`.data-table-num`) and the
  Allocation map's popup as well as by a tile — both verified in the running app.
- **The figure role is untouched.** `.stat-value` was already in the one rule that carries
  `--font-figure`, `tabular-nums` and `--tracking-figure` together
  ([[0053-bundled-typefaces-and-the-figure-role]]), which is what makes two tiles' figures line up
  digit under digit. The restyle adds a size and a weight to that rule's subject and no family.

## Consequences

- **`--text-xl` has exactly one consumer** — `.stat-value` — so raising it moved one figure and no
  page furniture. That is luck this story spent rather than earned; a second consumer would have
  turned a token change into a per-rule one.
- **`.highlight-label` follows.** Trades' *Best* / *Worst* cards wear `.stat-label` (folded in by
  DDR-0034), so their labels shrink to the micro-label too. Checked on screen: intended, and it
  is what keeps the highlight cards reading as siblings of the tiles above them.
- **`--text-2xs` is no longer "the native-currency chip".** It is the app's micro-label step, worn
  by the tile label, the table head and the gateway badge, with the chip as a fourth caller. Its
  comment in `:root` says so.
- **The row's reflow is now visible at real window sizes.** Before this story `auto-fit` never
  reached its minimum in practice; now Trades goes 4 → 2 between the default and the minimum
  window. Any future story adding a fifth tile to a row should re-measure rather than assume.
- **A story that widens a figure must re-measure the column.** The obvious future case is a
  display currency whose formatting is longer than EUR's, or an account an order of magnitude
  larger. The guard test fails on the twelve-character promise, not on the current data, so it
  will not catch a thirteenth character — it will catch a figure step raised without the column.

## Alternatives considered

**Keep `--text-xl` at 1.4rem and leave the grid alone.** The cheapest option, and it fails the
story: the 26px figure is the single loudest thing in the proposal's tile, and 22.4px beside an
11px label does not read as the same design. The grid is the part with slack; the figure is not.

**Add an eighth type step at 26px and leave `--text-xl` alone.** Rejected. `--text-xl`'s comment
already says "headline figure on a tile" and it has one consumer, so a new step would leave a dead
one behind — and DDR-0031's seven steps exist because thirteen unrelated sizes did not.

**Raise the column minimum to 15rem+ and let it hold thirteen characters.** Rejected on the
measurement above: at 15rem the 1280px default window fits three columns, so Trades' fourth tile
wraps to a second row in the layout the app is read in most. Holding a figure nobody has is not
worth breaking the row everybody sees.

**`white-space: nowrap` on `.stat-value` instead of widening the column.** Rejected, and it is the
tempting one, because a currency string has almost no break opportunities to begin with — the
failure it prevents is not wrapping but overflow, and `nowrap` converts a wrap into a clipped or
overrunning figure, which is worse and silent. Sizing the column so the figure fits is the fix;
`nowrap` is the way to stop noticing that it does not.

**Adopt the proposal's `0.08em` on the tile label.** Rejected above: two micro-labels two
thousandths apart is a decision every later surface has to make and no reader can see.

## References

- Story #187 — Restyle `StatTile` to the redesign's KPI tile; Epic #179
- [[0034-stat-tile-primitive-tone-axis]] — the tile's one axis, its absent surface, the empty
  neutral tone
- [[0031-design-token-scales]] — the type scale, and the `--text-xl` / `.stat-row` collision this
  record resolves the other way
- [[0059-card-strip-and-table-density]] — the micro-label this label adopts
- [[0053-bundled-typefaces-and-the-figure-role]] — the one rule that makes a figure a figure
- [[0021-allocation-map-gain-loss-scale]] — the carve-out that lets a tone colour a figure
- [[0046-contrast-split-tone-tokens]] — `--pos` / `--neg-text`, unchanged here
