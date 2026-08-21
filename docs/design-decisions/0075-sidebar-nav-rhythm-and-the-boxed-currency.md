# 0075. The sidebar's nav block gets a title and the proposal's rhythm, and the display currency gets a box

- **Status:** Accepted
- **Date:** 2026-08-21

## Context

Epic #179's acceptance criteria for the shell constrain its **behaviour** and say nothing about its
**composition**. They pin the tabs pattern, the mounted-view rule, the focus ring and the frameless
corner ([[0055-vertical-sidebar-tablist]], [[0057-sidebar-collapse-and-the-frameless-corner]], [[0068-sidebar-toggle-beside-the-app-name]]).
Every one of them was met, and three parts of the proposal's drawing were still missing — which is
the same gap the 2026-08-20 reopening note recorded for the collapse toggle and the gateway badge,
arriving once more one level down.

The proposal draws the nav as a **labelled section**: a micro-label reading *Views* above the five
rows, each row `9px 12px` with an `11px` gap between icon and label. The app ships the five rows at
`--space-2 --space-4` (6px 12px) with a `--space-2` (6px) gap and **no section label at all** — the
name "Views" existed only as an `aria-label`, so only a screen reader ever had it.

And the display currency is the one thing left in the column that is not boxed.
[[0069-boxed-gateway-chip-and-the-raised-surface]] gave the gateway badge a fill, an edge and a
corner at the head of the column; the field pinned to its foot stayed a bare `<select>` under a
rule, so the two things anchored to the two ends of one column are two different shapes.

## Decision

### The list's title is the tablist's name, not a decoration

`.app-nav-label` renders *Views* above the tablist, and `aria-label="Views"` on the tablist gives
way to **`aria-labelledby`** pointing at it. This is the half worth recording: the label is not a
caption added beside a region that was already named — it is the *same* name, promoted from an
attribute only assistive technology could reach to text on the screen. Two names for one region
would have been the redundancy, and there is exactly one.

It sits **outside** the tablist, because every child of `role="tablist"` is a `role="tab"`; and it
joins the one clip rule at 56px rather than being dropped, for a reason the other four labels share
and this one sharpens — it *is* the region's accessible name, so removing it leaves the tablist
unnamed on the rail ([[0057-sidebar-collapse-and-the-frameless-corner]]).

It is the app's **one** micro-label — the same four declarations `.stat-label` and
`.data-table thead th` carry — and it is added to `statTileVariants.test.ts`'s existing loop rather
than given a rule to agree with by inspection. The proposal sets it at `0.1em`;
[[0060-kpi-tile-figure-and-micro-label]] already declined a second tracking, and that
assertion is now what fails if `0.1em` is ever pasted in.

### The rhythm is the proposal's, and the scale expresses it exactly

`gap` moves `--space-2` → **`--space-4`** (12px, nearest to the proposal's 11px) and the row's
vertical padding `--space-2` → **`--space-3`** (8px, nearest to its 9px).

Its **2px row gap is not adopted and did not need to be.** Between two labels the proposal puts
9 + 2 + 9 = 20px; `--space-3` + `--space-1` + `--space-3` is 8 + 4 + 8 = **20px**. The scale
reproduces the inter-row rhythm to the pixel without a raw length the ratchet would fail
([[0031-design-token-scales]], [[0042-token-adoption-ratchet]]) — which is the argument for a
scale, made in one line.

### The label stays `--text-sm`, against the proposal's 13px

`--text-xs` (12.8px) is the nearest step and is **declined**. It is the scale's step for *hints and
dense controls*; these five rows are the app's primary navigation, the icon is sized `1em` and
would shrink with them, and the 1.4px buys width the column does not need.

### The 220px column is re-derived rather than re-tuned

The old note beside `--sidebar-width` read "wide enough for the longest label (*Performance*) at
`--text-sm` beside a 1em icon", which reads as though the label were the binding constraint.
Widening the gap spends 6px of it, so it was measured in the running app against the bundled Inter:

| | |
| --- | --- |
| 220 less the tablist's two `--space-3` gutters and a row's two `--space-4` gutters | 179.2px |
| less a 14.4px `1em` icon and the new `--space-4` gap | **152.8px** available |
| "Performance", the longest label, advances | **89.35px** |

**63px spare.** The label was never the binding constraint; the head row is, where the brand's name
shares its line with the toggle ([[0068-sidebar-toggle-beside-the-app-name]]). Neither width moves.

### The currency becomes the raised surface's third adopter, and the control gives up one property

`.app-currency` gains `--surface-raised`, a 1px `--border` edge and `--radius-md` — the same chip
the gateway badge became, at the other end of the same column.

That makes **three** rules standing on the app's one surface step that goes *up*, and
`sidebarRail.test.ts` counts them for a reason that is not tidiness: every ink measured against
`--surface-raised` is an ink one of those rules renders, so a new adopter brings inks nobody has
measured there ([[0070-hover-card-restyle-and-the-series-ink-ramp]]). Two pairings were added to
`lib/contrast.ts` — the field's label and its value — both re-pointed off `--card`, which is not the
surface either renders on any more. The box's *edge* is not added: `--border` on `--card` is already
the widest-reaching entry in that list.

**The control drops its resting border, and nothing else.** A bordered control inside a bordered box
is two nested rounded rectangles in a 220px column, which is not what the proposal draws. This
amends [[0035-field-and-form-control-primitives]] narrowly and deliberately:

- `border-color: transparent`, **never `border: none`** — the box metrics are unchanged, so nothing
  reflows, and `.control:hover:not(:disabled)` is (0,3,0) against this rule's (0,2,0), so the accent
  edge still arrives on hover. Only the *resting* edge goes.
- `padding-inline: 0`, because the box already insets by `--space-4` and the control's own
  `--control-pad-sm` would inset the value a second time — leaving the value 24px in while its label
  sits at 12px, a misalignment the proposal's drawing has neither of.
- The ink, the `:disabled` treatment, the generated id and the one focus ring stay the shared rules'.

The control stays a **real `<select>`, never disabled** ([[0056-sidebar-context-rail]]). The
proposal draws `EUR (€)` as static text; that is a prototype with one hard-coded currency, not a
request to remove the control.

The footer's `border-top` **stays**. The proposal has no rule there, but the head of this column
ships a rule *and* a chip, and the two ends of one column should be one shape.

### A malformed comment is now a test failure

This story shipped a broken stylesheet through every gate the repo has. A paragraph appended after a
comment's closing delimiter instead of inside it left prose in the rule stream, and the browser
discarded `.app-tab`'s entire rule — the five nav rows fell back to the UA's button styling, grey
and centred. **Lint passed, typecheck passed, all 1178 unit tests passed, and 63 e2e specs passed.**
A screenshot found it.

It is the exact inverse of the trap this repo has recorded five times ([[0042-token-adoption-ratchet]],
[[0047-allocation-map-is-a-group]], [[0048-tab-icons-as-a-second-channel]],
[[0058-one-page-header-pattern]], [[0070-hover-card-restyle-and-the-series-ink-ramp]]):
those guards strip comments because prose can satisfy an assertion the rules do not. This is the same
seam from the other side — a comment that never opens makes prose *into* rules, and every guard in
this repo reads `app.css` as text, so none of them can see it. `designTokens.test.ts` now walks the
delimiters and the braces.

## Consequences

Benefits:

- The five views are a named, titled block rather than five buttons under a rule, and the name is
  the one the tablist already had.
- The two things pinned to the ends of the sidebar are one shape.
- The column's width budget is a measurement with numbers in it rather than a claim.
- The cheapest possible guard now covers a failure mode that defeats every other guard in the repo.

Tradeoffs:

- The nav block is ~20px taller for the label and ~10px taller across five rows. The tablist is the
  part of the column that gives (`flex: 1; min-height: 0`), so a short window shortens the list and
  leaves the rail and the footer where they are.
- `--surface-raised` now has three users, and every future adopter owes two contrast measurements.
- `.control` has one scoped override, which is one more than [[0035-field-and-form-control-primitives]] had.

Risks:

- A fourth `--surface-raised` adopter that does not measure its inks. The count assertion is what
  catches it, and the comment beside it says so.
- The nav label and the tablist's name are two files apart (`App.tsx` holds both, but the id is a
  constant). A rename in one place without the other would leave the region named by stale text
  rather than unnamed, which is the quieter failure.

## Alternatives Considered

### Drop the nav label to `--text-xs` to match the proposal's 13px

Rejected on measurement and on role, above. The 1.4px is imperceptible; the step means "hint".

### Keep both borders — the box purely additive over an untouched `.control`

This is what Story #234's criteria said as filed, and it was put to the owner with both renderings
drawn. Two nested rounded rectangles at 220px is heavier than the proposal, and the inner border
carries no information the outer one does not. Rejected in favour of the narrow amendment.

### Adopt the proposal's 0.65 opacity on an inactive row's icon

Rejected. The icon is drawn in `currentColor`, so it already steps from `--muted` to `--accent` with
its row — the contrast difference the opacity is there to create exists without it. Multiplying a
`--muted` graphic by 0.65 pushes a non-text graphical object under 3:1 to buy a step the app already
has ([[0048-tab-icons-as-a-second-channel]], [[0021-allocation-map-gain-loss-scale]]).

### Drop the footer's rule, as the proposal does

Rejected for internal consistency: the head of the column ships a rule *and* a boxed chip, and
symmetry between the column's two ends is worth more here than fidelity to a drawing that never had
a rule above its badge either.

### Adopt the proposal's 2px row gap

Never arose as a trade — the scale lands on the same 20px rhythm. Recorded because the arithmetic is
the reason a raw length was not needed, not because a length was declined.

## References

- Story #234 — the work item.
- [[0055-vertical-sidebar-tablist]] — the tablist rotated into the column.
- [[0056-sidebar-context-rail]] — the display currency as the app's selection, never disabled.
- [[0057-sidebar-collapse-and-the-frameless-corner]] — the 56px rail, and why a collapsed label is clipped rather than removed.
- [[0068-sidebar-toggle-beside-the-app-name]] — the head row and the width budget it spends.
- [[0069-boxed-gateway-chip-and-the-raised-surface]] — the chip this field now matches, and `--surface-raised`.
- [[0070-hover-card-restyle-and-the-series-ink-ramp]] — why the raised surface's users are counted.
- [[0035-field-and-form-control-primitives]] — **amended** by the borderless control in this one placement.
- [[0031-design-token-scales]] / [[0042-token-adoption-ratchet]] — the scales and the ratchet.
- [[0060-kpi-tile-figure-and-micro-label]] — the app's one micro-label, and the tracking already declined.
- [[0048-tab-icons-as-a-second-channel]] / [[0021-allocation-map-gain-loss-scale]] — the icon as a second channel.
