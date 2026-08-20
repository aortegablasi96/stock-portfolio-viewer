# 0057. Sidebar collapse: one flag, a clipped label, and a title bar that keeps spanning the window

- **Status:** Superseded by [[0068-sidebar-toggle-beside-the-app-name]] (the toggle's *placement*
  only — everything else below still governs)
- **Date:** 2026-08-18

## Context

[[0055-vertical-sidebar-tablist]] put a fixed 220px column beside the content and
[[0056-sidebar-context-rail]] filled it. The Figma Make proposal Epic #179 adopts collapses that
column to a 56px icon rail: labels drop away, the brand tile and the status dot stay, the currency
footer becomes a bare `€`, and the width animates over `0.22s cubic-bezier(0.4,0,0.2,1)`.

Four things make it more than a CSS width toggle here.

**The window is frameless.** `frame: false` with an in-app `TitleBar`, drag versus no-drag
expressed with `-webkit-app-region` ([[0011-custom-frameless-window-shell]]). The sidebar now sits under
that bar and beside the content, so the story has to settle the corner where they meet — the
prototype draws the sidebar full height at `height: 100vh` beside the bar, which this app has never
done.

**A collapse that is not remembered is an annoyance rather than a feature.** The owner would
re-collapse it on every launch. There is already a mechanism for exactly this shape of fact:
[[0028-window-state-persistence]] keeps one overwritten JSON value under the `app_meta` key
`window_state` — metadata, not history, so no new table, and the owning service may not import
`electron`.

**A collapsed nav row still has to have a name.** The prototype relies on `title`, which is a
tooltip and not a reliable accessible name. These rows are `role="tab"` in a real tablist
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]).

**And the grid below collapses on the column it is given, not on the window.**
[[0051-performance-chart-grid]] picks its breakpoint from a legibility floor on a 1200px *content*
column; [[0055-vertical-sidebar-tablist]] restated that as 1420px of viewport by adding the
sidebar. A sidebar with two widths is a breakpoint with two values.

The prototype also puts an invisible full-width expand button at the top of the collapsed rail, a
second visible one at the bottom, and re-expands the sidebar whenever a nav item is clicked while
collapsed. That last behaviour defeats the purpose of collapsing.

## Decision

### The title bar keeps spanning the window, above the sidebar

The corner is settled the way #182 already shipped it, and now for a stated reason rather than by
inheritance. With no OS frame the bar is the window's **only grab handle**, and
[[0028-window-state-persistence]] judges whether a restored window is reachable at all on that
40px bar — not on the window's area. A sidebar running full height beside it would carve 220px out
of the drag region, and collapsing would then *change how grabbable the window is* as a side effect
of a navigation preference. Two states of a nav control must not be two answers to "can the owner
move this window".

`e2e/sidebar-collapse.spec.ts` pins the consequence: the bar is as wide as the viewport and the
drag region is more than half of it, in both states.

### Collapse is one class on the app's root element

`shellClassName(collapsed)` puts `app-collapsed` on the shell, and every collapsed rule in
`app.css` hangs off it. Nothing in the rail takes a `collapsed` prop — not the brand, not the
badge, not a tab. Two things follow that are worth more than the tidiness.

The **tabs pattern is untouched**: the roving `tabindex`, `aria-orientation`, automatic
activation and the one-exposed-panel rule are the same code in both states, so there is no second
path to keep correct. And **selecting a view cannot reopen the column**, because the only writer of
the flag is the toggle's own callback. The prototype's re-expand-on-click is not disabled here; it
was never expressible.

### One visible, labelled toggle, at the bottom of the column

> **Superseded 2026-08-20 by [[0068-sidebar-toggle-beside-the-app-name]]** — the *placement* only.
> The toggle moved into the sidebar's head row beside the brand, and the measurement below is what
> it pays: the product's name now **wraps to two lines** rather than being ellipsised. Kept as
> written because it is still the reason the name wraps, not a reason that turned out to be wrong.
> The Tab order in the last paragraph is now toggle → tabs → currency → panel. Everything else in
> this section — one visible control, `aria-expanded` for the state and a name for the action —
> stands.

Not the prototype's pair, one of which is invisible — that is how a reader collapses the sidebar by
accident and cannot see what to click to undo it. One control, in the same place in both states,
carrying `aria-expanded` for the state and a name for the action ("Collapse sidebar" /
"Expand sidebar").

It sits **last in the column rather than beside the brand**, and that was measured rather than
preferred: 220px minus the 32px brand tile leaves the product's own name barely fitting, and a
control there ellipsised "Stock Portfolio Viewer" to "Stock Portfolio…". The cost is one more stop
between the selected tab and its panel — the tablist is a single Tab stop, so anything after it
lands there — which `e2e/tab-navigation.spec.ts` already had to describe once for #183 and now
describes twice.

### A collapsed label is clipped, never removed

One rule, four selectors — the brand name, the badge's wording, the nav labels and the currency
field's label — using the same `position: absolute` + `clip` technique `.sr-only` uses.

`display: none` was the obvious alternative and is the wrong one: it takes the text out of the
accessibility tree and leaves `title` as the mechanism, which is precisely what the story rules
out. Clipped, a nav row is still named by its own text, and the currency select is still named by
its own `<label for>`. The tooltips added alongside are an addition. The one markup change this
needs is a `<span>` around each tab's label, so there is something to clip; the tab's `textContent`
is unchanged, which is why `e2e/tab-navigation.spec.ts` still reads the five tabs as five names.

### The status dot grows a second channel on the rail

This is the one place collapse costs something, and it is paid rather than absorbed.
[[0056-sidebar-context-rail]] made the badge's **wording** the channel and the dot its second. On
the rail the wording is clipped, so three tones would be separated by hue alone — the thing
[[0021-allocation-map-gain-loss-scale]] forbids. Shape is the channel that fits in 12px: **filled** is
live, **hollow** is idle, **haloed** is the pair of unhappy outcomes. Same three tones, same
`currentColor` (so no new pairing for `lib/contrast.ts`), and the wording is one click — or one
screen reader — away rather than gone. The dot grows from `--space-3` to `--space-4` first, because
a 2px ring on an 8px disc is a smudge and not a shape.

### The currency keeps its select, without its arrow

40px of content on the rail. The native dropdown arrow goes and the three-letter code becomes the
whole control; it is still a real `<select>` with the shared `.control` hover, focus and disabled
treatment ([[0035-field-and-form-control-primitives]]), and expanding restores the labelled field. The
prototype's bare `€` was declined: there is no symbol for `SEK`, and the code is what every figure
in the app is already labelled with.

### The width is on the motion scale, and arrives without animating

`transition: width var(--duration-base) var(--ease-out)` — the prototype's 0.22s rounded onto the
scale, which is what puts it inside the single `prefers-reduced-motion` rule that zeroes the
durations ([[0044-motion-scale-and-reduced-motion]]). A hand-picked 220ms would have escaped it,
and `lib/motionTokens.ts` fails one.

Only `width` transitions: text animating its own width squashes glyphs on the way, and the column
sliding is the motion the reader asked for.

The transition is armed **a frame after** the stored state arrives (`ANIMATED_CLASS`, applied from
a `requestAnimationFrame` in the shell's load effect). The state is read over IPC, so the first
paint is always the expanded column; without this, a rail the owner deliberately left collapsed
would slide shut in front of them on every launch — a 120ms animation reporting a decision they
made yesterday. Applied late, the stored width is simply where the sidebar already is.

### The state is persisted the way the window's own bounds are

`sidebarStateService` sits beside `windowStateService` in `services/window/`, keeps one overwritten
JSON value under the `app_meta` key `sidebar_state`, reaches it only through `metaRepository`, and
imports no `electron` — the whole of [[0028-window-state-persistence]]'s shape, including parsing what
it read so a hand-edited row costs a preference rather than a launch. First launch opens
**expanded**: the rail is the compact form of something the reader already knows, and the labelled
column is how they learn what five glyphs mean.

The two channels are `window:getSidebarState` / `window:setSidebarState` — under the `window:`
prefix because with no OS frame the app owns its own chrome, and `invoke` rather than the three
payload-free `send` commands beside them because there is a payload to Zod-validate. The shell reads
once on launch and writes on a toggle; nothing polls.

### The grid's breakpoint follows the column, from one number

`GRID_CONTENT_BREAKPOINT_PX` (1200) is now stated once in `lib/chartGeometry.ts`, and both
thresholds are derived from it: `1200 + 220 = 1420` expanded, `1200 + 56 = 1256` collapsed.
`gridColumns` and `chartWidthPx` take the sidebar width as a defaulted parameter, so neither
threshold can be tuned on its own. In CSS the collapsed case is a second, two-selector-deep media
query at `min-width: 1257px`.

This hands back the property [[0051-performance-chart-grid]] had and #182 spent. At the 1280px
default window, a half column is 438px with the column open — a 9.7px axis label, under the floor —
and 520px with the rail closed, an 11.4px label, over it. **Collapsing the sidebar is what gives a
default window its 2×2 grid back**, and it is the legibility floor answering rather than a
preference.

## Consequences

- Collapse is expressible in exactly one place. A rule that needs to know about the rail writes
  `.app-collapsed …`; a component never does.
- The Tab order through the sidebar is now tab → currency → toggle → panel. That is the second time
  #183's placement test has moved, and the third control to land between a tab and its panel; a
  fourth is the point to ask whether the footer wants a landmark of its own. *(Superseded by
  [[0068-sidebar-toggle-beside-the-app-name]]: the toggle moved above the tablist, so the order is
  toggle → tabs → currency → panel and the count is back to one.)*
- A collapsed rail is an **abbreviated** presentation, not a lossless one. The badge's wording, the
  currency's label and the app's name are all present to assistive technology and absent to the
  eye. The status dot is the only one of those that had to grow a replacement channel, because it
  is the only one whose *state* was being carried.
- `--sidebar-width-collapsed` joins `--sidebar-width` and `--titlebar-height` as shell geometry
  rather than a scale step, and `chartGeometry.test.ts` reads both widths back out of `app.css`.
- **Not done, deliberately:** the collapsed state is not exposed as a keyboard shortcut, and the
  rail does not expand on hover. A hover-expand rail moves the content column under the pointer,
  which is the behaviour the owner's own "does not force the sidebar back open" criterion is
  about — just triggered by a different gesture.
- Still deferred, from [[0046-contrast-split-tone-tokens]] and Epic #162: the tab panels sit outside
  a landmark (axe `region`, best practice). Unpicking that means restructuring
  [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] across every view, and collapse does not touch it.
