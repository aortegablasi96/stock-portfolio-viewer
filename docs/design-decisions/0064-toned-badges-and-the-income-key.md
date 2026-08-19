# 0064. A toned `Badge` that is still not a fill, keyed off the amount rather than the type

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

Story #192 restyles the Dividends view. Structurally it already carried the redesign — three KPI
tiles, the upcoming-dividends card, `Income over time`, `By Ticker`, and the transactions table
with its two filters — so the story is presentational, and three of its parts are genuinely open.

**The type badge.** The prototype draws each transaction row's type as a *tinted chip*: emerald
ground for `Dividends`, rose ground for `Withholding Tax`. `Badge` has neither a fill nor a tone
([[0037-badge-primitive-variants-and-sizes]]): a badge is a boundary and an ink, deliberately, and
the fill `.native-chip` used to declare was the one visual correction that story made. The chip
also has to land in a table cell without moving the row, which is the trap the size axis exists
for — arriving here from the other direction, because in that story `sm`'s missing vertical
padding protected a chip *beside* a value, and here it has to protect a badge that **is** the cell.

**Where the tone comes from.** The service builds this table from three Flex cash types:
`Dividends`, `Payment In Lieu Of Dividends` and `Withholding Tax`. Two of them are income, one is
not, and a branch on those strings would be right today and silent tomorrow — a reversal, a fee
IBKR renames, a fourth type the parser starts admitting, all falling into the gain tone with
nothing in the suite to notice.

**The income key.** The card's legend was a `<figcaption>` under the plot, and the card carried a
four-line source note above it. [[0052-composition-cumulative-and-chart-readability]] settled the
same question for the composition stack one milestone ago and moved its key into the card header.

## Decision

### Two toned variants, and the fill stays declined

`positive` and `negative` join `neutral | accent | plain`, on the primitive's own terms: the tone
mixed halfway into `--border` for the boundary, the tone as ink, and no background.

```css
.badge-positive {
  border: 1px solid color-mix(in srgb, var(--pos) 50%, var(--border));
  color: var(--pos);
}
.badge-negative {
  border: 1px solid color-mix(in srgb, var(--neg) 50%, var(--border));
  color: var(--neg-text);
}
```

Three things are load-bearing here.

**The ink is the split, and picking the wrong half is silent**
([[0046-contrast-split-tone-tokens]]). `--pos` is a text token as well as a fill; `--neg` is fill
only, so the loss ink is `--neg-text`. The *boundaries* take the fill tokens, because a border is
painted area rather than glyphs — the same reading that puts `--neg` on the gateway dot and
`--neg-text` on the line beside it.

**The mix is the idiom `.capture-status-error` and `.state-panel-error` already use**, not a new
one. Full strength on a 200-row transactions table reads as stripes; half into `--border` measures
3.12:1 (gain) and 1.97:1 (loss) against `--card`, both louder than the 1.25:1 boundary every
`neutral` badge already draws. The two are not equally loud, and that asymmetry is inherited
rather than chosen: `--neg` is the darker of the fill pair, which is exactly why `--neg-text`
exists. The boundary is not the channel — the badge's text names the type — so the imbalance costs
nothing that a figure does not already carry.

**Neither variant takes `.badge-accent`'s `font-weight: 600`.** That weight exists because
`accent` means *news*, a meaning a call site could word away ("Imported" / "Already imported" are
its doing, not the primitive's). A type badge cannot stop naming its type, so the tone is a second
channel here by construction and a weight step would only make a dense table louder.

**Two new pairings are enumerated in `lib/contrast.ts`**, because a badge in a table is text on a
surface that *lifts under the pointer* and nothing had measured either tone one step lighter.
`--pos` is 6.71:1 and `--neg-text` 6.33:1 on the hovered row — still within
[[0046-contrast-split-tone-tokens]]'s balance rule, which binds the loss tone to within 0.5 of the
gain tone rather than to 4.5:1.

### The variant union is a superset of the tile's tone union

`STAT_TONES` is `neutral | positive | negative` and `BADGE_VARIANTS` now contains all three, so
`toneOf(e.amountBase)` names a variant directly:

```tsx
<Badge variant={toneOf(e.amountBase)} size="sm" className={BADGE_CELL_CLASS}>{e.type}</Badge>
```

`neutral` is what makes this work — it is the default badge *and* the absence of a tone
([[0034-stat-tile-primitive-tone-axis]]), so a zero-amount row falls through to the bordered muted
label with no branch at the call site. The containment is asserted in `badgeVariants.test.ts`:
two unions agreeing on two names and disagreeing on the third would type-check everywhere and
render the wrong chip in one place.

### The tone comes from the row's signed amount, never from its type string

`toneOf(e.amountBase)`, and the same call tones the `In EUR` column through `cellClassName`. The
amount already answers the question the tone is asking — money in, or money out — for every type
the parser will ever admit. `dividendsLayout.test.ts` fails on a type-string literal appearing in
the view.

### `sm` in the cell, with the gap taken off by a placement class

`md`'s vertical padding puts a `--text-xs` line above a `--text-sm` one and grows every row of the
table; `sm` carries no vertical padding and is the right box. What `sm` also carries is
`margin-left` — the gap from the value in front of it — and here there is no value in front of it,
so 6px would set the column's only element in from its own uppercase header.

CSS cannot tell the two apart. The inline chips follow a **text node**, and `:first-child` and
`:only-child` count elements, so both forms are the first element child of their `<td>`. The gap
therefore stays on the size and the cell form is *placement*, which is what `className` is for
(ADR-0008):

```css
.badge.badge-cell { margin-left: 0; }
```

Doubled for the same reason `.badge.badge-plain` is — it undoes a size's declaration, and equal
specificity would leave it to source order. `BADGE_CELL_CLASS` is exported so the one rule has one
name pointing at it, and the test asserts the rule declares *exactly one* property: a padding or a
type size creeping in would be a third size wearing a placement class.

### The income key moves into the card header

`IncomeLegend` renders `chart-legend chart-legend-header` inside the card's `CardHeader`, and
`ColumnChart` emits a bare `<svg>` — the `<figure>`/`<figcaption>` wrapper is gone, the same shape
[[0052-composition-cumulative-and-chart-readability]] left the three grid charts in. Both halves
take the same two label constants, so the key cannot name one thing while the segment under the
pointer names another.

The four-line source note becomes one line. The legend now names the two series, so what is left
is only what the legend cannot say: that the column's full height is gross, and that a month whose
withholding outweighs its dividends dips below the zero line.

`ColumnChart` stays its own component and does not merge into `BarChart`
([[0052-composition-cumulative-and-chart-readability]]): it stacks two series, keys them and labels
every column, and `BarChart` does none of the three.

## Consequences

Benefits:

- The redesign's tinted chip arrives without a fill, so [[0037-badge-primitive-variants-and-sizes]]
  survives the milestone rather than being amended out of it — and #193's side badge inherits a
  variant list that has already stated what the gain/loss pair means.
- One `toneOf()` call tones the badge and the figure beside it, so the two cannot disagree about a
  row.
- The tone is right for a type nobody has seen yet.
- The income card is one header plus one bare `<svg>`, like the four Performance cards.

Tradeoffs:

- `.badge.badge-cell` is the second doubled-class selector among the primitives. The alternative
  was a third size differing from `sm` by one declaration, which would have put a *placement*
  question on an axis that carries type and padding.
- The two boundaries are not equally loud (3.12:1 against 1.97:1). Balancing them would mean
  putting `--neg-text` on a border, which is the split's other half and the thing
  [[0046-contrast-split-tone-tokens]] exists to stop.
- A row now carries its polarity twice — the badge and the EUR figure. That is redundancy rather
  than noise, but a third toned element on the same row would be.

Risks:

- `positive`/`negative` are one keystroke from `accent` at a call site, and a wrongly toned badge
  renders perfectly. The containment test binds them to `toneOf`, which is where the tone is
  decided; nothing checks a hand-written `variant="positive"`.

## Alternatives Considered

### A tinted background, amending DDR-0037

Rejected. The story allowed it explicitly, and the case against is the one DDR-0037 already made
and this view sharpens: a badge with its own fill reads as a button the first time it lands on a
nested surface, and here it would land on a surface that *lightens under the pointer*
([[0059-card-strip-and-table-density]]) — so the tint would sit on a moving ground, and either the
tint or the lift would have to be measured against the other on every row. The boundary-and-ink
form gets the same "this row is income / this row is tax" read with one surface underneath it.

### A third `size` for the dense standalone form

Rejected. It would differ from `sm` in exactly one declaration, and that declaration is not type
or padding — it is whether a value sits in front of the badge, which is placement. Two of the
primitives already declined a size axis for the mirror reason
([[0034-stat-tile-primitive-tone-axis]], [[0035-field-and-form-control-primitives]]).

### Taking the gap off `.badge-sm` and giving it to the inline call sites

Rejected. Four call sites in two files would each need a wrapper to reproduce a 6px gap, and
DDR-0037 put the margin on `sm` deliberately: the gap is part of the inline *form*, not a layout
decision the holdings table makes.

### Matching the type strings

Rejected, above.

### Leaving the legend under the plot

Rejected. It is the placement DDR-0052 already argued out of the app one story ago, and leaving one
`<figcaption>` behind is the half-done consolidation Epic #125 names as its standing risk.

## References

- Story #192, Epic #179.
- [[0037-badge-primitive-variants-and-sizes]] — the primitive this extends: two axes, no fill, no
  pill, and `sm`'s missing vertical padding.
- [[0046-contrast-split-tone-tokens]] — `--neg` fills, `--neg-text` inks, and the balance rule.
- [[0034-stat-tile-primitive-tone-axis]] — `STAT_TONES` and `toneOf`, the vocabulary reused here.
- [[0052-composition-cumulative-and-chart-readability]] — the legend-in-the-header placement, and
  why the stacked chart is its own component.
- [[0059-card-strip-and-table-density]] — the row lift the toned inks are measured against.
- [[0010-upcoming-dividends-from-flex-accruals]] ·
  [[0005-analytics-read-model-and-base-currency-conversion]] — the two data rules this restyle
  leaves alone, pinned by `dividendsLayout.test.ts`.
- ADR-0008 — `className` extends a primitive for placement, never for colour.
- `src/renderer/src/lib/badgeVariants.ts`, `src/renderer/src/components/charts/ColumnChart.tsx`,
  `src/renderer/src/components/analytics/DividendsView.tsx`.
