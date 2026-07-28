# 0029. Tab shell: the complete ARIA tabs pattern, with automatic activation

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

The shell's tab bar ([[0006-app-shell-tab-navigation]]) announced itself as a tablist —
`role="tablist"` on the nav, `role="tab"` and `aria-selected` on each button — and then stopped
there. No element carried `role="tabpanel"`, so no tab had anything to control; there was no
`aria-controls` and no `id` to point at; and arrow keys did nothing, so the thing behaved like
a plain row of buttons while telling assistive technology it was a tablist.

A half-implemented ARIA pattern is worse than no ARIA at all. `role="tablist"` is a promise
about the DOM and about the keyboard, and a screen reader that acts on that promise — arrowing
to reach the next view, expecting one Tab stop, expecting a panel to move into — finds none of
it there. Story #111 completes it.

Two things constrain the completion. The bar's visual design is settled and is not being
reopened; this is semantics and keyboard behaviour. And the shell's tabs are not
interchangeable: analytics tabs mount on first visit and stay mounted
([[0027-analytics-views-persist-and-explicit-refresh]]), while the Portfolio tab unmounts and
re-reads live IBKR data on every visit.

## Decision

Implement the WAI-ARIA tabs pattern in full, in `App.tsx`.

**Every view is a panel, and the pair points both ways.** A `TabPanel` wrapper renders
`role="tabpanel"` with `id="panel-<tab>"` and `aria-labelledby="tab-<tab>"`; each tab carries
`id="tab-<tab>"` and `aria-controls="panel-<tab>"`. This brings the **Portfolio** tab inside the
pattern for the first time — its dashboard and Flex import panel were previously loose children
of the shell. `aria-controls` is set **only on the selected tab**, because only the selected
tab's panel is in the tree: an unvisited analytics tab has no component at all, and naming an
element that does not exist is the same broken promise in miniature.

**Arrow keys move, and activate as they move.** Left/Right step with wrap-around at both ends,
Home/End jump to the first and last tab, and the tab focus lands on is also the tab that gets
selected — *automatic* activation, the pattern's default. The APG's reason to prefer manual
activation is latency: don't swap a panel the user is only passing over if showing it makes them
wait. Nothing here waits — every view paints its own loading or empty state synchronously, and
no view blocks on IPC before rendering. What automatic activation buys is that what a screen
reader announces and what is on screen can never disagree.

The index arithmetic (wrap, Home/End, keys the tablist must not swallow) lives in
`renderer/src/lib/tabKeyboard.ts`, because Vitest runs in Node with no jsdom and nothing inside
a component is testable. The pattern's other half — the attributes, the focus moves — is pinned
by `e2e/tab-navigation.spec.ts`.

**A roving `tabindex` makes the tablist one stop.** The selected tab is `tabIndex={0}`, the rest
`-1`, so Tab enters the bar once and the next Tab leaves it. Because the tab being left stops
being focusable, a keyboard move sets focus explicitly through a ref map rather than leaving it
to the browser. Panels are `tabIndex={0}` so that next Tab lands *in the view* rather than on
whichever control happens to sit first inside it.

**The active tab is marked by shape as well as colour.** It was distinguished by accent text on
a filled pill — two cues, both colour, and colour is the one channel that cannot be relied on
alone. A 2px bar under the label, drawn in `currentColor` inside the existing pill, is
presence-or-absence and survives any palette. That is the only visual change; the bar's
geometry fits inside the tab's existing padding, so nothing moves.

## Consequences

Benefits:

* The tablist now delivers what it announces: real panels, real arrow-key movement, one Tab stop.
* The Portfolio tab is a first-class panel rather than an unlabelled region.
* Hidden panels stay out of the accessibility tree, so four mounted-but-invisible analytics
  views are not four sets of unreachable-but-announced content.

Tradeoffs:

* Arrowing past an analytics tab **mounts it for the session** and issues its one IPC read,
  exactly as clicking it would. That is the cost of automatic activation and it is small — the
  reads are local SQLite. Landing on Portfolio re-reads live IBKR, which the repository's
  short-lived gateway cache ([[0024-gateway-read-coalescing-and-freshness-window]]) absorbs when it happens twice in
  quick succession.
* Panels are focusable, which adds one Tab stop per visible panel (there is only ever one).

## Alternatives Considered

### Manual activation (arrows move focus, Enter/Space selects)

Rejected. It is the APG's answer to *latency*, and there is none here: every view paints
immediately. Its real attraction was avoiding the IPC that arrowing past a tab triggers — but
that is one cheap local read, and paying for it with a pattern where the announced tab and the
shown panel disagree until a second keypress is the wrong trade for a screen-reader user.

### Leave the Portfolio tab outside the pattern

Rejected. It unmounts on every switch, so it is tempting to treat it as "not really a panel" —
but it is the tab the app opens on, and it would be the one view with no accessible association
to the tab that selected it.

### Distinguish the active tab by font weight instead of a bar

Rejected: weight is a weak cue at 0.9rem, and the tabs are already `font-weight: 600`, so the
available step is small. A bar is unambiguous at a glance and costs no layout.

### Add a headless tabs library

Rejected. The whole pattern is roughly forty lines against the "avoid dependencies" principle,
and [[0006-app-shell-tab-navigation]] already declined a router for the same reason.

## References

- [[0006-app-shell-tab-navigation]] — the shell this completes
- [[0027-analytics-views-persist-and-explicit-refresh]] — why panels stay mounted and hidden
- [[0011-custom-frameless-window-shell]] — the window chrome the tab bar sits under
- WAI-ARIA Authoring Practices — Tabs pattern
- GitHub Issues #100 (Epic), #111 (Story)
