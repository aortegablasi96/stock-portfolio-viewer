# 0059. The card's ruled header strip, and the table's density

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

The Figma Make proposal Epic #179 adopts draws two things on every screen: a card, and a table. Its
card is a 12px-radius surface whose top is a **ruled strip** — title left, whatever the card offers
to do with itself right, a 1px rule below it — with the body in its own region under that. Its table
is denser than this app's: 11px uppercase letter-spaced column heads, a rule under the head, a rule
between rows but **not** after the last one, a lift under the row the pointer is on, and the sorted
column carried by an accent-coloured head with an arrow.

Both already exist here as primitives — `Card` ([[0033-card-primitive-variants-and-sizes]]) and
`DataTable` ([[0039-data-table-primitive-and-column-sorting]]) — so Story #186 is a restyle of two
rule families, not a rebuild. Reading the proposal against the stylesheet, most of what it asks for
turned out to be either already true or a smaller change than it reads as, and that is the first
thing worth recording:

- **The radius is already the redesign's.** `--radius-lg` is 12px, and it is 12px *because* the
  proposal is where the radius scale came from ([[0031-design-token-scales]]).
- **The padding is already on the scale.** The proposal's card is `20px 24px`; `--surface-pad-md` is
  20px. The one-step horizontal difference was left alone deliberately — see *Alternatives*.
- **The trailing row rule is already dropped.** `tbody tr:last-child` has cleared it since #134.
- **The sorted column already carries the accent and an arrow**, and the arrow is a second channel
  rather than decoration ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]'s rule applied to
  a header).

So what the story actually changes is three things: the header strip, the column head's type, and
the row hover. The proposal's own implementation of the third is the one part of it that cannot be
adopted at all — it is `onMouseEnter`/`onMouseLeave` writing `currentTarget.style.background`, which
in this app would put a re-render behind every pointer move across a 260-row trade history.

## Decision

### The strip is one rule over two selectors, and it bleeds with a negative margin

```css
.card-header,
.card > .card-title:not(:last-child) {
  margin: calc(-1 * var(--card-pad)) calc(-1 * var(--card-pad)) var(--card-pad);
  padding: var(--space-5) var(--card-pad);
  border-bottom: 1px solid var(--border);
}
```

Two properties of that rule are the decision, and neither is obvious.

**Two selectors, because a card states its title two ways.** Nine of the sixteen card titles in the
app are a bare `CardTitle` with nothing beside them; seven are a `CardHeader` with a toolbar, a
filter strip or a button. A reader must not be able to tell which — a rule under some card titles
and not others is worse than a rule under none — so both wear the same three declarations, in one
rule, for the same reason the figure role is one rule and not eleven
([[0053-bundled-typefaces-and-the-figure-role]]).

**The rule reaches both edges, which means cancelling the card's own padding.** A rule inset by 20px
reads as an underline on the title; a rule that meets the card's border reads as a division of the
card. The strip therefore negates the card's inline padding and re-applies it as its own — which
needs a length the *size* rules carry, and a shorthand cannot be read back off the box, so each size
names its padding twice:

```css
.card-md {
  --card-pad: var(--surface-pad-md);
  padding: var(--surface-pad-md);
}
```

Stated in all three size rules rather than defaulted on `.card`, so a size is one place to read and
one place to change. `padding: var(--surface-pad-<size>)` is untouched, which is what keeps
[[0033-card-primitive-variants-and-sizes]]'s guarantee — a size carries padding and nothing else —
and keeps `Card` at two axes: **no call site names a strip, and none can turn one off.**

`:not(:last-child)` is the one exclusion. A card that is *only* a title would otherwise draw a rule
across its own bottom edge. The same case reached from the other side is `.card-header:last-child`,
which the import panel hits before anything has been imported: it gives the margin, the padding and
the rule all back, because a header with no body is not dividing anything and the card is just a
padded surface again.

### `CardContent` is untouched, and that is the point

Every declaration above is on the *header*. Nothing moved to `.card`, and nothing was added to
`.card-content`. That is what keeps [[0033-card-primitive-variants-and-sizes]]'s scope rule intact:
`.panel`'s descendant overrides hang off `.card-content`, so a `StatePanel` — a `Card` at `lg` whose
content is prose, with no title and no header — renders byte-identically to before this story. A
restyle that had reached for `.card` to add the strip's spacing would have restyled every state
panel in the app silently, which is the trap the story was filed with.

### The column head is 11px, and the tracking goes with it

```css
font-size: var(--text-2xs);   /* 11.5px, the scale's step at the redesign's 11px */
letter-spacing: 0.06em;       /* was 0.04em */
```

The two are a pair, not two changes: `--text-2xs` alone is small capitals set at a body face's
tracking, which is the one thing eleven-pixel uppercase does not survive. The ink and the weight are
deliberately *not* touched — this is a quieter label, not a fainter one, and `--muted` on `--card`
is the pairing `lib/contrast.ts` already holds at 5.80:1.

### The row hover is CSS, and the linked row still out-weighs it

```css
.data-table tbody tr:hover > th,
.data-table tbody tr:hover > td {
  background: color-mix(in srgb, var(--text) 4%, transparent);
}
```

A reading aid on every table in the app: a wide row of figures is easy to slip a line on, and the
lift is what ties a ticker at the left edge to a P&L at the right. `--surface-2` was **not** added
for it — [[0054-navy-indigo-palette-re-key]] declined the proposal's extra surface tokens for want
of a call site, and this call site is served by the idiom that re-key established instead: a token
mixed into the surface under it, measured rather than eyeballed.

The transition is `--duration-fast` and never a number. The pointer is already on the row, which is
what that step means ([[0044-motion-scale-and-reduced-motion]]), and under `prefers-reduced-motion`
the token is `0ms`, so the lift lands instantly rather than not at all.

The part that needed deciding is what happens where a row is *also* linked to something outside the
table — the donut slice under the pointer, in the Allocation breakdown
([[0040-allocation-breakdown-linked-slice-emphasis]]). Both states are on the same row whenever the
pointer is what linked it, which is the common case, and the emphasis has to win: the hover says
"you are reading this line", the link says "this line is the wedge you are pointing at". It wins the
way CSS decides rather than by being louder — the active rule is now scoped to `.data-table tbody
tr` too, matching the hover's specificity, and sits after it in the file:

```css
.data-table tbody tr.data-table-row-active > th,
.data-table tbody tr.data-table-row-active > td {
  background: color-mix(in srgb, var(--text) 7%, transparent);
}
```

Left unscoped, `tbody tr:hover > th` carries two more element selectors than
`.data-table-row-active > th` and would have taken the row over silently — leaving the link visible
from the keyboard and invisible from the pointer, which is the arrangement it exists to prevent. The
active row stays **neutral**: it is pointed at, not selected, and the accent already means "this
column holds the sort".

### The title takes full ink

`.card-title` was `--muted` at the `h2` weight, which is the reading of a title that sits *inside*
the body it names. On a ruled strip a muted title reads as a disabled one, so it is `--text` at 600
— the proposal's own values. The distinction [[0033-card-primitive-variants-and-sizes]] drew between
a card *title* (sentence case) and a *label* naming one figure (uppercase, tracked) is untouched.

## Consequences

Benefits:

- Every panel in the app is built the same way: a strip, a rule, a body. Two markup shapes, one
  reading.
- The four Performance cards stay exactly the same height, because `ChartCard` is the only place
  their header is declared and all four therefore grow by the same amount
  ([[0052-composition-cumulative-and-chart-readability]]).
- A long table is easier to read across, and the head is quieter without being fainter.
- Nothing in either primitive's API moved: no new component, no new axis, no per-call-site override.

Tradeoffs:

- The strip's cost is height: roughly 36px per card, which on the Performance grid is 36px twice
  over. Cards are taller than they were, and that is the redesign's shape rather than a regression.
- A card's body content is still inset by the card's padding, so a table inside a card does not
  reach the strip's rule. The proposal draws table cards at `padding: 0` with a full-bleed table;
  that is a *layout* change per view and belongs to #189–#193, not to the primitives.

Risks:

- `--card-pad` is a length stated twice in the same rule. A size that grows a padding and forgets
  the variable would draw its strip at the wrong width — invisible in review at `md`, since the
  strip's own padding would still look plausible. `cardVariants.test.ts` asserts both halves of all
  three size rules for exactly that reason.

### Guards

- `lib/cardVariants.test.ts` — the strip rule (both selectors, all three declarations), the
  `--card-pad` restatement in every size, the `:last-child` reset, and the title's ink and weight.
  The existing three failure modes are unchanged: a superseded selector returning, an axis value
  with no rule, a primitive re-declaring the focus ring.
- `lib/dataTableVariants.test.ts` — the 11px head *and* its tracking together, the hover's mix and
  its `--duration-fast` transition, the rules between rows and under the head but not after the
  last, and the source-order relationship the linked row depends on. Plus a comment-stripped scan of
  `DataTable.tsx` for an inline `style` or an element-style write — the prototype's hover, which the
  handlers that *do* stay (`onMouseEnter` reporting the linked row) would otherwise hide.
- `lib/contrast.ts` — three pairings, in the form [[0055-vertical-sidebar-tablist]] introduced: a
  token mixed into a surface. `--text` on the hover lift is 13.81:1, `--muted` on it is 5.34:1, and
  `--muted` on the linked row's 7% is 4.97:1. 10% would measure 4.60:1, so the ceiling on this
  family is close enough that a later story reaching for a louder row has to measure it rather than
  eyeball it.
- `lib/sliceHighlight.test.ts` — amended for the active row's new selector, since that test is what
  pins the emphasis as neutral.

## Alternatives Considered

### Give the card the proposal's `20px 24px` padding

Rejected, and the reason generalises. `--surface-pad-md` is a single length used by every card in
the app, `StatTile` and `StatePanel` included; making it two lengths to gain 4px of horizontal inset
would change every surface in the app for a difference no criterion names, and would cost the strip
its one-variable bleed (a shorthand's horizontal half cannot be negated). The same finding as
[[0054-navy-indigo-palette-re-key]]'s eight unchanged series hues: where the proposal and a
validated scale differ by less than the scale's own step, the scale wins.

### Draw the strip only where a `CardHeader` exists

Half the call sites would keep an unruled title. The rule would then read as a property of *having a
toolbar*, which is not a distinction a reader can see or should have to.

### Move the card's padding onto `CardHeader` and `CardContent`

The obvious way to get a full-bleed rule without a negative margin, and it breaks the size axis:
`.card-{size}` would stop carrying padding, so a card with neither a header nor a `CardContent` —
`StatTile`, `StatePanel`, the realized-gains highlight — would lose its padding entirely, and each
would have to name a size again from inside. One axis would become three.

### A `--surface-2` token for the row lift

The proposal has one, and [[0054-navy-indigo-palette-re-key]] declined it for want of a call site.
One call site is not enough to change that: a token in the scale is a promise that the *next* rule
should reach for it, and a hover lift is exactly the case the `color-mix()` idiom was established
for — it stays relative to whatever surface the row sits on, where a fixed token would be wrong the
first time a table is drawn on `--bg`.

### Make the hover and the linked row the same tint

Simpler, and it deletes the emphasis: [[0040-allocation-breakdown-linked-slice-emphasis]] exists so
that pointing at a row says something about the donut beside it. Two tints, three points apart, is
the smallest thing that keeps both readable.

## References

- Story #186, Epic #179 — the redesign's shared surfaces
- [[0033-card-primitive-variants-and-sizes]] — the card's two axes, and `CardContent` as a scope
- [[0039-data-table-primitive-and-column-sorting]] — the table's container axes and opt-in sorting
- [[0040-allocation-breakdown-linked-slice-emphasis]] — the linked row, and why it is neutral
- [[0052-composition-cumulative-and-chart-readability]] — the four chart cards' equal height
- [[0044-motion-scale-and-reduced-motion]] — `--duration-fast`, and the scroll-fade exemption
- [[0054-navy-indigo-palette-re-key]] — the `color-mix()` idiom, and the surface tokens not added
- [[0031-design-token-scales]], [[0042-token-adoption-ratchet]] — the scale, and the ratchet
- [[0046-contrast-split-tone-tokens]] — the pairing list this adds three entries to
