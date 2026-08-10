# 0046. The loss tone splits: `--neg` for fills, `--neg-text` for text

- **Status:** Accepted (extends [[0021-allocation-map-gain-loss-scale]], [[0034-stat-tile-primitive-tone-axis]], [[0032-button-primitive-variants-and-sizes]])
- **Date:** 2026-08-10
- **Story:** #163, under Epic #162 (Accessibility conformance)

## Context

ADR-0008 declined shadcn/ui and recorded the tradeoff in plain terms: **we own the accessibility
work** Radix would have supplied. Nothing had since measured whether that was being paid.

Two axe-core audits on 2026-08-10 measured it. The second — with the analytics views populated by
importing the committed sample Flex exports — found the result that matters:

| Tone | on `--card` | on `--bg` |
| --- | --- | --- |
| `--pos` `#0ca30c` | 5.19:1 ✅ | 5.63:1 ✅ |
| `--neg` `#d03b3b` | 3.62:1 ❌ | 3.93:1 ❌ |

**Every negative money figure in the app was less legible than every positive one** — in
`StatTile`, in twelve `DataTable`s, and in the realized-gains highlight at 20px (which does not
qualify for AA's large-text allowance: that needs 24px normal, or 18.66px bold). `.btn-primary`
failed the same way, white on `--accent` at 3.20:1.

Nothing in the suite noticed, and nothing could have. The two tones were chosen to *mean* opposite
things — [[0021-allocation-map-gain-loss-scale]] validated them for colour-vision deficiency, which
they pass — and were never measured against a contrast threshold. CVD validation and contrast
validation are different questions, and passing one says nothing about the other. That is the
lesson worth carrying: the palette was *validated*, just not for this.

## Decision

### The loss tone splits in two; `--neg` does not move

`--neg` cannot simply be lightened, because it is used **both as text and as a fill under white
text** — five fill sites (`.btn-danger:hover`, `.chart-bar-loss`, `.chart-bar-upper`,
`.legend-swatch-upper`, the map popup's `color-mix` tint under [[0041-map-popup-return-tint-strength]])
against two text sites. The two demands pull opposite ways:

| Value | as text on `--card` | white on it |
| --- | --- | --- |
| `#d03b3b` (today) | 3.62 ❌ | 4.80 ✅ |
| `#e56c6c` | 5.53 ✅ | 3.14 ❌ |

So:

- **`--neg` stays exactly `#d03b3b`**, keeping the CVD validation recorded in
  [[0021-allocation-map-gain-loss-scale]] and [[0030-allocation-map-country-donut-pairs]], and keeping every fill use
  correct.
- **`--neg-text: #e56c6c`** carries the tone wherever it is text on a dark surface — exactly two
  rules, `.btn-danger` and `.stat-negative`.

`#e56c6c` measures **5.53:1** on `--card` and **6.01:1** on `--bg`. It was chosen to sit alongside
`--pos`'s 5.19 / 5.63 rather than to clear 4.5 by the smallest possible margin, because the finding
was **asymmetry**, not a number: a value that scraped the threshold would leave losses still
harder to read than gains, which is the thing being fixed.

This stays inside [[0021-allocation-map-gain-loss-scale]]'s rule on where `--pos` / `--neg` may be
spent — never as the only channel on a mark, freely where a figure accompanies the colour. Every
`.stat-negative` site prints a signed number beside the colour.

### `--accent-strong` for the filled button; `--accent` does not move either

The same shape of decision. `--accent` is the focus ring, the active-tab bar and the sort arrow;
moving it to fix one button would repaint the app. **`--accent-strong: #1360e7`** is used by
`.btn-primary` alone.

The owner chose to keep the white label and darken the fill; dark text on the existing accent
(5.90:1) was declined as reading like a different control.

**The hover is the binding measurement, not the resting state.** `.btn-primary:hover` applies
`filter: brightness(1.08)`, which *lightens* its own fill and therefore lowers contrast against a
white label. `#1360e7` measures 5.45:1 at rest and **4.81:1 hovered**. It keeps `--accent`'s hue
(218°) at 85% saturation, so the button still reads as the accent family rather than dulling to
slate.

axe never saw this: **it tests resting state only.** A guard modelled on the audit would have
inherited the same blind spot.

### The title bar becomes a `<header>`

`.titlebar-drag` held the app name as the one piece of page content outside any landmark. With no
OS chrome, this bar *is* the app's banner, so it takes the banner element — the same argument that
makes the window controls real buttons ([[0011-custom-frameless-window-shell]]): the shell is app code,
so it owes the semantics OS chrome would have supplied.

### The guard is a Node test, not an axe suite

`lib/contrast.ts` computes WCAG luminance and contrast ratio, and `contrast.test.ts` measures an
**enumerated list of pairings** read out of `app.css`.

It is deliberately not axe-core in `e2e/`. CI runs `lint`, `typecheck`, `test`, `build`; the
Playwright suite is excluded because it needs a display server, so an assertion placed there would
run only when someone remembered — which is not a guard, and would have cost a permanent
dependency to be one. Contrast is arithmetic over declared values, so it belongs beside
[[0031-design-token-scales]]'s `designTokens.test.ts` and [[0042-token-adoption-ratchet]]'s
ratchet, which also take the stylesheet as their subject.

Four things the list does that the audit could not:

- **It measures hover states.** The `brightness()` helper models the filter, which is how
  `.btn-primary:hover` — the worse of its two states — is covered at all.
- **It lists `.stat-positive`, which passes.** A guard listing only what once failed would have
  missed this story's finding too; the asymmetry is what is being pinned, and one assertion states
  it directly — the loss tone may not be less legible than the gain tone.
- **It fails if a pairing's token disappears**, rather than silently passing.
- **It pins the split itself** — that no fill adopts `--neg-text` and no text rule returns to
  `--neg` — because the threshold assertions alone would still pass if the two swapped.

The list is **enumerated by hand and must stay that way.** Resolving every colour against its
inherited background needs a layout engine, which is exactly what the Node-only Vitest environment
does not have ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]] is the same constraint from the other direction).

## Consequences

### Benefits

- Losses read as clearly as gains. The app's core job is comprehension, and the figure most worth
  reading carefully was the one hardest to read.
- Both validated palettes survive untouched: `--neg`, `--pos`, `--accent` and the two chart
  palettes are unchanged, so no CVD or contrast validation is invalidated.
- Contrast now fails the build rather than waiting for an audit. All contrast violations were
  cleared and re-verified with axe against the populated views.

### Tradeoffs

- **Two tokens where there was one**, in both cases. A new rule must now ask "text or fill?" — and
  getting it wrong is silent to the eye. The test pins both sides for that reason.
- **The pairing list is maintained by hand**, so a new surface colour or a new tone needs an entry.
  A missing entry is unguarded, not a failure. This is the same tradeoff
  [[0042-token-adoption-ratchet]] accepted, and for the same reason: two mechanical derivations
  were tried there and both leaked.
- **`brightness()` duplicates a CSS filter in TypeScript.** It is accurate for the one hover this
  app declares; a different filter function would need modelling too.

### What this does not fix

- **The Allocation map's `nested-interactive` failure** — a `role="img"` container with a
  focusable Mapbox canvas. Filed as #164 under Epic #98.
- **The tab panels still sit outside a landmark** (axe `region`, moderate, best-practice rather
  than WCAG). The `.tab-panel` wrapper contains the view's `<main>` rather than sitting inside one,
  so clearing it means restructuring the pattern [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] fixed — across
  every view, and with tabs staying mounted ([[0027-analytics-views-persist-and-explicit-refresh]]) several `<main>`
  elements would coexist. Deliberately left; it is a structural question, not a colour one.
- **Contrast beyond the enumerated pairings.** Chart and map SVG fills are graphics, judged
  against 3:1 rather than 4.5:1, and are not in the list.
