# 0071. The value curve takes the indigo, and the return curve is split at zero

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

Two pieces of owner feedback on the shipped Performance grid, after reviewing it beside the Figma
proposal.

**The value curve is the wrong blue.** The proposal draws *Portfolio value over time* with
`stroke="#6366f1"` — the redesign's headline indigo. The app draws it in `--series-1`, `#3987e5`,
a sky blue from the validated data-viz palette. Both are "blue" in the abstract and they are
plainly different hues side by side, which is what the owner was seeing.

**The return curve should read like the daily bars.** *Daily return* has been green above the zero
line and red below it since Story #170. The owner wants *Performance change over time* to say the
same thing about the same period. The proposal does **not** do this — it draws that curve in
`#6366f1` too — so this is the owner's call rather than the proposal's, and it overrides
[[0070-hover-card-restyle-and-the-series-ink-ramp]], which recorded the cumulative curve as
deliberately untoned.

## Decision

### The value curve is `--accent`, and it leaves the categorical palette

`.chart-line`, `.chart-area-*`, `.chart-dot` and `.chart-hover-dot` move from `--series-1` to
`--accent`.

**Not the proposal's `#6366f1` itself.** [[0054-navy-indigo-palette-re-key]] already measured that
exact value and declined it: 4.14:1 on `--card`, which clears the 3:1 a graphic needs and fails
the 4.5:1 its text call sites need. `--accent` is that same identity hue one step lighter, at
6.21:1. Adopting `#6366f1` as a marks-only chart token was considered and rejected — it would
reintroduce, through a side door, the value a previous story rejected on measurement, and leave a
token in `:root` that must never carry a label with only a comment to police it. The visible
difference is that the app's curve is slightly brighter on a dark ground, which is the direction
that costs nothing.

**Leaving `--series-1` is the point, not a side effect.** Slot 1 is *the first of eight
categories*. A lone curve is not one of eight of anything — it is the view's primary reading,
which is what the accent means everywhere else in the app. `--series-1` keeps the Stocks band, the
map's country-weight donut and slot 1 of the categorical set; [[0030-allocation-map-country-donut-pairs]]
is untouched, and the blue stays reserved for the weight donut.

### The return curve is split at the zero line, in the bars' own tones

`--pos` above break-even, `--neg` below. **`--neg` and not `--neg-text`**: a curve is a mark. SVG
writes ink and fill the same way, so picking the wrong half of [[0046-contrast-split-tone-tokens]]'s
split is invisible in the diff and on the screen.

Three alternatives were put to the owner and this is the one chosen. The other two are recorded
because they are what a later story would otherwise re-propose:

- **Tone the whole curve by the period's result** — one colour end to end, matching the KPI tiles
  above. Rejected: the colour would report the endpoint, and the drawdown to −12.2% would be drawn
  green.
- **Tone only the area, leaving the stroke indigo.** Quieter, and it makes the fill and the line
  disagree about what the chart is about.

### The split is geometry, not a second series

One polyline and one polygon, each drawn twice under complementary clip rectangles.

The obvious implementation — split the data at the crossing and plot two series — is wrong for a
reason worth writing down: it requires **inventing a sample at zero that the report never took**.
`returnSeries` is a daily observation; a synthesised crossing point is a reading the broker never
made, and `LineChart` would stop plotting what it was handed. Clipping puts the boundary exactly
where the line really crosses, and costs one `<rect>` per band.

### The area is re-anchored to zero, and only here

A value curve's wash means "this much portfolio" and is anchored at the bottom of its domain. A
signed curve's wash means "this far from break-even" and is anchored at **zero**. Left at `minV`,
a stretch spent wholly under water would fill *downward from the curve* and be drawn exactly the
way a gain is — the fill would be largest where the loss was smallest.

Each band's gradient uses `gradientUnits="userSpaceOnUse"` over its own `y` range, so both fades
land on the zero line. An `objectBoundingBox` gradient would be measured against the polygon — one
shape spanning both halves — and the two fades would meet somewhere other than the one place they
have to meet.

### `lib/signedCurve` exists because the degenerate ranges are invisible

The two rectangles are arithmetic, and Vitest runs in Node with no jsdom (DDR-0029), so a
`<clipPath>` computed inline could not be tested at all.

What it protects is not a rounding error. A range in which every reading is positive puts zero at
or below the bottom edge; one in which every reading is negative puts it above the top. Unclamped,
the corresponding rectangle takes a **negative height**, and SVG treats a negative height as an
error value and *disables rendering of the shape* — so the band that should have covered the whole
plot renders as nothing, and the chart loses its fill and its line and looks like a failed load.
That happens in precisely the two ranges nobody scrubs to by hand.

## What this changes in earlier records

- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — the area gradient's colour is
  `--accent` now, not `--series-1`, and a signed chart has **two** gradients rather than one. The
  mechanism it settled is unchanged and is what made this cheap: the stops stay in `app.css`, the
  `fill` stays per element, and the ids still come from `useId()` — four of them here, derived
  from the one `useId()` mints, because two curves share the page. Its zero-line test —
  emphasised only where the series *crosses* zero — is now also the test for whether the split
  means anything.
- [[0070-hover-card-restyle-and-the-series-ink-ramp]] — "The cumulative return curve is
  deliberately *not* toned" is **superseded**. The rest of that record stands, including the
  hover card's own tones, which now agree with the curve beneath them rather than contrasting
  with it.

## A bug this found, and the guard that came with it

The vertex dots shipped indigo on a green curve during implementation, and nothing failed. Both
`.chart-dot` and a bare `.chart-mark-pos` are one class, so they tie on specificity — and
`.chart-dot` is declared lower in the file, so it won on source order and set the dot's `fill`
back to `--accent`. It was caught on screen, not by a test.

It is exactly the trap [[0059-card-strip-and-table-density]] recorded for the table's row
lift, where an unscoped rule was silently out-specified by `tr:hover > th`. The fix is the same —
double the selector rather than reach for `!important` or move the rule — and
`signedCurve.test.ts` now fails three ways: if either scoped selector goes, and if either tone
reappears as a bare single-class rule.

## Consequences

- `lib/contrast.ts` gains two pairings: `--pos` and `--neg` as **marks** on `--card`, at
  {@link NON_TEXT}. Both tones were already in the list several times over and every entry
  measured them as *text* — so the daily-return bars, which have filled with `--neg` since Story
  #170, had never been measured at all. `--neg` at 3.94:1 is the tighter of the two.
- `LineChart` gains one prop, `tone`, defaulted to `series`. A new caller gets the plain curve
  unless it asks otherwise.
- The colour of the plain area gradient is now pinned in `signedCurve.test.ts` alone.
  `chartTooltip.test.ts` asserted `--series-1` there and now asserts only the *shape* of the rule —
  a token at the curve, nothing at the baseline — because that token has moved once and the
  guard should fail in one place when it moves again, not two.
