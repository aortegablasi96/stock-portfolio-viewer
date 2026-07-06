# 0003. Snapshot persistence model, money representation, and capture policy

- **Status:** Accepted
- **Date:** 2026-07-06

## Context

Milestone M2 (Epic #3) gives the app a memory: an append-only, immutable, timestamped
history of the portfolio, captured on app open and on demand, read back for history and
(later, M3) analytics. Three cross-cutting decisions shape every M2 story and outlive it,
so they are recorded here rather than being re-litigated per story:

1. **How monetary values are stored.** The M1 in-memory domain (`@shared/domain/portfolio`)
   uses JS `number` (float) for money — fine for a live, transient view. Persisted history
   is different: it is summed for analytics and must not accumulate float drift, and
   `docs/database.md` already sets the convention "integer minor units (or text) plus an
   explicit currency code; avoid floating point for money."
2. **The snapshot table shape.** How normalized, and what a snapshot stores.
3. **When a snapshot is captured**, and how launch spam is avoided.

## Decision

### Money as integer minor units
Persisted monetary amounts (`total_market_value`, `net_liquidation`, `total_cash`,
`average_cost`, `market_price`, `market_value`) are stored as **integer minor units**
(cents, scale 2) alongside the raw `currency`/`base_currency` text. Share **quantity** is
stored as `real` — it is a share count, not money, and may be fractional. Conversion
float⇄minor-units happens only in the **repository** layer; services and the renderer
continue to work in decimal `number`s via the existing domain types.

### Header + detail, append-only
Two new tables (see the M2 Database Review):

- `snapshots` — one immutable row per capture: `captured_at` (epoch ms, UTC), `source`,
  `base_currency`, the three rolled-up totals (minor units), `holdings_count`, `created_at`.
- `snapshot_holdings` — per-holding detail, FK → `snapshots(id)` `ON DELETE CASCADE`.

Immutability is enforced **structurally**: `snapshotRepository` exposes only `append()` and
read methods — there is no update or delete path. A snapshot and its holdings are inserted
in a **single transaction** (all-or-nothing). `foreign_keys` is already `ON` in `client.ts`.

### Capture policy
- **On app open**, the **main process** (after `runMigrations()`) calls
  `snapshotService.captureOnOpen()`, which fetches via `portfolioService.getOverview()` and
  persists — but **only if no snapshot exists within the last 12 hours**.
- If `getOverview()` throws `IbkrNotConnectedError`, capture is **skipped silently** (no
  empty/error snapshot), consistent with [[0002-connection-state-as-ipc-result]].
- **Manual "Capture now"** (renderer → IPC → service) **always** writes, bypassing the
  12-hour rule — explicit user intent is absolute.

Capture is triggered in the main process, so it never depends on a renderer window and the
renderer is only ever a *trigger*, never the source of persisted data.

## Consequences

Benefits:

- Exact, driftless money aggregation via integer `SUM`; float rounding cannot corrupt
  history.
- History cannot be mutated in place — the immutability guarantee is a property of the
  repository's surface, not a convention.
- One predictable capture rule; launches don't spam the history, manual capture stays under
  the owner's control.

Tradeoffs:

- A float⇄minor-units mapping lives in the repository (small, localized, tested).
- Storing rolled-up totals on the header denormalizes data derivable from the detail rows —
  accepted deliberately so the history list and M3 analytics read totals without re-summing.

Risks:

- **Scale-2 assumption.** IBKR's `'BASE'` pseudo-currency or a 0-decimal currency (e.g. JPY)
  would mis-scale. The common case (USD, 2 dp) is exact; revisit if a non-2dp currency
  appears. The raw currency is stored so a later migration could re-scale.

## Alternatives Considered

### Money as decimal text
Rejected: preserves exactness without a scale assumption, but blocks SQL `SUM`/ordering and
pushes all aggregation into application code. Integer minor units keeps totals queryable.

### Money as float (`real`)
Rejected: contradicts `docs/database.md` and risks accumulated rounding error in summed
analytics over many snapshots.

### Single denormalized JSON-blob snapshot
Rejected: storing the whole overview as JSON text is simplest, but makes per-holding
analytics (M3 allocation drift) unqueryable without parsing every row. The header+detail
split keeps holdings first-class.

### Capture triggered by the renderer
Rejected: would make the renderer the source of persisted data and tie capture to a window
being open. Main-process capture-on-open is cleaner and matches "captured on app open."

## References

- Product Review, Architecture Review, Database Review — M2 (this session)
- ADR-0004 (IBKR integration), `docs/database.md`
- [[0002-connection-state-as-ipc-result]]
- GitHub Epic #3; Stories #17, #18, #19
- `src/db/schema.ts`, `src/repositories/snapshots/`, `src/services/snapshots/`
