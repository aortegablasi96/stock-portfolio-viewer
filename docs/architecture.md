# Architecture

This document expands on the architecture rules in `CLAUDE.md`. Where this file and an
accepted decision in `docs/decisions/` conflict, the decision wins.

## Layering

Stock Portfolio Viewer is an **Electron desktop application**. The React UI runs in the
**renderer** process; all business logic and data access run in the **main** process (in
TypeScript). The two communicate over Electron **IPC** — the renderer never touches data
sources directly.

Dependencies point **downward only**.

```text
src/renderer   (React UI)
        ↓ IPC
src/main       (Electron main: IPC handlers)
        ↓
src/services
        ↓
src/repositories
        ↓
SQLite / Interactive Brokers Gateway
```

### Rules

- IPC handlers remain thin — validate input (Zod), delegate to services, return plain data.
- Services contain business logic.
- Repositories own data access.
- The renderer never accesses repositories or data sources directly.

## Layer Responsibilities

### Renderer (`src/renderer`)

- Rendering, navigation, forms.
- Calls the main process over a typed IPC bridge.
- Must not contain business logic or reach data sources directly.

### Main / IPC (`src/main`)

- Owns the Electron main process, window lifecycle, and the IPC surface.
- IPC handlers are thin adapters over services.

### Services (`src/services`)

- Analytics, calculations, orchestration, portfolio workflows.
- Independent of UI and infrastructure.
- Primary unit-test target.

### Repositories (`src/repositories`)

- SQLite, Interactive Brokers (local Gateway / MCP), persistence, external APIs.
- Expose domain-oriented methods.
- Services must never know where data originates.

## Repository Pattern

Repositories abstract data sources. A single repository may compose data from the local
SQLite database, the Interactive Brokers Gateway, and (in future) other external providers.

```text
PortfolioService
        ↓
PortfolioRepository
        ↓
IBKR Gateway + SQLite
```

This keeps analytics independent from any specific external provider.

## Historical Snapshots

- Interactive Brokers is the live source of truth.
- Snapshots are stored locally (SQLite) for analytics and are **append-only, immutable, and
  timestamped**.
- Snapshots are captured **on app open** and on demand; because the app only runs when
  launched, an unattended background scheduler (e.g. a Windows Task Scheduler job) is a
  possible future enhancement.
- Analytics should operate primarily from stored snapshots rather than repeatedly
  querying Interactive Brokers.

## Domains

Primary: `portfolio`, `holdings`, `snapshots`, `dividends`, `analytics`.

Future: `benchmarks`, `taxes`, `brokers`, `ai`.

Keep domains cohesive.

## AI Principles

AI enhances portfolio *understanding* (explain changes, summarize performance, compare
periods, answer questions). AI must never recommend investments, suggest trades, decide
allocations, or execute transactions.

> Architecture Reviews (see the `architect` skill) produce the input to this document.
