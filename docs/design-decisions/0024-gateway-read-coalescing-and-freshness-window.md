# 0024. Gateway reads: coalesced in the repository, reusable for a short freshness window

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

Loading the Portfolio dashboard cost far more gateway round trips than the data required.

`portfolioRepository.getHoldings()` and `getBalances()` each began by calling
`ibkrGateway.ensureAuthenticated()` and `getAccountId()`, and `portfolioService.getOverview()`
runs the two in `Promise.all` — so **one** overview made **four** auth/account requests to
fetch **two** pieces of data. `getExchangeRates()` then issued one request **per distinct
currency, sequentially**; the owner's account trades in six (CAD, CHF, EUR, GBP, JPY, USD).
That is roughly 9–11 serial HTTPS round trips per load.

Every one of them was paid again on each display-currency switch, even though a switch exists
only to *re-convert* positions and a ledger that have not changed. And because the app captures
a snapshot on open, startup ran two full overview assemblies at once — doubling the whole count
against a gateway that is a single local session (DDR-0009).

Nothing was reused between calls, not even within a single overview assembly. With every
request now bounded by a 15s deadline (DDR-0022), a slow gateway multiplies that redundancy
into visible sluggishness rather than absorbing it.

## Decision

**Every gateway read in `portfolioRepository` goes through `gatewayCache`** — a small
freshness-bounded memo that lives in the repository layer and nowhere else. It does two
distinct things, and both matter.

### In-flight de-duplication

Concurrent callers share one promise. The parallel `getHoldings()` / `getBalances()` pair
therefore makes **one** auth check and **one** account-id resolution, and the on-open capture
racing the dashboard's own load collapses into a single positions read and a single ledger
read instead of two of each.

### A short, explicit freshness window

A settled read stays reusable for a TTL, so a currency switch reuses what was fetched moments
earlier. Two windows, because the two kinds of data age at completely different rates:

- **`SESSION_TTL_MS` (5 minutes)** — the auth check and the resolved account id. Long, because
  neither changes during normal use, and a stale answer is *self-correcting*: an expired
  session makes the next data request return 401/403, which the transport already maps to
  `IbkrNotConnectedError`.
- **`LIVE_TTL_MS` (30 seconds)** — positions, the ledger, and FX rates. Short, because these
  move with the market. It is long enough to cover a currency switch and the startup
  capture/load pair, and short enough that any deliberate revisit re-reads the gateway. The
  dashboard does not poll, so what is on screen is already at least this old between
  interactions — the window makes an existing property explicit rather than introducing
  staleness that was not there.

The window is measured from when the value **arrived**, not when the request went out, so a
slow response is not already half-stale by the time it lands.

### A failure is never cached, and a suspect session drops everything

A rejected read is evicted immediately, so the next caller may try again. Beyond that, an
`IbkrNotConnectedError` **or** an `IbkrTimeoutError` drops **every** entry, not just its own:
when the gateway stops answering, a memoized "authenticated: true" is precisely the entry most
likely to be wrong — DDR-0022 identifies a half-expired session as the usual cause of a stall.
Reconnecting therefore works without restarting the app, and the Retry button in the
`not_connected` / `not_responding` panels always reaches the gateway.

### FX rates are fetched concurrently

`getExchangeRates()` now issues every pair at once instead of awaiting them in a loop. This
still honours DDR-0022's "never wait `timeout × currencies`" rule — and honours it better.
The sequential version stopped at the first timeout, which bounded the wait but also *skipped*
every currency after it. With all requests already in flight, a stalled gateway costs one
timeout in total **and** the pairs that did answer keep their rates. The fan-out is bounded by
the currencies actually held, so this is a handful of requests, not a retry storm.

Everything else is unchanged. A currency whose rate is unavailable — refused, bogus, or timed
out — is still omitted, and its positions still render unconverted rather than zeroed
(DDR-0007). `IbkrNotConnectedError` still propagates and degrades the whole view.

### The cache is invisible above the repository

Services and the renderer are untouched and gain no cache-control parameter. Where data comes
from, and how recently, is a repository concern (ADR-0004's whole premise); a `forceRefresh`
flag threaded through `portfolioService` would make every caller responsible for a decision the
repository is better placed to make. The repository also keeps mapping cached DTOs into freshly
built domain objects, so no caller can mutate another's data through a shared entry.

## Consequences

Benefits:

- One overview costs one auth check, one account-id resolution, one positions read, one ledger
  read, and one concurrent burst of FX requests — down from 9–11 serial round trips.
- A display-currency switch normally costs nothing at the gateway at all.
- Startup's capture-and-load pair stops doubling the work against a single local session.
- A partially stalled gateway now yields *more* data than before, not less.
- The freshness policy is one small, pure, unit-tested module rather than ad-hoc `if` branches
  spread across repository methods.

Tradeoffs:

- Figures can be up to 30s old on a reused read, including one taken by an on-demand "Capture
  now". For an app that does not poll, and for a store of daily history, that is inside the
  noise.
- Two TTL constants are two things to reason about. Collapsing them to one would mean either
  re-checking auth far more often than it can change, or trusting market values far longer
  than they hold.

Risks:

- A future gateway-reaching read that skips `gatewayCache` silently reintroduces the redundancy.
  Mitigated by the cache being the repository's only path to `ibkrGateway` for portfolio data,
  and by the call-count assertions in `portfolioRepository.test.ts`.
- `classificationRepository` still calls `ibkrGateway.ensureAuthenticated()` directly. Left
  alone deliberately: its "fail once up front, before a long sequential loop" check is a
  different intent (DDR-0009), and folding it in was out of scope for #106.

## Alternatives Considered

### Request coalescing only, with no freshness window

Dedupe concurrent in-flight reads but never reuse a settled one. Rejected: it fixes the
four-auth-calls-per-overview defect but not the currency switch, which is the half the owner
actually feels — a switch is a *sequential* second load, so nothing would be in flight to share.

### A `forceRefresh` / `maxAge` parameter through the service

Rejected: it pushes a data-source concern up through `portfolioService` into the renderer,
which contradicts ADR-0004 and the story's own constraint that services and the renderer stay
unaware of where data comes from. Every call site would then have to make a decision it has no
information to make.

### Cache holdings and balances as domain models rather than raw DTOs

Rejected: a shared, already-mapped array hands every caller the same mutable objects. Caching
the raw DTOs and re-mapping per call is a negligible cost and removes the hazard entirely.

### Persist the live overview to SQLite

Rejected, and explicitly out of scope for #106: the Portfolio view is live-only by design, and
analytics read imported Flex history. A durable cache would blur two stores that CLAUDE.md
keeps deliberately separate.

### Keep FX rates sequential and rely on `break`

Rejected: the `break` bounded the wall-clock wait but discarded every currency after the stall.
Concurrency achieves the same bound and keeps the answers.

## References

- GitHub Issue #106 (Epic #102 — Gateway & data reliability)
- ADR-0004 (IBKR gateway as the live source; the repository fronts it)
- [[0007-portfolio-display-currency-and-live-fx]] — live FX; an unavailable rate is omitted,
  never zeroed. Its "fallback if it ever feels slow" note anticipated this story.
- [[0022-gateway-timeout-and-not-responding-state]] — the bounded request, and the
  `timeout × currencies` rule this re-satisfies by other means
- [[0009-sector-classification-cache-and-allocation-donuts]] — the single local gateway session
- `src/repositories/portfolio/gatewayCache.ts`, `src/repositories/portfolio/portfolioRepository.ts`
