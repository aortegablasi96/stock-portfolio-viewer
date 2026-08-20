# 0074. Allocation: the map goes first, and its marks name what they hold

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Story #223 is the sixth of Epic #179's second round, and it asks for two things on the Allocation
view: the world map above the breakdown, and each mark naming the holdings it stands for.

**The order.** [[0063-allocation-breakdown-pair-and-dark-basemap]] moved the breakdown above the map
four days ago, and gave a reason rather than a preference: the map is the tallest card on the page
and the only approximate one — positioned by issuer country, as its own label says — while the
breakdown is the exact answer. A 3:1 map above it pushed the breakdown's title below the bottom of
the window the app opens at. The story reverses that ordering and requires the reason to be
*answered*, not dropped: if the title goes off screen, the map is made shorter. Capping its width
stays rejected ([[0051-performance-chart-grid]], [[0057-sidebar-collapse-and-the-frameless-corner]]).

**The names.** A mark says *where* and *in what*. It has never said *which companies*, because
[[0030-allocation-map-country-donut-pairs]] deliberately retired per-holding granularity: a donut
split by holding needed eight distinguishable categorical hues on a 40px mark, and the Positions
table is where one company is read. The cost is that the reader carries a country and a sector down
to a table to answer "which of my companies is this?". The report already has the answer —
`positions` carry `symbol`, `description`, `issuerCountry` and `sector` — so nothing about the data
has to change.

What made this more than two edits is a coupling neither half declares. **The map's height is what
the popup lives in.** Mapbox mounts a popup as a direct child of the map container and clips it
there (`.mapboxgl-map { overflow: hidden }`), flipping it above or below the mark and nowhere else.
Shortening the map therefore truncates every popup, and adding a chip row to the popup truncates it
further. Measured in the running app at 1280x800, over all seventeen hover targets the map draws
against the owner's real import:

| | frame | worst popup | worst clipped |
| --- | --- | --- | --- |
| Before (breakdown first, 3:1) | 369px | 232px | 56px |
| Map first at 4:1, popup unchanged | 277px | 232px | ~130px |
| Map first at 4:1, with the chip row | 277px | 270px | 149px |

The last row is the story deleting its own feature: 149px is the figures *and* the whole holdings
list. The first row is worth stating too — the clip was never harmless, and no test could see it.

## Decision

### The map comes first, and the map gets shorter

`.country-map-frame` goes from `aspect-ratio: 3 / 1` to **`4 / 1`**, and the floor that sits under
it becomes a named token, `--country-map-min-height` (16rem), the fourth structural measure beside
`--sidebar-width`, `--rail-width` and `--donut-column-width` and declared for the same reason: it is
quoted by the frame that draws it *and* by the test that checks the card still ends above the fold.

The number is derived, and `lib/allocationLayout.test.ts` does the derivation rather than trusting
the comment beside it. At the window `windowStateService` opens (read from that file, so a change
there fails here), the map card may be at most:

```text
800 (window) − 290 (title bar, page header, KPI row, gaps) − 24 (--space-7) − 40 (a card's top edge
to the bottom of its title) = 446px
```

which leaves 295px for the frame once the card's own 151px of header strip, two-line legend and
padding are taken off. 4:1 at the widest content the default window affords (the **collapsed**
sidebar — a rail leaves more width, and more width is a taller map) is 280px; the floor is 256px.
Both are inside the budget, and both are asserted, because a floor above the budget would set the
height by itself and flattening the ratio would then change nothing.

The three measurements are named constants with the same standing as `0063`'s `TABLE_MIN_PX`: a page
header and a wrapped legend are type on a laid-out page, and no Node test can compute them. Asserting
them means a story that grows one has to come back here rather than quietly pushing the title off
screen again.

### The clip moves down one level, and that is what pays for the popup

`.country-map` stops clipping; `.country-map .mapboxgl-canvas-container` starts. Two classes deep
(`.country-map.mapboxgl-map`) so that which stylesheet the bundler emits first cannot decide it.

The basemap, the marks and Mapbox's controls stay clipped — a marker that escaped the frame would be
a mark placed where the map is not — and the rounded corner is cut there now instead. Only the popup
is let out. It is `pointer-events: none`, so nothing it covers becomes unreachable, and it takes a
`z-index` because it is now a descendant of an *earlier* sibling than the card it overlaps; Mapbox
declares none.

This is the one thing here that goes against the grain of
[[0061-chart-language-gradient-zero-line-and-one-hover-card]], which draws the chart tooltip **inside
the `viewBox`** precisely so it cannot cover the chart next door. The map is the case that argument
does not reach: a `viewBox` tooltip is drawn in the plot's own coordinates and can be *placed*
anywhere in it, while Mapbox owns this popup's position and offers two of them. Given a 277px frame
and a 270px card, "inside" and "whole" cannot both hold. Whole wins — a truncated popup is not a
quieter popup, it is a missing figure.

### A mark names its holdings, bounded, and the bound is arithmetic

`lib/countryDonuts` grows one field, `holdings`, on both `CountryDonuts` and `DonutSlice`:

```ts
{ named: Array<{ symbol: string; name: string | null }>, remainder: number }
```

Ordered by **market value**, because the bound has to cut somewhere and the names it keeps should be
the ones that account for most of the arc. `MAX_NAMED_HOLDINGS` is **4**, and the remainder is a
count rather than a silent truncation — `+3 more` says the mark covers more than it names. The bound
is a bound and not a scroll or a clamp because the popup is hover-only and pointer-transparent:
nothing in it can be reached, so anything that overflows is lost rather than deferred.

A country's list is its positions; a sector slice's is that sector's positions within that country.
The **weight donut's remainder names nothing** — it is context for the blue arc, not a subject — and
both weight slices open the country anyway.

The name comes from `instrumentName`, never `formatCompanyName`
([[0066-one-instrument-name-across-the-views]], [[0067-shortening-a-name-to-a-name]]): IBKR writes
the identifier again where an instrument has none, and title-casing that gives `Cad`. A holding with
no name of its own carries `name: null` and the chip is its symbol alone, because a chip reading
`CAD Cad` is the same text twice.

**This is not the granularity `0030` retired.** No holding gains a mark, an arc, a colour or a
figure, and no figure is added to the popup at all.

### The chips are `Badge`, reached as a class composer

Each chip is the shared primitive at `neutral`/`sm`, composed by `badgeClassName` — which works here
exactly as it does in JSX, because `mapboxgl.Popup` owns its content element and there is no
component to render. That is the seam the primitive's contract already has, and taking it is what
keeps the app from growing a fourth chip family in the one place it builds DOM by hand
([[0037-badge-primitive-variants-and-sizes]], ADR-0008). `sm` is the size with no vertical padding,
which is what keeps the chip row cheap; the row's own `gap` replaces the inline form's left margin,
taken off by a doubled placement class for the reason [[0064-toned-badges-and-the-income-key]]
records.

The symbol takes `--text` out of the badge's muted default and the name keeps it, so the chip reads
as an identity with a gloss on it. The name is the half that ellipsises — broker descriptions are not
length-bounded and the popup is 15rem — and the symbol never does.

Everything else about the popup is untouched: the same figures in the same order with the same
formatters, every string set with `textContent`, and `0041`'s tint geometry (inner stops at the
absolute `--popup-pad-y`, `--popup-edge-hold` strictly below it) unchanged. So are `role="group"`
with `keyboard: false` and every marker host at `tabindex="-1"` set before construction
([[0047-allocation-map-is-a-group]]), the reserved blue and `SECTOR_SLOT_OFFSET`
([[0030-allocation-map-country-donut-pairs]]), and the absence of a gain/loss mode
([[0045-allocation-map-one-sector-view]]), which `designTokens.test.ts` and `allocationLayout.test.ts`
still pin.

## Consequences

Benefits:

- The view opens on the picture. The map is the one card whose content nothing else on the page
  restates — the breakdown, the legend and the Positions table all carry its figures exactly, and
  none of them draws where the money is.
- Hovering a country answers "which of my companies is this?" on the spot, at both depths, with no
  new figure, channel, IPC call or service change.
- **Every popup is now readable in full**, which was not true before this story either. The 56px
  worst case at 3:1 was a defect nothing could see.
- The map's height and the floor under it are on one budget, asserted, and derived from the window
  size the main process actually opens.

Tradeoffs:

- **The map is 25% shorter.** At 1280x800 the frame goes 369px → 277px. Mercator at the world's
  bounds is a 1.89:1 picture, so the marks get no smaller — `R_MAX` is 25 CSS px whatever the frame
  is — but there is less ocean between them, and a portfolio spread over many countries will crowd
  sooner. Zoom and pan are unchanged.
- **A popup can now overlap the card below it**, and at the bottom of the map it does. That is a
  tooltip behaving like a tooltip, but it is a boundary this app had not crossed.
- **`0063`'s ordering is four days old.** Reversing a decision that quickly is worth naming: what
  changed is not the argument but which of two costs the owner would rather pay, and the argument's
  own condition — the breakdown's title below the fold — is now an assertion rather than a reason to
  keep the order.
- The story's own wording asks that the bounded list keep the popup no taller than the map. Taken
  literally against a 277px frame that permits **one** chip line on a six-row sector card, which is
  not a list. The clause is honoured as what it was protecting — a popup that outgrows what can be
  read — and the clip fix is what makes the bound sufficient rather than the bound making the clip
  survivable.

Risks:

- **The three layout measurements are 1280x800 with the sidebar collapsed and the owner's own
  import.** A different portfolio wraps the map's legend to three lines and adds ~17px, which the
  budget above has (295 − 280 = 15px) barely. The failure is the breakdown's title clipped at the
  fold, not truncated content, and it is visible the moment the view is opened.
- **Overriding a vendor stylesheet's `overflow` is the second scoped exception this popup has
  taken** — the first being its surface. A Mapbox upgrade that reorganises `.mapboxgl-canvas-container`
  would show up as a square-cornered basemap or an escaping marker, both visible on the first look.

## Alternatives Considered

### Option A — Keep the breakdown first

What `0063` decided, and cheapest. Declined by the story: the map is the view's picture and the
figures are restated three times below it. The condition `0063` gave is answered rather than ignored.

### Option B — Reorder and leave the map at 3:1

The breakdown's title lands at ~834px in an 800px window. `0063` predicted exactly this, and the
story rules it out in the same sentence it asks for the reorder.

### Option C — Cap the map's *width* instead of flattening it

Rejected twice already, on other charts, for the reason `0051` records: a label inside a `viewBox`
is sized in `viewBox` units, so a narrower frame is an illegible one. The map's marks are CSS pixels
rather than `viewBox` units, so the argument does not transfer directly — but the empty gutters
either side of a capped map are the same cost `0063` refused to pay beside the donut.

### Option D — Shrink the popup instead of unclipping it

The only content that could go is figures, and the story fixes those explicitly. A two-column figure
grid would save ~50px and need a wider popup to do it, and still leaves the sector card clipped in a
277px frame. The arithmetic does not close.

### Option E — Name the holdings in a row of ticker-only chips, as the proposal draws them

The chips *are* the proposal's row; what is added inside one is the name. `SBI` does not answer
"which of my companies is this?", which is the sentence the story opens with, and a reader who knows
the ticker already knows the answer. `instrumentName` returning `null` is what keeps this from
producing `CAD Cad`, so the ticker-only chip is still what a currency row gets.

### Option F — Let a long list scroll inside the popup

The popup is `pointer-events: none` by construction — the cursor must never leave the wedge that
opened it, or the mark reads as a mouseleave and the popup closes. Nothing in it can be scrolled.

## References

- [[0063-allocation-breakdown-pair-and-dark-basemap]] — supersedes its **ordering** section only; the
  pair, the fixed donut track, the derived stacking breakpoint, the returning legend and the
  `dark-v11` basemap with its `--muted` track are all untouched
- [[0030-allocation-map-country-donut-pairs]] — the dual-donut marks, the reserved blue, and why
  holdings are not *drawn* on the map
- [[0047-allocation-map-is-a-group]] — the map's accessibility position, unchanged here
- [[0045-allocation-map-one-sector-view]] — the withdrawn gain/loss mode, still pinned
- [[0041-map-popup-return-tint-strength]] — the popup's tint geometry, unchanged here
- [[0066-one-instrument-name-across-the-views]], [[0067-shortening-a-name-to-a-name]] —
  `instrumentName`, and why `formatCompanyName` is not it
- [[0037-badge-primitive-variants-and-sizes]], [[0064-toned-badges-and-the-income-key]] — the chip and its doubled
  placement class
- [[0061-chart-language-gradient-zero-line-and-one-hover-card]] — the tooltip-inside-the-plot rule
  this popup is the exception to, and why
- [[0031-design-token-scales]], [[0042-token-adoption-ratchet]] — the scale
  `--country-map-min-height` joins
- ADR-0007 — the Mapbox basemap and the renderer's one allowed origin
- Epic #179, Story #223
