# `src/repositories`

The **data-access layer**. Repositories own all reads/writes to data sources
(SQLite via Drizzle, the Interactive Brokers local Gateway / MCP, future external
providers) and expose domain-oriented methods. Services depend on repositories;
services must never know where data originates.

Current repositories, by data source:

- **SQLite** (Drizzle) — `meta/`, `snapshots/`, `flex/` (a write-only `flexRepository`
  and a read-only `flexReadRepository` over the same immutable `flex_*` tables).
- **IBKR Gateway** — `portfolio/portfolioRepository.ts` over `portfolio/ibkrGateway.ts`,
  which validates every response with Zod at ingress.
- **Both** — `classification/`, which fronts the `instrument_classifications` cache and
  falls back to the gateway.

Helpers that touch no data source (`flex/flexStatementParser.ts`, `flex/fifoSummary.ts`,
`snapshots/snapshotMapping.ts`) live in their own modules so services and unit tests can
import them without pulling in SQLite.

Dependency direction (downward only, see `CLAUDE.md`):

```
renderer → IPC → main → services → repositories → SQLite / IBKR Gateway
```
