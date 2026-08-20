# 0070. The hover card gets a surface of its own, and the palette gets an ink half

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

[[0061-chart-language-gradient-zero-line-and-one-hover-card]] made three private `HoverReadout`s
into one `ChartTooltip`, drawn inside the plot's own `viewBox` and pinned to the top of the plot.
That settled *where* the card is and *who owns it*, and it deliberately left the card's appearance
where it found it: `--card` on `--card`, separated only by a border and a shadow, with `--text`
figures beside `--muted` labels whatever the chart underneath was drawing.

The redesign proposal draws the card as a panel that has clearly lifted off the surface behind it —
`background: var(--surface-3)`, `border: 1px solid var(--border-2)`, `border-radius: 8`,
`padding: 10px 14px`, `min-width: 140` — and, in a stacked chart, colours each row's figure with
the band it names.

Two of those are cosmetic and one is not. The colour is a **role change**: the eight `--series-*`
slots have been fills since [[0030-allocation-map-country-donut-pairs]] validated them — a donut wedge, a map mark,
a stacked band, a legend swatch — and none of them has ever been asked to be text. Nothing in
`lib/contrast.ts` measured them, because a fill is measured against what sits *on* it, not against
what sits behind it.

Measured, three of the eight fail as ink on the card's fill: `--series-2` at 4.39:1, `--series-5`
at 4.33:1 and `--series-6` at 3.45:1, against AA's 4.5:1. `--series-6` fails on `--card` too, at
3.74:1 — so the failure is not something the new surface introduced, only something it exposed.

## Decision

### The card floats on `--surface-raised`, the app's second use of it

[[0069-boxed-gateway-chip-and-the-raised-surface]] added exactly one surface step that goes *up*,
for the gateway chip, and recorded that the chip was its only user. The hover card is the second,
and it is the same shape of need: a panel standing on a card, wanting ground of its own without
becoming a hole in the page. The proposal's `--surface-3` is a third step this app does not have
and does not need one of — the card is not stacked on the chip.

The step is faint (1.085:1 off `--card`), which is the point: the border still draws the edge and
the fill only seconds it, exactly as it does on the chip. `--border-2` is likewise a token this app
does not have; `--border` is the edge every card, table rule and input already ships, and the
pairing that matters — `--border` on `--card` — is already measured against `SURFACE_EDGE`.

`sidebarRail.test.ts` had frozen the count of `var(--surface-raised)` uses at one, with a note
saying that the second rule to adopt it "brings inks nobody has measured there — and has to come
here and say so". It fired, and this is the saying-so: four pairings were added for the card's own
inks, plus nine for the ramp below.

### Padding and the corner stay in `viewBox` units, and the corner gets a name

`PAD_X`/`PAD_Y` become 14/10 — the proposal's `10px 14px`, read as viewBox units rather than
pasted as page lengths. This is [[0018-content-measure-and-chart-aspect]]'s rule applied to a padding
rather than to a font size: the card scales with its plot, so a padding fixed in px would be one
card in the 2×2 grid and a different card in the stacked column.

The corner was an `rx={8}` literal in the component. It becomes `RADIUS_UNITS` in
`lib/chartTooltip`, beside the padding it has to agree with — `--radius-md`'s step as a number,
because `var(--radius-md)` would resolve against the page and grow the corner as the chart shrank
([[0031-design-token-scales]]).

### `MIN_WIDTH` is a floor, and only a floor

The card was exactly as wide as its widest line, so scrubbing from Daily return (one row) to
Composition over time (three bands and a total) changed the *size* of the thing under the pointer
as well as its contents, and the two read as different components. 140 units is the proposal's own
minimum. It is a `Math.max`, not a clamp: a card with more to say still grows past it, and
`chartTooltip.test.ts` asserts both halves — the failure a single assertion would miss is a `min`
written where a `max` was meant, which looks correct on the chart with one row and clips every row
off the chart with five.

### The `--series-ink-*` ramp: [[0046-contrast-split-tone-tokens]] applied to a categorical set

Nine tokens, `color-mix(in srgb, var(--series-N) 75%, var(--text))`, and nine two-class rules
resolving a row's `.pie-series-*` through them. The floor becomes 4.87:1.

The alternatives were considered and are worse:

- **Re-cut the eight slots to be text-safe.** [[0054-navy-indigo-palette-re-key]] spent a story
  establishing that the eight did not move under a full re-key, because CVD separation and the
  normal-vision floor are measured mark-against-mark and do not care what the ground is. Moving
  them now, to suit one label in one card, spends that.
- **Tint the label instead of the figure.** The label is the band's name; the figure is what the
  reader came for, and tinting the quieter half would make the tint decorative.
- **Leave the rows untinted and add a swatch.** A fourth channel in a card that is already a date,
  a name and a number, to say what a colour says.

Three properties of the ramp are worth stating because they are what makes it safe:

**The row is keyed by the band's own class string.** `compositionRows` hands over exactly what
`compositionColors` gave the ribbon and the legend swatch, so the row, the band and the key agree
because they are one string rather than because three call sites were kept in step. What differs is
only the *role* the colour plays, and that is where the rules resolve it.

**The band keeps full strength.** The ramp is the card's alone. `.stack-band` is untouched, still
softened by `fill-opacity` as [[0052-composition-cumulative-and-chart-readability]] left it.

**Colour is still never the only channel.** The tinted rows relative to each other are closer
together than the slots are, because a lerp toward one point compresses separation. That would
matter if the tint were the identity; it is not — every row carries its band's name on the left and
its figure on the right, and the tint restates the band the reader can already see in the stack
([[0021-allocation-map-gain-loss-scale]], [[0048-tab-icons-as-a-second-channel]]).

The 75 is one number, mirrored in `lib/contrast.ts` as `SERIES_INK_PERCENT` and pinned back against
the stylesheet by a test — a number restated in two files is a number that will disagree, so the
disagreement is what fails.

### Daily return gets one row, toned by sign

The proposal splits a signed bar chart into a "positive" and a "negative" series with a card entry
each. Declined: a day has one reading, and the direction is already in the figure's sign and in
which side of the zero line the bar is drawn on. The row keeps its single "Return" label and takes
`--pos` or `--neg-text` — the *text* half of the loss split, while the bar beside it fills with
`--neg`, which is the pairing [[0046-contrast-split-tone-tokens]] exists for and which SVG hides
particularly well, since the property is `fill` in both cases.

**A zero day is untoned**, which is why `signInk` is a function rather than a ternary: neither tone
is true of a flat day, and folding it into either paints a day that did not move as one that did.

The cumulative return curve is deliberately *not* toned. It is one series in `--series-1` end to
end, and a signed tone on it would claim the curve changes colour where it crosses zero, which is
a different chart from the one [[0061-chart-language-gradient-zero-line-and-one-hover-card]] drew.

### `--neg-text` in a `fill` is now legal, in exactly one place

`contrast.test.ts` asserted that `--neg-text` never appears in a `fill`, which was a good guard and
the wrong rule: an SVG `<text>` has no `color`, so its ink is a `fill` too. The assertion now
enumerates the one selector where the property means ink, rather than pattern-matching for one —
a second one has to come and say so.

That test also read the raw stylesheet, and Story #220's own commentary names both tokens it scans
for. It strips comments now. That trap has bitten five times
([[0042-token-adoption-ratchet]], [[0047-allocation-map-is-a-group]], [[0048-tab-icons-as-a-second-channel]],
[[0058-one-page-header-pattern]], and here).

## What is deliberately unchanged

- **The card's placement.** Still inside the `viewBox`, still pinned to the plot's top, still
  unable to cover the chart next door. The proposal floats an HTML box at the cursor; that is a
  re-decision, not a restyle.
- **The row's shape and its type steps.** Muted label left, figure right, date one step smaller —
  which is what the proposal asks for and what the card already did. The date and label still share
  one rule, so `lib/tokenAdoption`'s exemptions stay at **eight**.
- **The entrance.** Still `--duration-fast`, so the one `prefers-reduced-motion` block still
  covers it ([[0044-motion-scale-and-reduced-motion]]).
- **`.stack-band`, the bars, the donut's native tooltip and the map popup.**

## Consequences

- The app has two rules standing on `--surface-raised`. A third owes the same measurement, and
  `sidebarRail.test.ts` still counts.
- `lib/contrast.ts` grows thirteen pairings and its first *mapped* family. The list is still
  enumerated by hand — the slots are written out — but the pairing shape is written once. A tenth
  slot does not appear in the guard by itself.
- If a later re-key makes the eight slots text-safe on their own, a test fails and says so, and
  the ramp can be retired rather than lingering as a layer nobody remembers the reason for.
