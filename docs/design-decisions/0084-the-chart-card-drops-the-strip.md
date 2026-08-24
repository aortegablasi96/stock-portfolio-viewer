# 0084. The chart card drops the ruled strip, geometry and all

- **Status:** Accepted

- **Date:** 2026-08-24

## Context

Every card in the app states its title on a **ruled strip**
([[0033-card-primitive-variants-and-sizes]], [[0059-card-strip-and-table-density]]): title
left, whatever the card offers to do with itself right, a 1px `--border` rule below, and the body in
its own region under that. One rule serves two selectors — a `CardHeader` and a bare `CardTitle` —
precisely so a reader cannot tell which of the two a card used.

The strip is right for a card whose header carries an action. It is wrong on a **chart** card, which
is a title over a picture: a full-width horizontal line drawn immediately above a plot reads as part
of the plot — a second axis, or the top of a frame the chart does not have. The Figma proposal draws
all five chart cards unruled, and its own header (`SectionHeader`) is a plain flex row with
`marginBottom: 16` and no border at all.

The scope needed no new hook. The five cards in question already share `.chart-card-header`, set by
`ChartCard` in `PerformanceView.tsx` for all four Performance charts and by the income card's header
in `DividendsView.tsx`. That class exists for a different reason — `flex-wrap: nowrap`, so the four
Performance cards stay exactly one line tall in the header and therefore exactly the same height
([[0052-composition-cumulative-and-chart-readability]]) — but it is already the chart-card scope.

**Deleting the border alone would not have finished it.** The strip is a geometry as much as a line:
it cancels the card's own inline padding with a negative `--card-pad` so the rule reaches both
edges, then re-applies that padding as its own, and carries `--space-5` of vertical padding besides.
Remove only `border-bottom` and the header still bleeds out to the card's edges and still holds a
36px gap down to the plot — a title spaced for a division that is no longer drawn.

## Decision

### The chart card is the strip's one stated exception

Not a global change. The Performance periods table, the Dividends By Ticker table and its upcoming
panel, Data sources, Stored statements and the Portfolio cards all keep the strip, and `Card`'s own
rule is untouched for every one of them. What changes is scoped to the class the two call sites
already wore, so a sixth chart card inherits the treatment by *being* a chart card rather than by a
call site remembering to ask — `className` is for placement, not decoration
([[0032-button-primitive-variants-and-sizes]]).

### All three declarations go back, not one

```css
.card-header.chart-card-header {
  flex-wrap: nowrap;
  margin: 0 0 var(--space-5);
  padding: 0;
  border-bottom: none;
}
```

The same three the strip owns, given back in the same order `.card-header:last-child` already gives
them back — the precedent for "this header is not a strip" was in the stylesheet before this story
and is reused rather than re-invented. What is left is a plain flex row inside the card's own
padding.

### The gap beneath the title is a chosen number

`--space-5` (16px), which is three things at once: the proposal's own `marginBottom: 16`, the step
`.card-title` already carries under a bare title, and a scale step rather than a leftover
([[0031-design-token-scales]]). The space *above* the title becomes the card's own
`--surface-pad-md` (20px), and the space to either edge the same — the header no longer states its
own inset, so it cannot disagree with the body beneath it. Before this story none of those three
numbers was chosen: they fell out of a negative margin, a re-applied padding and a `--space-5`
stacking on top of each other, which is how the plot ended up 36px below its own title.

### The selector names both classes, which is the load-bearing half

`.card-header` and `.chart-card-header` are each one class. A bare `.chart-card-header` rule would
**tie** the strip on specificity and win only on source order — the trap
[[0059-card-strip-and-table-density]] records and this repo has shipped once, when a bare
`.chart-mark-pos` lost to `.chart-dot` the same way. Naming both classes states what is true — a
card header that is a chart's — and wins wherever in the file it is written. The unit test asserts
the compound rule exists *and* that no bare one does.

## Consequences

- **The five chart cards are ~30px shorter** and their plots sit closer to the titles that name
  them. The Performance grid's rows still align, because every card in a row lost the same 30px.
- **The header is still exactly one line tall.** `flex-wrap: nowrap` stays in the rule, the title
  still shrinks and ellipsizes, and the key still keeps its full width
  ([[0052-composition-cumulative-and-chart-readability]], [[0051-performance-chart-grid]]).
- **The key's placement is unchanged.** It stays in the card header rather than becoming a
  `<figcaption>`; the chart below it is still a bare `<svg>`
  ([[0052-composition-cumulative-and-chart-readability]], [[0064-toned-badges-and-the-income-key]]).
- **Nothing inside a `viewBox` moved.** Plot padding, axis gutters and label sizes are
  [[0018-content-measure-and-chart-aspect]]'s and [[0051-performance-chart-grid]]'s,
  and none of them reads the card header.
- **Every value is a token.** `--space-5`, `0` and `none`; the adoption ratchet's `BASELINE` stays
  empty and `EXEMPTIONS` does not grow ([[0042-token-adoption-ratchet]]).
- **It is pinned where it can actually be seen.** `lib/cardVariants.test.ts` asserts the rule and
  the absence of a bare one; `e2e/chart-card-header.spec.ts` reads the *cascade* — a text guard
  passes off the source whichever selector was written, which is the failure class
  [[0075-sidebar-nav-rhythm-and-the-boxed-currency]] records. The chart cards need imported Flex
  history to render and the e2e app deliberately has none, so the chart header is read off a probe
  wearing its classes inside a real `.card`, the way `reduced-motion.spec.ts` reads a `.pie-slice`;
  the other half — that a card which is *not* a chart card still draws its strip — is read off a
  real one, Portfolio's "Data sources".
- **A hairline is not `1px` to a monitor.** The e2e assertions parse the border width rather than
  comparing the string: on a 1.25 device scale factor a 1px rule computes as `0.8px`, so a literal
  would have passed or failed by display. Zero is still zero.

## Alternatives Considered

### Turn the rule off globally

Rejected. The strip is [[0059-card-strip-and-table-density]]'s decision and it is right
wherever a header carries an action beside a title — which is most of the app, and which the
proposal itself keeps. The defect is a line above a *plot*, not a line above a body.

### Drop `border-bottom` and leave the geometry

Rejected, and it is the version this story exists to rule out. The bleed and the re-applied padding
are what the rule was drawn *on*; without it they space a title for a division that is not there,
leaving 36px of nothing between a title and the picture it names.

### A `chart` variant on `Card`, or an `unruled` axis on `CardHeader`

Rejected. A variant carries the surface colour and a size carries the padding — two axes, and this
is neither ([[0033-card-primitive-variants-and-sizes]]). A third axis whose only member is "the
chart one" would put a scope that already exists into the component API, and every call site would
then have to remember to pass it.

### A `className` at the two call sites

Rejected by [[0032-button-primitive-variants-and-sizes]]: `className` is for placement, not decoration. It
would also be two places to change and a sixth chart card's chance to forget.

### Keep the bare `.chart-card-header` selector and rely on source order

Rejected on the record. It works today and would keep working until someone moves the rule, which is
exactly what [[0059-card-strip-and-table-density]] logged after it happened once.

## References

* [[0033-card-primitive-variants-and-sizes]] — the `Card` primitive and its two axes; the decision
  this scopes an exception out of.
* [[0059-card-strip-and-table-density]] — the ruled strip itself, its bleed, and the
  source-order trap this selector avoids.
* [[0052-composition-cumulative-and-chart-readability]] — the one-line header, the key beside the title,
  and why the four cards must match in height.
* [[0051-performance-chart-grid]] — the shared grid geometry the cards sit in.
* [[0031-design-token-scales]] / [[0042-token-adoption-ratchet]] — the scale the gap comes
  from, and the ratchet that keeps it a scale.
* [[0075-sidebar-nav-rhythm-and-the-boxed-currency]] — why a text guard is not evidence a line is
  gone.
* `renderer/src/app.css` (`.card-header.chart-card-header`), `renderer/src/lib/cardVariants.test.ts`,
  `e2e/chart-card-header.spec.ts`.
* Story #255, Epic #253.
