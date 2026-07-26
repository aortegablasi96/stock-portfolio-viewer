# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Repository State

**M0–M2 are merged; M3 is built and reopened for refinement.** Scaffolding (M0), the
read-only portfolio dashboard (M1), historical snapshots (M2), and the performance &
allocation analytics (M3, Stories #20–#24) are all on `main`. The app boots, connects to the
Interactive Brokers Client Portal Gateway, renders live holdings/balances/allocation in a
user-selected display currency, captures immutable snapshots (on open + on demand), imports
IBKR Flex Query statements into local history, and renders four analytics views over that
imported data (performance, allocation, dividends, realized gains & trade history). A tab
shell switches between the live Portfolio dashboard and the analytics views.

**Epic #4 (M3) reopened to refine the views, and refinement is ongoing.** Two rounds have
merged: #28–#33 (display currency, day-by-day performance, allocation donuts + sector
breakdown, net dividend chart + upcoming dividends, filterable dividend and trade tables) and
#42–#73 (frameless window shell, destructive-reset controls, TWR curve + chart tabs, world
bubble map, cash as an asset class, tabbed breakdowns, time-range filters, multi-select type
filter, `Symbol`→`Ticker` renames). **The epic is deliberately left open for further
refinement stories the owner plans to add** — read the backlog before assuming a view is
final; a view you are told is "done" has usually been reworked several times. The Stack and
Commands sections below are **live**. Still **not built**: AI features, multi-broker support,
benchmark comparison, and tax reporting — those are later milestones.

Live domains exist end-to-end as reference patterns:

- **portfolio** — read-only overview from IBKR. `portfolioService` → `portfolioRepository`
  → `ibkrGateway` (HTTP + Zod against the local Client Portal Gateway). No SQLite; live only.
  `getOverview(displayCurrency?)` converts holdings/balances with **live** gateway FX rates —
  the Flex `fxRateToBase` path does *not* apply here; unconvertible rows carry
  `displayValue === null` and are excluded from totals/allocation (DDR-0007).
- **snapshots** — immutable local history. `snapshotService` (capture policy: 12h de-dupe
  on open, always-write on demand) → `snapshotRepository` → SQLite (`snapshots` /
  `snapshot_holdings`). Reads IBKR only *through* `portfolioService`.
- **flex** — imported IBKR Flex Query history (M3, Story #20). A **write-only**
  `flexRepository` (parse XML + persist, two-tier de-dupe) and a **read-only**
  `flexReadRepository` (the only new `flex_*` read layer) fronting the immutable `flex_*`
  tables. `flex_prior_period_positions` holds the per-instrument daily MTM series that backs
  day-by-day performance; `flex_open_dividend_accruals` holds declared-but-unpaid dividends
  (Story #31) — an **optional** Flex section, so an export without it degrades to an empty
  list rather than failing; `flex_fifo_summaries` holds IBKR's own FIFO performance summary,
  which backs realized/unrealized gains. Real sample exports and a field reference live in
  `docs/flex-queries/` — check them before guessing at Flex XML shapes. See ADR-0005,
  DDR-0004, DDR-0008, DDR-0010.
- **analytics / dividends** — read-only analytics over the imported Flex data (M3, Stories
  #21–#24). `performanceService` / `allocationService` / `realizedGainsService` (analytics)
  and `dividendService` (dividends) read *only* through `flexReadRepository`, convert to base
  currency (EUR) in the service, and each return an `ok | needs_import` result. Statement-scoped
  reads (`getLatestOpenPositions`, `getLatestOpenDividendAccruals`) deliberately use the
  **latest statement only** — older as-of rows describe state that has since changed and would
  double-count. Two traps worth knowing before touching these services: IBKR's FIFO summary
  carries a **"Total (All Assets)" aggregate row** (blank symbol) that must be filtered out or
  it doubles every total — use `isInstrumentSummary` (`repositories/flex/fifoSummary.ts`, kept
  DB-free so services and their tests share the real predicate); and allocation's **cash slice
  is the NAV residual** (`ChangeInNAV.endingValue − Σ invested market value`), *not* the
  `percentOfNAV` shortfall, because Flex's `percentOfNAV` sums to 100% across positions and
  excludes cash — the shortfall approach shipped broken once already. See DDR-0005, DDR-0010,
  DDR-0015.
- **classification** — instrument sector/industry (M3, Story #30). Flex carries **no sector
  field**, so `classificationRepository` fronts *two* sources — the mutable SQLite cache
  `instrument_classifications` and `ibkrGateway` — and `classificationService` decides which
  conids to fetch (latest statement's positions, uncached only, sequential). `allocationService`
  joins the cache with a plain sync read, so Allocation still renders with the gateway closed;
  unclassified positions form their own slice. The `analytics:classifyInstruments` channel is the
  only analytics channel that reaches IBKR. See DDR-0009.

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
  renderer/      React + Vite UI (src/renderer/src/*; App tab shell under a custom
                 TitleBar, components/ + components/analytics/ + components/charts/ +
                 lib/ — pure, unit-tested helpers extracted out of components)
  services/      pure business logic — primary unit-test target (system/, meta/,
                 portfolio/, snapshots/, flex/, analytics/, dividends/)
  repositories/  the ONLY layer that touches a data source: SQLite (meta/, snapshots/,
                 flex/), the IBKR gateway (portfolio/portfolioRepository.ts + ibkrGateway.ts),
                 or both (classification/)
  db/            client.ts (better-sqlite3 + Drizzle singleton), migrate.ts, schema.ts
  shared/        ipc/contract.ts (Zod schemas + inferred types), ipc/channels.ts,
                 domain/ (portfolio.ts, snapshot.ts, flex.ts, performance.ts,
                 allocation.ts, dividends.ts, realizedGains.ts), errors.ts
drizzle/         generated SQL migrations + meta journal
e2e/             Playwright specs that launch the built Electron app
docs/flex-queries/  real IBKR Flex exports + field reference (parser ground truth)
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
- **Read-only analytics over local data:** the `analytics:*` channels show services
  reading imported history through a dedicated read-only repository (`flexReadRepository`),
  doing base-currency conversion and calculation in the service, and returning an
  `ok | needs_import` result the renderer renders as a first-class empty state. Charts are
  dependency-free inline SVG (`components/charts/`) — including the pannable/zoomable world
  bubble map, which avoids a geo library and a bundled polygon dataset by projecting
  equirectangularly onto ISO-3166 alpha-2 centroids (DDR-0014), and the performance view's
  cumulative **TWR** curve, chosen over a value curve so deposits and withdrawals don't move
  it (DDR-0013). See DDR-0005, DDR-0006.
- **Fire-and-forget command + state event:** the `window:*` channels show the *other* IPC
  shape — `ipcRenderer.send` / `ipcMain.on` with no payload and no Zod (there is nothing to
  validate), plus one `invoke` query (`window:isMaximized`) and one main→renderer event
  (`window:maximizeChanged`) carrying a bare boolean. See DDR-0011.
- **Destructive action:** `flex:clear` / `snapshot:clear` show the sanctioned full-reset
  exception to immutability (ADR-0006) behind the reusable in-place `ConfirmAction` control —
  expand-in-place warning, no modal, no `window.confirm`. See DDR-0012.

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
  `nodeIntegration: false`. Keep it that way; reach the main process only over IPC. The window
  also runs **frameless** (`frame: false`) with an in-app `TitleBar` supplying minimize /
  maximize / close — window chrome is app code, not OS chrome (DDR-0011).
- **Adding an IPC channel touches four files, in this order**: `shared/ipc/channels.ts`
  (name) → `shared/ipc/contract.ts` (Zod request/response schema + the `RendererApi` method)
  → `preload/index.ts` (bridge impl) → `main/ipc/handlers.ts` (parse input, delegate to a
  service). `contract.ts` is the single source of truth; the renderer and preload import only
  *types* from it so Zod never lands in those bundles. Failures cross IPC **as result
  variants, not exceptions** (`not_connected`, `needs_import`, `canceled`, `invalid`,
  `error`) so the renderer can render each as a first-class state.
- **That four-file recipe assumes a request/response channel** (`invoke`/`handle`), which is
  almost all of them. The exception is the three payload-free `window:minimize |
  toggleMaximize | close` commands: they use `ipcRenderer.send` / `ipcMain.on` and skip
  `contract.ts` entirely, since with no payload there is nothing to Zod-validate. Main→renderer
  events (`snapshot:captured`, `window:maximizeChanged`) are `ipcRenderer.on` subscriptions
  that return an unsubscribe function (DDR-0011).
- **`instrument_classifications` is the one mutable table** — it's a *cache* of derived
  reference data (upserted by conid), not history (DDR-0009). Every other table is append-only
  **during normal operation**: no record is ever edited, partially deleted, or silently
  mutated by the app's data flow. There is exactly **one sanctioned exception** — a
  whole-store, owner-confirmed reset per domain (`flexRepository.clearAll()` /
  `snapshotRepository.clearAll()`), so bad imports can be discarded wholesale and rebuilt.
  Deliberately no delete-by-id/date/statement variant; don't add one (ADR-0006).
- **Two money-storage conventions coexist** — don't mix them. `snapshots` /
  `snapshot_holdings` store **integer minor units** (cents) plus a currency (DDR-0003);
  the `flex_*` tables store **`real`** for money, prices, FX rates and P&L, because Flex is
  multi-currency and high-precision (DDR-0004). All timestamps everywhere are epoch-ms UTC
  integers.
- **Base-currency conversion happens in the service, never the repository or the renderer.**
  Analytics converts per record with the Flex row's own `fxRateToBase`; the live Portfolio
  view uses gateway FX (DDR-0005, DDR-0007).
- **The IBKR gateway is `https://localhost:5000`**, overridable via the `IBKR_GATEWAY_URL` env
  var. It serves a **self-signed certificate** that `ibkrGateway` accepts deliberately — that
  is not a TLS bug to fix.

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
npm run test:e2e       # build (electron-vite → out/), then Playwright launches the built app (e2e/*.spec.ts)

# Run a single unit test:
npx vitest run src/services/meta/metaService.test.ts
npx vitest run -t "generates and persists"   # by test-name substring

npm run db:generate    # drizzle-kit generate — emit SQL migration from schema.ts changes
npm run db:migrate      # drizzle-kit migrate — apply to ./local.dev.db (dev tooling only; override with DATABASE_URL)
npm run db:studio      # drizzle-kit studio — inspect the dev DB
```

> The app also applies migrations automatically on every launch; `db:migrate` is for the
> standalone dev DB. There is no local lint/format-fix or aggregate `check` script — run
> `lint`, `typecheck`, and `test` individually. **CI** (`.github/workflows/ci.yml`) runs
> exactly those three plus `npm run build` on every push to `main` and every PR (on Node 24,
> Ubuntu); the Playwright e2e suite is intentionally excluded from CI (needs a display server —
> run `npm run test:e2e` locally). Run the four locally before opening a PR to match CI.

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
* mcp.md (MCP server setup and usage notes)
* github-issues.md (backlog conventions — Epics / User Stories / Bugs)

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

Vitest picks up every `src/**/*.test.ts` and runs it in a **Node** environment (**no jsdom**),
so no test may render a React component. This shapes the renderer: chart maths, filtering,
sorting and formatting are **extracted out of components into pure modules under
`renderer/src/lib/`** (`format`, `pie`, `worldGeo`, `mapViewport`, `tableFilter`, `column`,
`sectorMap`, `performanceRange`) precisely so they can be tested — follow that split when
adding a component with real logic in it. Pure repository helpers that touch no data source
(`flexStatementParser`, `snapshotMapping`, `fifoSummary`) are unit-tested the same way.

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