# 0005. Flex Query file import as an offline authoritative data source

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

Milestone M3 (Epic #4) delivers performance, allocation, dividend, and realized-gains
analytics. The data foundation those views need does not exist in the app today:

- The **live IBKR Client Portal Gateway** ([[0004-interactive-brokers-integration]]) returns
  only *current* positions and balances. It has no realized P&L, no dividend/cash-transaction
  history, no trade log, and no time-weighted return.
- The app's own **snapshots** (M2, [[0003-snapshot-persistence-and-capture-policy]]) are
  point-in-time captures whose history only starts when the app was first run — they cannot
  reconstruct trades, dividends, or historical performance.

The owner has instead exported **IBKR Portfolio Analyst Flex Query** statements as XML files
(`docs/flex-queries/portfolio-analyst-2025.xml`, `…-2026.xml`). These are authoritative
account records that contain exactly what M3 needs: `ChangeInNAV` (TWR, deposits/withdrawals),
`OpenPosition` (cost basis, % of NAV, geography via `issuerCountryCode`), `Trade` / `Lot` /
`FIFOPerformanceSummaryUnderlying` (realized/unrealized P&L), `CashTransaction` (dividends,
withholding tax), and `SecurityInfo`.

This introduces a **third class of data source** — user-provided offline files — alongside the
live gateway and the local SQLite store. Because it establishes an ingestion pattern every M3
story inherits (and a new runtime dependency), the decision is recorded here rather than being
re-argued per story.

## Decision

- **Adopt Flex Query XML files as an offline, authoritative data source** for historical
  analytics, complementing (not replacing) the live gateway. The gateway remains the source of
  truth for *current* state; Flex statements are the source of truth for *history*.
- **Manual import only for M3.** The owner selects one or more `.xml` files via a native file
  dialog (`dialog.showOpenDialog`, main process). Automated fetching from IBKR's Flex **Web
  Service** (token + query id, network) is explicitly **out of scope** and left as a future
  enhancement — parallel to the deferred snapshot scheduler in `CLAUDE.md`.
- **Encapsulation via the repository layer.** A new `flex` domain confines all file/parse
  specifics to `repositories/flex`: a pure `flexStatementParser` (XML string → validated domain
  objects) plus a `flexRepository` that reads the file and persists. A `flexImportService` owns
  orchestration and the import/de-dupe policy. Services and the renderer never see XML or
  IBKR-specific shapes — the existing ESLint boundary rules already forbid it.
- **Zod at ingress.** Every parsed record is validated at the boundary before persistence,
  mirroring [[0004-interactive-brokers-integration]] and ADR-0002. A malformed or non–Flex-Query
  file is rejected as a first-class result variant with **no partial import**.
- **Outcome modelled as data, not exceptions.** The `flex:import` IPC result is a discriminated
  union (`imported` / `canceled` / `invalid` / `error`), consistent with
  [[0002-connection-state-as-ipc-result]]. Nothing throws across IPC.
- **New dependency: `fast-xml-parser`.** Flex statements are non-trivial XML; hand-rolled
  parsing would be fragile. `fast-xml-parser` is small, dependency-light, and reused by every
  M3 story, satisfying the "clear long-term value" bar in `CLAUDE.md` for adding a dependency.
- **Read-only, local, private.** Import runs entirely on the owner's machine; no file content
  leaves the device. Imported records are append-only and immutable (persistence detail in the
  companion DDR).

## Consequences

### Benefits

- Unblocks all four M3 view stories with authoritative history the gateway and snapshots cannot
  provide.
- The repository seam already established for IBKR and SQLite extends cleanly to a file source;
  services stay ignorant of provenance, so analytics remain source-independent.
- Keeps the app local-first and private — the historical data path is entirely offline.

### Tradeoffs

- The owner must periodically export and import Flex statements by hand until an automated Flex
  Web Service path is built.
- A parsing/validation layer must absorb Flex schema variation across statement configurations
  (e.g. optional sections, presence/absence of `tradeID`).
- One additional runtime dependency to maintain.

### Risks

- **Flex Query configuration drift.** A differently configured Portfolio Analyst query may omit
  fields the views expect. Mitigated by Zod-at-ingress and clear rejection of statements that do
  not parse.
- **Data reconciliation.** Imported historical positions and the live gateway's current
  positions can disagree at the edges (timing, corporate actions). M3 keeps the two sources in
  separate views; a reconciliation view is a future enhancement.

## Alternatives Considered

### Option A — Automated IBKR Flex Web Service fetch

Have the app pull statements directly using a Flex token + query id. Rejected for M3: adds
credential handling, network error states, and configuration that materially enlarge the first
milestone, with no user value beyond what manual import already delivers. Retained as the
natural future enhancement; adopting it would extend, not supersede, this ADR.

### Option B — Derive history from the live gateway and snapshots only

Rejected: neither source contains realized P&L, dividends, trade history, or TWR. It is not
possible to reconstruct the required analytics from current-state data plus sparse snapshots.

### Option C — Store raw XML blobs and parse on read

Rejected: pushes parsing into every analytics query, prevents indexed SQL reads, and leaks the
Flex format past the repository seam. Parsing once at import into typed, queryable tables keeps
the boundary clean (companion DDR).

## References

- Architecture Review — M3 Story #20 (`architect` skill, this session)
- [[0002-connection-state-as-ipc-result]], [[0003-snapshot-persistence-and-capture-policy]],
  ADR-0002 (typed IPC contract), [[0004-interactive-brokers-integration]]
- Companion DDR-0004 (Flex import persistence and de-dupe)
- `CLAUDE.md` — Repository Pattern, Historical Snapshots, Stack (dependency policy)
- `docs/flex-queries/` — sample Portfolio Analyst statements
- GitHub Issues #4 (Epic M3), #20 (Story)
