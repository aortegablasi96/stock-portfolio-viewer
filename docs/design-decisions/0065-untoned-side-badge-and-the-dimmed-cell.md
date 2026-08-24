# 0065. A side badge with no tone at all, and the dimmed cell moves into the table's namespace

- **Status:** Accepted — *the untoned side badge superseded by
  [[0086-the-side-badge-takes-the-tone-it-was-refused]], which counted the collision predicted
  below and found it 4 rows in 260; the dimmed cell, the `closedSomething` predicate, the
  `Best` / `Worst` tone and the nested-card re-measurement all still govern, as does the refusal
  of a **substitute** hue*
- **Date:** 2026-08-19

## Context

Story #193 restyles the Trades view, the last story of the M5 milestone and the view the Epic's
own survey called "the closest to the prototype". Four `StatTile`s, `Realized gains by Ticker`
beside the `Best` / `Worst` highlight cards, and the trade history under its period and type
filters — all of it already the shape the redesign draws. What is left is presentation, and one
part of it is a decision the story explicitly declined to make in advance.

**The side.** The prototype paints each row's `Side` as a tinted chip: `Buy` on a green ground in
the gain tone, `Sell` on a red ground in the loss tone. It is the one place in this Epic where the
story says the prototype's colour choice should probably not be adopted as drawn, and asks for a
stated alternative rather than naming one.

**The dash.** The Realized P&L column renders an em dash where a trade closed nothing. Its class
came from `toneClassName(toneOf(t.realizedBase))`, and a neutral figure gets **no class** by
design ([[0034-stat-tile-primitive-tone-axis]]) — so the dash inherited `--text` and sat at the weight of the
figures above and below it. The rule it wanted already existed under another view's name:
`.flex-import-dim`, written for the data-sources table's un-reimported counts, and described by
[[0037-badge-primitive-variants-and-sizes]] as surviving the badge consolidation because it
colours *a cell standing in for a value*, not a label.

**The nested card.** The story asks for a re-check rather than a change: `Best` / `Worst` are
`Card variant="nested"`, which takes `--bg` rather than `--card`, and the redesign's ground and
card surfaces sit closer together than the palette they replaced
([[0054-navy-indigo-palette-re-key]]).

## Decision

### The side badge carries no tone, and no substitute hue either

```tsx
{
  key: 'side',
  header: 'Side',
  cell: (t) => (
    <Badge size="sm" className={BADGE_CELL_CLASS}>
      {t.side}
    </Badge>
  ),
  sortValue: (t) => t.side,
}
```

No `variant`, so the side takes the default `neutral` badge — a bordered label in muted ink.

**The gain/loss pair is declined** because those two hues already mean gain and loss in the same
row's last cell. A trade sold at a loss would render a red `Sell` beside a red figure and a trade
bought would render a green `Buy` beside whatever its Realized P&L cell says, and the row would
read as though the side caused the number. One hue, two meanings, four columns apart.

**No substitute hue is invented either**, and that half is the less obvious one. The palette has
exactly two other channels a badge could take. `--accent` is spent: DDR-0037 gave it to the one
badge that reports *news*, marked by weight as well as colour precisely so the meaning survives
where hue is not read. The eight `--series-*` slots are a **dimension's** categorical set under
[[0030-allocation-map-country-donut-pairs]], where one sector keeps one hue everywhere — spending
two of them on a two-member boolean would collide with the sector palette the first time a chart
and this table share a screen.

So the badge earns its place on the channel it has left, which is **shape**: a run of boxes at one
x-position, where a bare word left the column ragged and every row's side began at a different
glyph. The word inside is unchanged, so nothing here is carried by colour at all — which is
[[0021-allocation-map-gain-loss-scale]] satisfied by construction rather than by a second
cue bolted beside a first.

Three consequences worth stating, because each is a thing that did *not* have to be done:

- **No new variant.** `BADGE_VARIANTS` is unchanged at five.
- **No new contrast pairing.** `--muted` on the table's 4% hover lift is already enumerated at
  5.34:1 ([[0059-card-strip-and-table-density]]); a toned side badge would have needed the
  two pairings Story #192 had to measure, on a second table.
- **No branch on the side string.** `tradesLayout.test.ts` fails on `=== 'Buy'` as well as on a
  `variant=` prop, because a tone reached either way is the same decision.

If the owner wants the column louder, the next channel to spend is weight or a second boundary
treatment. It is not a hue.

### `.flex-import-dim` becomes `.data-table .data-table-dim`

```css
.data-table .data-table-dim {
  color: var(--muted);
}
```

Same one declaration, same job, in the namespace the table's three other cell shapes already
share (`.data-table-num`, `.data-table-name`, `.data-table-note`). One call site moves, in
`DataSources.tsx`. Nothing renders differently.

The alternative was a second copy under a second view's prefix, which is the half-done
consolidation Epic #125 names as its own standing risk — a rule that means "this cell's value is
absent" existing twice, under two view names, neither of which is where the next author will look.
DDR-0037's finding that the rule survives the badge consolidation is unchanged; what changes is
that it is no longer a rule belonging to the Flex import.

The predicate behind it is extracted at the same time. `t.realizedNative !== 0` was written out
three times in three shapes — for the tone, for the text and for the sort value — and the three
have to answer identically or the column tones a row it renders as a dash:

```ts
function closedSomething(t: TradeRow): boolean {
  return t.realizedNative !== 0
}
```

The comparator still receives `null` rather than `0`: an opening buy has no realized P&L, which is
not the same as having realized zero, and a missing value sorts last in both directions
([[0039-data-table-primitive-and-column-sorting]]).

### The highlight card's label takes the item's tone, not the card's

The redesign draws `Best` in the gain tone and `Worst` in the loss tone. What ships tones **each
card by its own item's figure**:

```tsx
const tone = toneOf(item.totalRealized)
…
<p className={toneClassName(tone, statPartClassName('label'))}>{label}</p>
…
<p className={toneClassName(tone, 'highlight-value')}>{sc(item.totalRealized)}</p>
```

A portfolio whose weakest position still gained would otherwise carry a red `Worst` over a green
`+€40.12`. The words `Best` and `Worst` carry the ranking; the colour carries the polarity, which
is the only thing it means anywhere else in this app.

The label is **composed, not declared**: `.stat-label` stays the app's one micro-label
([[0060-kpi-tile-figure-and-micro-label]]) and picks up `.stat-positive` /
`.stat-negative`, the same two rules the figure below already wears. Source order settles the two
`color` declarations — the tones sit below the label in `app.css` — so no specificity is spent and
no third rule appears. `tradesLayout.test.ts` asserts that ordering, because it is invisible at
both call sites.

The card's other two lines take the redesign's emphasis on the scale's nearest steps: the ticker
to `--text-md` (17.6px against the prototype's 16px) at 700, the figure to 700 while staying at
`--text-lg` — it annotates the table beside it rather than heading the view, which is the one
thing about this card that has not changed ([[0033-card-primitive-variants-and-sizes]]).

### The nested card was re-measured and left alone

| Edge | Before the re-key | After |
| --- | --- | --- |
| `--border` against `--card` — the boundary | 1.228:1 | **1.252:1** |
| `--bg` against `--card` — the fill step | 1.086:1 | 1.059:1 |

The finding is that the nested card's separation was **never** carried by its fill. 1.06:1 is not
a visible step and was not one before; what separates a nested card is the 1px `--border` every
`.card` declares, and that edge got marginally *stronger* in the re-key. No action. The three
values are pinned by `designTokens.test.ts`, so neither number can move without a failing test.

## Consequences

- Trade side is scannable by shape and legible by word, and the Trades view is the one place in
  the app where the redesign's colour was read as a specification and answered with a different
  one. The reasoning generalises: a hue this app has spent on polarity cannot be borrowed for a
  category on the same row.
- The dimmed-cell rule has one name and one home. A third view wanting an absent-value cell now
  finds it beside the other cell shapes instead of under `flex-import-`.
- `.stat-label` gains a second call-site treatment (a tone) without gaining a second rule, which
  is the pattern [[0034-stat-tile-primitive-tone-axis]]'s "neutral is the absence of a rule" makes possible.
- `tradesLayout.test.ts` joins the five view-composition guards. It does **not** re-assert the two
  FIFO traps the story warns about — the `Total (All Assets)` aggregate row and the flow/balance
  split that shipped 25% overstated as Bug #103. `realizedGainsService.test.ts` already pins both
  against constructed statements, which is a behavioural test rather than a text scan, and a
  renderer test grepping `@services` would be a weaker copy of it on the wrong side of the layer
  boundary.
- What this story did **not** take: `formatCompanyName()`, which the Dividends view applies to its
  descriptions and Trades does not. It title-cases, and the trade history's FX rows carry
  `EUR.CHF` as their description — "Eur.chf". Making the two views agree needs the FX case
  handled, which is a formatting story rather than a restyle.

## References

- Story #193 — Trades: badge trade side and restyle the highlight cards
- Epic #179 — Visual redesign from the Figma proposal
- [[0037-badge-primitive-variants-and-sizes]] — a badge is a boundary and an ink; `accent` is news
- [[0064-toned-badges-and-the-income-key]] — the toned variants this story deliberately does not use
- [[0030-allocation-map-country-donut-pairs]] — the `--series-*` slots are a dimension's set
- [[0021-allocation-map-gain-loss-scale]] — superseded, still governing
- [[0033-card-primitive-variants-and-sizes]] — `nested` takes `--bg`
- [[0034-stat-tile-primitive-tone-axis]] — neutral is the absence of a rule
- [[0039-data-table-primitive-and-column-sorting]] — a missing value sorts last in both directions
- [[0046-contrast-split-tone-tokens]] — `--neg` fills, `--neg-text` inks
- [[0054-navy-indigo-palette-re-key]] — the surfaces re-measured here
- Bug #103 — the flow/balance split in the FIFO summary
