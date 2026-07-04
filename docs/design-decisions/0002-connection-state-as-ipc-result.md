# 0002. Model connection/load outcome as a discriminated-union IPC result

- **Status:** Accepted
- **Date:** 2026-07-04

## Context

The M1 dashboard's data is produced by a service that reads from the Interactive Brokers
Client Portal Gateway (ADR-0004). Failures come in two flavours the UI must treat
differently:

- **Expected connectivity failures** — the gateway isn't running, or the session isn't
  authenticated. These are recoverable and the UI should prompt the owner to start / log
  into the gateway.
- **Unexpected failures** — malformed responses, bugs. These are generic errors.

And a third, non-failure case — an **empty** but connected account — must be
distinguishable from both.

IPC (`ipcRenderer.invoke`) can only *resolve* with a value or *reject* with an error.
Rejecting collapses the expected/unexpected distinction into one catch, loses the typed
error class across the process boundary (errors serialize poorly), and pushes the UI
toward a single generic "something went wrong" state.

## Decision

`portfolio:getOverview` returns a **serializable discriminated union** keyed on `status`:

```ts
| { status: 'ok'; overview: PortfolioOverview }
| { status: 'not_connected'; message: string }
| { status: 'error'; message: string }
```

- The **service** stays pure and throws typed errors (`IbkrNotConnectedError`, other
  `AppError`s) — it does not know about transport.
- The **thin IPC handler** catches those errors and maps them onto the union variants
  (see [[0001-dashboard-layout-and-load-states]] for how the renderer presents them).
- The **renderer** `switch`es on `status`; the empty case is derived from `ok` with an
  empty `holdings` array.

This is the project convention for any IPC channel that reaches an external source with
expected connectivity failures.

## Consequences

Benefits:

- Expected vs unexpected failure is preserved across IPC and is type-checked exhaustively
  in the renderer.
- Values stay plain and serializable — no class instances or `Error` objects cross IPC.
- The service remains transport-agnostic and easily unit-tested (ADR-0002 principle).

Tradeoffs:

- A little more shape than "resolve or throw" — but that shape is the recovery UX.

Risks:

- Every new external-source channel must remember to map its typed errors to the union;
  mitigated by this being a documented, repeated pattern.

## Alternatives Considered

### Throw / reject over IPC

Rejected: collapses expected and unexpected failures, loses the typed error class on
serialization, and offers the renderer no structured way to choose a recovery path.

### Nullable result + separate error field

Rejected: less type-safe than a discriminated union; permits invalid combinations
(e.g. both a value and an error) that the union makes unrepresentable.

### HTTP-style numeric status codes

Rejected: not idiomatic for local IPC and less self-describing than named variants.

## References

- Architecture Review — M1 Story A (`architect` skill)
- ADR-0002 (typed IPC contract), ADR-0004 (IBKR integration)
- [[0001-dashboard-layout-and-load-states]]
- `src/shared/ipc/contract.ts`; GitHub Issue #14
