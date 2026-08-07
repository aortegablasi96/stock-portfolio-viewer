# 0041. The map popup's return tint is bounded by its own muted text, and the bound is recomputed by test

- **Status:** Accepted
- **Date:** 2026-08-07

## Context

The Allocation map's hover popup has carried a return tint since Story #122: the surface and
border take `--pos` when the hovered country or sector is up and `--neg` when it is down. That is
the one place on the map the app's green and red are allowed, and
[[0021-allocation-map-gain-loss-scale]] carves the case out explicitly — the tint accompanies a
Return figure printed two rows below it, so it is not fill-colour-as-the-only-channel and does not
need to clear CVD contrast unaided the way the marks' red ↔ gray ↔ blue scale does.

It was mixed at **12%** to protect the popup's text contrast, and it protected it into
invisibility. Against `--card` (`#171a21`) a 12% `--pos` mix resolves to `rgb(22, 42, 30)` — 16
points on the green channel and nothing on the other two. The owner reported the feature as
missing, not as weak, and the first diagnosis pass went looking for a wiring fault: the class
toggle, the `color-mix()` support, the Mapbox class list, the cascade against `mapbox-gl.css`,
whether cost basis was reaching `returnPercent` at all. All of it was correct. The only part that
could be seen was the 45% border, one pixel wide.

Two things about that are worth recording, because neither is visible in a diff. The failure was a
single number. And the number had a *reason* — the muted text — which made it look deliberate and
therefore unquestionable to everyone who read the rule afterwards, including the comment that
explained it.

## Decision

**The tint mixes at 26%, and the ceiling that produced it is enforced by test rather than by
comment.**

### The binding constraint is `--muted`, not `--text`

The popup's company name (`.map-popup-name`) and every row label (`.map-popup-row dt`) render at
`--muted` (`#9aa4b2`) and 0.78rem — 12.5px, which is WCAG AA normal text and so needs 4.5:1. That
is the first thing a stronger tint erodes; `--text` has roughly twice the headroom and never
binds. Resolved against the green surface:

| mix | surface | `--text` | `--muted` |
| --- | --- | --- | --- |
| 12% (was) | `rgb(22, 42, 30)` | 12.48:1 | 6.02:1 |
| 26% (is) | `rgb(20, 62, 28)` | 9.95:1 | 4.80:1 |
| 30% | `rgb(20, 67, 27)` | 9.34:1 | 4.50:1 |

30% is the exact bar. 26% is the bar with headroom, and it more than doubles the channel shift
that made the tint invisible. The red tone is looser at every step (5.41:1 at 26%) and does not
bind either.

### Both tones carry the same percentage

`--pos` is the darker and more saturated of the two, so the two tints do not read as equally loud
at 26%. Evening that out by tuning them apart was rejected: a tint meaning "up" and a tint meaning
"down" that differ in strength would encode a difference in *degree* on top of the difference in
sign, and the popup already prints the magnitude.

### The border stays louder than the surface

60% against `--border`, up from 45%. The surface carries the meaning; the border is what makes a
small popup read as tinted at all rather than as a slightly odd shade. The test pins the ordering
(`border > surface`) rather than the values, because the *relationship* is the decision.

### Flat and unknown share the untinted surface

`mapPopupTintClassName` returns `null` for both a return of exactly zero and one that cannot be
computed for want of a cost basis. Colour cannot separate those two, so it is not asked to — the
Return row prints `—` for the second. Strengthening the tint makes this *more* important, not
less: the untinted surface is now conspicuous by contrast, and it has to keep meaning "no
direction stated" rather than "flat".

### The number is recomputed, not asserted

`lib/mapPopupTint.test.ts` reads the `color-mix()` declarations out of `app.css`, resolves them in
sRGB the way the browser will, and computes WCAG contrast against the two text tokens. It fails in
**both** directions — below 20% (the "arithmetically present, practically absent" floor, which is
the lesson from 12%) and below 4.5:1 on either tone.

This is the same instinct as the ESLint layer boundaries, the CSP's omitted telemetry origin and
the zero-specificity focus ring ([[0031-design-token-scales]]): the invariant is
enforced by something that cannot be talked out of it. A class-name assertion would have passed at
12% and would pass again at 60% with the labels unreadable. The extraction of
`mapPopupTintClassName` out of `CountryMap` exists to give that test a home — Vitest is Node-only
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), so a rule about a component's colours can only be pinned from
`lib/`.

## Consequences

- The tint is legible, and the two ways it can be wrong now both fail CI.
- The floor and the contrast bar are constants in the test, so moving either is a deliberate edit
  with a diff, not a nudge to a value in a stylesheet.
- If `--card`, `--muted`, `--pos` or `--neg` are ever retuned, this test fails rather than the
  popup quietly falling below AA — the contrast is derived from the tokens, not copied from them.
- The marks are untouched. The map's own return scale stays red ↔ gray ↔ blue
  ([[0021-allocation-map-gain-loss-scale]], [[0030-allocation-map-country-donut-pairs]]), and this
  decision does not reopen it.
- Nothing here applies to `.stat-positive` / `.stat-negative`
  ([[0034-stat-tile-primitive-tone-axis]]), which colour *text* rather than a surface behind text.
