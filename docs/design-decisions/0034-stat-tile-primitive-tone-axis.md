# 0034. One stat tile: no surface of its own, one axis, and neutral is the absence of a tone

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

The Epic #125 audit found the same component written twice. The Portfolio dashboard's balance
tiles and the analytics views' stat tiles present a headline figure the same way, and the copies
had drifted:

| | `.balance-*` (dashboard) | `.stat-*` (analytics) |
| --- | --- | --- |
| Tile | `1.1rem 1.25rem`, `--card`, 1px border, 12px radius | *identical* |
| Label | `0.78rem`, `0.04em`, uppercase, `--muted` | **byte-identical** |
| Value | `1.5rem` 600 tabular | `1.4rem` 600 tabular |
| Hint | — | `.stat-hint` |
| Tone | — | `.stat-positive` / `.stat-negative` |
| Row | `repeat(3, 1fr)` + a 720px media query | `repeat(auto-fit, minmax(11rem, 1fr))` |

`StatTile.tsx` already existed, but under `components/analytics/`, so the dashboard could not
reach it: `BalancesSummary` rendered its own markup, and a balance could therefore never carry a
gain/loss colour or a hint line — a gap nobody chose.

[[0033-card-primitive-variants-and-sizes]] deliberately deferred these two rules to this story,
and [[0031-design-token-scales]] had already settled the one real collision: `--text-xl` is
**1.4rem**, because the stat grid packs tiles into 11rem columns where 1.5rem risks wrapping.

## Decision

**One `StatTile`, in `components/ui/` where both callers can reach it, built on the `Card`.**

### The tile has no surface rule at all

`.stat-tile` and `.balance-tile` collapse to **none**, not to one. A tile *is* a card
(`variant="default"`, `size="md"`), so its background, border, radius and padding are the card's.
What is left — `.stat-label`, `.stat-value`, `.stat-hint` and the tone — is the part a card knows
nothing about. `lib/statTileVariants.test.ts` fails if any `.stat-*` rule starts declaring a
`background`, `border` or `padding` again, which is how the surface stays in one place.

### The axis is `tone`, not `variant`/`size`

The button and the card take `variant` × `size`. A headline figure is always a panel-level tile,
so both of those axes would have exactly one value; what genuinely varies is the **polarity of the
number**. `tone` is therefore the tile's only axis, and adding the other two "for symmetry" would
be the speculative abstraction the project's principles rule out.

### Neutral is the absence of a tone, not a third colour

`toneClassName('neutral')` returns `''`, and there is deliberately no `.stat-neutral` rule. That
is what lets one helper serve all four places a signed figure appears — a tile, a table cell
(`num`), the realized-gains highlight, and the Allocation map's popup — because each keeps the ink
it already inherits. A `.stat-neutral` colour would have had to guess which of those four was
right. The map's popup had already reached this conclusion locally, with its own `toneFor` helper
returning an empty string; that duplicate is now the shared one.

`--pos` / `--neg` stay. This is precisely the case [[0021-allocation-map-gain-loss-scale]] carves
out of its own red↔blue scale: on a tile, in a cell and in the popup a **figure sits beside the
colour**, so hue is a second cue rather than the only channel.

### One row, `auto-fit`, no breakpoint

`.balances`' fixed `repeat(3, 1fr)` plus its 720px media query is replaced by `.stat-row`'s
`auto-fit` over `minmax(11rem, 1fr)`. At the dashboard's width the two are identical — three equal
columns — but `auto-fit` reflows on the space actually available, so the row needs no breakpoint of
its own and the same grid serves rows of three and four tiles.

### The realized-gains highlight card is *not* a StatTile

It keeps its own markup, and the reason is worth stating: a **symbol line sits between its label
and its figure**, and the figure is deliberately secondary (`--text-lg`) because it annotates the
table beside it rather than heading a view. Only `.highlight-label` folds in — it was a
byte-identical *third* copy of `.stat-label`.

## Consequences

- **`StatTile` and `StatRow` are the one way to show a headline figure**, and both the dashboard
  and the four analytics views use them. Tone and hint are now available to the balances; whether
  a balance uses them is a separate product decision, not a styling limit.
- **`toneOf` moved from a component file into `lib/`**, with `toneClassName` beside it. Under
  Vitest's Node-only environment (DDR-0029) that is the difference between tested and untested;
  the boundary cases — zero, and negative zero, both neutral — are pinned there.
- **Two deliberate visual corrections**, confirmed by pixel-diffing all five views against `main`
  (the balances row compared by injecting each build's own markup into its own page, since that
  row needs a live gateway to render). Nothing else on any page moved:
  1. The balance figure drops `1.5rem → 1.4rem`, matching every other headline figure in the app.
  2. Every tile's vertical padding rounds `1.1rem → 1.25rem` onto `--surface-pad-md`, taking each
     stat row 141px → 148px and shifting what follows it down by 7px.
  Label and hint sizes also round `0.78rem → --text-xs` (0.32px), the rounding DDR-0031 sanctioned.
- **`.stat-positive` / `.stat-negative` keep their names**, because they are worn by table cells
  and a map popup as well as by tiles — they are the app's tone semantic, not the tile's internals.
- The stylesheet is 1,951 lines, 19 fewer than before this story, and the primitive's rules now
  sit beside the card's rather than in the analytics section they were written for.
