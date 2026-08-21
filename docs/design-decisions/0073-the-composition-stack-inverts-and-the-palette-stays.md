# 0073. The composition stack inverts, and the palette stays where it was

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

*Composition over time* stacked from `stock` upward: Stocks on the baseline, then Options, Cash,
Accruals, and the `other` residual on top. That order was never argued for — it is the order the
asset classes are read out of a Flex `EquitySummaryInBase` row, declared once as `BAND_SPECS` in
`performanceService.ts` and drawn in sequence by the renderer.

Two things are wrong with it, and they are the same thing seen from either end of the stack.

**At the top.** The stack shares a 2×2 grid with the value curve it is read against, and its top
edge *is* that curve — the bands sum to NAV by construction ([[0052-composition-cumulative-and-chart-readability]]).
So the edge a reader follows across the card belonged to whichever band happened to be last, which
on this account is a 0.13% accrual sliver. The line the eye tracks was drawn by the smallest thing
on the chart.

**At the bottom.** A band's thickness is legible in proportion to what is beneath it, and the
baseline is the one place a hairline band has a straight edge to sit on. The slivers were instead
stacked on top of a mass that moves from €0 to €68k, so they rode a curve rather than a rule.

The redesign proposal draws it the other way, with the dominant band under the curve's own line and
its fill treatment differentiated: the top band on a vertical gradient (`#6366f1`, 0.8 down to
0.5), the remaining bands flat with a thin stroke of their own colour, gridlines horizontal only.

The trap this story had to walk around is that **the report's `bands` array does two jobs**. It is
the drawing order *and* the palette order: `compositionColors` assigns `pie-series-N` by position,
so reordering it to fix the picture would have moved every hue — Accruals would have taken slot 1,
the palette's only blue and its documented "magnitude / primary" slot, for the thinnest band on the
chart, and Stocks would have changed colour for a reason that has nothing to do with Stocks.

## Decision

### The stack runs least-invested at the bottom, most-invested at the top

Bottom → top: **Accruals, Cash, `other`, Options, Stocks.**

The story fixed three of the five and left the other two to be placed deliberately rather than
fall out of a reversed list. The rule that places all five is one sentence: *the stack ascends by
how invested the money is.* Accruals are not yet money; Cash is money and uninvested; `other` is
invested in something this parser cannot name; Options and Stocks are the named invested bands,
with the core position on top under the curve.

That puts the residual **above the Cash it is not and below the named invested bands it cannot be
identified with**. A plain reversal would instead have put it on the baseline, under Accruals,
which is the one arrangement the story's constraint rules out — and would have given the chart's
floor to the band that means "we don't know".

The order is a `Record` keyed by `CompositionBand['key']`, not a list, so **adding a band to the
domain union stops the renderer type-checking** until someone decides where the new band goes. A
list would have taken the new key silently and dropped the band off the chart.

### The palette keeps the report's order; only the picture inverts

The two jobs split. `bands` orders the **palette**; `lib/composition`'s `stackOrder` orders the
**picture**, and every consumer — ribbons, legend, hover card — reads the stack through it,
carrying each band's original index (because `point.values` is still index-aligned with the
report) and its colour.

The consequence worth stating plainly: **inverting the stack repainted nothing.** Stocks had slot
1's blue as the base of the stack and has it at the top; Cash is still orange, Accruals still aqua,
`other` still the neutral gray. A before/after of the card differs in shape and treatment and in no
hue at all.

The alternative — reorder `BAND_SPECS` and teach the renderer a key→slot map instead — puts the
same split in place with the halves swapped, and was rejected on two counts. It leaves *stacking
order*, which is presentation, declared in a service, which Epic #179 is explicitly holding still;
and the array it leaves in the service would be an order that means nothing to the service itself.
The service is untouched by this story apart from two doc comments.

### The legend and the hover card read top-down

Both are the stack reversed, so a reader moving between the key, the picture and the readout finds
the bands in the same sequence — the sequence they are looking at. Before this story the legend
happened to read top-down, because the report's order was the stack's; now it is stated. The
`Total` row stays last: it is the stack, not a band.

### The top band takes the gradient; every band takes a stroke of its own colour

- **Top band:** the proposal's vertical ramp, `stop-opacity` 0.8 at the band's top edge down to
  0.5 at its bottom, over the band's own bounding box (which is what the proposal's chart does
  too). Stops live in `app.css`, the `fill` is per element, and the id comes from `useId()` —
  [[0061-chart-language-gradient-zero-line-and-one-hover-card]]'s rule, and this page now mints
  three gradients rather than two. The top band is **whichever band reaches the top**, not `stock`
  by name: an account holding no equities still gets its NAV edge treated as the edge it is.
- **The proposal's `#6366f1` is not adopted**, only its ramp. The band's colour stays its palette
  slot, for the reason [[0071-indigo-value-curve-and-the-signed-return-curve]] gives from the other
  side: `--accent` is the *value curve's* hue now, and painting the Stocks band with it would put
  the curve's colour on a band beneath a different curve.
- **The remaining bands stay at `fill-opacity: 0.5`**, and the proposal's 0.7 is declined.
  [[0052-composition-cumulative-and-chart-readability]] picked 0.5 on screen against the owner's
  real import, having tried 0.62 and found it still the loudest thing in the grid, and the two
  curves it would shout down are still beside it. What the proposal was buying with the extra 0.2
  — definition on a small band — the stroke buys instead, and buys better.

  > **Superseded by [[0076-the-band-tint-is-measured-and-the-edge-carries-the-band]]** (Story
  > #235). The proposal's 0.7 is adopted after all, and so is the 0.8→0.5 ramp beside it, because
  > the softening moved out of the alpha channel entirely: a band's fill is now its hue mixed
  > 62.5% into `--card` first. The decision this bullet was making — *is 0.5 or 0.7 the right
  > number* — turned out to be unanswerable as posed, since neither is a value any test could
  > measure. Everything else in this section stands: the ramp, the stroke and the hue are
  > unchanged, and the stroke stays at **full strength** precisely so the softened fills can sit
  > under it.
- **The stroke is 1px of the band's own `--series-hue`**, `non-scaling-stroke` for
  `.chart-bar-active`'s reason: by a few hundred trading days a band is a hairline, and a stroke in
  viewBox units would be wider than the ribbon it edges. The top band's is 1.5px, the proposal's,
  and the edge it draws is the reader's NAV.

**This is not the stroke [[0052-composition-cumulative-and-chart-readability]] removed**, and the
distinction is the whole reason it can come back. That one was `--card`, drawn to *delimit*
neighbours the way `.pie-slice` does, and a stroke thick enough to see is thicker than a 0.13%
band — so on this portfolio it painted the card colour straight over the slivers it was meant to
separate, and they read as dark specks. This one is the band's own colour, so the same sliver is
drawn *as itself* rather than obliterated. The failure mode is inverted, which is why the outcome
is too.

### A palette slot publishes `--series-hue`

`.pie-series-*` already carried a slot's colour twice — `fill` for an SVG mark, `background` for an
HTML swatch. It now carries it a third time as `--series-hue`, an inheritable value for the
properties `fill` cannot stand in for: a band's `stroke`, and its gradient's `stop-color` read off
the class on the `<linearGradient>` itself.

This is what keeps the treatment down to one copy of the palette. The alternatives were a
`.stack-*.pie-series-*` pair per slot (eighteen rules, a third enumeration of eight hues) or a
fourth class family. Declaring a custom property costs nothing on the elements that do not read it.

It also settles the markup: **CSS beats a presentation attribute**, so a ribbon carrying
`.pie-series-N` cannot also be filled with `url(#…)`. Each ribbon is therefore wrapped in a `<g>`
whose only job is to publish the hue, and the top ribbon takes its fill from the attribute with no
CSS competing. The group is uniform across bands so the rule has one shape.

### The key's swatch is a miniature of the mark

8×8 with a 2px corner — the proposal's square, and a corner that keeps the 25% of its width the
12px swatch had, rather than inheriting one drawn for a bigger square. It is **no longer softened
to 0.5**: that matched the slab, and every band now carries its hue at full strength on its own
edge, which is what the key states. (Story #235 softened the fills further still and deliberately
left the swatch where it is, on this sentence:
[[0076-the-band-tint-is-measured-and-the-edge-carries-the-band]] keeps the edge at full strength,
so the key keeps stating it.) The shared `.legend-swatch` is untouched, so the donut legends
keep their 12px.

The 2px corner is the token ratchet's **ninth** exemption
([[0042-token-adoption-ratchet]]), and the first that could not be widened into
an existing entry: two squares of different sizes with proportional corners are two values, not one
rule with two members.

### Everything the stack means is unchanged

It still stacks cumulatively in base currency with the top edge as the day's NAV; a negative band
still hangs **below** the zero line rather than being clamped or folded; `other` is still the
surfaced residual and is never redistributed. `composition.test.ts` still asserts the top edge
against `point.total`, and `orderComposition` is asserted to leave `total` alone and to keep a
negative band signed through the reshuffle. Reviewed on screen against the owner's real import,
including a margin range with Cash at −€4,000, where the orange band hangs below the rule and the
domain widens to fit it.

## Consequences

Benefits:

- The edge the eye follows across the card is drawn by the band that accounts for it, and the two
  hairline bands sit on a straight rule instead of riding a curve.
- The stack's order is now stated, placed by one rule, and guarded from both sides: an existing
  key that moves fails a test, and a *new* key fails to compile.
- A presentation change no longer has to go through a service, and the two jobs the report's array
  was doing are separable from here on.
- The hairline bands are visible at all, which they were not: a 0.13% ribbon is sub-pixel, and a
  1px stroke of its own colour is the floor under it.

Tradeoffs:

- The report's `bands` order is no longer the drawing order, which is a thing to know rather than
  a thing to see. It is stated on `compositionBandSchema`, on `BAND_SPECS`, on the module and in
  the service's own test.
- A ninth permanent token exemption, for two pixels of corner.
- Three gradients on the Performance page rather than two, all `useId()`-scoped.

Risks:

- `--series-hue` is now readable anywhere a palette class lands, and a later rule could take a hue
  from it in a role the slot was never validated for — the trap
  [[0070-hover-card-restyle-and-the-series-ink-ramp]] recorded when a fill was used as ink. The
  ramp is still the answer for text; this is for marks.
- The gradient runs over the band's **bounding box**, so a range in which Stocks barely moves gets
  a nearly flat band and a range in which it triples gets a pronounced one. That is the proposal's
  own behaviour and it is the band's shape being described, but it means the ramp is not a constant
  across ranges.

## Alternatives Considered

### Reverse the report's array and stop there

Rejected twice over: it puts the residual on the baseline, under Accruals, which is the one
placement the story's constraint forbids; and because the palette follows that array, it repaints
every band — Accruals taking slot 1's blue.

### Reorder `BAND_SPECS` and move the palette map to the renderer

The same split with the halves swapped. Rejected because it leaves stacking order — presentation —
declared in a service Epic #179 is holding still, and because the array left behind would be
ordered by nothing the service cares about. It would also have churned six service tests to assert
a presentation decision.

### Adopt the proposal's 0.7 for the flat bands

Declined. [[0052-composition-cumulative-and-chart-readability]] measured 0.5 on screen against this
import with these neighbours, and nothing about the neighbours changed. The stroke gives the small
bands the definition the extra opacity was there for.

**Reversed by [[0076-the-band-tint-is-measured-and-the-edge-carries-the-band]]**, which found the
question ill-posed: "measured on screen" is not measured, and neither 0.5 nor 0.7 is a number any
guard in this repo could reach. Adopting 0.7 is safe once the hue is mixed toward `--card` first.

### Paint the top band `#6366f1`, as the proposal does

Declined for the reason [[0071-indigo-value-curve-and-the-signed-return-curve]] gives: that value
is `--accent`'s neighbourhood and `--accent` is the value curve. A band is one of a categorical
set; a curve is not one of eight of anything.

### Give the top band a gradient by masking rather than filling

A white-to-white `<mask>` over the band would have kept `.pie-series-N` on the ribbon and avoided
the `<g>` wrapper entirely. Rejected as the more surprising of the two: a mask puts the alpha ramp
somewhere no one reading the fill rules would look, and it introduces raw `#fff` into a stylesheet
whose colours are all tokens.

### Keep the shared `.legend-swatch` at 12px and only drop the softening

Half the proposal's change, and it leaves the key heavier than the marks it keys — the swatch is a
miniature of a hairline band.

## References

- [[0052-composition-cumulative-and-chart-readability]] — the cumulative stack, the 0.5 softening
  and the value it replaced, the legend in the card header, and the separating stroke that was
  removed. This DDR supersedes its ordering by implication only: that DDR never argued for one.
- [[0050-daily-nav-from-equity-summary]] — the daily NAV source and why the three accrual
  components are one band.
- [[0051-performance-chart-grid]] — the 2×2 grid, one geometry, equal card heights.
- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — stops in `app.css`, `fill` per
  element, the id from `useId()`, and the one hover card.
- [[0070-hover-card-restyle-and-the-series-ink-ramp]] — the card's row inks, and why a fill is not
  an ink.
- [[0071-indigo-value-curve-and-the-signed-return-curve]] — `--accent` is the value curve's, and
  `#6366f1` stays declined.
- [[0030-allocation-map-country-donut-pairs]] — one dimension, one hue; the reserved blue, which asset class does
  not pay for.
- [[0031-design-token-scales]] / [[0042-token-adoption-ratchet]] — the scales
  and the ratchet the ninth exemption is added to.
- [[0018-content-measure-and-chart-aspect]] — chart labels are viewBox units and stay off the page
  type scale.
- Story #222, Epic #179.
