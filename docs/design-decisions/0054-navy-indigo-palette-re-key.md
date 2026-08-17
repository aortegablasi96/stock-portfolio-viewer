# 0054. Re-keying the palette to navy/indigo, by measurement rather than by paste

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

Epic #179 adopts a Figma Make proposal that moves the ground and the accent together: a deeper
navy-indigo page (`#080b18`) and card (`#0f1320`), an indigo accent (`#6366f1`, with `#818cf8` for
text and active states), and emerald/rose gain-loss tones in place of the app's green and red.

The proposal is a specification of intent, not a set of values to paste. This app measures its
colours: [[0046-contrast-split-tone-tokens]] enumerates every text-on-surface pairing by hand and
models `.btn-primary:hover`'s `brightness(1.08)` because the hover is the binding measurement;
[[0030-allocation-map-country-donut-pairs]] carries the eight categorical hues' CVD validation and the
one-sector-one-hue invariant. A palette swap that ignores either is a validation silently thrown
away, and the app has already shipped that mistake once — every negative figure was less legible
than every positive one for four milestones, and nothing failed.

So this story ran the proposal's values through the guards before adopting any of them. **Four of
the eleven did not survive contact with a measurement.**

## Decision

### The four values the proposal got wrong, and what replaced them

| Role | Proposal | Measured | Shipped | Measured |
| --- | --- | --- | --- | --- |
| `--muted` | `#64748b` | **3.89:1** on `--card` | `#8690aa` | 5.80:1 |
| `--accent` | `#6366f1` | **4.14:1** as text | `#818cf8` | 6.21:1 |
| `--neg` (fill) | `#f43f5e` | **3.67:1** under white | `#e11d48` | 4.70:1 |
| `--neg-text` | `#f43f5e` | 5.04:1 — but `--pos` is 7.30:1 | `#fb7185` | 6.88:1 |

**`--muted` carries more text than any token but `--text`** — every stat label, hint, table header,
tab label and popup row — and the proposal's slate is below AA on both surfaces. Raised along the
same hue until it clears with margin. It is still dimmer than the tone it replaces (6.90:1), which
was the proposal's intent; what it is not is illegible.

**`--accent` is a text token before it is anything else.** Seven of its nine call sites are a
`color`: the eyebrow, the active tab, a sorted column header, an active toggle, the accent badge,
and two hover states. `#6366f1` clears the 3:1 a focus ring needs and fails the 4.5:1 all seven of
those need. `#818cf8` is the value the proposal itself assigns to "text and active states", and it
clears both — so it becomes `--accent` outright. A third `--accent-text` token was rejected:
DDR-0046's lesson is that a split tone is silent when you pick the wrong half, and this role needs
no split when one value clears both bars. The identity hue survives at full strength in
`--accent-strong` and in the two track tints.

**The loss/gain split survives and inverts.** The proposal quotes one rose for both roles and it is
right for neither. As a *fill* `#f43f5e` is 3.67:1 under white, and `.btn-danger`'s hover is exactly
that pairing — so `--neg` steps down the ramp to `#e11d48` (4.70:1, matching the 4.80:1 the old fill
carried). As *text* it passes at 5.04:1 and still fails the harder test: `--pos` is 7.30:1, so every
loss would again have been less legible than every gain. That asymmetry — not a threshold — is the
actual finding behind Story #163, and `contrast.test.ts` pins it as `--neg-text >= --pos - 0.5`.
`--neg-text` is `#fb7185` instead, 6.88:1 against 7.30:1. Before this story the split ran the other
way: `--neg` was fill-safe and text-unstable. **Same shape, opposite halves.**

### The eight categorical slots do not move

Re-validated against the new surface with the data-viz validator on 2026-08-18: lightness band,
chroma floor, adjacent-pair CVD separation, normal-vision floor and contrast all still pass. They
pass because CVD separation and the normal-vision floor are measured *mark against mark* and do not
move when the ground does, while the contrast check only improves on a darker one.

The proposal's seven ad-hoc chart colours were not pasted in. They are what a prototype needs to
look right in a screenshot, not a validated categorical set. Re-cutting eight hues that pass, to
suit a ground, would spend DDR-0030's one-sector-one-hue invariant — which reaches the map, the
donut, the legend and the breakdown table — on an appearance no measurement reports.

### What did move is achromatic, for a reason no ratio reports

`--series-neutral`, `--chart-axis` (`#898781` to `#8189a3`) and `--chart-grid` (`#2c2c2a` to
`#252c4e`) are **warm** greys. A warm grey on a blue-black ground stops reading as "no hue" and
starts reading as brown — which is the one thing the residual slot must not do, because hue there
has to keep meaning "a real category". Same job, same lightness relationships, cool.
`designTokens.test.ts` asserts the blue channel exceeds the red one for all three, so the next
re-key cannot quietly warm them again.

### Five rules hard-coded a colour outside `:root`, and now mix it from a token

`.app-nav`'s `rgba(15, 17, 21, 0.85)` was the *old* ground spelled out; `.allocation-track`'s
`rgba(76, 141, 255, 0.12)` and `.bar-track`'s `rgba(57, 135, 229, 0.14)` were the old `--accent` and
`--series-1`; `.capture-status-error` and `.state-panel-error` shared a `#5a2b2b` warm dark red. All
five now use `color-mix()` over the token they were derived from — the idiom
[[0041-map-popup-return-tint-strength]] already uses for the map popup's border. Without that, a
palette re-key leaves one strip of the app behind and nothing fails.

### No tint token, and no third surface

The proposal's dimmed tint backgrounds, its `--surface-2` / `--surface-3`, its `--border-2` and its
`#3d4f6b` dim ink are **not** added. They have no call site until the sidebar (#182–#184) and the
surface restyles (#186, #187), and a token nothing references is a decision made without a case in
front of it. `#3d4f6b` in particular is 2.23:1 on `--card` — a token that cannot legally carry text,
sitting in the scale waiting to be used for text. [[0037-badge-primitive-variants-and-sizes]]'s "a
badge is never a background" is therefore untouched rather than amended; the Badge story owns that
question. The two *track* tints that already existed are named in place, not generalised.

## Consequences

Benefits:

- The theme lands whole: five views, one ground, one accent, one gain and one loss tone.
- Every pairing is measured, and the list grew from ten to fifteen. Four of the five additions were
  always rendered and never listed — a guard that lists only what once failed has a blind spot the
  size of what has not failed yet, which is this module's own stated lesson.
- Nothing in the stylesheet hard-codes a colour any more, so the next re-key is a `:root` edit.
- The CVD validation and the sector-hue invariant are intact, not re-litigated.

Tradeoffs:

- **The app is no longer the proposal, exactly.** Four of its eleven values are adjusted, and the
  PR states each adjustment with its ratio. Anyone comparing the running app to the Figma file will
  find the muted grey lighter and the accent one step brighter.
- **The eight chart hues are still the old, warm-leaning set** on a cool ground. They pass every
  check and they are not what a designer would pick for navy. Re-cutting them is a real option, but
  it is a story with a validation pass in it, not a line in a re-key.

Risks:

- **The Allocation basemap is `mapbox/light-v11`** — a light map in a now-darker app. It was already
  a light map in a dark app, so this story does not make it worse, but the contrast between the
  frame and the basemap is more pronounced. Story #191 restyles that view and should decide.
- **`--muted` at 5.80:1 is a judgement inside a range.** Anything from 4.5:1 up passes; a dimmer
  choice would sit closer to the proposal. It is set where it is because this token carries small
  text (`--text-xs`, 12.8px) across the whole app.

## Alternatives Considered

### Option A — Paste the proposal's values and relax the guards

The fastest route, and the one the Epic explicitly forbids. It would have shipped four AA failures,
one of them (`--muted`) touching nearly every label in the app, and re-created the exact asymmetry
Story #163 existed to fix.

### Option B — Collapse the loss tone to one rose

What the proposal implies. Measured, `#f43f5e` cannot be both: 3.67:1 under white as a fill. The
split is not a historical artefact — it is what having a fill role and a text role costs.

### Option C — Keep `--accent` at `#6366f1` and add `--accent-text`

Mirrors the loss tone exactly and keeps the proposal's headline colour on the ring and the active
bar. Rejected because it makes three accent tokens where one value clears every bar, and each split
is a fresh chance to pick the wrong half silently — DDR-0046's own warning.

### Option D — Re-cut the eight categorical hues for the navy ground

Tempting on appearance and rejected on evidence: they pass. A new eight would need its own
validation pass, and would repaint every sector everywhere the invariant reaches. Worth a story;
not worth a paragraph in a re-key.

## References

- Story #181, Epic #179 — the visual redesign
- [[0046-contrast-split-tone-tokens]] — the fill/text split and the hover measurement this re-derives
- [[0030-allocation-map-country-donut-pairs]] — the categorical palette, its CVD validation, the sector-hue invariant
- [[0045-allocation-map-one-sector-view]] — the diverging scale, still absent
- [[0037-badge-primitive-variants-and-sizes]] — "a badge is never a background", untouched
- [[0041-map-popup-return-tint-strength]] — the `color-mix()` idiom the five re-keyed rules adopt
- [[0031-design-token-scales]] — the scale these tokens sit in
