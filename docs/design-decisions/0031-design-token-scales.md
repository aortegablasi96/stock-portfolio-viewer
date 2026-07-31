# 0031. Spacing, radius, type and focus come from a named scale

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

`:root` in `app.css` has always declared colour tokens, and declares them well: the categorical
`--series-*` palette and the diverging `--diverge-*` scale carry recorded CVD and contrast
validation ([[0021-allocation-map-gain-loss-scale]], [[0030-allocation-map-country-donut-pairs]]),
and [[0018-content-measure-and-chart-aspect]] added `--content-max` / `--content-pad` as the one
shared measure. **Every other dimension is picked at the call site.**

An inventory of the stylesheet at commit `797cb44` found:

| Dimension | Distinct values in use |
| --- | --- |
| Padding | `2rem`, `1.25rem`, `1.1rem 1.25rem`, `1rem 1.1rem`, `0.6rem 0.9rem`, `0.5rem 1rem`, `0.55rem 1.1rem`, `0.35rem 0.75rem`, `0.35rem 0.6rem`, `0.35rem 0.5rem`, `0.15rem 0.55rem`, `0.05rem 0.35rem`, … |
| Gap | `0.15`, `0.25`, `0.35`, `0.4`, `0.5`, `0.6`, `0.75`, `0.85`, `1`, `1.25`, `1.5rem` |
| Radius | `1px`, `3px`, `6px`, `8px`, `12px`, `999px` |
| Font size | `0.72`, `0.78`, `0.8`, `0.82`, `0.85`, `0.9`, `0.95`, `1.1`, `1.15`, `1.25`, `1.4`, `1.5`, `1.9rem` |
| Focus ring | `2px solid var(--accent)` ×9, `2px solid var(--neg)` ×1, absent ×several |

Five font sizes between 12.5px and 14.4px are not five decisions; they are one decision made five
times. `.balance-label` and `.stat-label` are byte-identical; `.balance-value` and `.stat-value`
differ only by `1.5rem` against `1.4rem`.

This is the foundation for the eight primitives in Epic #125 (ADR-0008 decides they are built
in-house rather than taken from shadcn/ui), so it lands first. The primitives cannot be consistent
if the values they are made of are not.

## Decision

Four scales on `:root`, alongside the untouched colour tokens. **A rule uses a step, never a raw
length.**

### Spacing — a 4px grid with one 6px half-step

`--space-1` `0.25rem` · `--space-2` `0.375rem` · `--space-3` `0.5rem` · `--space-4` `0.75rem` ·
`--space-5` `1rem` · `--space-6` `1.25rem` · `--space-7` `1.5rem` · `--space-8` `2rem`

Derived from the values already in the stylesheet: every existing padding, margin and gap lands
within **2.4px** of a step, and most within 0.8px. The 6px half-step exists because the app's
dense controls genuinely cluster there (`0.35rem`) and rounding them to 4px or 8px would be the
one visible change in the set.

On top of the scale, two families of **composite padding**, because the audit's twelve paddings
are really two things in three sizes:

- `--control-pad-sm | -md | -lg` — a control box. `md` (`0.5rem 1rem`) is the default and already
  matches `.capture-button` / `.danger-button` / `.ghost-button` exactly.
- `--surface-pad-sm | -md | -lg` — a card surface. `md` (`1.25rem`) is the default and already
  matches `.panel` / `.allocation` / `.snapshot-history`; `sm` is for a card nested inside a panel
  (`.highlight-card`), `lg` for a full-width state panel.

So `size="sm"` means the same thing on a button as on a chip, and a panel and a tile share one
surface treatment.

### Radius — `sm` 6px, `md` 8px, `lg` 12px, plus `pill` 999px

Kept in **px, not rem**: a corner should not grow when the type scale does. `sm` is for inline
chips, `md` for controls, `lg` for card surfaces — which is what the stylesheet already does, so
adopting them changes nothing. The `1px` and `3px` radii are chart and progress-bar internals and
stay out of the scale deliberately; they are geometry, not surface treatment.

### Type — seven steps replacing thirteen sizes

`--text-2xs` `0.72rem` · `--text-xs` `0.8rem` · `--text-sm` `0.9rem` · `--text-md` `1.1rem` ·
`--text-lg` `1.25rem` · `--text-xl` `1.4rem` · `--text-2xl` `1.9rem`

Ratios run 1.11 → 1.27, widening toward the top, which is how a type scale should behave. The
three near-identical small sizes (`0.78` / `0.8` / `0.82rem`) collapse into `xs`; the two body
sizes (`0.85` / `0.9rem`) into `sm`. Largest movement is **1.6px**, on the `1.4rem` → `1.5rem`
pair below.

Two line heights, unitless: `--leading-tight` `1.2` for headings and figures, `--leading-normal`
`1.45` for prose, matching the `1.4`/`1.45` already in use.

Chart and map SVG labels (`10px`, `11px`, `12px`) are **not** on this scale. They scale from a
`viewBox`, not from the page ([[0018-content-measure-and-chart-aspect]]), so a page-level step
would mean something different there.

**The named collision: `--text-xl` is `1.4rem`, not `1.5rem`.** `.balance-value` (Portfolio
balances) and `.stat-value` (analytics stat tiles) render the same thing — a headline figure on a
tile — at two sizes for no reason anyone recorded. `1.4rem` wins because `.stat-row` packs tiles
into `minmax(11rem, 1fr)` columns, where a long converted currency figure at `1.5rem` is at risk
of wrapping; the balances grid is a fixed three columns with room to spare. So the correction
costs the roomier surface 1.6px and protects the tighter one. Deliberate, and the only visible
type change in the Epic.

### Focus — one ring, and it is a base rule rather than a class

```css
--focus-ring-width: 2px;
--focus-ring-color: var(--accent);
--focus-ring: var(--focus-ring-width) solid var(--focus-ring-color);
--focus-ring-offset: 2px;
--focus-ring-offset-inset: -2px;
```

Applied by a zero-specificity base rule, not a utility class to remember:

```css
:where(a[href], button, input, select, textarea, summary, [tabindex]):focus-visible {
  outline: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

`:where()` is the point. It contributes **no specificity**, so every existing rule still wins and
this story is additive rather than a restyle — and as later stories delete their per-class focus
rules, each one falls through to this instead of losing its ring. An interactive element is now
ringed by default and **cannot be shipped without one**, which is the difference between a
convention and a guarantee. It is the same instinct as the ESLint-enforced layer boundaries and
the CSP that blocks Mapbox telemetry by omission (ADR-0007): an invariant that matters is enforced
by the platform, not by intent.

Two consequences follow immediately:

- **`.danger-button` loses its `--neg` ring.** It was the only element in the app that focused in
  red. Focus answers "where am I", not "how dangerous is this" — and the severity is already
  carried by the button's red label and red hover fill, neither of which changes. A red ring on a
  destructive control also collides with the error state's `#5a2b2b` borders.
- **`.map-zoom-btn` gains a ring it never had.** Along with the custom date inputs and any Mapbox
  control that takes focus. That is a real accessibility gap closed, and the one place a keyboard
  user will see a difference beyond the colour change above.

`--focus-ring-offset-inset` exists for the two controls whose ring would otherwise be clipped by an
ancestor — `.titlebar-button` and `.tab-panel` — which already used `-2px` and keep it, now by
name.

## Consequences

Benefits:

- Eight later stories inherit one set of decisions instead of re-picking values. A primitive that
  needs a padding has one place to look and three sizes to choose from.
- The `sm` / `md` / `lg` vocabulary in the token names is the same vocabulary as the `size` prop in
  ADR-0008, so a component's API and its CSS agree by construction.
- Focus becomes a guarantee rather than a habit, and one previously unringed control is fixed.
- `src/renderer/src/lib/designTokens.test.ts` pins the contract: every step declared, every scale
  ascending, spacing on the 4px grid bar the declared half-step, `outline` appearing in the
  stylesheet with exactly one value, and both validated palettes byte-for-byte where they were. It
  is a test with no module under test, which is unusual — but the artefact worth protecting here is
  the stylesheet, and eight stories are about to rewrite slabs of it.

Tradeoffs:

- **The scales are declared but not yet adopted.** Every existing rule still carries its raw value
  until the story that extracts its primitive gets to it, so for the length of Epic #125 the
  stylesheet holds both. Accepted deliberately: adopting all four scales in one commit would be a
  ~250-selector diff with no primitive to show for it, and impossible to review against "no
  unintended visual change".
- A 4px grid with a 6px exception is less pure than a strict grid. The exception is where the app
  actually lives; purity would have cost a visible change on every dense control.

Risks:

- **Adoption stalls and the raw values persist**, leaving two conventions permanently. Mitigated by
  the Epic's criterion that each story deletes the rules it supersedes, and by the token test
  failing loudly if the foundation itself erodes.
- **The scale proves too coarse** and a later story reaches for a raw value. That is the signal to
  add a named step and record why — not to special-case a call site.

## Alternatives Considered

### A strict 4px grid with no half-step

Cleaner to state, and rejected on the evidence: the app's dense controls sit at `0.35rem` (5.6px),
so every chip, chart tab and select would have moved by 1.6px or 2.4px. The story's own criterion
is that adopting the scale causes no visible change, and this is the one place a pure grid breaks
it.

### Tailwind's scale (or any published scale) adopted wholesale

Rejected for the same reason ADR-0008 rejects the package: an external scale is only free if you
also take the framework that applies it. Adopting the *numbers* alone would move essentially every
value in the stylesheet, which is a restyle disguised as a refactor.

### `clamp()` / fluid type instead of fixed steps

Rejected: this is a desktop app in a frameless window whose width the owner controls, and
[[0018-content-measure-and-chart-aspect]] already caps the content measure at `110rem`. Fluid type
solves a responsive-web problem the app does not have, and would make every size untestable as a
value.

### A `.focus-ring` utility class instead of a base rule

Rejected: a class has to be remembered, and the audit is a record of what happens to things that
have to be remembered — `.map-zoom-btn` shipped with no ring at all. A zero-specificity base rule
inverts the default so that forgetting produces the correct result.

## References

- [[0018-content-measure-and-chart-aspect]] — `--content-max` / `--content-pad`, the precedent for
  a shared measure on `:root`, and why chart text is not on the page's type scale
- [[0021-allocation-map-gain-loss-scale]], [[0030-allocation-map-country-donut-pairs]] — the
  validated palettes this story leaves byte-for-byte untouched
- [[0012-in-place-destructive-confirm]] — the destructive control whose focus ring changes here
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — `.tab-panel`'s inset ring, and the
  Node-only test constraint that shapes where logic lives
- ADR-0008 (`docs/decisions/0008-in-house-design-system.md`) — the companion ADR: in-house
  primitives, shadcn's API without shadcn
- `src/renderer/src/app.css` (the `:root` block and the `:focus-visible` base rule),
  `src/renderer/src/lib/designTokens.test.ts`
- GitHub Issues #125 (Epic), #126 (Story)
