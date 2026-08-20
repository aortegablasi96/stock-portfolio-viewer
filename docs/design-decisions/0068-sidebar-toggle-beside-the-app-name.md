# 0068. The collapse toggle moves beside the app's name, and the name wraps to pay for it

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

[[0057-sidebar-collapse-and-the-frameless-corner]] put the sidebar's one collapse toggle **last in
the column**, under the display-currency selector, and it did so on a measurement rather than a
preference: 220px less the head's gutters leaves 156px beside the 32px brand tile, and
"Stock Portfolio Viewer" wants 154 of them. A control on that row left 118px, and the name — which
was `white-space: nowrap` with `text-overflow: ellipsis` — became "Stock Portfolio…".

The owner reviewed the shipped result and asked for the control to move up anyway. The reason is
the one the placement could not answer: **the toggle is the only control in the app that changes
the navigation's width, and it sat at the opposite end of the column from the thing it changes**,
in a footer whose other occupant — the display currency — has nothing to do with it. The footer
reads as two unrelated controls sharing a box, and the head reads as a mark and a badge with an
empty right-hand third.

So the measurement is not wrong; it is a **cost, not a verdict**. This record settles what pays it.

## Decision

### The toggle sits in the sidebar's head row, at its trailing edge

One new rule, `.app-sidebar-head-row`, holding `SidebarBrand` and `SidebarToggle` with
`justify-content: space-between`. It is a row of its own rather than a third child of
`.app-sidebar-head`, because the head is a column and the gateway badge below still needs a line to
itself.

Nothing about the control itself changes. It is still the single visible, labelled toggle
[[0057-sidebar-collapse-and-the-frameless-corner]] decided on — `aria-expanded` for the state, a
name for the action, `aria-controls="app-sidebar"`, the shared focus ring and no rule of its own —
and it still reaches no IPC, because the shell owns the flag and hands down a callback. The
prototype's second, invisible toggle at the top of the collapsed rail stays declined.

### The product's name wraps to two lines; it is never abbreviated

The clamp goes: `.app-brand-name` drops `white-space: nowrap`, `overflow: hidden` and
`text-overflow: ellipsis`, and gains `line-height: var(--leading-tight)`. At 118px the name breaks
after "Portfolio" and the head row grows from 34px to 43px — about 9px on a column that has an
empty middle at every window size this app runs at.

That is the whole trade, and it is stated this way round on purpose: **an abbreviated product name
is a worse defect than a taller head row.** "Stock Portfolio…" is the app failing to say what it
is, in the one place whose job is to say it; the extra 9px costs the nav list nothing, because the
list is nowhere near the bottom of the column.

`--leading-tight` rather than the inherited leading is what makes the two lines read as one name:
at prose leading the pair sits further apart than the 32px tile is tall, and the mark stops looking
like it belongs to the text beside it.

### Neither width moves, and neither derived breakpoint can

Expanded stays `--sidebar-width` (220px) and collapsed stays `--sidebar-width-collapsed` (56px).
Widening the column to fit the control on one line was the obvious alternative and is the one this
Epic's own acceptance criteria rule out: both of the Performance grid's thresholds are derived from
`GRID_CONTENT_BREAKPOINT_PX` **plus a sidebar width** ([[0051-performance-chart-grid]],
[[0057-sidebar-collapse-and-the-frameless-corner]]), so a wider sidebar is a higher breakpoint, and
a higher breakpoint is the 1280px default window losing the 2×2 grid that collapsing exists to give
it back. The name is the thing with slack; the column is not.

### On the rail, the row turns the corner

56px less the rail's `--space-3` gutters is 40px of content — the 32px tile *or* the 30px control,
not both across. `.app-collapsed .app-sidebar-head-row` sets `flex-direction: column`, so the two
stack and the head's existing `align-items: center` does the centring on the new axis. Both stay
visible and stay in the same order, which is what keeps the rail's one control findable. The brand
name is clipped by the same rule as before, so the shell is still named by its own text.

This is the only change collapse needed. The flag is still one class on the shell, nothing in the
rail takes a `collapsed` prop, and the animation, the reduced-motion behaviour and the persisted
state are untouched.

### The sidebar's Tab order becomes toggle → tabs → currency → panel

DOM order, which is also visual order. The tablist is a single Tab stop with a roving `tabindex`
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), so moving the toggle above it takes one
stop *out* from between the selected tab and its panel rather than adding one:
[[0057-sidebar-collapse-and-the-frameless-corner]]'s consequence note counted three controls
landing between a tab and its panel and flagged a fourth as the moment to ask for a landmark. This
puts the count back to one.

`e2e/tab-navigation.spec.ts` walks the whole order in a real browser, and
`e2e/sidebar-collapse.spec.ts` gains the two facts only a browser can see: that the name is
untruncated on two lines at 220px, and that the tile and the control both fit inside 56px stacked.

## Consequences

- The one control that changes the navigation's width now sits with the thing it changes, and the
  footer carries the display currency alone.
- The app's name is legible in full for the first time on a row that shares its width. It is also
  now the only two-line label in the shell, which is why the leading is pinned rather than
  inherited.
- The head row is taller by roughly one line. Nothing below it moves that a reader would notice —
  the nav list has never come close to filling the column.
- **[[0057-sidebar-collapse-and-the-frameless-corner]] is superseded on this point only.** Its
  measurement is preserved rather than deleted, because it is still the reason the name wraps; what
  changed is which side of the trade the owner wanted. Everything else in that record — the flag,
  the clipped labels, the shape channel on the status dot, the title bar's corner, the persistence,
  the derived breakpoints — still governs.
- **Not done, deliberately:** the head row does not become a landmark, and the toggle gains no
  keyboard shortcut. Both were out of scope for the same reason as in `0057`, and the stop count
  went down rather than up.

## Alternatives Considered

### Widen the sidebar to fit the name and the control on one line

Rejected above: `--sidebar-width` is an input to both of the Performance grid's breakpoints, so
this trades a legible name for an illegible axis label at the default window size.

### Shrink the name's type step so it fits on one line

Rejected. The step is `--text-sm`, already the smallest thing in the shell that is prose rather
than a micro-label, and the next step down is the 11px uppercase micro-label role
([[0060-kpi-tile-figure-and-micro-label]]) which the app deliberately has exactly one of. Shrinking
the product's own name to fit a control beside it is the same failure as ellipsising it, more
quietly.

### Keep the ellipsis and let the title attribute carry the full name

Rejected on the grounds `0057` already argued for the nav rows: `title` is a tooltip, not a
reliable accessible name, and the app has one place where its own name is written out.

### Put the toggle in the title bar instead

Rejected. The bar is the frameless window's only grab handle and
[[0028-window-state-persistence]] judges a restored window's reachability on it
([[0011-custom-frameless-window-shell]]); every control added there is drag region taken away. The
toggle also belongs to the sidebar, not to the window.

## References

- [[0057-sidebar-collapse-and-the-frameless-corner]] — the collapse mechanism, and the placement
  this record supersedes
- [[0056-sidebar-context-rail]] — why the brand and the badge sit above the list
- [[0055-vertical-sidebar-tablist]] — the vertical sidebar tablist
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the tabs pattern and the roving
  `tabindex`
- [[0051-performance-chart-grid]] — the breakpoint the sidebar's width is an input to
- [[0031-design-token-scales]] — the scale the leading step comes from;
  [[0042-token-adoption-ratchet]] — the ratchet
- Story #218, Epic #179
