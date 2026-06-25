# Roadmap

This file defines milestones for Stock Portfolio Viewer. The **current milestone** takes priority
over future roadmap items unless explicitly instructed otherwise.

## Current Milestone

**M0 — Project scaffolding**

The repository is greenfield. Before feature work begins, the foundation must exist.

- [ ] Scaffold Electron + React + Vite + TypeScript project
- [ ] Configure SQLite + Drizzle ORM
- [ ] Establish `src/renderer`, `src/main`, `src/services`, `src/repositories` layering
      with thin IPC handlers between renderer and main
- [ ] Wire up Vitest and Playwright (Electron E2E)
- [~] Add `.mcp.json` (including `interactive-brokers`) and reconcile enabled MCP servers
      — `.mcp.json` added with placeholder runtime; not yet in `enabledMcpjsonServers`
- [x] Align the `.claude/skills/` library to the Stock Portfolio Viewer name and portfolio domain

## Upcoming Milestones

**M1 — Read-only portfolio dashboard**

- [ ] Connect to Interactive Brokers MCP via a repository
- [ ] Display current holdings
- [ ] Display account balances and basic allocation

**M2 — Historical snapshots**

- [ ] Append-only, immutable, timestamped snapshot storage in SQLite
- [ ] Capture-on-open and manual snapshot capture (background scheduler is a later option)
- [ ] Analytics driven primarily from stored snapshots

**M3 — Performance & allocation analytics**

- [ ] Performance over time
- [ ] Allocation analysis
- [ ] Dividend tracking

## Future (Unscheduled)

- AI-assisted portfolio analysis
- Multi-broker support
- Benchmark comparison
- Tax reporting

> Milestones are refined through the planning workflow. When a milestone changes scope,
> update this file and record the rationale (ADR/DDR) where appropriate.
