# 0004. Interactive Brokers integration: local Client Portal Gateway REST behind a repository

- **Status:** Accepted
- **Date:** 2026-07-04

## Context

Milestone M1 (Epic #2, Story #14) is the first feature that needs **live** portfolio data —
current positions and balances — from Interactive Brokers. Before writing that repository,
the project must fix *how the running app reaches IBKR at runtime*, because two very
different access paths exist and the choice has long-term architectural consequences (see
`CLAUDE.md` Repository Pattern, `docs/architecture.md`, `docs/mcp.md`).

The forces:

- The `interactive-brokers` entry in `.mcp.json` is an intentional **placeholder**
  (`REPLACE_WITH_RUNTIME`) and is **not functional** — no local IBKR MCP runtime has been
  finalized (ADR context recorded in `docs/mcp.md`).
- A separately connected, hosted `Interactive_Brokers_IBKR` MCP offers read-only account and
  market tools, but it is available only to the **Claude planning agent** during development.
  It is **not** available to the packaged Electron app, and depending on a cloud-hosted MCP at
  runtime would violate the app's local-first, private guarantee.
- IBKR ships a **Client Portal Gateway** — a locally run process exposing a REST API (default
  `https://localhost:5000`). The `.mcp.json` env already reserves `IBKR_GATEWAY_URL` and
  `IBKR_ACCOUNT_ID` for exactly this.
- The Repository Pattern requires that all data-source specifics stay confined to the
  repository layer, so services and the renderer never learn where data comes from.

## Decision

- **Runtime data path:** the app reaches Interactive Brokers via the **IBKR Client Portal
  Gateway local REST API** (default `https://localhost:5000`), run by the owner on their own
  machine. All data stays on-device.
- **Encapsulation:** access is confined to an `IbkrGateway` infrastructure client in the
  repository layer. A `PortfolioRepository` maps raw Gateway responses into domain models and
  exposes domain-oriented methods (`getHoldings()`, `getBalances()`). Services and the
  renderer never see IBKR-specific shapes — the existing ESLint boundary rules already forbid
  it.
- **Read-only:** only read endpoints (positions, balances, allocation) are used. No
  order/trade endpoints are called, consistent with the analytics-first, no-trading stance.
- **Boundary validation:** Gateway responses are validated with **Zod at ingress** — external
  data is untrusted, mirroring the boundary-validation principle of ADR-0002.
- **Configuration, not hardcoding:** the Gateway base URL and account id come from
  configuration (`IBKR_GATEWAY_URL`, `IBKR_ACCOUNT_ID`); the app does not hardcode them.
- **TLS:** the Gateway serves a self-signed certificate on localhost. Trust is handled
  **scoped to that host only** — never by globally disabling TLS verification in the process.
- **Placeholder MCP runtime deferred:** the local `interactive-brokers` MCP runtime is *not*
  adopted for runtime data access now. It remains a reserved future option; if it is ever
  finalized and adopted, a new ADR supersedes this one. The hosted `Interactive_Brokers_IBKR`
  MCP is explicitly a development/planning aid, not a runtime dependency.

## Consequences

### Benefits

- Works today: unblocks M1 without waiting on the unfinalized local MCP runtime.
- Matches IBKR's documented local integration and keeps the app local-first and private — the
  data path never leaves the owner's machine.
- Provider specifics are isolated in one place; the repository seam stays open to *compose*
  SQLite alongside IBKR in M2 (historical snapshots) without services noticing.
- Read-only by construction reinforces the no-trading guarantee.

### Tradeoffs

- Requires the owner to run **and authenticate** the Client Portal Gateway (browser login,
  plus periodic keep-alive / "tickle"; sessions expire). The app must present a clear
  "not connected / re-authenticate" state rather than assuming a live session.
- REST payloads are IBKR-specific and versioned; the mapping/validation layer must absorb
  provider changes.

### Risks

- **Session expiry / Gateway down** must surface as a handled connection state, not a crash —
  addressed by the discriminated connection-status result shape in the M1 Architecture Review
  (to be recorded as a DDR).
- **Self-signed TLS** handling must stay scoped to the Gateway host; a careless global
  override would weaken TLS for the whole process.
- **Multi-currency balances:** IBKR reports several currencies. M1 shows base-currency totals;
  FX normalization is deferred.

## Alternatives Considered

### Option A — Wait for a local IBKR MCP runtime

Finalize the placeholder `interactive-brokers` MCP runtime and have the app speak to it.
Rejected for M1: the runtime is unfinalized (`docs/mcp.md`) and would block delivery of the
first user-facing milestone. Retained as a possible future direction — adopting it would
supersede this ADR.

### Option B — Depend on the hosted `Interactive_Brokers_IBKR` MCP at runtime

Rejected: it is a Claude-hosted planning aid, not available to the packaged desktop app, and
routing portfolio data through a hosted service would break the local-first, private
guarantee.

### Option C — Direct TWS API (socket) instead of the Client Portal Gateway

Rejected as heavier and more stateful than needed. The REST Gateway is simpler for read-only
analytics and matches the configuration already reserved in `.mcp.json`.

## References

- Architecture Review — M1 Story A (`architect` skill)
- ADR-0002 (typed IPC contract — boundary validation), ADR-0003 (local persistence)
- `CLAUDE.md` — Repository Pattern, Historical Snapshots, Enabled MCP Servers
- `docs/architecture.md`, `docs/mcp.md`
- GitHub Issues #2 (Epic M1), #14 (Story)
