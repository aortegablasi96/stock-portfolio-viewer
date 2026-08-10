# 0021. Allocation map: the gain/loss colour scale

- **Status:** Superseded by 0045 (the colour mode is withdrawn — but the reasoning below that
  governs where `--pos` / `--neg` may be spent **still applies**, and 0045 depends on it)
- **Date:** 2026-07-26

## Context

[[0020-allocation-map-position-bubbles]] built the map's circle colour as a **data-driven style
expression over feature properties**, specifically so a later story could re-colour without
restructuring how the map is drawn, and named gain/loss colouring as the intended case. Story #95 is
that story.

It arrived with a natural assumption, written into the issue's first draft: use the app's existing
`--pos` / `--neg` gain-and-loss tokens, so the map agrees with the Positions table's Unrealized P&L
column, the performance stats, and the dividend bars. That assumption turned out to be wrong, for a
reason specific to this surface.

This DDR does **not** supersede DDR-0020. The circle layer, the popup, the spread, and the sector
palette are all unchanged; this records the second colour scale layered onto them, and the seven
design tokens it introduces.

## Decision

### Colour encodes return on cost, not absolute P&L

The circle's **radius already encodes market value**. Colouring by absolute P&L would spend the
colour channel re-encoding size, and a large holding barely up would outrank a small holding sharply
down — the map would answer *where is my money* twice and *how is it doing* never.

Return is `unrealizedPnl / |costBasis|`. The **absolute** cost basis matters: a short position
carries a negative basis, and a gain on a short is still a gain, so dividing by the signed value
would report winners as losers.

### Red ↔ gray ↔ blue, not green ↔ red

This is the decision worth the record, because it contradicts what the rest of the app does.

Measured with the data-viz validator against the light basemap:

| pair | CVD ΔE (worst) | verdict |
| --- | --- | --- |
| `--pos` `#0ca30c` ↔ `--neg` `#d03b3b` | **4.1** (deuteranopia) | **FAIL** — below the 6.0 floor |
| `#2a78d6` ↔ `#d03b3b` | **23.8** (protanopia) | PASS |

Green also measures **2.95:1** against the basemap, under the 3:1 floor for marks.

The reason green/red is tolerable everywhere else in the app and not here is **what else is on
screen**. In the Positions table, the popup, and the stat tiles, colour sits beside a signed number:
it reinforces a value the reader already has. On the map, fill colour is the **only** channel — no
number, no label, nothing beside a circle. A red-green colourblind reader (~8% of men) would see one
undifferentiated colour across the entire map and get nothing at all from the mode.

So `--pos` / `--neg` are **unchanged everywhere they are used today, including this map's own
popup**, where the signed P&L figure accompanies them. Only the circle fills take the diverging
scale.

### Seven steps through a neutral gray middle

Three steps per arm plus a neutral middle. Discrete buckets read better than a continuous gradient
on a 4–16px circle, and give the legend something to label. The midpoint is **gray, never a hue** —
a hue there would imply a third category rather than an absence.

Steps are interpolated in **Oklab** between `#d03b3b`, `#898781` and `#2a78d6` — computed, not
eyeballed — and every one clears 3:1 against the basemap:

| token | hex | contrast | meaning |
| --- | --- | --- | --- |
| `--diverge-1` | `#d03b3b` | 4.22 | ≤ −16.7% |
| `--diverge-2` | `#bc5d55` | 3.82 | −16.7 to −8.3% |
| `--diverge-3` | `#a5746b` | 3.48 | −8.3 to 0% |
| `--diverge-4` | `#898781` | 3.16 | flat, or unknown |
| `--diverge-5` | `#6f849f` | 3.37 | 0 to +8.3% |
| `--diverge-6` | `#5180bb` | 3.58 | +8.3 to +16.7% |
| `--diverge-7` | `#2a78d6` | 3.88 | ≥ +16.7% |

Lightness peaks at the neutral middle and falls toward both poles, which is what makes it read as
diverging rather than as a ramp. The middle reuses the same gray the map already gives unclassified
sectors, so "no information" wears one colour throughout the view.

### Bounded at a fixed ±25%, clamped

A **fixed** bound, so the same colour means the same return in every session and the map is
comparable over time. A data-driven range scaled to the largest return on screen was rejected: one
outsized winner would wash everything else pale, and the same colour would mean different things on
different days.

Returns beyond ±25% saturate at the pole — a +150% holding paints the same as a +25% one, both
simply "strongly up". The bound is one named constant (`RETURN_BOUND`).

### Flat and unknown share a colour, so the popup states the number

A holding with **no cost basis** has no return to express. It takes the neutral step rather than
being rendered as 0% — claiming "flat" would assert something untrue.

That makes the neutral colour ambiguous: it means *flat* or *unknown*. Rather than invent a third
visual treatment for a rare case, the **popup gained a `Return` row** stating the figure in text,
showing `—` when it cannot be computed. Colour is therefore never the only carrier of the meaning,
which is also what keeps the mode legible when the scale itself is hard to read.

### Sector stays the default; the mode is not persisted

The map opens the way it always has. Gain/loss is reached through a `Colour by` segmented control
using the existing `.chart-tabs` pattern — the third instance of an established control, not a new
one — and the selection resets on relaunch. *Where am I losing money* is a question you ask, not a
mode you live in.

Switching modes changes **only the paint expression**: both colours ride on every feature, so the
source is never touched and nothing moves, resizes, reorders, or re-uploads. The legend and the
caption hint swap with the mode; the caption keeps its slot so the map does not shift.

## Alternatives Considered

### Keep green ↔ red, matching the P&L column

Familiar, needs no explanation, and consistent with every other gain/loss surface. Rejected on the
measurement above: on a surface where colour is the only channel, it conveys nothing to a red-green
colourblind reader, and green additionally fails the contrast floor against the basemap.

### Green ↔ red plus a texture channel

Would keep the familiar hues and restore meaning under CVD through hatching. Rejected as
impractical at this size: hatching a 4–16px circle will not read, and it is substantially more work
than choosing hues that pass unaided.

### A continuous gradient rather than seven steps

Smoother, and arguably more honest about a continuous quantity. Rejected on legibility: adjacent
values are indistinguishable on a small circle either way, and a stepped scale gives the legend
labelled bounds instead of an unlabelled ramp.

### Data-driven scale bounds

Always uses the full palette, whatever the portfolio's spread. Rejected for instability — the same
colour would denote different returns from day to day, and a single large winner would flatten the
rest of the map.

### Replacing sector colouring outright

Simplest to build: one colour meaning, no control. Rejected by the owner — sector-at-a-glance on the
map, and its shared identity with the Sector donut, is worth keeping.

## References

- [[0020-allocation-map-position-bubbles]] — the circle layer and data-driven colour expression this
  extends; **not superseded**
- [[0009-sector-classification-cache-and-allocation-donuts]] — the sector palette Sector mode uses
- [[0007-portfolio-display-currency-and-live-fx]] — unrelated to this scale; base-currency figures
  reach the map already converted
- `docs/decisions/0007-mapbox-basemap-and-renderer-network-policy.md` — unchanged by this story
- GitHub Issues #95 (Story), #4 (Epic M3); prior rounds #46, #70, #71, #89, #92
