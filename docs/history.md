# History

A running log of notable changes, decisions, and milestones for Stock Portfolio Viewer. Newest
entries first. This is a human-readable narrative, not a replacement for git history,
ADRs, or DDRs.

## 2026-06-25

- **Pivoted the project direction from a hosted web/SaaS app to a standalone, single-user
  desktop application.** Rationale: this is a private personal tool that is not shared, the
  IBKR Client Portal Gateway already runs locally (`localhost:5000`), and keeping financial
  data on the owner's machine avoids hosting, auth, and multi-tenancy entirely. Reworked the
  full documentation set to match — **stack changed** from Next.js (App Router) + PostgreSQL
  to **Electron + React/Vite + TypeScript + SQLite** (Drizzle retained), and the layering
  changed from `src/app → services → repositories → Postgres/IBKR` to
  `renderer → IPC → main → services → repositories → SQLite/IBKR Gateway`. Snapshots are now
  captured on app open / on demand (background scheduler is a future option). Updated
  `CLAUDE.md`, `docs/product.md`, `docs/roadmap.md`, `docs/architecture.md`, and
  `docs/database.md`. No ADR was written (foundational stage, per owner's instruction).
- Reconciled the `.claude/skills/` library to the desktop direction: `api-builder` rewritten
  from "thin Next.js HTTP routes" to **Electron IPC handlers**; PostgreSQL → **SQLite**
  references updated across `database-designer`, `repository-builder`, `service-builder`,
  `storage-builder`, and `feature-implementer`; `storage-builder` reframed from cloud object
  storage to **local file storage**; and **multi-tenant SaaS assumptions removed**
  (tenant isolation, authenticated `userId`, sessions) across `repository-builder`,
  `database-designer`, `assistant-builder`, `testing`, `architect`, `adr-writer`, and
  `product-manager` — replaced with single-user, domain-scoped (`accountId`) guidance.
- Added `.mcp.json` defining the `interactive-brokers` MCP server (with placeholder
  `command`/`args` to be replaced with the real runtime). The server is not yet listed in
  `enabledMcpjsonServers` in `.claude/settings.local.json`, so reconciliation is still in
  progress. Note: IBKR tools are already reachable via the Claude-managed
  `Interactive_Brokers_IBKR` connector permissions.
- Created the core documentation set under `docs/` (`product.md`, `roadmap.md`,
  `architecture.md`, `database.md`, `history.md`) and the `docs/decisions/` and
  `docs/design-decisions/` directories, matching the documentation hierarchy in
  `CLAUDE.md`.
- Project remains greenfield: only `CLAUDE.md`, the `.claude/skills/` library, and config
  exist. No application source yet.
- Adopted **Stock Portfolio Viewer** as the project name and applied it everywhere
  (`CLAUDE.md`, `docs/`, `.claude/skills/`). Aligned the skills library to the portfolio
  domain — naming plus example concepts (investors, holdings, snapshots).

## Open Items

- Finish reconciling the `interactive-brokers` MCP server: replace the placeholder
  `command`/`args` in `.mcp.json` with the real runtime and add it to
  `enabledMcpjsonServers` in `.claude/settings.local.json` — or decide whether the
  Claude-managed IBKR connector makes the local `.mcp.json` server unnecessary.
- Scaffold the Electron / React / Vite / TypeScript / SQLite / Drizzle desktop project
  (see M0 in `docs/roadmap.md`).
