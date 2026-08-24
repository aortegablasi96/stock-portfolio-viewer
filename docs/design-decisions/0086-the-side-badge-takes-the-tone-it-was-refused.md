# 0086. The side badge takes the tone it was refused, and the box is what earns it

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

Story #257 asks for the Trades history table's `Side` column to be toned: `Buy` in the gain tone,
`Sell` in the loss tone. [[0065-untoned-side-badge-and-the-dimmed-cell]] declined exactly this, in
exactly these two hues, ten stories ago. Under CLAUDE.md a change to an accepted decision **stops
and returns to the owning workflow skill** rather than being made inline, so the story routed
through `ui-designer` and closes here.

The owner has asked for the change. What that settles is the *direction*, not the *argument*: the
thing DDR-0065 recorded is a prediction about how a row would be read, and a reversal that does not
answer it is a decision made twice with no more information than the first time. So the work of
this record is to answer it — and the first half of the answer turned out to be a thing that could
be **counted** rather than reasoned about.

**What DDR-0065 predicted.**

> The gain/loss pair is declined because those two hues already mean gain and loss in the same
> row's last cell. A trade sold at a loss would render a red `Sell` beside a red figure and a trade
> bought would render a green `Buy` beside whatever its Realized P&L cell says, and the row would
> read as though the side caused the number. One hue, two meanings, four columns apart.

It then declined a **substitute** hue as well — `--accent` is spent on the badge that reports news
([[0037-badge-primitive-variants-and-sizes]]), and the eight `--series-*` slots are a dimension's
categorical set ([[0030-allocation-map-country-donut-pairs]]) — and spent the one channel it had
left, **shape**: a run of boxes at one x-position, where a bare word had left the column ragged.

That second half is not reversed here and is what makes the reversal affordable. The column has
been a `Badge` since Story #193; this story changes which variant it takes, and nothing else.

## Decision

### `Buy` is `positive` and `Sell` is `negative`, from one mapping

```ts
export const SIDE_VARIANTS: Record<TradeSide, BadgeVariant> = {
  Buy: 'positive',
  Sell: 'negative',
}
```

```tsx
{
  key: 'side',
  header: 'Side',
  cell: (t) => (
    <Badge variant={sideVariant(t.side)} size="sm" className={BADGE_CELL_CLASS}>
      {t.side}
    </Badge>
  ),
  sortValue: (t) => t.side,
}
```

No variant is invented: `positive` and `negative` are the pair Story #192 added for the dividend
type badge ([[0064-toned-badges-and-the-income-key]]), so `BADGE_VARIANTS` is unchanged at five and
the badge's axes do not grow. A toned badge is still **border-carried ink and never a ground**,
which is the half of DDR-0064 this decision leans hardest on. The word stays inside the badge, so
colour is not the only channel ([[0021-allocation-map-gain-loss-scale]]). `sortValue` is untouched:
the tone is presentation, and the column still sorts on the side string.

### The collision was counted, and it is smaller than the prediction

DDR-0065's argument is empirical — it says what a reader will see — so it was checked against the
owner's real import rather than re-argued. 260 trades:

| Side | What the Realized P&L cell renders | Rows |
| --- | --- | --- |
| `Buy` | the dimmed em dash | **192** |
| `Sell` | the dimmed em dash | 50 |
| `Sell` | a **gain** figure | 14 |
| `Sell` | a **loss** figure | **4** |

Two findings, and the first is the one that moves the decision.

**The green-`Buy` collision does not occur.** DDR-0065 worried about "a green `Buy` beside whatever
its Realized P&L cell says"; in this history the answer is always the same thing — the dimmed dash,
192 times out of 192. That is not a coincidence of this portfolio. An opening buy realizes nothing,
which is the very fact `closedSomething` and `.data-table-dim` exist to render (DDR-0065's other
half, still standing). A buy closing a *short* would realize, and there are none here; the
structural claim is therefore "overwhelmingly" rather than "never", which is enough. Three quarters
of the toned rows in the table pair a green chip with an absent figure, and an absent figure cannot
be read as caused by anything.

**The red-`Sell` collision is 4 rows in 260**, and it is outnumbered **14 to 4** by a red `Sell`
beside a *green* figure. The pair a reader is most likely to meet is the one that refutes the
causal reading, in the same screenful that would otherwise teach it. A channel that disagrees with
itself three times out of four is not read as a cause.

This is a measurement of one import and is honest about that. What it replaces is not a
measurement at all.

### What keeps the side from reading as the figure: it is a different **shape**

The numbers say the collision is rare. What says the two marks mean different things is that they
do not look alike.

Polarity in this app is always a **signed figure** — every toned number goes through
`formatSignedCurrency`, so it carries `+` or `−` as well as a hue, in the figure role's tabular
digits ([[0053-bundled-typefaces-and-the-figure-role]]). The side is a **bordered chip containing a word**,
at `--text-2xs`, in the app's inline badge size. A reader matching a red chip to a red figure has
to cross a difference in box, in type size, in glyph class and in the presence of a sign.

That makes the **border** load-bearing for the first time. DDR-0064 built the toned variants as a
boundary and an ink and measured only the ink, which was fine while the tone merely restated a
figure in the same row. Here the box is the argument, so it is measured:

| Edge (mixed 50% into `--border`) | On `--card` |
| --- | --- |
| `.badge-positive` | **3.12:1** |
| `.badge-negative` | **1.97:1** |
| `.badge-neutral` — what this column wore until today | 1.25:1 |

Both clear `SURFACE_EDGE` (1.2), and deliberately not `NON_TEXT`: what identifies the badge is its
ink and its wording, and the boundary's job is the weaker one that threshold was cut for — mark a
box on the surface rather than dissolve into it ([[0069-boxed-gateway-chip-and-the-raised-surface]]).
The asymmetry is real and worth naming — `--neg` is the darker token, so the loss chip's edge is
the tighter of the two and the first thing a dimmed `--border` would break — but the number that
settles it is the third row: **the quieter toned edge is still 1.6× the neutral edge it replaces.**
The reversal buys a tone without giving up an edge, which is the thing DDR-0065 would have had to
be told to change its mind.

### Four pairings, and two that were deliberately not added

The two inks are already enumerated on both surfaces this column renders them on. On `--card` they
are `.stat-positive` / `.stat-negative` (7.30:1 and 6.88:1); on the table's 4% hover lift they are
`.badge-positive` / `.badge-negative`, added by Story #192 (6.71:1 and 6.33:1, inside the 0.5 that
`--neg-text` is held to against `--pos`). The Trades table's lift is the same rule and the same
mix as the Dividends table's ([[0059-card-strip-and-table-density]]), so the arithmetic is
identical.

So the two lift entries are **re-worded to name both tables rather than copied**. A copy would
measure the same three things — same selector, same ink, same lift — under a second view's name,
could never fail on its own, and is the duplication DDR-0065's own other half removed from the
stylesheet when `.flex-import-dim` became `.data-table .data-table-dim`. `contrast.ts`'s list is
hand-maintained precisely so each entry earns its place; an entry that cannot fail independently
does not.

What is genuinely new is the pair above: the two **boundaries**, on `--card`, at `SURFACE_EDGE`.
Those had never been measured, and this is the story that made them matter.

### The guard is turned around, not turned off

`tradesLayout.test.ts` was written to fail on this change, two ways — a `variant=` in the side cell
and an `=== 'Buy'` branch, "because a tone reached either way is the same decision". Turning it off
was never the option; what replaces it says the same thing about a different target:

- the cell takes `variant={sideVariant(t.side)}` and the view **imports** it;
- **no literal tone** appears anywhere in the view — `variant="positive"` would put the mapping in
  two places;
- **no branch on the side** in the view. The original assertion survives verbatim; what changed is
  not that branching became allowed but *where the one branch lives*;
- **`variant={toneOf(t.realizedBase)}` fails.** This is the sharpest of the four. It type-checks,
  renders, and tones the side *by the row's P&L* — which is not a different implementation of this
  decision but the misreading this decision exists to argue against, shipped as fact;
- the **word stays inside the badge**. Under DDR-0065 the untoned column satisfied DDR-0021 by
  construction; here that rule has exactly one guarantee left, so it is asserted rather than
  assumed.

The mapping moves into `lib/tradeSide.ts` for the reason `closedSomething` was extracted: a cell
function is where a colour decision gets made by accident. It also converts two entries of text
scanning into a real test — `Record<TradeSide, BadgeVariant>` is total by construction, so a third
side added to the shared `z.enum` is a compile error rather than a silent fall-through, and
`tradeSide.test.ts` asserts the containment in `TONED_BADGE_VARIANTS` that keeps this column from
growing the primitive.

## Consequences

Benefits:

- A trade's direction is readable at a glance instead of by reading a word, which is the app's
  densest table and the one the owner scans most.
- The badge's *boundary* is measured for the first time, on both toned variants — a channel three
  call sites have rendered since Story #192 with nothing watching it.
- The decision has one home. A tone reached in the view fails four ways, and the mapping it must
  come from is unit-tested rather than grepped.
- `.flex-import-dim`'s lesson is applied to `contrast.ts`: a second call site widens an entry's
  reach rather than cloning it.

Tradeoffs:

- **`--pos` and `--neg` now carry two meanings in this app**, which is a real cost and not one the
  measurement makes disappear. Where they meet — a red `Sell` beside a red figure — the row is
  ambiguous for as long as it takes to notice the chip is a chip. Four rows in this import; a
  portfolio that sells mostly at a loss would meet it more often, and the argument above is the
  count, not a guarantee.
- The reasoning DDR-0065 generalised — "a hue this app has spent on polarity cannot be borrowed for
  a category on the same row" — is narrowed rather than kept: it holds where the two marks look
  alike, and this pair does not.

Risks:

- **The mapping is conventional, not derived.** Green-buy / red-sell is the convention IBKR's own
  platform uses, and it is *not* a cash-flow reading — a buy takes money out. A reader who arrives
  expecting the app's polarity meaning has to learn the column once.
- `--neg` at 50% into `--border` is 1.97:1 and is now the app's tightest boundary. A future dimming
  of `--border`, or a lighter `--card`, breaks the loss chip's box before anything else — which is
  why it is enumerated rather than left to the eye.
- The Dividends type badge and this one now share a vocabulary while asking different questions of
  it: there the tone is the amount's own sign, here it is a category. A third toned badge should
  say which of the two it is.

## Alternatives Considered

### Option A — leave DDR-0065 standing

Rejected by the owner, who asked for the change. Worth recording that the argument for it was
weaker than it looked: it rested on a collision that this import realises in 1.5% of rows and
contradicts in 5.4%.

### Option B — tone it and say nothing

Refused by CLAUDE.md, and it would have lost the two findings above — the counted collision and the
unmeasured badge boundary — neither of which was reachable without asking why the first decision
said no.

### Option C — a substitute hue

Still declined, and by DDR-0065's reasoning unchanged: `--accent` means news (DDR-0037) and the
`--series-*` slots are the sector palette's (DDR-0030). Nothing about this story frees either.

### Option D — an inline ternary in the cell

Two lines shorter and it keeps the decision in the file whose guard exists to stop decisions being
made there. The module costs one import and buys a behavioural test where there was a text scan.

### Option E — four new `contrast.ts` pairings, two per tone

The literal reading of the story's acceptance criterion, and it would have added two entries whose
arithmetic is character-for-character an entry already in the list. Both surfaces are covered for
both tones; the two entries that were missing are the borders, and those are the ones added.

## References

- Story #257 — Tone the Trades side badge; Epic #253
- [[0065-untoned-side-badge-and-the-dimmed-cell]] — the decision this supersedes, in its side-badge
  half only. Its dimmed cell, its `closedSomething` predicate and its `Best`/`Worst` tone all stand
- [[0064-toned-badges-and-the-income-key]] — the toned pair, border-carried and never a fill
- [[0037-badge-primitive-variants-and-sizes]] — a badge is a boundary and an ink; `accent` is news
- [[0046-contrast-split-tone-tokens]] — `--neg` fills, `--neg-text` inks, and picking wrong is silent
- [[0054-navy-indigo-palette-re-key]] — the tokens measured here
- [[0059-card-strip-and-table-density]] — the table's hover lift, and the pairings already on it
- [[0069-boxed-gateway-chip-and-the-raised-surface]] — `SURFACE_EDGE`, and why it is not a WCAG bar
- [[0021-allocation-map-gain-loss-scale]] — superseded, still governing: never colour alone
- [[0030-allocation-map-country-donut-pairs]] — why the `--series-*` slots were not available
- [[0039-data-table-primitive-and-column-sorting]] — sorting is the column's, not the cell's
- [[0053-bundled-typefaces-and-the-figure-role]] — what a figure looks like, and therefore what a chip does not
