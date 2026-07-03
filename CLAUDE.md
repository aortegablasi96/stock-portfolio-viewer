# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Repository State

This repository is **greenfield**. The committed artifacts are this file, the
`.claude/skills/` library, and the `docs/` documentation set. There is no application
source yet — no `package.json` or `src/`. The Stack and Commands sections below describe
the **intended** project; those commands will not run until the project is scaffolded.

> **Project name:** This project is **Stock Portfolio Viewer**, a **standalone,
> single-user desktop application** for personal stock portfolio analytics. It is
> **local-first and private** — it runs on the owner's machine, stores data locally, and
> is not hosted or shared. Treat the workflow *structure* of the `.claude/skills/` library
> as authoritative.

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

`.claude/settings.local.json` lists `context7`, `filesystem`, `postgres`, `playwright`, and
`interactive-brokers` in `enabledMcpjsonServers`. Note that the `interactive-brokers` entry
in `.mcp.json` still uses a **placeholder runtime** (`REPLACE_WITH_RUNTIME`), so enabling it
does not make it functional until the runtime is finalized. Separately, a connected
`Interactive_Brokers_IBKR` MCP is available with read-only account/market tools allowlisted
(positions, balances, price history, etc.) — no order-placing tools are allowlisted, in
keeping with the analytics-first, no-trading stance. The `postgres` entry predates the move
to SQLite and can be retired during scaffolding.

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
npm install

npm run dev      # launch Electron with the Vite dev server (hot reload)
npm run build    # build renderer + main process bundles
npm run package  # produce a distributable desktop app (e.g. via electron-builder)

npm run lint
npm test

npm run db:generate   # Drizzle migration generation (SQLite)
npm run db:migrate
npm run db:studio
```

---

# MCP Servers

Available through `.mcp.json`.

Typical servers:

* interactive-brokers
* context7
* playwright
* filesystem

(The `postgres` server predates the move to SQLite and is being retired.)

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