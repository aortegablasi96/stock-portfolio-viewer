# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Budget: keep this file under 35 KB.** It is loaded into every session, so its cost is paid
> before any work starts. It grew 10 KB → 84 KB between 2026-06-25 and 2026-08-19, and a
> compaction on 2026-08-11 was fully reversed within eight days.
>
> The failure mode is re-narrating a decision this repo already records: **every ADR and DDR is
> 8–20 KB and carries its own reasoning**, and `docs/design-decisions/README.md` indexes all of
> them in one line each. When a story lands, add *the trap* here in a sentence with its DDR number
> — never the argument. 35 KB is what remains when every trap below is stated once and nothing is
> justified twice; if it is exceeded, the fix is to find the paragraph that argues a case rather
> than to drop a trap.

## Current Repository State

M0–M5 are delivered. The app boots, connects to the Interactive Brokers Client Portal Gateway,
renders live holdings/balances/allocation in a display currency, captures immutable snapshots (on
open + on demand), imports IBKR Flex Query statements, and renders four analytics views over that
imported data. A vertical sidebar switches between the live Portfolio dashboard and the four
analytics views.

Not built: AI features, multi-broker support, benchmark comparison, tax reporting.

**Which Epics are open is deliberately not recorded here** — the backlog is the source of
milestones (see *Current Priority*). The stable rule is the **lifecycle**: an Epic closes when its
stories close, and new refinement opens a *new* area-scoped Epic rather than reopening a delivered
one. The one narrow exception is in `docs/github-issues.md`; Epic #125 is the precedent.

**Views are reworked often — read the backlog before assuming one is final.**

### Domains

Each exists end-to-end and is the reference pattern for its shape.

- **portfolio** — live IBKR read, no SQLite. `portfolioService` → `portfolioRepository` →
  `ibkrGateway` (HTTP + Zod). Converts with **live gateway FX**, not Flex `fxRateToBase`;
  unconvertible rows carry `displayValue === null` and leave totals/allocation (DDR-0007).
- **snapshots** — immutable local history. `snapshotService` (12h de-dupe on open, always-write on
  demand) → `snapshotRepository` → SQLite. Reads IBKR only *through* `portfolioService` (DDR-0003).
- **flex** — imported Flex history, split **write-only** `flexRepository` / **read-only**
  `flexReadRepository` over immutable `flex_*` tables; services mirror the split
  (`flexImportService` / `flexStatementsService`). See ADR-0005, DDR-0004, DDR-0026.
- **analytics / dividends** — read-only over Flex through `flexReadRepository`, converting to base
  (EUR) **in the service**, each returning `ok | needs_import`. See DDR-0005, DDR-0010, DDR-0015.
- **classification** — sector/industry. `classificationRepository` fronts *both* the mutable
  SQLite cache and `ibkrGateway`; `analytics:classifyInstruments` is the only analytics channel
  reaching IBKR. Refreshes are **resumable, not transactional** — a run that dies at 30 of 40 keeps
  29 and the next re-derives its work list. See DDR-0009, DDR-0023.

### Flex data traps

These have each shipped broken at least once. Read them before touching analytics.

- **The FIFO summary carries a "Total (All Assets)" aggregate row** (blank symbol) that doubles
  every total — filter with `isInstrumentSummary` (`repositories/flex/fifoSummary.ts`, kept DB-free
  so services and tests share the real predicate).
- **The same FIFO row mixes a flow and a balance**: realized P&L is per-period and *must* be summed
  across statements; unrealized is an as-of balance that must *not* be. Scope it with
  `fromLatestStatement`; "latest" is the largest **end date**, never the largest id. Shipped 25%
  overstated once (#103).
- **Allocation's cash slice is the NAV residual** (`ChangeInNAV.endingValue − Σ invested market
  value`), *not* the `percentOfNAV` shortfall — `percentOfNAV` sums to 100% across positions and
  excludes cash (DDR-0015).
- **`flex_equity_summaries` is statement-scoped *and* daily**, so overlapping statements duplicate a
  calendar day — keep the row whose statement ends latest (`latestPerDay`). Duplicates put two
  points on one date, so the curve doubles back on itself. Carries no `fxRateToBase`, and every
  category attribute is optional: an unselected asset class is *absent*, not zero (DDR-0050).
- **Statement-scoped reads use the latest statement only** (`getLatestOpenPositions`,
  `getLatestOpenDividendAccruals`) — older as-of rows describe state that has since changed.
- **Optional sections degrade, never fail** — `flex_open_dividend_accruals` is absent from some
  exports and becomes an empty list.
- **A description that repeats the symbol is not a name** — IBKR writes the identifier again where
  an instrument has none: `EUR.CHF` in trades, bare `CAD` in the FIFO summary. Views go through
  `instrumentName`, never `formatCompanyName`, which title-cases (`Cad`) (DDR-0066, DDR-0067).
- **Check `docs/flex-queries/` before guessing at XML shapes — or before concluding a section is
  missing** (#171). The directory is **gitignored** (real account data), so a fresh clone has
  none of it and the parser's tests fall back to an inline fixture.

### As-built layout

```text
src/
  main/          Electron main: index.ts + ipc/handlers.ts (thin, Zod-validated)
  preload/       contextBridge → window.api (types + channel names only, no Zod)
  renderer/      React + Vite (src/renderer/src/*): App sidebar shell under a custom TitleBar,
                 components/{analytics,charts,ui}/, lib/ (pure, unit-tested), assets/fonts/
  services/      pure business logic — primary unit-test target
  repositories/  the ONLY layer touching a data source (SQLite, the IBKR gateway, or both)
  db/            client.ts (better-sqlite3 + Drizzle singleton), migrate.ts, schema.ts
  shared/        ipc/contract.ts (Zod + inferred types), ipc/channels.ts, domain/, errors.ts
drizzle/         generated SQL migrations + meta journal
e2e/             Playwright specs launching the built app
docs/flex-queries/  real Flex exports (parser ground truth) — gitignored
docs/figma_design/  Epic #179's Figma Make export — gitignored
```

### Reference slices to copy

- **Minimal slice / test style** — `app:ping` and `metaService.getInstallId()`; see
  `services/meta/metaService.test.ts` for the repository-mocking pattern.
- **External data source** — `portfolio:getOverview`: a repository fronting IBKR with Zod at
  ingress, and connection state modelled as data. ADR-0004, DDR-0002.
- **Local persistence + policy** — the `snapshot:*` channels: a service owning a capture policy
  over an append-only table, plus a main→renderer event. DDR-0003.
- **Read-only analytics** — the `analytics:*` channels: read through a read-only repository,
  convert in the service.
- **Fire-and-forget command + state event** — the `window:*` channels. DDR-0011.
- **Destructive action** — `flex:clear` / `snapshot:clear`: the in-place `ConfirmAction` control —
  no modal, no `window.confirm`. ADR-0006, DDR-0012.

## Enforced boundaries & gotchas

### Enforced by the platform, not by convention

This repo's habit is to make invariants *unexpressible* rather than documented — reach for the same
instinct. **ESLint layer boundaries** (`eslint.config.mjs`, ADR-0002/0003): the renderer may not
import `@services`/`@repositories`/`@db`/`@main`/`electron`, services may not import `@db` or
`electron`. The CSP's omitted telemetry origin, the `:where()` focus ring and the token ratchet
below are the same move.

### Build, runtime, environment

- **Path aliases live in three files that must stay in sync**: `tsconfig.json`,
  `electron.vite.config.ts`, `vitest.config.ts`.
- **`better-sqlite3` is native**, rebuilt for Electron by the `postinstall` hook. On an ABI
  mismatch: `npm install` or `npx electron-rebuild -f -w better-sqlite3`.
- **Runtime DB vs tooling DB** — the app opens `app.getPath('userData')/portfolio.db` and applies
  migrations on launch; drizzle-kit (`db:*`) runs *outside* Electron against `./local.dev.db`.
- **A fresh clone needs `.env`** (copy `.env.example`). electron-vite splits by prefix:
  `MAIN_VITE_*` / `PRELOAD_VITE_*` / `RENDERER_VITE_*` are inlined at **build** time; unprefixed
  (`IBKR_GATEWAY_URL`) stays in `process.env`, main-process only. Without
  `RENDERER_VITE_MAPBOX_TOKEN` the map renders a placeholder; nothing else is affected.
- **Electron security is locked down** — `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, and `frame: false` with an in-app `TitleBar` (DDR-0011). Keep it.
- **The renderer's CSP admits exactly one external origin** (`https://api.mapbox.com`);
  `events.mapbox.com` is **omitted on purpose**, so the platform blocks Mapbox telemetry however
  the library is configured. Only tiles and the viewport leave the machine — no portfolio data
  (ADR-0007).
- **Exactly one instance runs at a time** — `app.requestSingleInstanceLock()` at **module load**,
  before any `whenReady` work, so the loser quits without migrating, capturing, or opening the DB.
  Every write path assumes it is the only writer. Scoped to the user-data dir, which is why the
  e2e suite's second app still starts (DDR-0025).
- **The window's own size/position/maximized state is app code** (DDR-0028): one overwritten
  `app_meta` value. Three traps — `windowStateService` may not import `electron` (main passes
  geometry in as plain rectangles); persist **`getNormalBounds()`**, never maximized bounds, and
  skip a **minimized** window entirely; re-apply with **`setBounds()`, not the constructor**, or a
  frameless window grows a few pixels every launch. Pinned by `e2e/window-state.spec.ts`.

### IPC

- **Adding a channel touches four files, in order**: `shared/ipc/channels.ts` →
  `shared/ipc/contract.ts` (Zod schema + `RendererApi` method) → `preload/index.ts` →
  `main/ipc/handlers.ts`. `contract.ts` is the single source of truth for the wire shape; renderer
  and preload import **types only**, so Zod never lands in those bundles. Domain result schemas go
  in `shared/domain/*.ts` and `contract.ts` composes them — not inline.
- **Failures cross IPC as result variants, not exceptions** (`not_connected`, `not_responding`,
  `needs_import`, `canceled`, `invalid`, `error`). `not_connected` (gateway isn't running) and
  `not_responding` (accepted, then stalled) are **not interchangeable** — `IbkrTimeoutError` is
  deliberately not a subclass of `IbkrNotConnectedError` (DDR-0022). Success is **not** uniformly
  `ok`: capture returns `captured`, import `imported`, both clears `cleared`.
- **The four-file recipe assumes `invoke`/`handle`.** The exception is the payload-free
  `window:minimize | toggleMaximize | close`, which use `send`/`on` and skip `contract.ts`
  entirely. Main→renderer events return an unsubscribe function; **a service that emits one takes
  a callback**, because services may not import `electron` (DDR-0011, DDR-0023).

### Data

- **`instrument_classifications` is the one mutable table** — a *cache* of derived reference data,
  upserted by conid (DDR-0009). Everything else is append-only, with exactly **one** sanctioned
  exception: a whole-store, owner-confirmed reset per domain (`clearAll()`). Deliberately no
  delete-by-id/date/statement variant; don't add one (ADR-0006).
- **Two money conventions coexist — don't mix them.** `snapshots` / `snapshot_holdings` store
  **integer minor units** plus a currency (DDR-0003); `flex_*` tables store **`real`** (DDR-0004).
  All timestamps are epoch-ms UTC integers.
- **Base-currency conversion happens in the service** — never the repository, never the renderer.

### The IBKR gateway

- **`https://localhost:5000`** (override `IBKR_GATEWAY_URL`). Its **self-signed certificate is
  accepted deliberately** — not a TLS bug to fix.
- **Every request is bounded by a whole-request deadline** (`IBKR_GATEWAY_TIMEOUT_MS`, 15s),
  defined once in `ibkrGateway`. Deliberately *not* `request.setTimeout` (socket inactivity, reset
  by every byte) — the gateway's usual failure is accepting the connection and then going quiet,
  which emits no error code.
- **One bounded attempt, never a retry loop**, and **no per-item loop may pay the timeout once per
  item** (DDR-0022). Classification stops at the first timeout; `getExchangeRates` instead issues
  every pair **concurrently**, bounding the wait the same way while keeping rates that answered
  (DDR-0024).
- **Portfolio reads are coalesced** by `gatewayCache` between repository and gateway, so one
  overview costs one of each call however many service methods run. A failed read is never cached,
  and a not-connected *or* timeout error drops **every** entry. The policy stops at the repository
  — no cache-control parameter reaches services or the renderer (DDR-0024).

### Renderer: styling and design tokens

- **Never write a focus rule.** One ring (`--focus-ring` / `--focus-ring-offset`, always
  `--accent`, destructive controls included) is applied by a **zero-specificity `:where(...)` base
  rule** at the top of `app.css`, so an element is ringed by default and can't ship without one.
  `:where()` is the mechanism: every existing rule still wins, so deleting a per-class focus rule
  makes it *fall through* rather than lose its ring. `--focus-ring-offset-inset` is for the two
  controls whose ring an ancestor would clip.
- **Use a scale step, not a raw length** (DDR-0031): `--space-1..8`, composite `--control-pad-*` /
  `--surface-pad-*` in `sm|md|lg` (the same vocabulary as the primitives' `size` prop),
  `--radius-*` in **px**, `--text-2xs..2xl`, `--leading-*`. Deliberately off-scale: chart/map SVG
  label sizes (DDR-0018) and sub-6px radii. One collision, re-decided: **`--text-xl` (26px) and
  `.stat-row`'s `minmax(14.5rem, 1fr)` are one number** — the column holds a twelve-character
  figure, asserted in `statTileVariants.test.ts`. Both ends bind: narrower overruns the card,
  wider drops Trades to two rows at 1280px (DDR-0060).
- **Adoption is held by a ratchet; don't re-baseline it** (DDR-0042). `lib/tokenAdoption.ts` has
  `BASELINE` (may only shrink — **currently empty and must stay empty**) and `EXEMPTIONS`
  (permanent, **eight**, each with a reason). The test fails three ways, including on a *dead*
  entry.
- **A figure is a role, not a font** (DDR-0053). `--font-figure` + `--tracking-figure` +
  `font-variant-numeric: tabular-nums` are **one rule** listing its selectors, because the three
  only work as a set. It declares no `font-size`, which is what keeps DDR-0018 intact where it
  reaches SVG `<text>`. `lib/figureRole.ts` **throws rather than merging** if a second rule applies
  the family. Mono is ~20% wider for digits — a story adding a column should re-measure.
- **Motion is two durations and two easings** (DDR-0044): `--duration-fast` (90ms) ·
  `--duration-base` (120ms) · `--ease-out` · `--ease-linear` (for a width *reporting a number*).
  One `prefers-reduced-motion` block **zeroes the tokens** rather than listing what moves, so later
  additions are covered. **Source order is the mechanism** — the block sits directly under `:root`
  and `designTokens.test.ts` fails if it moves. A raw duration is the only way out.
- **The loss tone is two tokens and picking the wrong one is silent** (DDR-0046, DDR-0054): `--neg`
  is **fill only**, `--neg-text` **text only**; same shape for `--accent` (labels + ring) vs
  `--accent-strong` (the primary button's fill alone). The *shape* is durable — the split
  **inverted** in the #181 re-key. `--neg-text`'s constraint is **not** 4.5:1 but `--pos − 0.5`.
  `contrast.ts` **enumerates pairings by hand**, lists *passing* ones too, and models
  `.btn-primary:hover`'s `brightness(1.08)` — which *lowers* contrast where axe tests resting state
  only. A tint mixed into a surface is a **measured** number, never eyeballed (the sidebar's active
  row passes at 4.95:1; 22% fails), and a tone rendered on a **hovered row** is measured on the
  lift, not on `--card` (DDR-0064).
- **The palette is navy/indigo and was re-derived, not pasted** (DDR-0054) — the **eight
  `--series-*` slots did not move**.
  `designTokens.test.ts` guards the stylesheet itself: it fails if `outline` gains a second value,
  a scale stops ascending, or a validated colour moves.
- **A text-scanning guard must strip comments first.** This trap has now bitten four times
  (DDR-0042, DDR-0047, DDR-0048, DDR-0058) — `app.css` and the components quote their own values in
  prose, so an assertion can pass off the commentary alone.

### Renderer: structure and behaviour

- **shadcn/ui was deliberately declined** (ADR-0008, Epic #125). The CLI and MCP server are there
  to *read* the component API, not to install: no `shadcn add`, no re-proposing the package. What
  is adopted is the API *shape* — `variant`/`size`, `Card`/`CardHeader`/`CardContent`.
- **The view list is the full WAI-ARIA tabs pattern**, not styled buttons (DDR-0029), rotated into
  a **vertical sidebar** (DDR-0055) that **collapses to a 56px rail** (DDR-0057). Every view
  including Portfolio is wrapped in a `TabPanel`; `aria-controls` is set **only on the selected
  tab** (an unvisited tab has no panel to name); a roving `tabindex` makes the tablist one Tab
  stop, so a keyboard move must `focus()` through the ref map; arrows use **automatic activation**,
  which is why arrowing mounts a view. Index arithmetic is in `lib/tabKeyboard.ts`. **Up/Down
  only** — Left/Right are deliberately inert. Collapse is **one `app-collapsed` flag on the shell,
  never a `collapsed` prop**, which makes "selecting a view must not reopen the column"
  unexpressible; a collapsed label is **clipped, never removed**, so a row is still named by its
  own text. The toggle shares the head row with the app name, which **wraps** to fit it — never
  re-ellipsise it, and never widen the column (DDR-0068).
- **An analytics tab mounts on first visit and then stays mounted**, hidden rather than unmounted,
  so view-local state survives; unvisited tabs issue no IPC (DDR-0006, DDR-0027). The consequence:
  a mounted view can go stale, so both Flex write paths bump `lib/dataVersion` and every
  `useAnalytics` re-reads. **`loading` means the first load only**; a reload reports through
  `refreshing`. **Portfolio is deliberately excluded** and re-reads on every visit — it shows live
  data that changes with no event to signal it.
- **`AnalyticsShell` owns the four-branch guard, the `<main>`, and the page header** (DDR-0043,
  DDR-0058). Children are a **function of the report, not elements**, because three of four states
  have no report, and **the shell holds no state**, which is what keeps DDR-0027 intact. The status
  row is **absent, not empty**, where there is nothing to refresh. `lib/analyticsShell.ts` holds
  the branch mapping; its test fails if a view re-declares the guard, wrapper, or header.
- **Charts are dependency-free inline SVG** sized by **aspect ratio, never a pixel width**
  (DDR-0018), because an axis label is 11 *viewBox units* — halving the column halves the label.
  Performance's four charts share one geometry (`lib/chartGeometry`), and both grid breakpoints
  derive from **one** number (`GRID_CONTENT_BREAKPOINT_PX`, 1200) with the sidebar width as a
  defaulted parameter, so neither can be tuned alone. Don't "restore" the old breakpoint by
  lowering it — that ships illegible labels; capping a chart's width stays **rejected**
  (DDR-0051, DDR-0057). **A `viewBox` clips an overflowing label in silence**, so `pad.left` is
  *derived* from a measured glyph advance and a character budget (DDR-0051 §#190). A stacked
  chart's key lives in the **card header**, not a `<figcaption>` — `ColumnChart` and
  `StackedAreaChart` both emit a bare `<svg>` (DDR-0052, DDR-0064).
- **One chart tooltip, drawn inside the `viewBox`** (DDR-0061). Three `HoverReadout`s became
  `ChartTooltip` over `lib/chartTooltip`, in the plot's own space — so it **cannot** cover the
  neighbouring chart — and **pinned to the plot's top** in all three, never tracking the mark. A
  row's label is prose (sans), its date a figure; sharing one rule keeps `tokenAdoption` at
  **eight**. The area fill is a `<linearGradient>` with **stops in `app.css`, `fill` per element**
  (`useId()` — two curves, one page); `LineChart` draws a zero line only where the series *crosses*
  zero. Bars, `.stack-band` and the donut's native tooltip are untouched.
- **Chart maths that has drawn a wrong picture before.** The performance curve is **cumulative
  TWR**, not a value curve, so deposits and withdrawals don't move it (DDR-0013). Daily returns are
  **chain-linked from that curve** (`lib/dailyReturns`), never differenced from `valueSeries`, and
  take the **unwindowed** series, so the opening bar measures against the day that really preceded
  it; bars **thin rather than aggregate** (DDR-0049). Composition stacks **cumulatively in base
  currency** with the top edge as NAV: a negative band **hangs below the zero line** (never
  clamped or folded), and `other` is the **residual, surfaced and never redistributed** — drop a
  category into it instead and nothing will look wrong (DDR-0052).
- **The map popup's tint is banked into its edges, and the geometry is what lets it be loud**
  (DDR-0041): the gradient's inner stops sit at `--popup-pad-y`, an **absolute length, not a
  percentage** (a percentage band creeps under the text of taller popups), and
  `--popup-edge-hold` must stay **strictly below** it or the first line lands on undiluted `--pos`.
  `--pos`/`--neg` may never be the *only* channel on a mark; a figure must accompany them
  (DDR-0021, superseded but still governing).
- **The sidebar's gateway badge is derived, never polled** (DDR-0056) — its source is the last
  `portfolio:getOverview` result, which is why that tab is excluded from stay-mounted. The one
  `setTimeout` in `SidebarRail.tsx` is a **clock** arming the moment a live reading goes stale,
  not an interval. `displayCurrency` is the **app's** selection, so the control is never
  disabled.
- **One sector, one hue, everywhere.** `pie-series-1` — the palette's only blue — is reserved for
  the map's country-weight donut, so the *sector* dimension starts at slot 2 (`SECTOR_SLOT_OFFSET`
  in `lib/pie`) wherever a sector appears. Only sectors pay it; asset class, currency and country
  keep all eight. Don't put a new chart on slot 1 beside sectors, and don't un-reserve the blue —
  widen the palette instead (DDR-0030).
- **The Allocation map is a `role="group"`, not an `img`** (DDR-0047) — it must contain Mapbox's
  attribution links, so the graphics are made inert instead: `keyboard: false`, canvas at
  `tabindex="-1"`, and **every marker host at `tabindex="-1"` set *before* the `Marker` is
  constructed**, because Mapbox only assigns its own when the element lacks one. It is **one view,
  coloured by sector** — the gain/loss mode was withdrawn and `designTokens.test.ts` pins that
  *absence*, so don't paint wedges green and red (DDR-0045). Geometry and colour live in
  `lib/countryDonuts`, which emits palette **classes** rather than values.
- **The Allocation breakdown's table and donut link on the slice's `key`, never on position** — the
  table sorts by any column, so row order and arc order have no reason to agree. Emphasis **never
  touches `fill`**: the active wedge keeps its colour and the rest drop to 0.35 opacity (DDR-0040).
  The donut's track is **fixed** (`--donut-column-width`) and its stacking breakpoint derived;
  `allocationLayout.test.ts` has the arithmetic (DDR-0063).
- **The basemap and the weight donut's track are one decision** (DDR-0063): the track was `--card`
  at 42%, a grey ring *only over a white map*, and vanishes on `dark-v11`. Move both or neither.

### UI primitives (`components/ui/`, Epic #125)

Each replaced several hand-rolled class families and has a guard test in `lib/*Variants.test.ts`
failing the same three ways: a superseded selector reappears, an axis value has no rule in
`app.css`, or the primitive re-declares something the shared rules own (focus ring, `:disabled`,
`outline`). **Read the DDR before changing an axis** — each records call sites and rejected
alternatives this table can only name.

| Primitive | Axes | The rule that isn't obvious |
| --- | --- | --- |
| `Button` (DDR-0032) | `variant` × `size` (`icon` is a *shape*) | `ghost` changed meaning — the old `.ghost-button` is now `secondary`. `type` defaults to `"button"`. `className` is for **placement, not colour**. |
| `Card` (DDR-0033, DDR-0059) | `variant` (surface colour) × `size` (`--surface-pad-*`) | `CardContent` is a **scope** — descendant rules hang off it, keeping a state panel's prose out of reach. The ruled header strip bleeds to the edges by negating `--card-pad`, which each size **restates beside its `padding`** (change one, change both). `.card-header:last-child` gives the strip back. |
| `StatTile` / `StatRow` (DDR-0034, DDR-0060) | `tone` only | A tile **is** a `Card`, so it declares no surface. **Neutral is the absence of a rule.** Its label is the app's *one* micro-label — the same four declarations as `.data-table thead th`; don't grow a second. |
| `Field` + `Select` + `DateInput` (DDR-0035) | `kind` only | **`Field` generates its id with `useId()` and takes no `id` prop** — tabs stay mounted, so all three `RangeFilter`s can be in the document at once and a fixed id would name only the first. |
| `ToggleGroup` (DDR-0036) | `mode`, which is **worn** (`--radius-md` vs `--radius-pill`) | **Never a tablist**: `aria-pressed`, not `role="tab"`. Only `.app-tab` is a real tablist. |
| `Badge` (DDR-0037, DDR-0064, DDR-0065) | `variant` × `size` | **Never a pill** (that corner means multi-select) and **never a background** — the toned pair keeps both: `--pos` / `--neg-text` ink, the *borders* take the fill tokens. `BADGE_VARIANTS` ⊇ `STAT_TONES`, so `toneOf()` names a variant. `sm` carries no vertical padding — with it, every holdings row grows ~7px; alone in a cell it also needs `BADGE_CELL_CLASS`, because CSS cannot see that an inline chip follows a *text node*. Trades' side badge is **untoned on purpose** (DDR-0065): a buy is not a gain, and no substitute hue is free either. |
| `StatePanel` (DDR-0038) | `variant` (the state) × `surface` | Only `error` paints; the axis exists because the copy and the *announcement* differ. `role` is derived. No heading → the panel **is** a `<p>`. |
| `DataTable` (DDR-0039, DDR-0059, DDR-0065) | the *container's* `surface` × `height` | Sorting is **opt-in per column**; a **missing value sorts last in both directions**. `.data-table-dim` is the absent-value cell — a *neutral* tone is the **absence** of a class, so an untoned cell keeps `--text`. The 11px column head and its `0.06em` tracking are a **pair**. The linked row's lift is scoped to match the hover's specificity and win on source order — unscoped, `tr:hover > th` silently out-specifies it. |

## Architecture

Dependencies point downward only, and the boundary is **ESLint-enforced**.

```text
src/renderer      React UI. No business logic, no data source.
        ↓ IPC     (window.api only)
src/main          thin handlers: validate with Zod, delegate to a service
        ↓
src/services      business logic, calculations, orchestration
        ↓
src/repositories  the only layer that touches a data source
        ↓
SQLite / Interactive Brokers Gateway
```

Repositories expose **domain-oriented** methods, so a service never knows where data originates.
Keep `src/repositories/README.md` in step when adding one. The database holds local history, app
metadata and cached derived data — don't duplicate live brokerage data there unless analytics needs
it. Longer treatments (*Layer Responsibilities*, *Repository Pattern*) are in `docs/architecture.md`.

## Stack

Node ≥22.12 (CI runs 24) · npm · Electron · React + Vite · TypeScript (renderer **and** main) ·
SQLite via Drizzle · Zod · IBKR Client Portal Gateway · Vitest · Playwright.

Runtime dependencies are deliberately few — `better-sqlite3`, `drizzle-orm`, `fast-xml-parser`,
`mapbox-gl` (the Allocation basemap only), `react`, `react-dom`, `zod`.
**Avoid adding dependencies without clear long-term value.**

## Commands

```bash
npm install            # postinstall: electron-rebuild for better-sqlite3 (native)

npm run dev            # Electron + Vite dev server (hot reload)
npm run build          # build main + preload + renderer into out/
npm start              # preview the built app
npm run package        # build + distributable via electron-builder

npm run lint           # eslint . (also enforces the layer-boundary import rules)
npm run typecheck      # tsc --noEmit
npm test               # vitest run — Node env, *.test.ts under src/
npm run test:watch
npm run test:e2e       # builds, then Playwright launches the built app

npx vitest run src/services/meta/metaService.test.ts   # a single unit test
npx vitest run -t "generates and persists"             # by test-name substring
npm run build && npx playwright test e2e/tab-navigation.spec.ts   # a single e2e spec

npm run db:generate    # emit SQL migration from schema.ts changes
npm run db:migrate     # apply to ./local.dev.db (dev tooling only; override with DATABASE_URL)
npm run db:studio
```

Migrations apply automatically on launch; `db:migrate` is for the standalone dev DB. There is no
lint-fix or aggregate `check` script. **CI** runs exactly `lint`, `typecheck`, `test` and `build`
on every push to `main` and every PR (Node 24, Ubuntu). The Playwright suite is **intentionally
excluded from CI** (needs a display server) — run `npm run test:e2e` locally. Run all four before
opening a PR.

## Testing

Services are the primary unit-test target; mock repositories and external providers.

**Vitest runs every test under `src/` in a Node environment with no jsdom, so no test may render a
React component.** This shapes the renderer: chart maths, filtering, sorting, formatting and state
are **extracted into pure modules under `renderer/src/lib/`** precisely so they can be tested —
follow that split when adding a component with real logic. Pure repository helpers
touching no data source (`flexStatementParser`, `snapshotMapping`, `fifoSummary`) are tested alike.

Several `lib/*.test.ts` files have **no module under test** — they guard `app.css`, the components,
a view's own composition, or accessibility by scanning source text. What no Node test can see is
pinned by Playwright: `e2e/page-header.spec.ts`, `e2e/tab-navigation.spec.ts`, `e2e/reduced-motion.spec.ts` (that the
media query actually wins the cascade), `e2e/window-state.spec.ts`, `e2e/sidebar-collapse.spec.ts`.

Every completed feature should include unit tests, regression review, edge-case validation, and a
Testing Report.

## Skills System (`.claude/skills/`)

Four tiers. Each stage produces an artifact that is the next stage's input; execution skills
consume only *approved* artifacts and must not redefine requirements, design, or architecture.

They are **plain `SKILL.md` files, not `Skill`-tool skills** — read
`.claude/skills/<tier>/<name>/SKILL.md` directly; invoking one by name resolves nothing.

- **workflow-skills** (planning) — `product-manager` → `ui-designer` / `architect` →
  `database-designer` → `implementation-engineer` → `testing`.
- **execution-skills** — `feature-implementer`, `repository-builder`, `service-builder`,
  `api-builder`, `ui-builder`, `storage-builder`, `assistant-builder`. The Implementation Engineer
  selects the minimum set.
- **governance-skills** — `adr-writer` (→ `docs/decisions/`), `design-recorder`
  (→ `docs/design-decisions/`), `refactoring-reviewer` (required before significant restructuring).
- **project-management** — `issue-writer` helps the owner *draft* backlog issues;
  `project-historian` backfills historical ones. These track work; they never design it.

Work **originates in GitHub Issues** — the owner authors Epics and Stories, and the Product Manager
**reads them before planning**. Issues are never created after implementation to record work done.

Small bug fixes may skip planning artifacts. **Any change to an already-approved decision must stop
and return to the owning workflow skill rather than being made inline.**

## Documentation

`docs/` holds `architecture.md`, `database.md`, `product.md`, `mcp.md`, `github-issues.md`, plus
`decisions/` (ADRs) and `design-decisions/` (DDRs), each with a README indexing every record in one
line. Two directories are **gitignored and local-only**, so a fresh clone has neither:
`flex-queries/` and `figma_design/`.

Project history is **not** kept in local files — milestones and work items live in GitHub Issues;
the record of completed work is the git history and closed issues.

Consult documentation in this order: **`docs/decisions/` → `docs/design-decisions/` →
`docs/product.md` → GitHub Issues → `docs/architecture.md` → `docs/database.md`.** On a conflict:
identify it, explain the tradeoffs, and request clarification or propose a new ADR. **Never silently
override an accepted decision.**

## MCP Servers

`.claude/settings.local.json` enables `context7`, `filesystem`, `playwright`, `interactive-brokers`
and `shadcn`. The `shadcn` server is for *reading* component APIs only (ADR-0008). The
`interactive-brokers` entry in `.mcp.json` still has a **placeholder runtime**
(`REPLACE_WITH_RUNTIME`), so enabling it does not make it functional. A connected
`Interactive_Brokers_IBKR` MCP has read-only account/market tools allowlisted — **no
order-placing tools**.

**Prefer Context7 over model memory** for framework or library documentation. Setup notes: `docs/mcp.md`.

## Product guardrails

Stock Portfolio Viewer is a **standalone, single-user, local-first desktop application** for
personal portfolio analytics, **analytics-first, not advice-first**.

AI features (a later milestone) may explain changes, summarize performance, compare periods and
answer questions. AI must **never** recommend investments, suggest trades, decide allocations, or
execute transactions. Robo-advisor functionality is out of scope; the owner decides.

## Current Priority

Milestones live in GitHub Issues. Read the backlog to find the active milestone and its work items:

```bash
gh issue list --state open --label epic
gh issue list --state open --milestone "<milestone title>"
gh api repos/:owner/:repo/milestones --jq '.[].title'
```

Prioritize the current milestone over future ones unless explicitly instructed otherwise.
