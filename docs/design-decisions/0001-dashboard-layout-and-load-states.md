# 0001. Read-only dashboard layout and data-loading state pattern

- **Status:** Accepted
- **Date:** 2026-07-04

## Context

Milestone M1 introduces the first real screen — the read-only portfolio dashboard —
and with it the first genuine asynchronous data view. Its data is fetched over IPC from
an external source (the Interactive Brokers Client Portal Gateway, ADR-0004) that is
frequently *not* available: the gateway may be stopped, or the session may have expired.
The screen therefore needs both a layout and a repeatable way to present load outcomes.
Because later milestones (snapshots, analytics) will add more such screens, these choices
should become reusable conventions rather than one-offs.

## Decision

**Layout.** A single-screen dashboard with shallow navigation, centered in a
`max-width` column:

1. Header — title and a "Live from Interactive Brokers" source note.
2. Balances row — three stat tiles (net liquidation, cash, holdings value).
3. A two-column region — the holdings table (main) and the allocation panel (side) —
   that collapses to a single column under ~720px. Balances and tiles also wrap.

**Load-state pattern.** Every data view renders exactly one of four exclusive states,
derived from the IPC result (see [[0002-connection-state-as-ipc-result]]):

- `loading` — a neutral status panel.
- `ok` — the populated view. When the account has no positions, an informational
  "empty" panel is shown *in addition to* the balances (which may still be non-zero).
- `not_connected` — a recoverable panel explaining the gateway isn't connected, with a
  **Retry** action.
- `error` — an alert panel with the message and a **Retry** action.

**Design system.** Reuse the existing dark-theme CSS custom-property tokens
(`--card`, `--border`, `--accent`, `--muted`, …). No new styling system (no Tailwind,
no CSS-in-JS). The stat tile, state panel, and Retry button are now reusable patterns.

**Accessibility.** Semantic `<table>` with `<th scope>` and a caption; `role="status"`
/ `role="alert"` on state panels; `role="meter"` with aria values on allocation bars;
`:focus-visible` outlines on interactive controls; tabular-nums for numeric alignment.

## Consequences

Benefits:

- One predictable way to present loading/empty/not-connected/error across every future
  data screen; users always know whether a blank view means "loading", "nothing here",
  or "not connected".
- Recovery is inline (Retry) rather than hidden in dialogs or toasts.
- No new dependencies or styling systems; visual consistency with the existing shell.

Tradeoffs:

- The four-state scaffolding is slightly more code than a single spinner, but it is the
  whole point — it makes external-source failure a first-class, recoverable UX.

Risks:

- Very large holding counts are handled only by scrolling (virtualization deferred);
  revisit if performance suffers.

## Alternatives Considered

### Multi-tab / nested navigation

Rejected: over-structured for a single-user, single-purpose analytics app. The product
prefers fewer screens and shallow navigation.

### Spinner-only loading (no distinct not-connected vs error)

Rejected: it cannot tell the owner whether to *start the gateway*, *log in again*, or
*report a bug*. The not-connected vs error distinction is exactly what guides recovery.

### Error dialogs / toasts

Rejected: hidden and transient; a persistent inline panel with Retry is more discoverable
and recoverable.

## References

- UI Review — M1 Read-only Dashboard (`ui-designer` skill)
- Product Review — M1 (`product-manager` skill)
- [[0002-connection-state-as-ipc-result]], ADR-0004 (IBKR integration)
- `docs/product.md`; GitHub Issues #15, #16
