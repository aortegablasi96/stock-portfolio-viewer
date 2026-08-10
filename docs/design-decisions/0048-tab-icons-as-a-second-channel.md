# 0048. Tab icons are a second channel, sized from the type scale

- **Status:** Accepted (extends [[0029-tab-shell-aria-pattern-and-keyboard-navigation]], [[0031-design-token-scales]])
- **Date:** 2026-08-10
- **Story:** #168, under Epic #100

## Context

`App.tsx` declared the tab strip as five text-only labels in a uniform row. Nothing distinguished
them until they were read, and four of the five — *Performance*, *Allocation*, *Dividends*,
*Trades* — are similar-length abstract nouns. Finding a view meant reading a word rather than
recognising a shape.

The risk is not the icons; it is where they go. The strip is the app's most invariant-heavy
component: the full WAI-ARIA tabs pattern
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), with a roving `tabindex`,
`aria-controls` set **only** on the selected tab, automatic activation on arrow keys, and index
arithmetic extracted to `lib/tabKeyboard.ts` because Vitest is Node-only. All of it is pinned by
`e2e/tab-navigation.spec.ts` — which CI does not run, because it needs a display server.

So the question this record answers is not "which glyphs", but: what stops a cosmetic change from
quietly becoming a semantic one?

## Decision

### The icon is a second channel; the label stays and remains the name

Every tab renders `<Icon />` followed by its label as a **bare text node**. The glyph is
`aria-hidden="true"` and `focusable="false"`, so the accessible name is the label and only the
label. Nothing in the ARIA pattern changes, and `e2e/tab-navigation.spec.ts` passes unmodified —
an SVG contributes no text node, so `tablist.getByRole('tab')` still reads exactly the five names.

An icon is *added* recognition, never substituted recognition. Collapsing the strip to icons-only
at narrow widths is explicitly out of scope: it trades the label away, and the label is the name.

### One shared frame, so an icon cannot ship missing an attribute

`components/TabIcons.tsx` exports five components, each rendering through a private `Glyph`
wrapper that carries `viewBox`, `aria-hidden`, `focusable`, `fill="none"`,
`stroke="currentColor"`, the stroke width and the joins. The module declares **exactly one
`<svg>`**. That is what makes the guarantees total rather than five-times-remembered: a sixth icon
inherits them by construction.

They are dependency-free inline SVG in the convention `TitleBar.tsx` established — no icon
library, no new runtime dependency (ADR-0008, `docs/decisions/0008-in-house-design-system.md`).

They live in their own module rather than at the bottom of `App.tsx`, where `TitleBar` keeps its
own. `TitleBar` is a component file for one component; `App.tsx` is the tab shell's ARIA pattern,
and seventy lines of path data between a reader and those invariants is exactly how a cosmetic
change makes an invariant-heavy component harder to review.

### `currentColor` is the whole colour decision

The glyph is stroked in `currentColor` against `fill="none"`, so it follows the tab through
`--muted` → `--text` (hover) → `--accent` (active) and introduces **no new colour pairing** for
`lib/contrast.ts` to cover ([[0046-contrast-split-tone-tokens]]). A literal hex or a palette token
in an icon would be a colour nothing measures.

### Size comes from the type scale, in `em`

`.app-tab-icon` is `width: 1em; height: 1em`, resolving against the tab's own
`font-size: var(--text-sm)`. The 16×16 `viewBox` is geometry, not a size.

`em` rather than a step is the point of the decision. `--space-*` is a spacing scale and a glyph
is not spacing; picking a px height would make the icon the one thing in the strip that did not
move when `--text-sm` did. This is the same reasoning [[0018-content-measure-and-chart-aspect]] and
[[0042-token-adoption-ratchet]] apply to SVG `<text>` labels, arriving at the opposite answer for
the opposite reason: those labels scale from a `viewBox` and so must stay *off* the page's scale,
while this one sits **in** a line of page text and so must stay *on* it. The gap to the label is
`var(--space-2)`, an ordinary spacing step.

`flex-shrink: 0`, because the strip wraps at narrow widths and a squashed glyph reads as a
different shape rather than as a smaller one.

### The active tab keeps its bar, now spanning icon and label

`.app-tab-active::after` is untouched. Accent-on-pill is two cues but both are colour; the 2px bar
is the non-colour one ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), and an icon does
not replace it — a reader who cannot separate the accent from the muted grey gains nothing from a
glyph that is present on all five tabs. The bar now underlines the icon as well as the label,
which is a consequence of the pill growing, not a change to the cue.

### The guard is a comment-stripped text scan

`lib/tabIcons.test.ts` pins the single `<svg>`, the hidden-from-AT attributes, `currentColor` with
no literal colour and no `var(--…)`, the absent imports, the `em` sizing with no px or rem in the
rule, the `--space-*` gap, the surviving 2px bar, and the bare-text-node label.

A text guard is not the first choice; it is the only one that runs. The decision lives in a `.tsx`
and a stylesheet, Vitest is Node-only with no jsdom, and `e2e/` is excluded from CI.
**It strips comments before matching**, the trap [[0042-token-adoption-ratchet]] recorded for
`app.css` and [[0047-allocation-map-is-a-group]] measured for `CountryMap.tsx`: both files here
explain themselves in prose, `aria-hidden` and `currentColor` included, so a raw scan would pass
on the commentary alone.

### Icons stop at the tablist

The analytics sub-tabs, the Allocation breakdown strip and the `RangeFilter` presets get none.
Those are `ToggleGroup`s, not tabs ([[0036-toggle-group-mode-axis-and-pressed-semantics]]) — they
switch what one card draws, and their options are concrete enough that an icon would be decoration.
Adding icons there is a separate judgement, and this record is not it.

## Consequences

### Benefits

- The five views are told apart by shape before they are read, which is the whole ask.
- A sixth tab's icon is a `Glyph` and a path: the accessibility and colour guarantees come with it.
- No new dependency, no new colour, no new spacing value, and no change to the ARIA pattern.

### Tradeoffs

- **The glyphs are 14.4px**, which is small for a drawing. They are stroked at 1.5 in a 16 unit
  box and were checked in the running app at that size, but they are recognition aids, not
  illustrations, and detail beyond a silhouette will not survive.
- **The strip is ~20px wider per tab.** It has room at every supported width and wraps as before,
  but it is closer to wrapping than it was.
- **A glyph is a guess about a reader's vocabulary.** A briefcase for *Portfolio* and a banknote
  for *Dividends* are conventions, not meanings; the label is what actually says. That is the
  reason the label stays, rather than a consolation for keeping it.

### Risks

- The guard pins the *shape of the source*, not the rendered DOM. It would not catch a regression
  that only a browser can see — the active bar's geometry against a wider pill, for instance.
  `e2e/tab-navigation.spec.ts` covers that, and CI does not run it.
- `1em` binds the icon to `--text-sm` through the cascade rather than by name. Changing
  `.app-tab`'s `font-size` resizes the icons, which is the intent, but it is an effect at a
  distance.

## Alternatives considered

### A px or `--space-*` height

Rejected: it decouples the glyph from the type step it sits beside, and `--space-*` is a spacing
scale being asked to size an object. The story's own criterion asked for the token scale, and the
type scale is the one that governs how big this row is.

### Icons inline in `App.tsx`, as `TitleBar` does

Rejected on volume, not on principle. Five glyphs are seventy lines, and they would sit between a
reader and the roving `tabindex`, `aria-controls` and automatic-activation logic that this file
exists to hold.

### Per-icon `<svg>` elements with their own attributes

Rejected: five copies of `aria-hidden` is five chances to omit one, and omitting it fails no
existing test — `e2e/tab-navigation.spec.ts` reads text content, which an `<svg>` does not change
either way.

## References

- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the pattern this must not disturb
- [[0031-design-token-scales]] — the type and spacing scales the sizing draws from
- [[0042-token-adoption-ratchet]] — the comment-stripping trap, and why `width` is unguarded
- [[0046-contrast-split-tone-tokens]] — the pairing list `currentColor` avoids adding to
- [[0047-allocation-map-is-a-group]] — the text-guard precedent
- `../decisions/0008-in-house-design-system.md` (ADR-0008) — no icon library
- `src/renderer/src/components/TitleBar.tsx` — the inline-SVG convention followed
