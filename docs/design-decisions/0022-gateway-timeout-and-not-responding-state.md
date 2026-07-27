# 0022. Bound every gateway request, and give a stalled gateway its own renderer state

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Every request to the Interactive Brokers Client Portal Gateway went out with no time bound.
`rawGet` mapped `ECONNREFUSED` / `ENOTFOUND` to `IbkrNotConnectedError`, but those codes only
fire when the connection is **refused outright**. The gateway's more common failure — accepting
the TCP connection and then going quiet, typically on a half-expired session — emitted nothing
at all. The promise never settled, so the dashboard sat on "Loading your portfolio…"
indefinitely, with no Retry and no way out but restarting the app.

That left the renderer with a state DDR-0002 never anticipated: not `ok`, not `not_connected`,
not `error`, but *pending forever*. And when it does resolve, "the gateway isn't running" and
"the gateway is running but silent" call for different actions from the owner — start the
gateway, versus re-authenticate the session it already has.

## Decision

**Every gateway request carries a whole-request deadline** (`IBKR_GATEWAY_TIMEOUT_MS`, default
15s), defined once in `ibkrGateway` so no endpoint can be added without it. Exceeding it
destroys the request and rejects with a new typed `IbkrTimeoutError`.

It is a deadline over the *whole exchange* — connect, headers, and body — not Node's
`request.setTimeout`, which measures **socket inactivity** and is reset by every byte: a
gateway dribbling a response out forever would never trip it. The env override exists so the
bound is testable and retunable; a missing or nonsensical value falls back to the default, so
the bound can be changed but never disabled.

**A stall is its own IPC result variant, `not_responding`**, alongside `not_connected` —
extending the DDR-0002 pattern rather than overloading it. It is added to
`portfolio:getOverview`, `snapshot:capture`, and `analytics:classifyInstruments`: the three
channels that reach IBKR. `IbkrTimeoutError` is deliberately **not** a subclass of
`IbkrNotConnectedError`, so no `instanceof` check silently absorbs it into the wrong state.
The renderer gives it a panel of its own — different heading, the re-authenticate hint, and a
Retry button, because a bounded request that gave up is precisely the case worth retrying.

Three consequences follow from "one bounded attempt, never a retry loop":

- **A timed-out FX rate is a missing rate, not an error.** It joins the DDR-0007 bucket: the
  position renders unconverted (`displayValue === null`) and is excluded from totals, rather
  than being multiplied by a fabricated number or zeroing a figure.
- **The first timeout stops the loop.** `getExchangeRates` and the sequential classification
  refresh both iterate over the gateway. A stalled gateway would time out on *every* remaining
  item, so the view would wait `timeout × n`. Both stop at the first timeout and report what
  they gathered — the opposite of a retry: give up sooner, not later.
- **`ETIMEDOUT` moves to `not_responding`.** The OS giving up on the connect means the host is
  there and silent, which is the same story the owner needs to hear.

Local SQLite reads are untouched: `better-sqlite3` is synchronous and local, with nothing to
time out.

## Consequences

Benefits:

- No renderer state can wait on the gateway forever; every request completes, fails, or times
  out into a recoverable state with Retry.
- The two recovery paths stay distinguishable end to end — typed error, IPC variant, and panel.
- A stall degrades proportionally: history stays visible, converted rows stay converted, and
  only the unresolved parts are flagged.
- The transport bound is testable against a real stalling server, not a mocked socket.

Tradeoffs:

- A genuinely slow-but-working gateway call could be cut off at 15s. Retry is one click, and an
  answer that slow is indistinguishable from a hang from the owner's side anyway.
- A fourth variant on three channels is more surface for the renderer to switch on — but an
  exhaustive union is what makes a missed state a type error rather than a blank panel.

Risks:

- Any future IBKR-reaching channel must map `IbkrTimeoutError` as well as
  `IbkrNotConnectedError`. Mitigated by the two sitting adjacent in every handler that maps them.

## Alternatives Considered

### Reuse `not_connected` with a different message

Rejected: the renderer would show "Not connected to Interactive Brokers" for a gateway that is
demonstrably connected, and the message is the only thing distinguishing them — invisible to
the type system, so nothing keeps them apart as the app grows.

### `IbkrTimeoutError extends IbkrNotConnectedError`

Rejected: convenient (existing `instanceof` checks keep working) and exactly the problem — every
call site that means "gateway isn't running" would silently swallow a stall.

### `request.setTimeout` / a socket-inactivity timeout

Rejected: the standard idiom, but it measures the wrong thing. A trickling response resets it
indefinitely, which is a stall the bound is supposed to catch.

### Retry with backoff

Rejected, and out of scope for #104: the gateway is a single local session (DDR-0009), so
hammering it adds load without changing the outcome. One bounded attempt plus a manual Retry
keeps the owner in control.

## References

- GitHub Issue #104 (Epic #102 — Gateway & data reliability)
- ADR-0004 (IBKR gateway as the live source; connection state as data)
- [[0002-connection-state-as-ipc-result]] — the variant pattern this extends
- [[0007-portfolio-display-currency-and-live-fx]] — unavailable FX rate excluded, never zeroed
- [[0009-sector-classification-cache-and-allocation-donuts]] — sequential lookups, single session
- `src/repositories/portfolio/ibkrGateway.ts`, `src/shared/errors.ts`
