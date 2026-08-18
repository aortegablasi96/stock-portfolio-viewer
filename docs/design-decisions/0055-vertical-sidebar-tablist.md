# 0055. The tablist rotates into a vertical sidebar, and everything it promises comes with it

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The five views lived in a horizontal strip under the title bar: `.app-nav` supplied a sticky,
translucent, full-bleed band, `.app-tabs` held the row on the content measure, and `.app-tab` was
each button. The Figma Make proposal Epic #179 adopts replaces that with a 220px left sidebar —
each view a full-width row of icon and label, the current one carrying accent ink over a dimmed
accent fill.

That is a change of orientation and skin. What makes it worth a record is everything it is *not*
allowed to change, because the strip is the app's most invariant-heavy component:

- It is the complete WAI-ARIA tabs pattern ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]),
  not a styled row of buttons — roving `tabindex`, `aria-controls` on the selected tab only,
  automatic activation, panels pointing back with `aria-labelledby`.
- Views mount on first visit and then **stay mounted**
  ([[0027-analytics-views-persist-and-explicit-refresh]]). The prototype renders
  `{view === 'portfolio' && <PortfolioView/>}`, which unmounts, and porting that would silently
  discard every view's range selection, type chips and loaded report on each switch.
- The active item may not be marked by colour alone. The strip's 2px underline exists precisely
  because accent-on-pill is two cues and both are colour.
- Icons are `1em` in `currentColor` ([[0048-tab-icons-as-a-second-channel]]), so they introduce no
  pairing for `lib/contrast.ts` to cover and no length for `lib/tokenAdoption.ts` to catch.

## Decision

**The tablist becomes a column in a sidebar, and stays a tablist.** `<nav class="app-sidebar">`
holds `<div class="app-sidebar-tabs" role="tablist" aria-orientation="vertical">`; the buttons
keep the class `.app-tab` and every attribute they had. Only two things about the pattern change,
and both follow from the axis: the tablist declares `aria-orientation="vertical"`, and
`lib/tabKeyboard.ts` moves on **Up/Down** where it moved on Left/Right. Home/End are unchanged.

**Left/Right are not accepted as a second way to move.** A tablist that announces one orientation
and answers to both axes describes neither, and those keys belong to whatever the focused panel
does with them. `e2e/tab-navigation.spec.ts` pins that they do nothing here.

**The shell becomes two columns under one full-width title bar.** `.app-body` is a flex row of
`.app-sidebar` and `.app-content`; the panels move inside the content column rather than being
siblings of the nav. Three details carry weight:

- `align-items: flex-start`, because a stretched flex item is as tall as the document and has
  nothing to stick to. The sidebar is `position: sticky` at `--titlebar-height` and exactly
  `calc(100vh - var(--titlebar-height))` tall, which is what the strip's `top: 40px` was doing.
- `min-width: 0` on the content column. A flex item's default minimum is its content's intrinsic
  width, so without it one wide table pushes the column past the window and scrolls the whole
  page sideways instead of scrolling inside its own container.
- The document keeps scrolling. Nothing here introduces a second scroll container, so the capped
  tables' scroll-driven fade ([[0044-motion-scale-and-reduced-motion]]) and the sticky title bar
  are untouched.

**Two shell measures become tokens**: `--titlebar-height: 40px` and `--sidebar-width: 220px`.
Neither is a type or spacing step — they are the shell's own dimensions — but each is now quoted
in more than one place, and 40px in particular was about to be written out three times.

**The active row's non-colour cue rotates with it.** The 2px bar under a label becomes a 3px bar
down the row's leading edge, same `::after`, same `currentColor`. Its radius is `--radius-pill`
rather than a hand-picked hairline: on a 3px bar it resolves to a stadium, which is what the
strip's `1px` was approximating, and it retires the last raw radius
`lib/tokenAdoption.ts` was carrying for this component.

A **second** non-colour cue comes with the rotation: resting rows are `font-weight: 500` and the
active row is `600`. [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] rejected weight *as
the cue*, on the ground that the strip's tabs were already 600 and the available step was too
small. A list of full-width rows has the room the strip did not, so weight joins the bar instead
of replacing it.

**The hover rule is scoped away from the active row**, and this is load-bearing rather than tidy.
A pseudo-class counts as a class, so `.app-tab:hover` is (0,2,0) against `.app-tab-active`'s
(0,1,0) and wins outright regardless of source order — a pointer resting on the current view would
repaint it in the *unselected* ink and tell the reader the app has no current view. The rule is
`.app-tab:hover:not(.app-tab-active)`. The horizontal strip carried the same defect unnoticed,
because both of its states happened to share a background.

**The two tints are measured, not chosen.** The active fill is
`color-mix(in srgb, var(--accent) 16%, transparent)` over `--card`, and accent text on it is
4.95:1. The ceiling is close enough to matter — 20% is 4.60:1 and 22% is 4.41:1, a failure — so
`lib/contrast.ts` gains a third way to name a colour, a token mixed into a surface, and both new
pairings are listed. That closes a gap [[0054-navy-indigo-palette-re-key]] opened: it made
`color-mix()` the way a rule tints something, and nothing measured the results.

## Consequences

Benefits:

- The view list reads as a list, and the window's full width belongs to the content.
- The tablist is unchanged where it counts. `e2e/tab-navigation.spec.ts` needed exactly the two
  adaptations the axis forces, and gained three: the orientation attribute, the cross-axis arrows
  doing nothing, and the hover-cascade check above.
- A real defect was found by the rotation rather than introduced by it — the hover specificity bug
  predates this story.
- `color-mix()` results are now inside the contrast guard.

Tradeoffs:

- **The Performance grid no longer opens two-up in a default window**, and this is the one thing
  the story genuinely spends. [[0051-performance-chart-grid]] chose 1200px "deliberately below
  the 1280px default window, so a fresh install opens on the grid". The threshold is the *content
  column*, and the column is now the window minus 220px, so the media query moves to 1420px to
  keep meaning the same thing — which puts it above the default window. No breakpoint fixes it:
  at 1280px a half column is 438px and renders a 9.7px axis label, under the 11px floor. So a
  default window opens Performance **stacked**, four full-width charts at a comfortable 20.7px
  label, and the 2×2 grid wants 1421px or more. The two ways out — a wider default window, or a
  narrower sidebar — are decisions about the shell, and neither is made here.
- `lib/chartGeometry`'s width maths gains a term it can now get wrong. It would have kept passing
  while describing a layout that no longer existed, which is the drift it exists to catch, so
  `--sidebar-width` is mirrored and read back out of `app.css` like every other token it uses.
- `NARROWEST_TESTED_PX` rises from 800 to 1020 — the same content floor, plus the sidebar. The
  app's usable minimum window really did grow by 220px.
- The sidebar's width is fixed at every window size. That is Story #184's problem, not this one's.

Risks:

- The sidebar clips (it scrolls), so a row flush against its edge would lose half its focus ring.
  The tablist's `--space-3` padding is the gutter the ring lives in; it is 8px against the 4px a
  ring needs, and it is not decoration.

## Alternatives Considered

### Give the content column its own scroll container

Rejected. It moves the scrollbar off the document, which the sticky title bar, the global
scrollbar styling and the capped tables' scroll-driven fade are all built around, and it buys
nothing the sticky sidebar does not already give.

### Accept Left/Right as well as Up/Down

Rejected. See above: it makes `aria-orientation` a half-truth and takes two keys from the panel.

### Keep the active row's cue as colour plus the tint alone

Rejected — that is the prototype's design, and a dimmed-accent fill under accent ink is two cues
that are both colour, which is exactly what
[[0029-tab-shell-aria-pattern-and-keyboard-navigation]] added the bar to avoid.

### Rename `.app-tab` to something sidebar-shaped

Rejected. It is the same tab, and three guard tests plus two DDRs speak about it by that name. The
containers were renamed because they genuinely are different things; the tab was not.

### Declare the active tint as a hex token instead of a `color-mix()`

Rejected. It would have been measurable without touching `lib/contrast.ts`, but it detaches the
tint from `--accent`, so the next palette re-key would leave one strip of the app behind — the
failure [[0054-navy-indigo-palette-re-key]] found five times and fixed by moving *to* `color-mix()`.
Teaching the guard the mix is the smaller change.

### Widen the default window by 220px so the chart grid still opens two-up

Rejected here, not on the merits — it is a reasonable answer and it is a decision about the window
([[0028-window-state-persistence]]), not about the nav. A 1500px default also does not fit a
1366×768 laptop, so it trades one default for another.

## References

- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the pattern this carries across
- [[0027-analytics-views-persist-and-explicit-refresh]] — why views stay mounted
- [[0048-tab-icons-as-a-second-channel]] — the icons, unchanged
- [[0051-performance-chart-grid]] — the breakpoint this moves, and the property it cannot keep
- [[0018-content-measure-and-chart-aspect]] — the content measure, which no longer has the nav
  strip aligned to it
- [[0054-navy-indigo-palette-re-key]] — `color-mix()` as the way a rule tints, now measured
- [[0046-contrast-split-tone-tokens]] — the guard the two new pairings join
- [[0031-design-token-scales]], [[0042-token-adoption-ratchet]] — the scale, and the exemption retired
- [[0044-motion-scale-and-reduced-motion]] — the hover transition's duration
- [[0011-custom-frameless-window-shell]] — the title bar the sidebar sits under
- GitHub Issues #179 (Epic), #182 (Story)
