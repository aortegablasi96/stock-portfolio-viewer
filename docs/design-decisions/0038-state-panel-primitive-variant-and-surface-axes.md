# 0038. One `StatePanel`: the state as `variant`, "does it bring a card" as `surface`

- **Status:** Accepted
- **Date:** 2026-08-03

## Context

The app models failure as first-class result variants rather than exceptions — `not_connected`,
`not_responding`, `needs_import`, `error` ([[0002-connection-state-as-ipc-result]],
[[0022-gateway-timeout-and-not-responding-state]]) — so that the renderer can present
each as a state rather than a stack trace. It then presented them five different ways:

| Presentation | Where | Surface | Heading | Explanation | Hint | Action |
| --- | --- | --- | --- | --- | --- | --- |
| `.state-panel` / `.state-notice` / `.state-error` | Portfolio dashboard, the four analytics views | `Card` at `lg` | `h2` at 1.15rem — *on the notice and error panels only* | yes | `.source-note`, once | Retry |
| `NeedsImport` | the four analytics views | `Card` at `lg` | `h2`, unstyled | yes | — | Import statements… |
| `.snapshot-empty` | snapshot history, stored statements, realized gains | none | — | one line at 0.9rem | — | — |
| `.chart-empty` | twelve call sites across the charts and analytics views | none | — | one line at 0.9rem | — | — |
| `.country-map-unavailable` | the Allocation map, degraded | its own centred frame | — | three flat lines | 0.82rem at 85% opacity | — |

`.snapshot-empty` and `.chart-empty` were **byte-identical** — `margin: 0; color: var(--muted);
font-size: 0.9rem` — declared 550 lines apart. The heading rule applied to two of the three panel
states, so "No dividend income recorded" rendered a full 24px UA `h2` while
"Not connected to Interactive Brokers", four pixels of DOM away in a sibling view, rendered at
18.4px. And an empty state was a bare line in one place and a 2rem card in another, with nothing
choosing between them.

The consequence is not a bug; it is that a reader who meets two of these in one session is given
no consistent signal for "there is nothing here to show, and here is why".

## Decision

**One `StatePanel` under `components/ui/`, on two axes that are deliberately *not* the button's:
`variant` says which state this is, `surface` says whether the panel brings a card with it.**

```tsx
<StatePanel variant="loading">Loading your portfolio…</StatePanel>

<StatePanel
  variant="notice"
  heading="Interactive Brokers isn’t responding"
  hint={<>The gateway is running but didn’t answer. Its session usually needs re-authenticating at <code>https://localhost:5000</code>.</>}
  action={<Button variant="primary" onClick={retry}>Retry</Button>}
>
  {state.message}
</StatePanel>

<StatePanel surface="inline">No trades match these filters.</StatePanel>
```

The parts render in one fixed order — heading, explanation, hint, action — so the recovery action
is always the last thing and always in the same place. That ordering *is* the story: the states
differ in what they say, never in where they say it.

### The axes are the state and the surface, not colour and size

A state panel has no size worth choosing: it fills the region whose state it is reporting, and
every superseded panel used `--surface-pad-lg`, the step [[0031-design-token-scales]] already
named "full-width state panels". It has no colour worth choosing either — it is muted prose. What
genuinely varies is which state it presents and whether it stands on its own surface.

`variant` is `loading | empty | notice | error`. `empty` is "there is nothing here, and that is
not a fault" — no open positions, no dividend income, no imported statements, no rows matching a
filter. `notice` is "something outside the app is in the way and you can act on it" — the gateway
is down, or stalled, or the map has no token. The distinction is worth keeping because it is the
distinction between *waiting for data you do not have yet* and *a condition you can fix*.

`surface` is `panel | inline`. `panel` is the full-width form that replaces a view's content:
a `Card` at `default`/`lg`. `inline` is the form that sits inside a surface that already exists —
an empty chart under its card title, an empty history list, the map's degraded frame — where
nesting a card in a card would draw a box with nothing behind it, the case
[[0033-card-primitive-variants-and-sizes]] already called out.

### Only `error` paints anything, and that is the design

There is no `.state-panel-loading`, `.state-panel-empty` or `.state-panel-notice` rule. The axis
exists because the **copy** and the **announcement** differ, not because four states want four
decorations — the same move as the tile's neutral tone
([[0034-stat-tile-primitive-tone-axis]]), where the absence of a rule is what lets one helper
serve five callers. A quiet variant that decorated itself would be inventing a distinction the
app does not have. `lib/statePanelVariants.test.ts` fails if one acquires a rule.

For the same reason there is no `.state-panel-panel`: that surface *is* the card's, so the class
would have nothing to declare, and `statePanelSurfaceClassName('panel')` returns `''`.

### Two things the primitive derives rather than asks for

**The element.** A panel with no heading is a `<p>`; with one, a `<section>` (or a `<div>` when
inline). That is not a nicety: the one-line loading states were already `Card as="p"`, and the UA
margins on that paragraph are part of how `.dashboard`'s flex column spaces the dashboard — the
reason `as` is a prop on `Card` at all ([[0033-card-primitive-variants-and-sizes]]). Rebuilding a
one-line state as a section wrapping a paragraph would move the page for no reason.

**The ARIA role.** `error` is `alert`; everything else is `status`. A failed read is the one state
that interrupts, because it reports that something the owner asked for did not happen and it
carries the action that retries it. `not_connected`, `not_responding` and `needs_import` are
conditions the owner did not cause, and a screen reader interrupting for each of them on every
launch is what this rule prevents. Both derivations live in `lib/statePanelVariants` because
Vitest is Node-only and nothing inside a component is testable
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]).

`role` stays overridable. Nothing in the app currently needs to.

### `not_connected` and `not_responding` stay visibly distinct

They share the `notice` variant, and they must: they are one *presentation* — a condition outside
the app, with a Retry. What distinguishes them is what a reader actually acts on — the heading
("Not connected to Interactive Brokers" against "Interactive Brokers isn’t responding") and the
hint, which the stalled state carries and the disconnected one does not, because the fixes are
different ones ([[0022-gateway-timeout-and-not-responding-state]]). Giving the pair two
variants would have put the distinction in a colour instead of in the sentence that explains it,
and left `not_responding` without a variant of its own anyway.

### The chart empties adopt it, inline

The story left this open. They adopt the primitive at `surface="inline"`, which is exactly what
makes it proportionate: a chart's empty state is reporting one card's contents, not the view's, so
it stays one muted line and gains no surface. The alternative — leaving `.chart-empty` alone —
would have left a rule byte-identical to the primitive's inline form sitting beside it, which is
the half-done consolidation Epic #125 names as its own worst outcome.

They do gain `role="status"`, which none of them had. That is the point of the announcement rule:
"No transactions match these filters" appearing after a filter change is exactly the kind of thing
a live region is for, and it was silent in twelve places.

### What the primitive does not own

The Portfolio tab's **converting note** stays its own rule. It is not a state: the figures stay on
screen while they are re-converted, which is the live-data half of
[[0027-analytics-views-persist-and-explicit-refresh]] — the same distinction the analytics views
draw between `loading` and `refreshing`. It borrowed `.state-panel` for its muted ink, so it now
declares that itself.

The map's **frame** (`.country-map-unavailable`) stays a rule too: it is *where* the panel is
drawn — a full-height centred box standing in for the basemap — not a second way of styling the
panel. That is `className` used for placement, as ADR-0008 allows.

`.capture-status` is untouched. It reports what an action *did* ("Cleared 3 statements."), not
what a region has to show, and it belongs to whichever story consolidates status messages.

## Consequences

Benefits:

- Five presentations become one primitive plus six short rules, all on the token scale.
- A state's heading, explanation, hint and recovery action are always in the same order and the
  same place, in every view.
- The states are announced by one rule instead of per call site, and twelve silent empty states
  became live regions.
- `.snapshot-empty` and `.chart-empty` can no longer drift apart, because they no longer exist.

Tradeoffs:

- Four deliberate visual changes. An empty-state heading that had no rule (`No dividend income
  recorded`) drops from a 24px UA `h2` to `--text-md` at 17.6px, matching the notice and error
  panels — the largest change in the story, and the drift that motivated it. The notice/error
  heading itself moves 1.15rem → 1.1rem. The not-responding hint moves from `.source-note` to
  `.state-panel-hint`: 0.85rem → `--text-xs`, and it tucks under its explanation at `--space-3`
  instead of a 1em UA margin. The map's degraded state gains a heading and loses its third muted
  level (`opacity: 0.85`), its three flat lines becoming heading + explanation + hint.
- The map's copy was re-cut to fit those three parts. Nothing was dropped; the "your data is
  unaffected" reassurance now shares the hint line with the fix.

Risks:

- `variant` and `surface` are independent, so `variant="error"` at `surface="inline"` is
  expressible and renders a border-colour override on an element with no border. It is harmless
  and no call site does it; constraining the pair would cost a union of pairs for one dead
  combination.
- A panel whose explanation is itself a block element would be wrapped in a `<p>`. Every current
  call site passes a phrase.

## Alternatives Considered

### `variant` × `size`, matching the button and the card

Rejected. Both axes would have had one value: every superseded panel used the `lg` surface
padding, and there is no second size any view wants. The family already has three primitives whose
axis is named for what actually varies — `tone`, `kind`, `mode`
([[0034-stat-tile-primitive-tone-axis]], [[0035-field-and-form-control-primitives]],
[[0036-toggle-group-mode-axis-and-pressed-semantics]]).

### `not-connected` as its own variant, as the story sketched it

Rejected. `not_responding` would then have had no variant to wear, and the two would have been
distinguished by decoration rather than by the sentence a reader acts on. The visible distinction
the story requires is preserved in the heading and the hint.

### A boolean `inline` prop instead of a `surface` axis

Rejected. `surface="panel"` names the thing it brings — a card at `lg` — where `inline={false}`
names the absence of the other one, and the axis reads at the call site next to `variant` as the
second of two nouns rather than a flag.

### Leaving `.chart-empty` alone, as the story permitted

Rejected. See above: it was byte-identical to `.snapshot-empty`, and the inline surface makes
adoption proportionate rather than a promotion to a panel.

## References

- Story #133, Epic #125.
- [[0031-design-token-scales]] — the spacing and type scales this uses; `--surface-pad-lg`.
- [[0032-button-primitive-variants-and-sizes]] — the Retry/Import action.
- [[0033-card-primitive-variants-and-sizes]] — the surface, and why `as` is a prop.
- [[0034-stat-tile-primitive-tone-axis]] — the absence of a rule as a design statement.
- [[0002-connection-state-as-ipc-result]], [[0022-gateway-timeout-and-not-responding-state]] — the states being presented.
- [[0027-analytics-views-persist-and-explicit-refresh]] — why the converting note is not a state.
- ADR-0007 — the Mapbox basemap, whose absence is the map's `notice`.
- ADR-0008 — shadcn's API adopted, the package declined.
- `src/renderer/src/components/ui/StatePanel.tsx`, `src/renderer/src/lib/statePanelVariants.ts`.
