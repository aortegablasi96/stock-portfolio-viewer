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
periods, answer questions) and, against the owner's own **investor profile**, judges balance
and may propose rebalancing — naming positions (ADR-0009).

Three architectural rules make that safe, and they replace the former analytics-only guardrail:

- **The model never produces a figure.** Every number is computed by a service, from
  repositories, exactly as the analytics views compute theirs; the model is given assembled
  reports and asked to phrase them. Context assembly is deterministic and unit-tested. The
  model has no tools and no data access — it reaches neither the database, the repositories,
  nor the IBKR gateway.
- **The app never acts.** No order placement, no broker write, no path to one.
- **The app never sets the policy.** It proposes moves toward the owner's targets; it never
  proposes the targets.

A proposal about a held position is grounded and carries its arithmetic. An instrument the
owner does not hold comes from the model's training data — unverified, not price-checked — and
must be marked apart from computed claims.

The provider is `gpt-4.1-mini` on the OpenAI API, reached from the **main process** through a
repository-layer gateway. **Supplying a key is the authorization** — with one present a question is
sent with nothing in front of it, and removing the key is what stops it; no consent is asked for,
stored or checked (ADR-0010, amended by ADR-0011). The renderer's CSP is unchanged and the renderer
never reaches it.

> Architecture Reviews (see the `architect` skill) produce the input to this document.
