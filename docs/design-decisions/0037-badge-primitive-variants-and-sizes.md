# 0037. One `Badge`: boundary and ink as `variant`, inline versus standalone as `size`

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

Four unrelated rules in `app.css` rendered the same idea — a small piece of secondary text set
off from its surroundings — each written for its own view:

| Rule | Where | Type | Corner | Padding | Ink |
| --- | --- | --- | --- | --- | --- |
| `.native-chip` | a holding's native amount, beside its converted value | 0.72rem | 6px | 0.05rem 0.35rem | `--muted` on a `--card` fill |
| `.flex-import-badge` | an import row's status | 0.78rem | 999px | 0.15rem 0.55rem | `--muted`, no fill |
| `.flex-import-badge-new` | the same, when the statement is new | — | — | — | `--accent` |
| `.card-count` | "12 of 40 shown" in a filtered table's toolbar | 0.8rem | none | none | `--muted` |
| `.flex-import-dup` | "(+12 dup)" beside a re-imported count | 0.8rem | none | none | `--muted` |

Three near-identical small type sizes, two corners with nothing choosing between them, and a
fill on the one chip that never showed — `.native-chip` declared `background: var(--card)` and
both of its call sites sit on a `--card` surface, so it was painting the surface it already
stood on.

Only one of the five carried meaning: `.flex-import-badge-new` distinguishes a statement that
was just imported from one that was already held.

## Decision

**One `Badge` under `components/ui/`, on the button's two axes: `variant` carries the boundary
and the ink, `size` carries the type and the box padding.**

```tsx
<Badge size="sm">1.345,00 $</Badge>            // native-currency chip
<Badge>Already imported</Badge>                 // import status
<Badge variant="accent">Imported</Badge>        // …and the one that is news
<Badge variant="plain" role="status">12 of 40 shown</Badge>
```

### `size` is *where it sits*, and the difference is structural

`sm` is the inline form: a chip inside a run of text, following the value it qualifies. It
carries **no vertical padding**, and that is not a taste for a smaller box. A badge is an
`inline-block`, and an inline-block with vertical padding grows the line box it sits in — a
native-currency chip with 4px above and below silently adds ~7px to *every row* of the holdings
table and the snapshot list. `sm` also carries the left margin that separates it from the value,
because that gap is part of the inline form rather than a call site's layout.

`md` is the standalone form: alone in a table cell or a toolbar, sharing its line with nothing,
where the box can have height.

Two sizes, both genuinely in use — unlike the tile's and the field's single-value scales
([[0034-stat-tile-primitive-tone-axis]], [[0035-field-and-form-control-primitives]]), where a
size axis was declined for exactly the opposite reason.

### A badge is never a pill

`.flex-import-badge` was a 999px pill. It cannot stay one:
[[0036-toggle-group-mode-axis-and-pressed-semantics]] spent that corner on a *meaning* one story
ago — a multi-select toggle item, "any number of these can be pressed". A static status label
wearing the same shape invites a click that does nothing, and in the analytics views a pill
badge would sit feet away from pill chips that do respond. Every badge is `--radius-sm`, which
the radius scale reserves for precisely this: an inline chip
([[0031-design-token-scales]]). This is the one deliberate visual change in the story.

### No fill, and `plain` is the absence of a boundary

The boundary is the border. The fill `.native-chip` declared was invisible where it stood, and a
badge that carries a lighter fill of its own starts reading as a button the first time one lands
on a nested (`--bg`) surface.

`plain` is the badge without a boundary — a count or a qualifier, set off by being small and
muted. It therefore takes no box padding either, or the row count moves in its `gap`-spaced
toolbar and "(+12 dup)" moves in its cell. That rule is declared doubled (`.badge.badge-plain`)
so it beats the size's padding by specificity rather than by source order.

The name is `plain`, not the `muted` the story sketched: `neutral` is muted-coloured too, so
that name would describe the ink where the axis is actually the boundary.

### The one meaning does not ride on colour alone

`accent` adds `font-weight: 600` alongside the accent border and ink. The labels already differ
("Imported" against "Already imported" / "No new rows"), but that is the call site's doing and a
future one could word them the same; a primitive that carries a meaning should carry a second,
non-colour channel itself. Same instinct as the active tab's 2px bar
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]) and the active toggle item's doubled
stroke.

### What the primitive does not own

`role="status"` on the row count stays at the call site. It is a fact about *that* count — the
one thing on screen that changes when a filter does — not about badges, and putting it in the
primitive would make every chip in the holdings table a live region.

`.flex-import-dim` survives as a rule of its own. It colours a **table cell** standing in for a
count that was not re-imported; it is not a label, and folding it in would mean a badge that is
a `<td>`.

Nothing here is focusable. A badge is a `<span>`, so the stylesheet section declares no focus
ring — the one place in Epic #125 where that absence is the point rather than a delegation to
the base rule.

## Consequences

Benefits:

- Five rules become one primitive plus five short rules, all on the token scale.
- The one badge that means something is marked by weight as well as colour.
- The pill now means one thing in the app: a control that takes any number of choices.
- A count and a chip can no longer drift apart by 0.02rem, because they are the same component.

Tradeoffs:

- `.badge.badge-plain` is the only doubled-class selector among the primitives. It buys
  order-independence for the one variant that must undo a size's declaration; the alternative
  was a padding axis that every boxed badge would have had to restate.
- The status badge grows 3.2px taller and the native chip loses 1.6px of (invisible) vertical
  padding. Measured against `main` in a two-column harness: **every affected table row is
  identical in height**, and the row count is pixel-identical.

Risks:

- `plain` is a badge with no boundary, no padding and no fill — close enough to a bare `<span>`
  that a future call site may reach for the span. The count's `tabular-nums` and `nowrap` are
  what it would lose.

## Alternatives Considered

### One size, unifying the type

Rejected. The two boxed forms sit differently: 0.72rem beside a market value it must not compete
with, 0.8rem alone in a cell. Unifying up enlarges the chip in every holdings row; unifying down
shrinks the status badge. Both are visible changes with nothing gained — the type scale already
names `--text-2xs` "inline native-currency chip".

### `variant` carrying the padding, so `plain` simply declares none

Rejected. The padding differs by size (`sm` has none vertically), not by variant, so `neutral`
and `accent` would each have to restate both sizes' padding — four declarations to avoid one
doubled class.

### Keeping the count out of the primitive

Rejected. It is the clearest case of the thing this story consolidates: a piece of secondary
text set off from a toolbar, hand-styled with the same four declarations as the others.

## References

- Story #132, Epic #125.
- [[0031-design-token-scales]] — the spacing, radius and type scales this uses.
- [[0032-button-primitive-variants-and-sizes]] — the `variant` × `size` shape adopted here.
- [[0036-toggle-group-mode-axis-and-pressed-semantics]] — why the pill is spoken for.
- ADR-0008 — shadcn's API adopted, the package declined.
- `src/renderer/src/components/ui/Badge.tsx`, `src/renderer/src/lib/badgeVariants.ts`.
