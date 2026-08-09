# 0042. Token adoption is held by a ratchet with a hand-enumerated exemption list

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

[[0031-design-token-scales]] declared a spacing, radius, type and focus scale, and Epic #125's nine
Round 1 stories each converted the rules they extracted. That reached the primitives and stopped:
measured across `app.css`, **zero** raw values remain inside a primitive selector, and **110**
remain outside one.

Nothing in the suite failed when a new rule added the 111th. `designTokens.test.ts` pins the
*shape* of the scales — eight ascending spacing steps, radii in px, one outline in the stylesheet —
and each primitive's `*Variants.test.ts` pins its own rules, but no test asked whether an ordinary
rule *used* the scale.

That is precisely the mechanism the Epic's own audit described. Nine button families arrived one
defensible decision at a time, and nothing in "tidy as you go" stopped the tenth. Round 1 replaced
the nine families and left the accumulation mechanism intact, so the consolidation had a known
half-life and no alarm attached to it.

The Epic was reopened for a Round 2 whose first story is this guard, deliberately ahead of the
conversion work in #152: landing it second would mean recomputing a baseline against a moving
target, with new violations able to enter faster than the conversion removes them.

## Decision

### A ratchet, not a check

`lib/tokenAdoption.ts` carries two lists and `tokenAdoption.test.ts` fails three ways:

1. a guarded declaration in **neither** list — the guard;
2. a **`BASELINE` entry that no longer matches** — the ratchet;
3. an **`EXEMPTIONS` entry that no longer matches** — the same, for the permanent list.

The second assertion is what separates this from a suppression file. Without it, converting a
value leaves a dead entry behind, the list stops describing anything, and #152's progress is
invisible. With it, `BASELINE` can only shrink, and its length is a number that means something.

`BASELINE` entries carry their **current value**, so editing a baselined declaration also fails.
If you are already touching the line, you tokenize it.

### The exemption list is enumerated by hand, and must stay that way

This is the decision most likely to be "simplified" later, so it is recorded with its evidence.
Two mechanical rules were tried while planning the story and **both leaked**:

| Rule | Wrongly exempted |
| --- | --- |
| Selector prefix (`.chart-`, `.pie-`, `.country-`, `.map-`…) | **30** |
| Radius below 6px | **1** |

The prefix rule's failures are not edge cases — they are the bulk of the map area.
`.chart-legend { gap: 1.25rem }` is flex layout, `.country-map-unavailable { padding: 1rem }` is a
state panel. **Element type decides it, not selector name**: `.chart-axis-label`,
`.chart-tooltip-date` and `.chart-tooltip-value` render as SVG `<text>`, while `.chart-legend` is a
`<figcaption>`, `.pie-legend-item` an `<li>`, `.map-scale` a `<span>` and `.country-map-sector` a
`<ul>`. Those last four are page-scale HTML that happens to sit beside a chart.

The radius rule's single failure is the sharper warning, because it came out of a list that had
already been narrowed: `.app-tab-active::after { border-radius: 1px }` is the active-tab underline
from [[0029-tab-shell-aria-pattern-and-keyboard-navigation]], not chart geometry. A generated list of 17 contained a wrong
entry at the first attempt.

The hand review settled at **8 exemptions, 102 baseline** — three SVG label sizes, four sub-6px
chart-geometry radii, and `.sr-only`'s `margin: -1px`. Each carries a reason, and a test fails if
one does not.

`.sr-only` is listed rather than special-cased as "negative margins are fine": its `-1px` pairs
with a `1px` box in the standard visually-hidden clip and means nothing on its own, whereas an
optical `margin-top: -0.5rem` *is* spacing and should still fail.

### A text scanner, not a CSS parser

`lib/cssDeclarations.ts` scans characters. `postcss` would be more correct in the abstract and is a
dependency in a project with seven runtime ones ([[0008-in-house-design-system]]), for a single
stylesheet this project writes by hand.

Two properties of the scan are load-bearing:

- **Comments are blanked in place**, preserving newlines. `app.css` is comment-dense and quotes
  lengths in prose — line 904 reads "Was a hand-picked 0.7rem; `--space-4` is the step it always
  meant" — which a naive scan reports as a violation nobody can act on. Blanking rather than
  deleting keeps every reported line number true.
- **Declarations are keyed on the brace stack plus the property** —
  `@media (max-width: 720px) >> .snapshot-item | gap` — never on line numbers, which #152 shifts in
  every commit. Verified: 110 declarations produce 110 distinct keys, and the at-rule prefix is
  what keeps a rule and its media override apart.

### Zero is never a violation; a suggestion is only a suggestion

`padding: 0` needs no token. `margin: 0 0 0.35rem` fails for the `0.35rem` alone.
`calc(var(--space-4) * 2)` passes and `calc(100% - 1rem)` does not. Percentages, `auto` and `fr`
are not on any scale and cannot fail.

The failure message names the nearest step, and says so advisorily: `0.7rem` is nearest
`--space-4` (0.75rem) but the author may have wanted `--space-3`. The message points; the person
converting decides.

## Consequences

### Benefits

- The consolidation is held by the platform rather than by review discipline — the same instinct
  as the ESLint layer boundaries, the CSP's omitted telemetry origin, and the zero-specificity
  focus ring in [[0031-design-token-scales]].
- `BASELINE.length` is a progress metric for #152 that cannot be gamed without a visible diff.
- The two-list shape is reusable. #154 applies it to motion tokens.

### Tradeoffs

- **The baseline churns.** Nearly every #152 commit edits it. Intended.
- **A hand-rolled scanner meets CSS it was not written for.** Mitigated by its own unit tests and
  by `app.css` having a maximum nesting depth of 2. The failure mode is a loud, local false
  positive in a test, not a runtime bug.
- **Dev-only modules live in `renderer/src/lib/`**, which is otherwise app code. Both carry a
  header saying so. The alternatives were worse: inlining the scanner in its test makes the part
  most likely to be subtly wrong untestable, and a `tooling/` directory adds a path alias and an
  ESLint boundary for two modules.

### Risks

- **Someone "simplifies" the exemption list into a rule.** The table above is the answer, and it
  is in the module's own header as well as here.
- **The baseline is regenerated wholesale rather than shrunk.** A test pins both list lengths, so
  a bulk change is visible in the diff rather than silent.

## Alternatives Considered

### Option A — Convert everything first (#152), then add the guard

Rejected on sequencing. The baseline would be computed against a moving target, and during the
conversion nothing would stop new violations arriving. Landing the guard first also makes the
conversion measurable.

### Option B — A stylelint plugin

Rejected. It is a new toolchain in the renderer build and a new CI surface, for a check the
existing Node-only Vitest setup already expresses. `designTokens.test.ts` had established that a
test may take the stylesheet as its subject.

### Option C — Suppression comments in the CSS (`/* token-guard-ignore */`)

Rejected. It scatters the exemption record across 2,232 lines, makes "how many are left" an
unanswerable question, and puts the decision to exempt at the point of least review.

## References

- [[0031-design-token-scales]] — the scale this enforces
- [[0008-in-house-design-system]] — the dependency-minimal stance behind the text scanner
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the tab underline the radius heuristic wrongly exempted
- [[0018-content-measure-and-chart-aspect]] — why SVG label sizes are off the page scale
- GitHub Issues #125 (Epic, Round 2), #151 (Story), #152 (the conversion this unblocks)
