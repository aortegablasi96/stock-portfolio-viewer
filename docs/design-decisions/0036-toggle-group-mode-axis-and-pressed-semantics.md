# 0036. One `ToggleGroup`: `mode` as the only axis, and pressed buttons rather than a false tablist

- **Status:** Accepted
- **Date:** 2026-08-01

## Context

The Epic #125 audit called `.chart-tab` "a control invented twice". It was invented **five
times**. The class was written for the Performance view's two-chart switcher (Story #45) and
then borrowed verbatim by every later group of related choices, because no primitive existed:

| Call site | Wrapper | Item semantics | Selection |
| --- | --- | --- | --- |
| `PerformanceView` chart switcher | `.chart-tabs`, `role="tablist"` | `role="tab"` + `aria-selected` | one |
| `AllocationView` map colour | `.chart-tabs`, `role="tablist"` | `role="tab"` + `aria-selected` | one |
| `AllocationView` breakdown | `.chart-tabs`, `role="tablist"` | `role="tab"` + `aria-selected` | one |
| `RangeFilter` presets | `.chart-tabs`, `role="group"` | `aria-pressed` | one |
| `TypeFilter` chips | `.type-filter`, `role="group"` | `aria-pressed` | any number |

Two problems, and only the first is cosmetic.

**The single-select and multi-select groups were visually identical.** The Dividends and Trade
history views stack them one above the other — a period strip that takes exactly one choice,
above a type filter that takes any number — rendered by the same class, in the same size, with
the same corner. Nothing on screen said which was which; you found out by clicking.

**Three of the five claimed the WAI-ARIA tabs role without implementing it.** `role="tablist"`
with `role="tab"` children is a promise: a roving `tabindex` so the group is one Tab stop,
arrow-key navigation between tabs, and a `role="tabpanel"` each tab points at with
`aria-controls`. None of the three had any of it. A screen-reader user was told "tab 2 of 4"
and then found four ordinary Tab stops, no arrow keys and no panel. The app *does* have that
pattern, built properly for the app tab bar in `lib/tabKeyboard.ts`
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]) — which is precisely what made the
copies look plausible.

## Decision

**One `ToggleGroup`, with `mode` (`single | multiple`) as its only axis, rendering
`aria-pressed` buttons in an `aria-label`led `role="group"`.**

### `mode` is the only axis, and it carries the corner

The button and the card take `variant` × `size`. Every group in this app is the same dense
strip in a card header or a toolbar, so a size scale would ship with one value in use — the
call [[0034-stat-tile-primitive-tone-axis]] and [[0035-field-and-form-control-primitives]]
already made. What genuinely differs between two groups is **how many of their items can be on
at once**, and that is a fact about the control's meaning that a reader has to be able to see
before clicking.

So the mode is worn: a single-select item keeps `--radius-md`, the control corner every other
box in the app uses; a multi-select item is `--radius-pill`. One declaration each, and the base
`.toggle-item` rule declares **no** corner, so neither mode is the silent default of the other
and a mode that stops declaring one fails the test rather than falling back to a shape that
looks fine.

The wrapper takes no mode class. The group is the same flex row either way, and a class with no
rule behind it is exactly what `lib/toggleGroupVariants.test.ts` exists to catch.

### `aria-pressed`, not `role="tab"` — for all five

The three tablists are corrected rather than completed. They are **not tabs**: they switch what
a single card draws, in place, with no second panel to move focus into. A pressed-state toggle
describes that accurately, needs no keyboard behaviour beyond the button's own, and cannot fall
out of step with a panel that does not exist. Completing the tabs pattern instead would have
meant three more roving-`tabindex` implementations, three panels invented to satisfy the role,
and automatic activation semantics on a control where nothing is being navigated.

The two groups that were already `aria-pressed` needed no change. That is the tell: the honest
markup was already in the app, in the two call sites whose authors did not reach for the class's
name.

### The active item is marked by a doubled stroke, not only by the accent

`.chart-tab-active` set `color` and `border-color` to `--accent`. Both are colour, and colour is
the one channel that cannot be relied on alone — the same finding that gave the active app tab
its 2px bar ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]). `.toggle-item-active`
adds `box-shadow: inset 0 0 0 1px var(--accent)`, so the active item's stroke reads as 2px
against its neighbours' 1px: presence or absence of a thickening, which survives any palette.

A bar rather than a ring was rejected on shape. These items are bordered boxes with 6px of
vertical padding; there is nowhere to put an underline that does not read as a mistake.
`box-shadow` rather than `border-width` so nothing moves when the selection changes.

### `Clear` leaves the group

`TypeFilter`'s Clear button was the last child of the `role="group"` labelled "Filter by type".
It is not one of the choices, so it now sits beside the group in the toolbar. It keeps
`Button`'s `link` variant, which [[0032-button-primitive-variants-and-sizes]] assigned it and
names as that variant's exemplar — the story's acceptance criterion said `ghost`, written
before #127 landed and redefined `ghost` as the borderless window-chrome variant.

## Consequences

- **`ToggleGroup` is the one way to offer a group of related choices**, and five class-name
  call sites collapse to five one-element call sites. `.chart-tabs`, `.chart-tab`,
  `.chart-tab-active`, `.chart-tab:focus-visible` and `.type-filter` are deleted; the test fails
  if any of them reappears.
- **`.app-tab` is deliberately untouched.** It is a real tablist with a real implementation
  ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), and folding it in would delete
  tested code to satisfy a family resemblance.
- **No vertical layout shift anywhere.** Both builds were measured element by element against
  `main` in the running app across all four analytics views: every item is 30.4px, every group
  30.4px, every range bar and card toolbar 30.4px, and every card and panel height is identical
  to the hundredth of a pixel. The padding rounding onto `--control-pad-sm` (5.6px → 6px) is
  offset exactly by the type rounding onto `--text-xs` (13.12px → 12.8px) — the same coincidence
  [[0035-field-and-form-control-primitives]] measured, and the reason it chose `--text-xs` for
  the neighbouring date inputs rather than `--text-sm`.
- **Items narrow by 1–4px each**, from the type step alone: the range strip 254.95 → 252.23px,
  the dividends type filter 416.73 → 408.61px, the Performance chart switcher 385.23 → 377.16px.
  Nothing is positioned from those widths.
- **Two deliberate visual changes**, both named above: multi-select chips become pills, and the
  active item's stroke doubles.
- **A `ToggleOption` is `{ id, label, title? }`**, and `title` is a tooltip. `BREAKDOWN_TABS`
  already had a `title` meaning "the card's heading", so `AllocationView` strips it at the call
  site rather than hanging a duplicate of the visible heading off every button — a structural
  collision worth knowing about before adding a sixth group.

## Alternatives Considered

### A joined segmented track for single-select

The other conventional way to say "exactly one": items butted together in one bordered track,
shared borders collapsed. Rejected on wrapping. The range presets are five items in a bar that
already wraps on a narrow window, and a joined track breaks with them — the radii land
mid-strip and the control reads as two broken pieces. A pill-versus-box distinction is wrap-safe
and costs one declaration.

### Completing the tabs pattern on the three tablists

Rejected above: they are not tabs. Doing it would have added three implementations of a keyboard
pattern to controls that navigate nothing, and invented panels to give the role something to
point at.

### One mode, with multi-select left visually identical

The story's acceptance criteria allowed recording why the two should *not* be distinguished.
Rejected because the two appear stacked, six inches apart, in two of the five views — this is
the one place in the app where the ambiguity is on screen rather than hypothetical.

### `variant`/`size` on the group, mirroring `Button`

Rejected as speculative, per the project's development principles. Every group is the same dense
strip; `--control-pad-md` is one line to add when a second size is genuinely needed.

## References

- Story #131, Epic #125.
- [[0031-design-token-scales]], [[0032-button-primitive-variants-and-sizes]],
  [[0033-card-primitive-variants-and-sizes]], [[0034-stat-tile-primitive-tone-axis]],
  [[0035-field-and-form-control-primitives]].
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] (the real tabs pattern, and why the
  app tab bar is excluded), [[0017-analytics-table-time-range-filter]] (the range presets),
  [[0027-analytics-views-persist-and-explicit-refresh]] (why all three range filters can be
  mounted at once).
- ADR-0008 (in-house design system: shadcn's API shape, not the package).
