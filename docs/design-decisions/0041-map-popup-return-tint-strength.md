# 0041. The map popup's return tint is banked into its edges, so the colour never passes behind text

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

The Allocation map's hover popup has carried a return tint since Story #122: it takes `--pos` when
the hovered country or sector is up and `--neg` when it is down. That is the one place on the map
the app's green and red are allowed, and [[0021-allocation-map-gain-loss-scale]] carves the case
out explicitly — the tint accompanies a Return figure printed inside the popup, so it is not
fill-colour-as-the-only-channel and does not need to clear CVD contrast unaided the way the marks'
red ↔ gray ↔ blue scale does.

It shipped as a **flat wash at 12%**, and was reported as missing rather than weak. Against
`--card` (`#171a21`) a 12% `--pos` mix resolves to `rgb(22, 42, 30)` — sixteen points on the green
channel and nothing on the other two, a contrast of 1.15:1 against the untinted surface. The
diagnosis pass went looking for a wiring fault first: the class toggle, `color-mix()` support, the
Mapbox class list, the cascade against `mapbox-gl.css`, whether cost basis was reaching
`returnPercent` at all. All of it was correct.

12% was not arbitrary. It was protecting the popup's own muted text — `.map-popup-name` and every
`.map-popup-row dt` render at `--muted` (`#9aa4b2`) and 0.78rem, which is 12.5px and therefore WCAG
AA normal text at 4.5:1. That is a real constraint, and it caps a flat wash at **30%**:

| flat wash | surface | `--text` | `--muted` |
| --- | --- | --- | --- |
| 12% | `rgb(22, 42, 30)` | 12.48:1 | 6.02:1 |
| 26% | `rgb(20, 62, 28)` | 9.95:1 | 4.80:1 |
| 30% | `rgb(20, 67, 27)` | 9.34:1 | **4.50:1** |

An intermediate revision of this story shipped 26% — the ceiling with headroom. It was still not
enough colour, which is the useful finding: **the constraint was not the number, it was the
premise that the tint is a surface.**

## Decision

**The tint is a gradient banked into the popup's top and bottom edges — `--popup-edge` at both
extremes, `--card` across the middle — and the two inner stops sit at the content's own vertical
padding.**

```css
background: linear-gradient(
  to bottom,
  var(--popup-edge, var(--card)) 0,
  var(--popup-edge, var(--card)) var(--popup-edge-hold),
  var(--card) var(--popup-pad-y),
  var(--card) calc(100% - var(--popup-pad-y)),
  var(--popup-edge, var(--card)) calc(100% - var(--popup-edge-hold)),
  var(--popup-edge, var(--card)) 100%
);
```

### The geometry is what buys the strength

The coloured band is exactly the gutter above the first line and below the last. No glyph is ever
on the tint: every line of text sits on plain `--card`, at its full 14.32:1 for `--text` and 6.90:1
for `--muted`, whatever the tint is doing. Colour that never passes behind a glyph has no contrast
budget to spend, so the edge is free to be loud — **50%**, resolving to `rgb(17, 95, 22)` and
`rgb(115, 43, 46)`, roughly double the separation from `--card` that the flat 26% managed.

### The gutter is the canvas, and the colour is held flat across half of it

The first cut of this gradient rode the popup's existing 0.6rem padding and started fading at the
very first pixel. It was still reported as barely visible, and the arithmetic says why: a 9.6px
ramp is only ~5px before it is halfway to `--card`, so the tint had no area at full strength
anywhere.

Two changes, and the second is the one that mattered. `--popup-pad-y` goes to **1.1rem** — a deeper
gutter than a popup this dense would otherwise want, accepted because the gutter *is* the area the
tint is allowed to use. And `--popup-edge-hold` (**0.55rem**) holds the edge colour flat before the
fade begins, so half the band is solid colour rather than a ramp through it. Widening alone would
have produced a wider hairline.

`--popup-edge-hold` must stay strictly below `--popup-pad-y`: at the hold stop the tint is still at
full strength, so if the two ever met, the first line of text would sit on undiluted `--pos`.

### The stops are an absolute length, not a percentage

`--popup-pad-y` is declared once on `.map-popup-shell` and used both as the content's padding and
as the gradient's inner stops, so the two cannot drift. A percentage band would look identical on
the four-row country popup it was tuned against and creep under the text of the six-row sector
popup — the failure would appear only on the taller cards, which are also the more informative
ones.

### The tip takes the edge colour, not the middle

Mapbox flips the popup above or below the mark to keep it in frame, so the tip attaches to
whichever edge is loud. A `--card` arrow on a coloured edge would read as a seam.

### Both tones carry the same percentage

`--pos` is the darker and more saturated of the two, so they are not equally loud at 50%. Evening
that out by tuning them apart was rejected: a tint meaning "up" and a tint meaning "down" that
differ in strength would encode a difference in *degree* on top of the difference in sign, and the
popup already prints the magnitude.

### Flat and unknown share the untinted popup

`mapPopupTintClassName` returns `null` both for a return of exactly zero and for one that cannot be
computed for want of a cost basis. Colour cannot separate those two, so it is not asked to — the
Return row prints `—` for the second. A stronger tint makes this *more* important, not less: an
untinted popup is now conspicuous, and it has to keep meaning "no direction stated".

### What the test pins is the geometry

`lib/mapPopupTint.test.ts` asserts the gradient's inner stops are `--popup-pad-y`, that the same
variable is the padding, and that `--popup-edge-hold` sits strictly inside it — the invariant the
strength rests on — plus a floor on the edge's
separation from `--card` (1.6:1; the flat-wash era sat at 1.10–1.15) and AA for `--muted` and
`--text` against `--card`, which is the surface they actually sit on. It resolves the `color-mix()`
declarations out of `app.css` and computes contrast rather than asserting literals, so retuning
`--card`, `--muted`, `--pos` or `--neg` fails here instead of quietly dropping the popup below AA.

Same instinct as the ESLint layer boundaries, the CSP's omitted telemetry origin and the
zero-specificity focus ring ([[0031-design-token-scales]]): the invariant is enforced by something
that cannot be talked out of it. The extraction of `mapPopupTintClassName` out of `CountryMap`
exists to give that test a home — Vitest is Node-only
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), so a rule about a component's colours
can only be pinned from `lib/`.

## Consequences

- The tint is visible, and it got there without spending any of the text's contrast.
- The band's width is tied to the padding by construction, so a future padding change carries the
  gradient with it.
- The marks are untouched. The map's own return scale stays red ↔ gray ↔ blue
  ([[0021-allocation-map-gain-loss-scale]], [[0030-allocation-map-country-donut-pairs]]), and this
  decision does not reopen it.
- Nothing here applies to `.stat-positive` / `.stat-negative`
  ([[0034-stat-tile-primitive-tone-axis]]), which colour *text* rather than a surface behind text.
- **This does not make a losing holding visible on the map.** The popup's subject is a country or a
  sector-within-country ([[0030-allocation-map-country-donut-pairs]] retired per-holding marks), so
  a loss inside a winning parent is aggregated away before the tint sees it — a portfolio can have
  several losing positions and exactly one red mark. Making individual losers findable is a
  granularity question, not a colour one, and is not settled here.
