# 0056. The sidebar's context rail: a derived gateway badge, and the currency that outlives the view

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

[[0055-vertical-sidebar-tablist]] rotated the tablist into a 220px column and left most of that
column empty. The Figma Make proposal Epic #179 adopts fills it with three things that are true of
the **app** rather than of any one view: a brand mark at the top, a gateway status badge under it,
and the display currency pinned to the bottom.

Only the first is cosmetic. The other two are decisions.

**The badge has to report a state it actually knows.** The prototype hard-codes a green dot and an
account number. Real gateway state is already modelled as data, and it has *three* failure
outcomes rather than one: `not_connected` is nothing listening, `not_responding` is something that
accepted the request and then stalled past its bounded wait, and `IbkrTimeoutError` is deliberately
not a subclass of `IbkrNotConnectedError` so that no `instanceof` can merge them
([[0022-gateway-timeout-and-not-responding-state]]). A badge rendering both as "offline"
throws away the one distinction that tells the owner whether to *start* the gateway or to
*re-authenticate* it.

**And it may not go and ask.** Every gateway request is one bounded attempt and never a retry loop,
and the repository already coalesces reads behind `gatewayCache`
([[0024-gateway-read-coalescing-and-freshness-window]]). A badge that polled would either be answered from
that cache — learning nothing — or spend a 15-second deadline on a question nobody asked, on a
timer, forever.

**The currency control has a subtler problem.** It drives `portfolio:getOverview`'s display
currency, and it currently lives inside the Portfolio dashboard — the one view deliberately
excluded from stay-mounted, because it reads live data that changes with no event to announce it
([[0027-analytics-views-persist-and-explicit-refresh]]). A control that lives in a component which
unmounts on every switch away cannot hold a selection; today it silently resets to EUR each visit,
which nobody notices only because the reset is invisible.

## Decision

**The badge is derived, not polled. Its source of truth is the last result of
`portfolio:getOverview`.** The Portfolio view reports every read up to the shell — success *and*
failure, including a read whose figures it then discards — and the shell holds the latest as
`{ status, at }`. No new IPC channel, no new caller of the gateway, and no timer that touches it.
The view already re-reads on every visit, so the reading refreshes exactly as often as the owner
looks at the data it describes.

**A derived reading ages, so freshness is part of the answer.** Past five minutes a live reading
stops claiming to be live: `Live · 14:32` becomes `Last seen 14:32`, and the dot drops to the idle
tone. Five minutes is not a taste — it mirrors `SESSION_TTL_MS`, the window in which the repository
still trusts its own memory of "authenticated". Past it the repository would re-ask, so past it the
badge stops asserting. The value is **restated rather than imported**: the renderer may not reach
`@repositories` (an ESLint-enforced boundary), and a display threshold that happens to agree with a
cache TTL is not the same fact as the TTL.

Only `live` is aged out. The three unhappy outcomes are already the absence of a working gateway,
so an old one cannot mislead the way an old "Live" does, and blanking them would replace a true
statement with no statement.

**Five outcomes, five wordings, three tones** — in that order of importance:

| reading | wording | tone |
| --- | --- | --- |
| never read | `Not checked yet` | idle |
| `ok`, fresh | `Live · 14:32` | live |
| `ok`, aged out | `Last seen 14:32` | idle |
| `not_connected` | `Not running` | idle |
| `not_responding` | `Stalled` | warn |
| `error` | `Unavailable` | warn |

Three tones for six lines is the point rather than an economy: **no pair of outcomes is separated
by colour alone**, because two of them share every tone. The dot is the second channel and never
the first ([[0021-allocation-map-gain-loss-scale]]). Its tones are declared once as two local custom
properties, `--gateway-mark` and `--gateway-ink`, so the fill and text halves of the loss tone
cannot be swapped at the two call sites: a dot is a filled shape and takes `--neg`, the detail
line beside it is text and takes `--neg-text` ([[0046-contrast-split-tone-tokens]]). All three dot
fills join `lib/contrast.ts` as the guard's first **non-text** pairings, at 1.4.11's 3:1.

**The account number is not shown, and that is a finding rather than an omission.** The prototype's
second line reads `Live · U18846869`. `PortfolioOverview` carries no account id — the repository
resolves one and keeps it — and Epic #179 states that this milestone changes presentation only, so
no IPC channel, service or contract changes shape because of it. The badge therefore adopts what
exists (the state, and when it was observed) and the account id opens its own story.

**One timer exists, and it is a clock rather than a poll.** A single `setTimeout`, armed for the
moment a live reading crosses into stale, and only while one is waiting for it. Not an interval:
there is nothing to check on a cadence, only one known future moment when the label stops being
true. It issues no IPC and asks the gateway nothing.

**The three pieces of standing context lift into `App` as plain `useState`.** Not a module store
in the shape of `lib/dataVersion`, and not a context: the shell is already the only common ancestor
of the sidebar and the dashboard, and the values are read in exactly two places. The two callbacks
handed down are **stable**, and that is load-bearing rather than tidy — the dashboard's load effect
depends on their identity, so a new function each render would re-run the read that produced the
report that caused the render.

**The currency selector moves to the footer and becomes the app's selection**, which changes three
things about it. It survives a switch to Performance and back, because the shell holds it and the
shell does not unmount. It is **never disabled**: it used to be, while a conversion was in flight,
which cannot work from out here, since the control has to stay usable while the view it converts is
not in the document at all. And the race that disabling prevented — two overlapping reads resolving
out of order — is handled instead of avoided, by a request sequence in the dashboard: a superseded
read still reports its gateway reading, because that observation is true whatever the owner has
since selected, and then drops its figures. Everything DDR-0035 gave the control is unchanged: it
is still a `Field` + `Select` pair generating its own id with `useId()`, and it stacks by a
placement class rather than by a new variant.

**The column stops scrolling; the list scrolls.** `.app-sidebar` becomes `overflow: hidden` and
`.app-sidebar-tabs` takes `flex: 1; min-height: 0; overflow-y: auto`. The rail states what the app
is and the footer holds a control — neither may scroll out of sight to make room for a sixth view.
`min-height: 0` is the load-bearing half, for the same reason `min-width: 0` was on the content
column in [[0055-vertical-sidebar-tablist]]: a flex item's default minimum is its content, so
without it the list refuses to shrink and pushes the footer off the bottom instead.

## Consequences

Benefits:

- The owner can see whether the gateway is answering from any of the five views, and the answer is
  one the app actually has rather than a decoration.
- The three-outcome distinction [[0022-gateway-timeout-and-not-responding-state]] fought
  for survives one layer further out. "Not running" and "Stalled" send the owner to different fixes.
- The display currency stops resetting to EUR on every visit to the Portfolio tab.
- `lib/contrast.ts` learns to measure a graphic, which it had no entry for. Every mark added later
  has a threshold to be held to.

Tradeoffs:

- **The Tab order gains a stop.** `e2e/tab-navigation.spec.ts` asserted that Tab from the selected
  tab lands on the panel; the sidebar now has a control below the list, so the next stop is that
  control and the panel is the one after. DOM order, visual order and tab order still agree, and
  what the test was really pinning — that Tab does not walk the other four tabs — is unchanged and
  still asserted. The alternative was to put the footer *before* the tablist in the DOM and reorder
  it visually with flex `order`, which buys the old sequence by making the reading order disagree
  with the screen. Rejected.
- **The badge can be five minutes behind.** That is the cost of not polling, and it is paid in
  words: after five minutes it says when it looked rather than what it saw. A reading is never
  silently kept alive.
- **The app's name now appears twice**, in the title bar and beside the brand mark. Removing the
  title bar's copy interacts with the banner landmark decision (#163) and is settled in the
  sidebar-collapse story, so it stands for now.
- The Portfolio dashboard gained two props and became a reporter as well as a reader. It is the
  only component that can observe the gateway, so the reporting has to start there.

Risks:

- The badge is only as fresh as the owner's last visit to the Portfolio tab. Someone who launches,
  goes straight to Dividends and stays there sees `Not checked yet` — correct, and quieter than a
  green dot would have been, but it does mean the rail is uninformative in that one path.
- `--gateway-mark` / `--gateway-ink` are local custom properties, which `designTokens.test.ts` does
  not scan. A second component copying the pattern without measuring its tints is the gap; the
  three pairings in `lib/contrast.ts` cover this one.

## Alternatives Considered

### Poll the gateway on a timer

Rejected, and ruled out by the story before it was written. It contradicts
[[0022-gateway-timeout-and-not-responding-state]] (one bounded attempt, never a loop)
and would be answered from `gatewayCache` most of the time anyway
([[0024-gateway-read-coalescing-and-freshness-window]]), so it would burn a 15-second deadline on a schedule
to learn what the last real read already knew.

### A dedicated `portfolio:getStatus` channel

Rejected. It is a second caller of the gateway for a fact the first caller already produces, and it
would still need a trigger — which is either a poll (above) or the view mounting, which is what
this decision uses directly. Epic #179 also holds this milestone to presentation-only changes.

### A module store, in the shape of `lib/dataVersion`

Rejected. That store exists because its writers (the Flex import panel) and its readers (four views
mounted in four different branches of the tree) have no useful common ancestor. Here they do — the
shell renders both the sidebar and the dashboard — and a store would add a module-level singleton
to be reset between tests for no reach that props do not already have.

### Show the account number, by adding it to the overview

Rejected here, not on the merits. It is a small, sensible field to surface, and it is exactly the
"new figure" Epic #179 says must open its own story rather than arrive inside a restyle. Deciding
it inside a sidebar story would settle a contract question in the wrong place.

### Keep the currency control in the Portfolio header and put only a read-out in the sidebar

Rejected. Two places showing one setting, one of which cannot change it, is worse than either
alone — and the selection would still reset on every visit, because the control that owns it still
unmounts.

### Disable the currency control while a conversion is in flight, as before

Rejected. From the sidebar the control must work while the Portfolio tab is not mounted, so
"in flight" is not always a state it can observe. Sequencing the reads is both stricter (it also
covers a read superseded by a *later* one that finished first) and invisible.

### Give the badge `role="status"`

Rejected. Its detail quotes a clock time, so every return to the Portfolio tab would announce
"IBKR Gateway Live 14:35" — a re-read, not a change of state. The Portfolio view already announces
the states that matter, with the sentence explaining each and the Retry beside it.

## References

- [[0055-vertical-sidebar-tablist]] — the column this fills, and the tablist it must not disturb
- [[0022-gateway-timeout-and-not-responding-state]] — three outcomes, one bounded attempt
- [[0024-gateway-read-coalescing-and-freshness-window]] — the cache a poll would be answered from
- [[0027-analytics-views-persist-and-explicit-refresh]] — why the Portfolio tab unmounts, and why
  a control living inside it cannot hold a selection
- [[0007-portfolio-display-currency-and-live-fx]] — the conversion this control drives, unchanged
- [[0035-field-and-form-control-primitives]] — `Field` owns the id; the control moved without it
- [[0046-contrast-split-tone-tokens]] — the fill/text split the dot and its detail line straddle
- [[0048-tab-icons-as-a-second-channel]] — the icon rules the brand glyph follows
- [[0031-design-token-scales]], [[0042-token-adoption-ratchet]] — the scales the rail is built from
- GitHub Issues #179 (Epic), #183 (Story)
