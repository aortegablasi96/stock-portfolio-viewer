# 0076. The band tint is measured, and the edge carries the band

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

*Composition over time* shares a 2×2 grid with three charts drawn in one or two hues, and it is
the only one of the four that fills. Since Story #171 it has worn the `--series-*` palette as
**area** — slabs covering most of a card, in hues cut for a 40px donut wedge — and the card has
dominated its neighbours ever since. [[0052-composition-cumulative-and-chart-readability]] softened
it with `fill-opacity: 0.5`, picked on screen against the owner's real import after 0.62 was tried
and found still the loudest thing in the grid.

The redesign proposal draws the same chart three ways at once: the band at the stack's edge takes a
`1.5` stroke and a vertical gradient from its hue at 0.8 down to 0.5, and every other band takes a
`1` stroke and a flat fill at **0.7**. Story #222 adopted the first half exactly
([[0073-the-composition-stack-inverts-and-the-palette-stays]]). It declined the second, because
0.7 is *more* opaque than the 0.5 already there — the proposal's own number would have made the
card louder, which is the opposite of what anyone wanted from it.

So the proposal and the app disagreed by 0.2, and the disagreement was never resolvable in that
channel: one of the two numbers is right and there is no measurement that says which, because
**nothing here could be measured at all**. `lib/contrast.ts` has enumerated every ink in the app
since Story #163 and has never contained a single entry for this chart, in either of the two roles
it wears the palette. The reason is mechanical rather than an oversight: a `fill-opacity` is not a
colour. It resolves against whatever happens to lie beneath it, which a Vitest run in Node has no
layout engine to determine, so the guard could not reach it and the softening stayed a number
someone had looked at.

That is the actual defect behind Story #235, and it is bigger than the card being loud. Two stories
tuned this chart by eye, and a third was about to.

## Decision

### The proposal's numbers are alpha; the app's softening is hue

The two halves stop competing for one channel. The alphas become the proposal's, exactly — `0.7`
flat, `0.8` down to `0.5` on the band at the stack's edge — and the softening moves into the hue,
where each band is mixed toward `--card` before its alpha is applied:

```css
.stack-hue {
  --band-tint: color-mix(in srgb, var(--series-hue) 62.5%, var(--card));
}
```

Over an opaque card the two channels composite identically, so this buys no picture that a lower
`fill-opacity` could not also have drawn. What it buys is that **a mix resolves to a value**, and a
value is something `lib/contrast.ts` can measure. Everything below rests on that.

The mix is derived, not chosen. The ramp opens at 0.8, so the constraint that fixes it is *the
loudest tint the chart may render is the one its quietest band already wore*:

```text
0.8 × 62.5% = 50%   — the flat opacity every band carried before this story
0.7 × 62.5% = 43.75% — the flat bands
0.5 × 62.5% = 31.25% — the ramp's foot
```

The whole card now sits at or below the value its softest band used to, and the band that made it a
slab — whichever reaches the top, Stocks on this account — loses its NAV edge from 3.70:1 to
2.17:1 against `--card`.

`62.5` is deliberately not a token, for [[0070-hover-card-restyle-and-the-series-ink-ramp]]'s
reason: a percentage inside `color-mix()` is on no scale [[0031-design-token-scales]] declares, and
`BAND_TINT_PERCENT` measures this exact number, so a nudge fails a test rather than quietly dimming
a chart.

### The edge carries the band; the fill only decorates it

The one sentence the two measurements make between them, and the reason a fill this quiet is safe
at all.

- **The stroke stays at full strength** and is now held to `NON_TEXT` (WCAG 1.4.11's 3:1) against
  `--card` on all nine slots. On this portfolio a cash band is ~0.1% of NAV and sub-pixel, so the
  hairline **is** the mark — the property [[0073-the-composition-stack-inverts-and-the-palette-stays]]
  added it for. `--series-6` is the tightest at 3.74:1.
- **The fill is held *under* that same bar** — a ceiling, not a floor — so a band's identifying
  channel is always the sharper of its two. The loudest tint measures 2.39:1 (`--series-7`, at the
  ramp's edge).
- The two ranges do not meet, and `contrast.test.ts` asserts the **gap** rather than the two bounds
  separately: every fill is quieter than every edge, on every slot.

Story #235 offered diluting the strokes as the alternative half of the softening, and the
measurement is what declines it: 85% of the hue puts `--series-6` at 3.01:1 and 84% fails, so there
is nothing to spend there. Softening a card whose loudness is *area* by dimming its one hairline
channel would spend the wrong budget, and would spend it against the thing that makes a 0.1% band
visible at all.

The fills also carry a floor, and `SURFACE_EDGE` is the right threshold rather than a borrowed one:
[[0069-boxed-gateway-chip-and-the-raised-surface]] cut it for a fill that has to mark a shape
rather than dissolve into the surface behind it, with no claim on an accessibility bar, which is
exactly what a band's tint is. The quietest is 1.37:1 (`--series-6` at the ramp's foot). Both ends
bind, and neither is far away.

### `contrast.ts` learns a ceiling

`Pairing` gains an optional `maximum`, and it is the first thing in that module that is not a
floor. Every failure the guard was built for was something too faint to read; this one is the other
kind, and a guard that only knows floors cannot see it — which is precisely why the bands went
unmeasured through DDR-0052 and DDR-0073 while every label around them was pinned twice over.

A ceiling is only meaningful where something else carries the meaning. That is why the two families
land together: the fill may sit under 1.4.11's bar *because* the stroke is held above it, nine
entries below.

Thirty-six pairings, from two mapped tables. All three alphas are listed, not just the two
extremes — the ratios are monotone in the composite, so the middle is bounded by arithmetic, but
the middle is the alpha most bands actually wear and "bounded by construction" is how a value stops
being looked at.

### The tint is derived where the hue is published

`--band-tint` is declared on `.stack-hue`, a class the wrapping `<g>` and the `<linearGradient>`
carry beside the palette slot. The stroke, the flat fill and both gradient stops read the result,
so the mix is one number in one place and the group stays uniform across bands — the shape
[[0073-the-composition-stack-inverts-and-the-palette-stays]] chose the wrapper for.

Not on `.pie-series-*`: a tint of `--card` is this chart's business and no donut's, and that DDR
spent an argument keeping the palette publishing the hue alone. Not on `:root` either, which does
not work at all — a custom property computes on the element that declares it, so `--series-hue`
would resolve to nothing there and inherit down as the guaranteed-invalid value.

**The ribbon stops carrying its palette class.** It only ever had it to be filled by it; the flat
fill now comes from `--band-tint`, and a second copy on the path would declare a competing `fill`
at equal specificity and be settled by source order — [[0059-card-strip-and-table-density]]'s trap,
which has shipped once already. Every ribbon now carries the same two classes, and the fill lives
on `.stack-band-flat` alone so that the top band's `url(#…)` **attribute** survives: CSS beats a
presentation attribute, which is the rule that put the hue on the group to begin with.

### The key's swatch does not follow, and that is the same decision restated

Story #235 required this to be decided rather than left to drift. The swatch is a miniature of the
mark, and [[0073-the-composition-stack-inverts-and-the-palette-stays]] un-softened it on the
grounds that *every band carries its hue at full strength on its own edge*. That sentence is not
weakened by this story — it is what this story is built on. The edge is still full strength, so
the swatch still states it. Nothing about the 8px square or its 2px corner moves, and the ratchet's
ninth exemption is untouched.

### Everything the stack means is unchanged

The order is `stackOrder`'s, still bottom-up Accruals · Cash · `other` · Options · Stocks, and
`BAND_SPECS` is still the palette rather than the order. A negative band still hangs below the zero
line, never clamped or folded; `other` is still the surfaced residual; the top edge is still NAV
and the ramp still anchors on the band's own bounding box with its id from `useId()`. No
`--series-*` slot moves, and the reserved blue is untouched.

**The hover card is not softened with the bands.** Its rows are *ink*, resolved through
`--series-ink-*` precisely because three of the eight slots fail AA as text on `--surface-raised`,
and the ramp reads `stackOrder`'s colour rather than anything `bandPaint` produces — so it is
unreachable from this change by construction, not by care.

Reviewed on screen against the owner's real import, the card captured **beside its three
neighbours** because that is what the complaint was about. The rendered pixels were checked against
the arithmetic rather than judged: a mid-band sample moves from 62.9% of the hue to 39.1%, and
0.629 × 0.625 = 0.393.

## Consequences

Benefits:

- The chart that fills is now measured in both of the roles it wears the palette, on every slot,
  by the guard that already covers every other colour in the app. It was the last unmeasured
  colour surface of any size.
- The softening is a number with a derivation instead of a number someone looked at, and the next
  story to reach for it fails a test rather than re-tuning by eye for the third time.
- The proposal's fill numbers are adopted **as written**, which closes the one place Epic #179
  diverged from it on a value rather than on a measurement.
- The gridlines read *through* the stack. Less of each line survives (30% at 0.7 against 50% at
  0.5) but it survives against a far darker tint, so the €20k–€60k rules are legible inside the
  band where they were buried in it.
- The band's own edge is now the strongest thing on the card, which is what
  [[0073-the-composition-stack-inverts-and-the-palette-stays]] inverted the stack to make readable.

Tradeoffs:

- `contrast.ts` gains a second kind of threshold, and a pairing now has to be read for which end
  binds it. The 36 new entries are two thirds of the list.
- Two numbers are restated between `app.css` and `contrast.ts` rather than one — the mix *and*
  the three alphas — because the composite is their product. Both are pinned back against the
  stylesheet, so the disagreement is what fails.
- A band's fill is now further from its legend swatch than it was, and the swatch is the only place
  a slot appears at full strength in this card. Decided deliberately above; it is still a thing to
  know.

Risks:

- `--band-tint` is readable anywhere `.stack-hue` lands, and it is a *fill* value in a stylesheet
  that has already had a fill used as ink once (`--series-ink-*` exists because of it). It is
  tinted toward `--card` and would fail every text threshold in the app by construction.
- The ceiling is calibrated against `--card`. A future story lightening that surface moves every
  band's measurement in the loud direction at once — which the guard will catch, and which is the
  point, but it would fail 27 pairings in one go rather than one.

## Alternatives Considered

### Adopt the proposal's 0.7 literally and change nothing else

The reading Story #235 opened by asking about, and it is self-defeating: it raises the flat bands
from a 50% composite to a 70% one and makes the card *louder*. The proposal's numbers are right
for the proposal's own hues, which are three ad-hoc values on a light ground; four of them failed a
guard when [[0054-navy-indigo-palette-re-key]] measured them.

### Lower `fill-opacity` below 0.5 and stop there

The obvious cheap move, and over an opaque card it draws the same picture as this one for a third
of the diff. Rejected because it draws that picture *unmeasurably*: it keeps the softening in the
channel no Node test can resolve, which is the condition that let two stories tune this chart by
eye. It also throws away the proposal's fill numbers a second time, leaving the same open
disagreement for the next story.

### Dilute the band strokes instead of the fills

Story #235 offered this as the other half of "and/or". Declined on the measurement: 85% is the
floor before `--series-6` fails 1.4.11 and 84% is already below it, so the channel has almost
nothing in it — and it is the channel that makes a sub-pixel band visible at all.

### Retune the `--series-*` slots for this chart

The alternative [[0052-composition-cumulative-and-chart-readability]] declined, and it stays
declined for the reason it gave: the eight hues are validated for CVD and contrast **as a set**
(2026-07-23, re-validated 2026-08-18) and are worn by the allocation donuts, the map and every
legend in the app, none of which have this problem. This story re-decided the *mechanism* it chose
— `fill-opacity` alone — and not the scope it chose.

### Put `--band-tint` on the palette classes

Nine more declarations, and every donut and map mark would carry a composition chart's tint of
`--card` in a property none of them read. It also reopens what
[[0073-the-composition-stack-inverts-and-the-palette-stays]] settled by having a slot publish its
hue and nothing else.

### Keep the ceiling out of `PAIRINGS` and assert it in the test alone

Rejected because the list is the enumeration, deliberately, and a threshold living beside it rather
than in it is one nobody finds. The `maximum` is optional, so the 40 existing entries are unchanged
by it.

## References

- [[0073-the-composition-stack-inverts-and-the-palette-stays]] — the inverted stack, `stackOrder`
  vs `BAND_SPECS`, the band stroke, the `<g>` wrapper and `--series-hue`, and the key's swatch.
  This DDR supersedes its declining of the proposal's 0.7 and re-decides the swatch as unchanged.
- [[0052-composition-cumulative-and-chart-readability]] — the cumulative stack, the negative band,
  the surfaced residual, the legend in the card header, and the "`fill-opacity` alone, **not** the
  palette" choice this DDR replaces with "the hue, and still not the palette".
- [[0070-hover-card-restyle-and-the-series-ink-ramp]] — the `--series-ink-*` ramp, why a fill is
  not an ink, and the precedent for a mix ratio pinned against the stylesheet.
- [[0069-boxed-gateway-chip-and-the-raised-surface]] — `SURFACE_EDGE`, and why it is not a WCAG
  threshold.
- [[0064-toned-badges-and-the-income-key]] — a tint mixed into a surface is a measured number.
- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — stops in `app.css`, the `fill`
  per element, the id from `useId()`, and `.chart-area-from`'s `stop-opacity`.
- [[0046-contrast-split-tone-tokens]] — the fill/text split, and why picking the wrong half is silent.
- [[0059-card-strip-and-table-density]] — the equal-specificity rule settled by source order.
- [[0054-navy-indigo-palette-re-key]] / [[0030-allocation-map-country-donut-pairs]] — the validated
  palette and the one-dimension-one-hue invariant.
- [[0031-design-token-scales]] / [[0042-token-adoption-ratchet]] — the scales, and why a
  `color-mix()` percentage is not on one.
- [[0051-performance-chart-grid]] / [[0018-content-measure-and-chart-aspect]] — the 2×2 grid, equal
  card heights, and chart labels off the page type scale.
- Story #235, Story #222, Epic #179.
