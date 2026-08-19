# 0063. Allocation: the breakdown as a pair, and the basemap goes dark

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

Story #191 is the fourth of Epic #179's five view stories, and like #190 it found most of its own
acceptance criteria already satisfied: the Allocation view has carried three KPI tiles, a map card,
a breakdown card with its slice-by strip and a positions table since Milestone M3, and Stories
#185–#188 restyled all four. Three things were genuinely open.

**The pair.** The prototype draws the breakdown table and its donut side by side at `1fr / 280px`,
with a name + percentage legend under the donut. The table and donut have been side by side since
Story #48 — but at `1.4fr / 1fr`, two *fractional* tracks, and with the donut's legend switched off
because the table said everything it did. Two fractional tracks look equivalent to `1fr / 280px` and
are not: `.pie` caps at 13rem, so past about 1200px of card the donut stops growing while its column
does not, and a maximized window spends the difference on empty air — taken from the table, which is
the half with figures in it.

**The order.** The prototype puts the pair above the map. This view ships with the map first, which
is how it grew rather than a decision: the map arrived in M4 as the headline of its own story.

**The basemap**, which [[0054-navy-indigo-palette-re-key]] explicitly deferred here. That story
re-keyed the app to a `#080b18` ground and recorded the consequence as a risk rather than fixing it:
`mapbox/light-v11` had been a light map in a dark app for two milestones, and against navy it became
a lit panel in a dark room — the brightest thing in the app by a wide margin, and the only surface
that does not belong to it.

What made the basemap more than a one-line swap is a coupling nothing states. The weight donut's
track — the arc's remainder, the thing [[0030-allocation-map-country-donut-pairs]] says turns "an
arc" into "38% of the way round" — was drawn as `fill: var(--card)` at 42% opacity. That is how you
draw a *grey ring* when there is a white map behind it. On a dark basemap it is near-black on
near-black: the track disappears, and the left donut becomes a small blue arc floating with nothing
to be a fraction of. It renders, it type-checks, and it looks like a design rather than a fault.

## Decision

### The donut's track is fixed at 280px, and the table takes the rest

`grid-template-columns: minmax(0, 1fr) var(--donut-column-width)`, the third structural width
token beside `--sidebar-width` and `--rail-width` and declared for the same reason: it is quoted by
the grid that places it and by the media query that decides when it stops fitting.

`align-items` moves from `center` to `start`. With a fixed short column, centring floats the donut
in the middle of a twelve-row card with its legend adrift below it.

The stacking breakpoint moves **640px → 948px**, derived rather than chosen, and
`lib/allocationLayout.test.ts` does the arithmetic rather than trusting the comment beside it:
220 (sidebar) + 64 (content padding) + 40 (the card's own) + 280 (the donut) + 24 (`--space-7`) +
320 (what a slice label, a currency value and a percentage need). 640px was right while both tracks
were fractional and shrank together; a fixed track does not shrink, so below this width the table is
the only thing left to squeeze — which is the opposite of what the pair is for.

### The legend comes back, carrying the share and not the value

`showLegend` is gone rather than flipped: it had one call site, set to `false`, so the legend it
guarded had rendered nowhere in the app since Story #48. What returns is not that legend. The old
one was a vertical list of label + value + percentage — the table again, in a 280px column, at half
the legibility. The new one **wraps**, and carries a muted name beside a full-strength percentage:
the hue's meaning, which the table cannot supply, and the figure the arc itself encodes, so a reader
following an arc round does not change columns to find out what it came to. Value stays in the
table's column and in the slice's `<title>`, each of them once.

### The breakdown comes before the map

The map is the tallest card on the page and the only approximate one — it is positioned by issuer
country and says so in its own label. The breakdown is the exact answer to the question the view is
opened with. A 3:1 map above it put the figures below the fold at the window this app opens at.

### The basemap is `dark-v11`, and the track moves with it

Monochrome and low-saturation, which is [[0019-allocation-map-basemap-and-overlay]]'s stated reason
and is unspent by going dark: the sector palette is categorical, and the marks must stay the only
strongly saturated thing on screen. `streets` and `satellite` remain rejected on that same ground.

**`.country-mark-rest` moves from `var(--card)` to `var(--muted)`**, and drops its own `--border`
hairline so the rest wears the same `--card` separator as every other slice on the mark. `--muted` is
the app's neutral for something that recedes, and it is hue-free, which this track must stay: a
tinted track would read as a ninth category.

The two are asserted **together** in `lib/allocationLayout.test.ts`, because either one alone is a
regression that looks deliberate — reverting the basemap leaves a grey ring on a grey map, and
moving the track alone leaves the lit panel.

Nothing else about the map changes. The dual-donut marks, the reserved blue slot and
`SECTOR_SLOT_OFFSET`, the 2% floor on sectors only, `role="group"` with `keyboard: false` and every
marker host at `tabindex="-1"` set before construction, the popup's absolute-length tint stops, the
app's own zoom controls, and the `aspect-ratio: 3 / 1` frame are all untouched — as is
[[0045-allocation-map-one-sector-view]]'s absence of a gain/loss mode, which the same test pins by
walking every `.country-mark*` declaration for `--pos` / `--neg`.

## Consequences

Benefits:

- The window's extra width now goes to the table rather than to air beside a donut that has stopped
  growing, at every size above about 1200px of card.
- The Allocation card no longer contains the brightest surface in the application. The map reads as
  part of the page instead of a window cut into it.
- The weight donut states a proportion again — on either ground, now, since the track no longer
  borrows a surface colour to be grey.
- The exact figures are the first thing on the page.
- One dead prop and one dead legend variant leave the codebase.

Tradeoffs:

- **The stacking breakpoint nearly doubles**, so a narrow window stacks where it used to keep two
  columns. That is the honest reading of a fixed track: at 700px the pair would have been a 280px
  donut beside a 200px table.
- **The map's marks are now light-on-dark**, which is a second appearance for every sector hue.
  They were validated mark-against-mark and that does not depend on the ground (DDR-0054), but the
  eight hues were cut for a light basemap and a re-cut for navy remains the open option that story
  named.
- The legend repeats a percentage the table also shows. That is deliberate — it is the arc's own
  label — but it is a duplicate.

Risks:

- **`dark-v11`'s labels are dimmer than `light-v11`'s.** Country names on the basemap are Mapbox's
  own type, outside this project's contrast guards either way, and they sit further from AA on the
  dark style. The map is supplementary and carries no figure — the popup and the Positions table do
  — but it is worth stating that this is a style whose typography we do not control.
- **The 320px table budget is a judgement**, like #190's character budget. It is asserted, so a
  wider column has to come back here rather than quietly overrunning.

## Alternatives Considered

### Option A — Keep `light-v11`

Cheapest, and it is what shipped for two milestones. Rejected on the evidence in the running app:
the card is the brightest object on screen by a large margin, and the redesign's whole claim is one
deliberate visual system rather than the accumulated result of four rounds. DDR-0054 already stated
the problem and deferred only the fix.

### Option B — The prototype's flat `geoNaturalEarth1` bubble map

Out of scope by the Epic's own *Not Included*, and rightly: it discards the sector dimension the
dual donuts carry and the absolute 0–100% weight donut, and would supersede both ADR-0007 and
DDR-0030. It needs its own ADR.

### Option C — Two cards for the pair, as the prototype draws it

The prototype puts the table in one card and the donut in another headed *Distribution*. Declined:
the slice-by control heads the pair, not the table, and splitting them puts a card boundary through
a link that DDR-0040 spent a story making seamless. One card, one header strip, two columns.

### Option D — Keep the donut's column fractional and cap it

`minmax(0, 1fr)` with a `max-width` on the chart is what the view already effectively had, and it
is the arrangement that produced the empty air. Capping the *chart* does not stop the *track* from
growing.

## References

- [[0019-allocation-map-basemap-and-overlay]] — the basemap's original monochrome reasoning; the
  style value below is superseded here, the reason for it is not
- [[0030-allocation-map-country-donut-pairs]] — the dual-donut marks, the reserved blue, the track
- [[0040-allocation-breakdown-linked-slice-emphasis]] — the table/donut link on `key`, never `fill`
- [[0041-map-popup-return-tint-strength]] — the popup's tint geometry, unchanged here
- [[0045-allocation-map-one-sector-view]] — the gain/loss mode stays withdrawn
- [[0047-allocation-map-is-a-group]] — the map's accessibility position, unchanged here
- [[0054-navy-indigo-palette-re-key]] — the palette this basemap was left behind by, and the
  deferral this record answers
- [[0031-design-token-scales]], [[0042-token-adoption-ratchet]] — the scale the new width joins
- Epic #179, Story #191
