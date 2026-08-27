# `src/repositories`

The **data-access layer**. Repositories own all reads/writes to data sources
(SQLite via Drizzle, the Interactive Brokers local Gateway / MCP, future external
providers) and expose domain-oriented methods. Services depend on repositories;
services must never know where data originates.

Current repositories, by data source:

- **SQLite** (Drizzle) — `meta/`, `snapshots/`, `flex/` (a write-only `flexRepository`
  and a read-only `flexReadRepository` over the same immutable `flex_*` tables).
- **IBKR Gateway** — `portfolio/portfolioRepository.ts` over `portfolio/ibkrGateway.ts`,
  which validates every response with Zod at ingress. Its reads are coalesced and briefly
  reusable via `portfolio/gatewayCache.ts`, so one overview costs one auth check, one
  account-id resolution, and one read of each figure (DDR-0024). That freshness policy stops
  at this layer — services and the renderer stay unaware of it.
- **Both** — `classification/`, which fronts the `instrument_classifications` cache and
  falls back to the gateway.
- **OpenAI** — `assistant/aiGateway.ts`, the app's only outbound call to a service the owner does
  not run (Epic #5, ADR-0010, DDR-0096). It inherits the IBKR gateway's discipline — Zod at
  ingress, a whole-request deadline, **one attempt and never a retry loop** — and differs in three
  ways: it is plain HTTPS rather than the `openai` SDK, it **returns a result union rather than
  throwing** (one operation, every outcome already a named state), and it bounds what may be
  **sent** as well as what may be waited for. The key is read from `process.env` here and nowhere
  else.

Helpers that touch no data source (`flex/flexStatementParser.ts`, `flex/fifoSummary.ts`,
`snapshots/snapshotMapping.ts`, `portfolio/gatewayCache.ts`) live in their own modules so
services and unit tests can import them without pulling in SQLite or the gateway.

Dependency direction (downward only, see `CLAUDE.md`):

```
renderer → IPC → main → services → repositories → SQLite / IBKR Gateway
```
