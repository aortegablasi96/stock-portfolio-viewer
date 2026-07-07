# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Repository State

**Milestones M0–M2 are merged.** Scaffolding (M0), the read-only portfolio dashboard
(M1), and historical snapshots (M2) are all built and on `main`. The app boots, connects
to the Interactive Brokers Client Portal Gateway, renders live holdings/balances/allocation,
captures immutable snapshots (on open + on demand), and shows snapshot history. The Stack
and Commands sections below are **live**. Still **not built**: dividends, performance
analytics over the snapshot series, and any AI features — those are later milestones (read
the GitHub backlog for the active one).

Two live domains exist end-to-end as reference patterns:

- **portfolio** — read-only overview from IBKR. `portfolioService` → `portfolioRepository`
  → `ibkrGateway` (HTTP + Zod against the local Client Portal Gateway). No SQLite; live only.
- **snapshots** — immutable local history. `snapshotService` (capture policy: 12h de-dupe
  on open, always-write on demand) → `snapshotRepository` → SQLite (`snapshots` /
  `snapshot_holdings`). Reads IBKR only *through* `portfolioService`.

> **Project name:** This project is **Stock Portfolio Viewer**, a **standalone,
> single-user desktop application** for personal stock portfolio analytics. It is
> **local-first and private** — it runs on the owner's machine, stores data locally, and
> is not hosted or shared. Treat the workflow *structure* of the `.claude/skills/` library
> as authoritative.

### As-built layout & reference slice

The current source tree (mirror it when adding features):

```text
src/
  main/          Electron main: entry (index.ts) + ipc/handlers.ts (thin, Zod-validated)
  preload/       contextBridge bridge → window.api (types + channel names only, no Zod)
  renderer/      React + Vite UI (src/renderer/src/*; components/ + lib/format.ts)
  services/      pure business logic — primary unit-test target (system/, meta/,
                 portfolio/, snapshots/)
  repositories/  the ONLY layer that touches a data source: SQLite (meta/, snapshots/)
                 or the IBKR gateway (portfolio/portfolioRepository.ts + ibkrGateway.ts)
  db/            client.ts (better-sqlite3 + Drizzle singleton), migrate.ts, schema.ts
  shared/        ipc/contract.ts (Zod schemas + inferred types), ipc/channels.ts,
                 domain/ (portfolio.ts, snapshot.ts), errors.ts (IbkrNotConnectedError)
drizzle/         generated SQL migrations + meta journal
e2e/             Playwright specs that launch the built Electron app
```

Canonical flows to copy when adding a feature:

- **Minimal slice / test pattern:** `app:ping` (`contract.ts` → `preload` → `handlers.ts`
  → `systemService`) and `metaService.getInstallId()` (service → `metaRepository` →
  `app_meta`) show the layering and the repository-mocking test style
  (`services/meta/metaService.test.ts`).
- **External data source:** `portfolio:getOverview` shows a repository fronting IBKR
  (`ibkrGateway` validates every response with Zod at ingress) and **connection state
  modelled as data** — the handler maps `IbkrNotConnectedError` to a `not_connected`
  result variant instead of throwing, so the renderer renders it as a first-class state
  (ADR-0004, DDR-0002).
- **Local persistence + policy:** the `snapshot:*` channels show a service owning a
  capture policy over an append-only, immutable table, plus a main→renderer event
  (`snapshot:captured`) pushed after an on-open capture (DDR-0003).

### Enforced boundaries & gotchas

- **Layer boundaries are ESLint-enforced** (`eslint.config.mjs`, via ADR-0002/0003), not
  just conventional. The **renderer** may not import `@services`/`@repositories`/`@db`/
  `@main`/`electron` — only `window.api`. **Services** may not import `@db` or `electron` —
  they go through a repository. Adding a feature the wrong way fails `npm run lint`.
- **Path aliases** (`@main`, `@renderer`, `@services`, `@repositories`, `@db`, `@shared`)
  are declared in **three** places that must stay in sync: `tsconfig.json`,
  `electron.vite.config.ts`, and `vitest.config.ts`.
- **`better-sqlite3` is a native module** rebuilt for Electron via the `postinstall`
  (`electron-rebuild`) hook. If it errors with a Node/Electron ABI mismatch, re-run
  `npm install` or `npx electron-rebuild -f -w better-sqlite3`.
- **Runtime DB vs. tooling DB**: the app opens the database at
  `app.getPath('userData')/portfolio.db`; drizzle-kit (`db:*` scripts) runs *outside*
  Electron against `./local.dev.db` (override with `DATABASE_URL`). Migrations are applied
  automatically on launch (`runMigrations()` in `main/index.ts`) and shipped under
  `extraResources` when packaged.
- **Electron security is locked down**: `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`. Keep it that way; reach the main process only over IPC.

## Skills System (`.claude/skills/`)

The artifact-driven workflow in this file is implemented as concrete skills in four tiers.
Each stage produces an artifact that becomes the input to the next; execution skills only
consume *approved* artifacts and must not redefine requirements, design, or architecture.

**workflow-skills** — planning, each produces a review artifact:
`product-manager` (Product Review) → `ui-designer` (UI Review) → `architect`
(Architecture Review) → `database-designer` (Database Review) → `implementation-engineer`
(Implementation Plan) → `testing` (Testing Report).

**execution-skills** — implement an approved Implementation Plan:
`feature-implementer` (vertical slices), `repository-builder`, `service-builder`,
`api-builder` (thin IPC handlers between renderer and main), `ui-builder`,
`storage-builder` (local file storage), `assistant-builder` (AI tools/orchestration).
The Implementation Engineer selects the minimum set of execution skills needed.

**governance-skills** — record/guard long-term decisions:
`adr-writer` (ADRs → `docs/decisions/`), `design-recorder` (DDRs → `docs/design-decisions/`),
`refactoring-reviewer` (Refactoring Review, required before significant restructuring).

**project-management** — the GitHub backlog (Epics, User Stories, Bugs only) is the
**source of milestones**, authored by the owner and **read before planning**, not written
after implementation: `issue-writer` helps the owner *draft* backlog issues that follow the
repo templates; `project-historian` (secondary) backfills the tracker with historical issues
from git history, ADRs, and DDRs for work that predates it. The `product-manager`
workflow skill reads these issues to begin planning. These skills track work; they never
design features, architecture, or implementation.

Small bug fixes may skip planning artifacts. Any change to an already-approved decision
must stop and return to the owning workflow skill rather than being made inline.

## Enabled MCP Servers

`.claude/settings.local.json` enables `context7`, `filesystem`, `playwright`, and
`interactive-brokers` (the `postgres` server has been retired following the move to SQLite).
Note that the `interactive-brokers` entry in `.mcp.json` still uses a **placeholder runtime**
(`REPLACE_WITH_RUNTIME`), so enabling it does not make it functional until the runtime is
finalized. Separately, a connected `Interactive_Brokers_IBKR` MCP is available with read-only
account/market tools allowlisted (positions, balances, price history, etc.) — no order-placing
tools are allowlisted, in keeping with the analytics-first, no-trading stance.

## Project Overview

Stock Portfolio Viewer is a personal, single-user desktop application for understanding and
analyzing investment portfolios.

Current capabilities:

* Portfolio dashboard
* Holdings visualization
* Historical portfolio snapshots
* Performance analytics
* Allocation analysis
* Dividend tracking

Future capabilities:

* AI-assisted portfolio analysis
* Multi-broker support
* Benchmark comparison
* Tax reporting

Out of scope:

* Investment recommendations
* Automated trading
* Order execution
* Robo-advisor functionality

The application is **analytics-first**, not advice-first.

---

# Stack

* Node ≥20
* npm
* Electron (desktop shell)
* React + Vite (renderer / UI)
* TypeScript (everywhere — renderer **and** main process)
* SQLite (embedded, local) via Drizzle ORM
* Zod
* Interactive Brokers (local Client Portal Gateway / MCP)
* Vitest
* Playwright

The app is **local-first**: business logic and data access run in the Electron **main
process** (TypeScript); the React **renderer** talks to it over IPC and never reaches data
sources directly.

Avoid introducing additional dependencies unless they provide clear long-term value.

---

# Commands

```bash
npm install            # also runs postinstall: electron-rebuild for better-sqlite3 (native)

npm run dev            # launch Electron + Vite dev server (hot reload) — electron-vite dev
npm run build          # build main + preload + renderer bundles into out/ — electron-vite build
npm start              # preview the built app — electron-vite preview
npm run package        # build + produce a distributable via electron-builder

npm run lint           # eslint . (also enforces the layer-boundary import rules)
npm run typecheck      # tsc --noEmit (no emit; electron-vite/esbuild does the transpiling)

npm test               # vitest run — unit tests (services), Node env, *.test.ts under src/
npm run test:watch     # vitest (watch mode)
npm run test:e2e       # build, then Playwright launches the packaged app (e2e/*.spec.ts)

# Run a single unit test:
npx vitest run src/services/meta/metaService.test.ts
npx vitest run -t "generates and persists"   # by test-name substring

npm run db:generate    # drizzle-kit generate — emit SQL migration from schema.ts changes
npm run db:migrate      # drizzle-kit migrate — apply to ./local.dev.db (dev tooling only)
npm run db:studio      # drizzle-kit studio — inspect the dev DB
```

> The app also applies migrations automatically on every launch; `db:migrate` is for the
> standalone dev DB. There is no lint/format-fix or CI-wide `check` script — run `lint`,
> `typecheck`, and `test` individually.

---

# MCP Servers

Available through `.mcp.json`.

Typical servers:

* interactive-brokers
* context7
* playwright
* filesystem

(The `postgres` server has been retired following the move to SQLite.)

Prefer Context7 over model memory when consulting framework or library documentation.

---

# Architecture Rules

Dependencies point downward only.

```text
src/renderer   (React UI)
        ↓ IPC
src/main       (Electron main: IPC handlers + services)
        ↓
src/services
        ↓
src/repositories
        ↓
SQLite / Interactive Brokers Gateway
```

Rules:

* IPC handlers remain thin — they validate input (Zod) and delegate to services.
* Services contain business logic.
* Repositories own data access.
* The React renderer never accesses repositories or data sources directly; it only calls
  the main process over IPC.

---

# Repository Pattern

Repositories abstract data sources.

Repositories may retrieve data from:

* SQLite (local database)
* Interactive Brokers (local Client Portal Gateway / MCP)
* future external providers

Services should never know where data originates.

Example:

```text
PortfolioService

↓

PortfolioRepository

↓

IBKR Gateway
+
SQLite
```

This keeps analytics independent from external providers.

---

# Historical Snapshots

Interactive Brokers is the live source of truth.

Historical portfolio snapshots are stored locally for analytics.

Snapshots are:

* append-only
* immutable
* timestamped

Because the app is a desktop application that only runs when launched, snapshots are
**captured on app open** (and on demand). A background scheduler (e.g. a Windows Task
Scheduler job invoking a headless capture) is a possible future enhancement for regular,
unattended history.

Analytics should primarily operate from stored snapshots instead of repeatedly querying Interactive Brokers.

---

# Domain Structure

Primary domains:

* portfolio
* holdings
* snapshots
* dividends
* analytics

Future domains may include:

* benchmarks
* taxes
* brokers
* AI

Keep domains cohesive.

---

# Layer Responsibilities

## Renderer (UI)

Responsible for:

* rendering
* navigation
* forms
* calling the main process over IPC

Must not contain business logic or touch data sources directly.

---

## Services

Responsible for:

* analytics
* calculations
* orchestration
* portfolio workflows

Must remain independent of UI and infrastructure.

---

## Repositories

Responsible for:

* SQLite
* Interactive Brokers (local Gateway / MCP)
* persistence
* external APIs

Repositories expose domain-oriented methods.

---

## Database

Stores:

* historical snapshots
* cached analytics
* benchmark history
* application metadata

Do not duplicate live brokerage data unless necessary for analytics.

---

# AI Principles

AI enhances portfolio understanding.

Examples:

* explain portfolio changes
* summarize performance
* compare historical periods
* answer portfolio questions

AI must never:

* recommend investments
* suggest trades
* decide allocations
* execute transactions

The user remains the decision maker.

---

# Development Workflow

Stock Portfolio Viewer follows an artifact-driven workflow. Work **originates in GitHub
Issues** — the owner authors Epics and User Stories (grouped under GitHub Milestones), and
the Product Manager **reads them before planning**. Issues are never created after
implementation to record work already done.

Planning

```text
GitHub Issues (Epics / User Stories)   ← owner-authored backlog = source of milestones
        ↓  (read before planning)
Product Manager
        ↓
Product Review
        ↓
UI Designer      Architect
        ↓             ↓
UI Review   Architecture Review
                     ↓
             Database Designer
                     ↓
             Database Review
                     ↓
      Implementation Engineer
                     ↓
        Implementation Plan
                     ↓
          Execution Skills
                     ↓
               Testing
                     ↓
           Testing Report
```

Small bug fixes may skip planning artifacts.

---

# Workflow Artifacts

Workflow skills communicate through artifacts.

Artifacts become the input to subsequent stages.

Core artifacts:

* Product Review
* UI Review
* Architecture Review
* Database Review
* Implementation Plan
* Testing Report

Execution skills consume approved artifacts.

They do not redefine requirements or architecture.

---

# Documentation

Project documentation lives under `docs/`.

Core documents:

* architecture.md
* database.md
* product.md

Project history and milestones are **not** kept in local files. Milestones and work items
live in GitHub Issues (Epics / User Stories, grouped under GitHub Milestones); the record of
completed work is the git history and closed issues.

Accepted decisions live in:

```text
docs/decisions/
```

Design decisions live in:

```text
docs/design-decisions/
```

CLAUDE.md contains project rules.

Detailed documentation belongs in `docs/`.

---

# Documentation Hierarchy

When making decisions, consult documentation in this order:

1. docs/decisions/
2. docs/design-decisions/
3. docs/product.md
4. GitHub Issues (Epics / User Stories — current milestones and work items)
5. docs/architecture.md
6. docs/database.md

If documentation conflicts:

1. Identify the conflict.
2. Explain the tradeoffs.
3. Request clarification or propose a new ADR.

Never silently override accepted decisions.

---

# Development Principles

Prefer:

* simplicity
* existing patterns
* small, focused changes
* strong typing
* explicit ownership

Avoid:

* speculative abstractions
* premature optimization
* unnecessary dependencies
* unrelated refactoring

Keep files reasonably small.

Test business logic thoroughly.

---

# Before Implementing

Before implementing any non-trivial feature:

1. Review relevant documentation.
2. Identify affected domains.
3. Produce the required planning artifacts.
4. Follow the approved Implementation Plan.

---

# Testing

Services are the primary unit-test target.

Mock repositories and external providers.

Every completed feature should include:

* unit tests
* regression review
* edge-case validation
* Testing Report

---

# Current Priority

Milestones live in **GitHub Issues**, grouped under GitHub Milestones. Read the backlog to
find the active milestone and its work items:

```bash
gh issue list --state open --label epic        # milestone-sized Epics
gh issue list --state open --milestone "<milestone title>"
gh api repos/:owner/:repo/milestones --jq '.[].title'
```

Prioritize the current milestone over future ones unless explicitly instructed otherwise.