# Stock Portfolio Viewer

A **local-first, single-user desktop application** for personal portfolio analytics. It reads a
live Interactive Brokers account, keeps its own immutable history, imports IBKR Flex Query
exports for the analytics it cannot get live, and answers questions about the result.

Everything runs on the owner's machine and stores its data there, with **one qualification**: the
AI assistant sends portfolio-derived figures to OpenAI when the owner has supplied a key and asks
a question. Supplying the key is the authorization; removing it is what stops the sending
(ADR-0010, ADR-0011). No other data path leaves the machine.

## What it does

Six views, in sidebar order:

| View | Source | Covers |
| --- | --- | --- |
| **Portfolio** | live gateway | holdings, balances, gain/loss and a display-currency selector, plus snapshot history |
| **Performance** | imported Flex | cumulative time-weighted return, daily returns, portfolio value and composition |
| **Allocation** | imported Flex + gateway | asset class, currency, sector and country weights, a world map, and on-demand sector classification |
| **Dividends** | imported Flex | income received, withholding, per-share history and upcoming accruals |
| **Trades** | imported Flex | trade history and realized gains |
| **Assistant** | both | the investor profile, balance drift against it, and a grounded chat about the portfolio |

**The app proposes; it never acts, and it never sets the owner's policy.** It places no orders and
has no path to one. The owner writes the investor profile; the app measures against it, and where
the profile is silent it applies its own published baseline and says whose standard each judgement
is (ADR-0009, ADR-0012).

**The model never produces a figure.** Every number in an answer is computed by a service and only
*phrased* by the model (DDR-0111).

## Getting started

Requires **Node ≥ 22.12** (CI runs 24 — `@electron/rebuild` and `node-abi` need it).

```bash
npm install          # postinstall rebuilds better-sqlite3 for Electron's ABI
cp .env.example .env
npm run dev
```

For live portfolio data, run the **IBKR Client Portal Gateway** and log in; the app expects it at
`https://localhost:5000` (override with `IBKR_GATEWAY_URL`). Its self-signed certificate is
accepted deliberately. Without the gateway the live views report `not_connected` and every
Flex-backed view still works.

Two optional keys, both unprefixed and neither ever bundled:

- `OPENAI_API_KEY` — enables the assistant. It can also be saved from inside the app; a real
  environment variable wins, and the app says so rather than shadowing it silently (DDR-0105).
- `RENDERER_VITE_MAPBOX_TOKEN` — without it the Allocation map renders a placeholder and nothing
  else changes.

Editing `.env` needs a restart: it is read once at startup (`src/main/env.ts`).

## Commands

| | |
| --- | --- |
| `npm run dev` | run the app with HMR in the renderer (main-process edits need a relaunch) |
| `npm run build` | type-check and bundle main, preload and renderer into `out/` |
| `npm start` | preview the built bundle |
| `npm run package` | build and produce an installer via electron-builder into `release/` |
| `npm run lint` | ESLint, including the layer-boundary rules |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest, every test under `src/` |
| `npm run test:watch` | the same in watch mode |
| `npm run test:e2e` | build, then the Playwright specs in `e2e/` against the built app |
| `npm run db:generate` | generate a migration from `src/db/schema.ts` |
| `npm run db:migrate` / `db:studio` | apply / browse, against the tooling database |

Run a single unit test file, or one test by name:

```bash
npx vitest run src/services/portfolio/portfolioService.test.ts
npx vitest run -t "converts to the display currency"
npx playwright test e2e/tab-navigation.spec.ts
```

CI runs exactly `lint`, `typecheck`, `test` and `build`. Playwright is **intentionally excluded**
(it needs a display server), so run `test:e2e` locally before opening a PR.

## Layout

```text
src/main/          Electron main process: window lifecycle, startup, the IPC surface
src/preload/       the typed contextBridge — the renderer's only door
src/renderer/      the React UI, its pure logic in lib/, and the design tokens
src/services/      business logic, one directory per domain
src/repositories/  the only layer that touches a data source
src/db/            Drizzle client, schema and migration runner
src/shared/        the IPC contract and the domain types both processes agree on
e2e/               Playwright specs launching the built app
drizzle/           generated SQL migrations
docs/              ADRs, DDRs and the prose docs
```

Each of those directories has its own README covering what lives there and the rules that hold
it together.

Dependencies point **downward only**, and ESLint enforces it rather than convention:

```text
renderer → IPC → main → services → repositories → SQLite / IBKR Gateway / OpenAI
```

## Where the rules are written down

Consult in this order, and never silently override an accepted decision:

1. **`docs/decisions/`** — ADRs, the highest tier.
2. **`docs/design-decisions/`** — DDRs, the UI/UX and lower-level design record.
3. **`docs/product.md`** — scope and guardrails.
4. **GitHub Issues** — Epics and Stories; work originates there.
5. **`docs/architecture.md`**, **`docs/database.md`**.

`CLAUDE.md` is the working index over all of it: the traps that have each shipped broken at least
once, in one line apiece with the record number to read. It is held to a size budget by
`src/claudeMdBudget.test.ts`, because it is loaded before any work starts.

## Testing

Vitest runs every test under `src/` in a **Node environment with no jsdom**, so no test renders a
React component. That shapes the renderer: chart maths, filtering, sorting, formatting and state
live in pure modules under `renderer/src/lib/` so they can be tested at all. Several of those test
files have no module under test — they guard `app.css`, a view's composition or accessibility by
scanning source text. What a text scan cannot see is pinned by Playwright.

Services are the primary target; repositories and external providers are mocked.
