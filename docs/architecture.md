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
periods, answer questions) and judges balance — against the owner's own **investor profile**, and,
for whatever that profile leaves silent, against the app's own published **baseline** (ADR-0012). It
may propose rebalancing, naming positions (ADR-0009).

Three architectural rules make that safe, and they replace the former analytics-only guardrail:

- **The model never produces a figure.** Every number is computed by a service, from
  repositories, exactly as the analytics views compute theirs; the model is given computed
  reports and asked to phrase them. Assembly is deterministic and unit-tested. The model
  reaches neither the database, the repositories, nor the IBKR gateway.

  **How it obtains a report is an implementation choice; what it may compute is not** (ADR-0009).
  Epic #322 lets it *select* among reports through tools, which the ADR anticipated and permits
  without amendment, on four conditions: every tool returns a **computed report and never raw
  data**, no tool is a general query, each is backed by a **service method**, and there is no write
  tool and no path to one. Many tools may share one method; **no tool may span two** — a join is
  computation, and computation belongs in a service. ADR-0009's Option E — *let the model compute* —
  stays rejected (DDR-0111).

  Story #326 ships the first four, #327 the four performance reports, #328 `get_position` and #329
  dividend income, realised gains and data coverage — **twelve**
  (`services/assistant/assistantTools.ts`, with the prose in `toolReports.ts`,
  `performanceReports.ts` and `storeReports.ts`), executed in **main** against the services and
  rendered through the app's
  own formatters. The four period tools are the *many tools, one method* half of the rule: they
  narrow `analytics:getPerformance` and add no arithmetic and no join. `get_position` is the other
  half's cost: there was no per-position read, so `portfolioService` **gained the method** rather
  than the tool layer filtering a report — the resolution by conid and its *ambiguous* and *not
  held* states are business rules, tested where business rules are tested (DDR-0111).
  `get_data_coverage` cost the same thing again: sketched over `flex:listStatements` *plus*
  `snapshot:list`, it gained `dataCoverageService` instead, because *"only metadata"* is not a line
  anyone can hold. It is also the one report with **no `needs_import`** — nothing imported is not a
  failure to report coverage, it is the coverage. Each tool declares the
  `DISCLOSURE_CATEGORIES` category it falls under — a tool result is built in main and never crosses
  the IPC boundary that drops an undeclared section, so the registry is where that bound is enforced.
  #329 **added a category** rather than borrowing one: `coverage` names statement counts, spans and
  import dates, which no existing entry described, and the list is the only thing that may be sent.

  **The renderer assembles nothing.** `lib/assistantContext.ts` returns an empty context and the
  arithmetic its sections were built on moved to `@shared/domain/standardPeriods.ts` and
  `performanceWindow.ts`, where main can reach it and the renderer's chart libs re-export it — one
  implementation of a window, not two (DDR-0098, DDR-0111). What stays **unconditional** is the base
  context: the absences, which are never a tool, because a prohibition whose supporting fact the
  model may decline to fetch is not a prohibition (DDR-0101, DDR-0110, DDR-0111).
- **The app never acts.** No order placement, no broker write, no path to one.
- **The app never sets the owner's policy.** It proposes moves toward their targets; it never
  proposes the targets, and never suggests one for them to set. Where they have stated nothing, the
  app applies its own **baseline** — a versioned, dependency-free module of default ceilings, never
  a number the model supplies — and marks that judgement apart from one against a target the owner
  wrote, beside the claim (ADR-0012). It is not applied to a dimension they have targeted.

A proposal about a held position is grounded and carries its arithmetic. An instrument the
owner does not hold comes from the model's training data — unverified, not price-checked — and
must be marked apart from computed claims.

The provider is `gpt-4.1-mini` on the OpenAI API, reached from the **main process** through a
repository-layer gateway. **Supplying a key is the authorization** — with one present a question is
sent with nothing in front of it, and removing the key is what stops it; no consent is asked for,
stored or checked (ADR-0010, amended by ADR-0011). The renderer's CSP is unchanged and the renderer
never reaches it.

> Architecture Reviews (see the `architect` skill) produce the input to this document.
