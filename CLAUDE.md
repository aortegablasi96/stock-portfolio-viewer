# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current Repository State

**M0–M3 are merged and closed; refinement continues under M4.** Scaffolding (M0), the
read-only portfolio dashboard (M1), historical snapshots (M2), and the performance &
allocation analytics (M3, Stories #20–#24) are all on `main`. The app boots, connects to the
Interactive Brokers Client Portal Gateway, renders live holdings/balances/allocation in a
user-selected display currency, captures immutable snapshots (on open + on demand), imports
IBKR Flex Query statements into local history, and renders four analytics views over that
imported data (performance, allocation, dividends, realized gains & trade history). A tab
shell switches between the live Portfolio dashboard and the analytics views.

**The views have been refined repeatedly, and refinement is ongoing.** Epic #4 (M3) absorbed
four rounds before being closed as delivered: #28–#33 (display currency, day-by-day
performance, allocation donuts + sector breakdown, net dividend chart + upcoming dividends,
filterable dividend and trade tables), #42–#73 (frameless window shell, destructive-reset
controls, TWR curve + chart tabs, world bubble map, cash as an asset class, tabbed breakdowns,
time-range filters, multi-select type filter, `Symbol`→`Ticker` renames), and #74, #75, #76,
#89, #92, #95 (dividend shares held + per-share, time-range filter on the dividend and trade
tables, a widened content measure with charts sized by aspect ratio, and the Allocation map's
rebuild onto a Mapbox basemap with per-holding bubbles and a gain/loss colour mode).

**Further refinement lives in milestone `M4 — Analytics refinement`, split across area-scoped
Epics** so no single Epic grows unbounded again. Open as of 2026-07-31: **#98 Allocation map**,
**#99 Analytics views polish** (the four analytics views + the live Portfolio dashboard), **#102
Gateway & data reliability**, and **#125 Shared UI primitives & visual consistency** (stories
#126–#134). **#100 App shell & layout** (window chrome, tab shell, page layout) is closed as
delivered — its shared-control scope was superseded by #125. An Epic closes when its stories
close; new refinement opens a new Epic under the current milestone rather than reopening a
delivered one. **Read the backlog before assuming a view is final** — a
view you are told is "done" has usually been reworked several times. The Stack and Commands
sections below are **live**. Still **not built**: AI features, multi-broker support, benchmark
comparison, and tax reporting — those are later milestones.

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
  tables. The services mirror that split: `flexImportService` writes (import + whole-store
  clear), `flexStatementsService` reads the store's *shape* — which statements are held and the
  span they cover — behind `flex:listStatements`, so the Portfolio tab can answer "what are my
  analytics built from?" on launch with no import. Coverage is a **min/max** over all
  statements, computed in the service, because statements may overlap or be imported out of
  order; an empty store is an empty list, not a result variant (DDR-0026). `flex_prior_period_positions` holds the per-instrument daily MTM series that backs
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
  double-count. Three traps worth knowing before touching these services. IBKR's FIFO summary
  carries a **"Total (All Assets)" aggregate row** (blank symbol) that must be filtered out or
  it doubles every total — use `isInstrumentSummary` (`repositories/flex/fifoSummary.ts`, kept
  DB-free so services and their tests share the real predicate). The same FIFO summary mixes
  **a flow and a balance in one row**: realized P&L is per-period and *must* be summed across
  statements, while unrealized P&L is an as-of balance that must *not* be — an instrument held
  through two statements reports its unrealized gain in both. Scope that half with
  `fromLatestStatement` (same module); `getFifoSummaries()` therefore returns each row's
  `statementId` + `statementToDate`, and "latest" means the largest **end date**, not the
  largest id (ids follow import order). This shipped broken once, 25% overstated (#103).
  Finally, allocation's **cash slice is the NAV residual**
  (`ChangeInNAV.endingValue − Σ invested market value`), *not* the `percentOfNAV` shortfall,
  because Flex's `percentOfNAV` sums to 100% across positions and excludes cash — the
  shortfall approach shipped broken once already. See DDR-0005, DDR-0010, DDR-0015.
- **classification** — instrument sector/industry (M3, Story #30). Flex carries **no sector
  field**, so `classificationRepository` fronts *two* sources — the mutable SQLite cache
  `instrument_classifications` and `ibkrGateway` — and `classificationService` decides which
  conids to fetch (latest statement's positions, uncached only, sequential). `allocationService`
  joins the cache with a plain sync read, so Allocation still renders with the gateway closed;
  unclassified positions form their own slice. The `analytics:classifyInstruments` channel is the
  only analytics channel that reaches IBKR. A refresh is **resumable, not transactional**: the
  fetch loop's failure is captured, the rows already fetched are written, and only then is the
  outcome mapped — so a run that dies on instrument 30 of 40 keeps 29, and the next run re-derives
  its work list from the cache and asks only for the rest. Every failure variant therefore carries
  `partial: { fetched, classified, remaining }`, and the run pushes `analytics:classifyProgress`
  events (`{ completed, total }`, where `total` counts *uncached* instruments) so the sequential
  loop isn't silent. See DDR-0009, DDR-0023.

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
                 TitleBar, components/ + components/analytics/ (views, their use*
                 hooks, shared filter controls) + components/charts/ +
                 components/ui/ (shared primitives, Epic #125) +
                 lib/ — pure, unit-tested helpers extracted out of components)
  services/      pure business logic — primary unit-test target (system/, meta/, window/,
                 portfolio/, snapshots/, flex/, analytics/, dividends/)
  repositories/  the ONLY layer that touches a data source: SQLite (meta/, snapshots/,
                 flex/), the IBKR gateway (portfolio/portfolioRepository.ts + ibkrGateway.ts),
                 or both (classification/)
  db/            client.ts (better-sqlite3 + Drizzle singleton), migrate.ts, schema.ts
  shared/        ipc/contract.ts (Zod schemas + inferred types), ipc/channels.ts,
                 domain/ (portfolio.ts, snapshot.ts, flex.ts, performance.ts,
                 allocation.ts, dividends.ts, realizedGains.ts,
                 classification.ts), errors.ts
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
  dependency-free inline SVG (`components/charts/`) — including the allocation donuts and the
  performance view's cumulative **TWR** curve, chosen over a value curve so deposits and
  withdrawals don't move it (DDR-0013). They are sized by **aspect ratio** (the `viewBox`), never
  a pixel width, because they scale to a shared `--content-max` column (DDR-0018). The
  **Allocation map is the one scoped exception**: a Mapbox GL JS basemap (ADR-0007) carrying, per
  issuer country, **two donuts side by side** — the left the country's weight in the portfolio (its
  share of NAV in blue against a muted remainder, on an **absolute 0–100% scale**), the right one
  slice per sector — with the pair's area proportional to the country's market value and anchored to
  ISO-3166 alpha-2 centroids, which makes the map deliberately *approximate*, positioned by issuer
  country rather than by company (DDR-0030, superseding DDR-0020 on the unit, the spiral spread, the
  canvas layer and per-holding granularity). Six things to know before touching it. The marks are
  **SVG carried by `mapboxgl.Marker`, not painted into the canvas** — a circle layer paints one flat
  fill per feature, so donut slices have no canvas equivalent. Colour therefore needs no
  `getComputedStyle`: a palette class on a `<path>` *is* the fill, so `.map-diverge-*` carries `fill`
  as well as `background` and a colour-mode switch is an ordinary re-render, not `setPaintProperty`.
  **The split into two charts is what makes the colour work, and three earlier forms failed on
  exactly that** — a nested sunburst forced every holding to wear its sector's hue and rendered as
  one solid block; a holdings donut needed eight distinguishable hues on a 40px mark. Here each chart
  has one job and the colours that job needs exist: the left shows one number, the right shows
  sectors, which already have a palette. **`pie-series-1` — the palette's only blue — is reserved for
  the country weight, so the *sector* dimension starts at slot 2** (`SECTOR_SLOT_OFFSET` in
  `lib/pie`), applied everywhere a sector appears (map, map legend, Sector donut, its table) because
  the invariant is one sector/one hue *everywhere*. Only sectors pay it: asset class, currency and
  country keep all eight slots. Don't put a new chart using slot 1 next to sectors, and don't
  un-reserve the blue — widen the palette instead. **Holdings are not on the map at all** — that retires
  DDR-0020's per-holding granularity; the Positions table is where one company is read, and the
  `aria-label` says so. **The 2% slice floor applies to sectors only** — applying it to the weight
  donut would overstate every small country, which is the one thing a proportion chart must not do.
  Two colour modes ride behind a toggle: the sector palette, and unrealized **return on cost** (not
  absolute P&L — size already encodes that). That second scale is **red ↔ gray ↔ blue, deliberately
  not the app's `--pos` / `--neg` green/red**, which fails CVD contrast where fill colour is the only
  channel and no number sits beside it. Don't "restore" them on the slices (DDR-0021) — but the popup
  *is* tinted `--pos` / `--neg` by the hovered subject's return, which is exactly the case DDR-0021
  carved out: a figure sits two rows below the tint. Finally, a country under an 8px radius becomes a
  **single disc** in its largest sector's hue (two donuts that small are two smudges), and note that
  an SVG `<g>` is only ever hit *through its children* — grouping slices and putting
  `pointer-events: auto` on the group catches nothing. All of this lives in `lib/countryDonuts`. See
  DDR-0005, DDR-0006.
- **A view that outlives its tab:** an analytics tab mounts on **first visit and then stays
  mounted**, hidden rather than unmounted, so returning to it keeps both the report and every
  bit of view-local state (time range, type chips, chart tab, map colour mode) — nothing is
  restored because nothing was discarded. Unvisited tabs still issue no IPC. The consequence to
  respect: a mounted view can go stale, so both Flex write paths (`FlexImport`'s import and
  clear, the inline `NeedsImport` action) bump `renderer/src/lib/dataVersion`, and every
  `useAnalytics` re-reads on a bump. `loading` therefore means the **first** load only — a
  reload keeps the current report on screen and reports itself through `refreshing`, which is
  what makes the shared `RefreshBar` (reading time + Refresh) non-destructive. The **Portfolio
  tab is deliberately excluded** and still re-reads on every visit: it shows live IBKR data,
  which changes with no event to signal it. See DDR-0027 (extends DDR-0006).
- **The tab bar is the full WAI-ARIA tabs pattern**, not a styled row of buttons (DDR-0029).
  Every view — the Portfolio dashboard included — is wrapped in a `TabPanel` (`role="tabpanel"`,
  `id="panel-<tab>"`, `aria-labelledby="tab-<tab>"`, `tabIndex={0}`) and its tab points back with
  `aria-controls`, **set only on the selected tab** because an unvisited tab has no panel in the
  tree to name. A roving `tabindex` (selected `0`, the rest `-1`) makes the tablist one Tab stop,
  so a keyboard move must `focus()` the new tab through the ref map — the tab being left stops
  being focusable. Arrow/Home/End use **automatic activation** (focus selects), which is why
  arrowing past an analytics tab mounts it exactly as clicking would; the index arithmetic sits
  in `renderer/src/lib/tabKeyboard.ts` because nothing inside a component is testable under
  Vitest's Node environment, and the attributes and focus moves are pinned by
  `e2e/tab-navigation.spec.ts`. The active tab carries a 2px bar under its label as well as the
  accent colour: accent-on-pill is two cues but both are colour. Don't drop the bar.
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
- **So is the window's size, position and maximized state** (DDR-0028): with no OS frame there
  is no OS behaviour restoring anything. `windowStateService` keeps one JSON value under the
  `app_meta` key `window_state` via `metaRepository` — metadata that is overwritten, not
  history, so no new table and no migration. Three traps live here. The service may not import
  `electron`, so `main` passes display geometry **in** as plain rectangles and the off-screen
  recovery stays a pure, unit-tested function. What is persisted is **`getNormalBounds()`**,
  never the maximized bounds — a maximized window must remember the size it restores *to*, and
  a **minimized** one is skipped entirely because it reports neither useful bounds nor (on
  Windows) its maximized state. And a restored rectangle is re-applied with **`setBounds()`,
  not the constructor**: only `setBounds` is the inverse of `getNormalBounds()`, since Windows
  adds its invisible resize border to a frameless window — round-trip through the constructor
  instead and the window grows a couple of pixels *every launch*. `e2e/window-state.spec.ts`
  opens the app three times specifically to pin that down. Reachability is judged on the 40px
  **title bar**, not the window's area: a body covering the screen with its bar above the top
  edge cannot be dragged. A reachable position is left exactly as the owner left it, including
  one straddling two displays.
- **Exactly one instance runs at a time.** `main/index.ts` requests
  `app.requestSingleInstanceLock()` at **module load**, before any `whenReady` work is
  registered, so the losing process quits without running migrations, capturing a snapshot, or
  opening the database (`getDb()` is lazy — nothing before the lock request touches it); the
  winner focuses its existing window on `second-instance`. That ordering is the point: every
  write path assumes it is the only writer, and two processes on one SQLite file would
  duplicate history silently rather than error. The lock is scoped to the user-data directory,
  which is why the e2e suite's second app — its own `--user-data-dir` — still starts
  (DDR-0025).
- **Adding an IPC channel touches four files, in this order**: `shared/ipc/channels.ts`
  (name) → `shared/ipc/contract.ts` (Zod request/response schema + the `RendererApi` method)
  → `preload/index.ts` (bridge impl) → `main/ipc/handlers.ts` (parse input, delegate to a
  service). `contract.ts` is the single source of truth for the wire shape; the renderer and
  preload import only *types* from it so Zod never lands in those bundles. Domain result
  schemas themselves live in `shared/domain/*.ts` (that is where every analytics
  `ok | needs_import` union is declared) and `contract.ts` composes them — put a new one there,
  not inline. Failures cross IPC **as result variants, not exceptions** (`not_connected`,
  `not_responding`, `needs_import`, `canceled`, `invalid`, `error`) so the renderer can render
  each as a first-class state. `not_connected` and `not_responding` are **not**
  interchangeable: the first is a gateway that isn't running, the second one that accepted the
  request and then stalled past its bounded wait, and `IbkrTimeoutError` is deliberately not a
  subclass of `IbkrNotConnectedError` so no `instanceof` check can quietly merge them
  (DDR-0022). Success is *not* uniformly `ok`: capture returns `captured`, import
  `imported`, and both clears `cleared`.
- **That four-file recipe assumes a request/response channel** (`invoke`/`handle`), which is
  almost all of them. The exception is the three payload-free `window:minimize |
  toggleMaximize | close` commands: they use `ipcRenderer.send` / `ipcMain.on` and skip
  `contract.ts` entirely, since with no payload there is nothing to Zod-validate. Main→renderer
  events (`snapshot:captured`, `window:maximizeChanged`, `analytics:classifyProgress`) are
  `ipcRenderer.on` subscriptions that return an unsubscribe function (DDR-0011). A service that
  needs to emit one takes a **callback** and lets the handler send it — services may not import
  `electron` (DDR-0023).
- **`instrument_classifications` is the one mutable table** — it's a *cache* of derived
  reference data (upserted by conid), not history (DDR-0009). Every other table is append-only
  **during normal operation**: no record is ever edited, partially deleted, or silently
  mutated by the app's data flow. There is exactly **one sanctioned exception** — a
  whole-store, owner-confirmed reset per domain (`flexRepository.clearAll()` /
  `snapshotRepository.clearAll()`), so bad imports can be discarded wholesale and rebuilt.
  Deliberately no delete-by-id/date/statement variant; don't add one (ADR-0006).
- **Renderer styling is being consolidated in-house, and shadcn/ui was deliberately declined**
  (Epic #125, scoped 2026-07-31). The `shadcn` CLI sits in devDependencies and its MCP server is
  enabled — as a *reference* for the component API, not as a dependency to install. Do not run
  `shadcn add`, and do not propose adopting the package again without new reasons: it would pull
  Tailwind v4 + PostCSS into the renderer build plus `radix-ui`, `cva`, `clsx`, `tailwind-merge`
  and `lucide-react`; ~40% of the 1,880-line `renderer/src/app.css` is chart/donut/map styling
  shadcn has no equivalent for (so the app would run two styling systems); Radix Tabs would
  displace `lib/tabKeyboard.ts`, which exists precisely because Vitest is Node-only (DDR-0029);
  and DDR-0012 already rules out the modal components carrying much of shadcn's value. What *is*
  adopted is the API shape — a `variant`/`size` prop contract and `Card`/`CardHeader`/
  `CardContent` composition — for primitives built under `renderer/src/components/ui/` and styled
  by the existing CSS custom properties. That decision is now recorded as **ADR-0008**, so it is
  overridden by a superseding ADR, not by a pull request. The CVD-safe palettes stay untouched
  (DDR-0021, DDR-0030).
- **`app.css` has a full token scale now, and a rule uses a step rather than a raw length**
  (Story #126, DDR-0031): `--space-1..8` (a 4px grid with one deliberate 6px half-step at
  `--space-2`, where the app's dense controls actually sit), the composite `--control-pad-*` /
  `--surface-pad-*` in `sm|md|lg` (the same vocabulary as the primitives' `size` prop, so the CSS
  and the component API agree by construction), `--radius-sm|md|lg|pill` in **px** so a corner
  doesn't grow with the type scale, and `--text-2xs..2xl` + `--leading-tight|normal`. Two things
  are deliberately *off* the scale: chart and map SVG label sizes, which scale from a `viewBox`
  rather than the page (DDR-0018), and the sub-6px radii, which are chart geometry. The scale is
  declared but **only partly adopted** — each story in #125 converts the rules it extracts, so
  until the Epic closes both conventions coexist on purpose. The named collision to know:
  `--text-xl` is **1.4rem, not 1.5rem**, because `.stat-row` packs tiles into `minmax(11rem, 1fr)`
  columns where the bigger figure risks wrapping.
- **There is one button, and adding one means naming a role, not writing CSS** (Story #127,
  DDR-0032). `components/ui/Button.tsx` replaced the eight families the audit found —
  `.capture-button`, `.danger-button`, `.ghost-button`, `.retry-button`, `.view-refresh`,
  `.type-filter-clear`, `.titlebar-button`, `.map-zoom-btn` — with `variant` ×
  `size`. **Variants carry colour and border only**: `outline` (default) · `primary` (filled
  accent — the one action a panel offers) · `secondary` (bordered but quieter: Cancel, Refresh) ·
  `danger` · `ghost` (**borderless**, window chrome) · `link` · `surface` (its own `--card` fill and
  shadow, because it floats over the Mapbox basemap and a transparent button on arbitrary tiles is
  unreadable). Note `ghost` changed meaning: the old `.ghost-button` had a border and is now
  `secondary`. **Sizes carry padding and type only** — `sm|md|lg` are the `--control-pad-*` steps,
  while `icon` is a *shape*, a square with no text box, which is why the two icon buttons differ by
  variant rather than sharing one. Four things to know before touching it. `type` defaults to
  `"button"`, so no caller can ship a submit button by omission. **No variant declares a focus ring
  or its own `:disabled`** — both fall through to the shared rules, and
  `lib/buttonVariants.test.ts` fails if one tries, if a union member has no rule in `app.css`, or
  if any of the eight superseded selectors reappears. `className` is appended for **placement, not
  restyling** (`.titlebar-controls .btn`, `.map-zoom-reset`); a `className` carrying colour rebuilds
  the problem one view at a time. And `.btn` declares **no `line-height`** on purpose: `font:
  inherit` leaves it `normal`, which is what all eight families used, and "adopting"
  `--leading-tight` here takes ~3px off every button and lifts the whole Portfolio page, since
  `.dashboard-header` is `align-items: flex-end` over the actions column.
- **There is one card surface too, on the same two axes** (Story #128, DDR-0033).
  `components/ui/Card.tsx` (`Card` / `CardHeader` / `CardTitle` / `CardContent`) replaced
  `.state-panel`, `.panel`, `.allocation`, `.snapshot-history` and `.highlight-card`. **Variants
  carry the surface colour**: `default` (`--card`) · `nested` (`--bg`). **Sizes carry the padding**
  and *are* the `--surface-pad-*` steps — `sm` nested, `md` panel, `lg` state panel — so the API and
  the CSS can't drift; a test fails if a size stops resolving to its step. Five things to know.
  `.highlight-card`'s `--bg` was **kept, not normalised**: that card sits inside a panel, where
  `--card` on `--card` is a border with nothing behind it. **`CardContent` is a scope, not
  decoration** — the two rules `.panel` declared on its descendants (a `.table-scroll` filling the
  body drops its border; a `.source-note` lede sits tighter) now hang off `.card-content`, which is
  what keeps a state panel's prose out of their reach; scoping them to `.card` would give the *not
  responding* panel a negative top margin it was never written for. **`as` is a prop** because the
  superseded surfaces weren't one element — the one-line loading states are a `<p>` whose UA margins
  space `.dashboard`'s flex column. **One heading treatment, sentence case**, because
  uppercase-with-tracking is this app's *label* treatment for a single figure (`.stat-label` and
  friends) and spending it on section headings loses the distinction. And `.state-panel` survives
  shrunken to `color: var(--muted)` — only the surface moved; Story #133's `StatePanel` folds the
  rest, so `className="state-panel state-error"` is transitional, not the pattern.
- **A headline figure is a `StatTile`, and it has no surface rule of its own** (Story #129,
  DDR-0034). `components/ui/StatTile.tsx` (`StatTile` + `StatRow`) replaced the same component
  written twice — the dashboard's `.balance-tile` and the analytics views' `.stat-tile`, whose
  labels were byte-identical and whose values disagreed only on `1.5rem` vs `1.4rem` (`--text-xl`,
  1.4rem, wins). The two tile rules collapse to **none**: a tile *is* a `Card` at `default`/`md`,
  so the surface is the card's and only the three lines and the tone remain. Four things to know.
  The tile's axis is **`tone`, not `variant`/`size`** — a headline figure is always a panel-level
  tile, so those two axes would each have one value. **Neutral is the absence of a tone**:
  `toneClassName('neutral')` returns `''` and there is deliberately no `.stat-neutral` rule, which
  is what lets one helper serve a tile, a table cell, the realized-gains highlight and the map
  popup, each keeping the ink it inherits. `.stat-positive` / `.stat-negative` keep their names
  because those three non-tile callers wear them — they are the app's tone semantic, not the
  tile's internals, and they stay `--pos` / `--neg` (the case DDR-0021 carves out, since a figure
  sits beside the colour). And `.stat-row` is `auto-fit` over `minmax(11rem, 1fr)` for both
  callers, which is why the balances row needs no breakpoint of its own any more.
  `lib/statTileVariants.test.ts` fails if a `.stat-*` rule starts declaring a surface again, if a
  part or tone has no rule, or if `.stat-neutral` acquires one.
- **A labelled control is a `Field`, and it owns the `id`** (Story #130, DDR-0035).
  `components/ui/Field.tsx` + `Select.tsx` + `DateInput.tsx` replaced `.field-inline`,
  `.select-control` and the `.range-custom` date override — one class that styled both form
  controls while the two call sites *labelled* them differently (`<label htmlFor>` + `id` vs a
  `<label>` wrapping a bare `<span>`), which is the only reason
  `.range-custom .field-inline span` existed. Four things to know. **`Field` generates the id
  with `useId()` and takes no `id` prop**, because analytics tabs stay mounted (DDR-0027) — all
  three views carrying a `RangeFilter` can be in the document at once, and a defaulted id would
  appear three times, silently pointing every label at the first control and leaving the rest
  unnamed. The control is passed as **a function of that id** (`{(id) => <Select id={id} …/>}`)
  so a call site can't receive it and forget to apply it. **The control has no `size` axis** —
  both call sites are the same dense box, so `kind` (`select | date`) is the only one, carrying
  cursor and `color-scheme` only; everything else is the shared `.control`. And its hover and
  disabled rules **are** `.btn-outline`'s and `.btn`'s, compared body-for-body by
  `lib/fieldVariants.test.ts`, which also fails if a `.control`/`.field` rule declares `outline`
  or if any of the three superseded selectors reappears. `DateInput` fixes `type` rather than
  defaulting it: a different type would strip the meaning from the `min`/`max` bounds that keep
  the picker inside the imported history (DDR-0017).
- **A group of related choices is a `ToggleGroup`, and it is never a tablist** (Story #131,
  DDR-0036). `components/ui/ToggleGroup.tsx` replaced `.chart-tab` — the class the audit called
  "a control invented twice", which was in fact invented **five** times: the Performance chart
  switcher, the Allocation map's colour toggle and its breakdown strip, the `RangeFilter`
  presets and the `TypeFilter` chips. Four things to know. Its axis is **`mode`
  (`single | multiple`), and the mode is *worn*** — a single-select item keeps `--radius-md`, a
  multi-select item is `--radius-pill` — because the Dividends and Trade history views stack
  both kinds one above the other and until this story they were indistinguishable; `.toggle-item`
  declares no corner at all, so neither mode is the other's silent default. **The three
  `role="tablist"` call sites were corrected, not completed**: they declared `role="tab"` +
  `aria-selected` with no roving `tabindex`, no arrow keys and no `role="tabpanel"` — a promise
  the app keeps only in `lib/tabKeyboard.ts` (DDR-0029) — and they aren't tabs anyway, they
  switch what one card draws, which is `aria-pressed`. `.app-tab` stays out; it is a real
  tablist. The active item carries a **doubled stroke** (`box-shadow: inset 0 0 0 1px`) as well
  as the accent, DDR-0029's "both cues are colour" rule applied to a bordered box, and
  `lib/toggleGroupVariants.test.ts` fails if that goes, if a mode has no rule, if a `.toggle-*`
  rule declares `outline`, or if any of the superseded selectors reappears. Watch the option
  shape: `ToggleOption.title` is a **tooltip**, and `BREAKDOWN_TABS.title` already meant the
  card's heading — `AllocationView` strips it at the call site.
- **Never write a focus rule.** One ring — `--focus-ring` / `--focus-ring-offset`, always
  `--accent`, destructive controls included — is applied by a **zero-specificity `:where(...)`
  base rule** at the top of `app.css`, so an interactive element is ringed by default and can't
  ship without one. `:where()` is the mechanism, not a style choice: it means every existing rule
  still wins, so deleting a per-class focus rule during #125 makes it *fall through* to the base
  rather than lose its ring. Same instinct as the ESLint layer boundaries and the CSP's omitted
  telemetry origin — the invariant is enforced by the platform. `--focus-ring-offset-inset`
  (`-2px`) is for the two controls whose ring an ancestor would clip (the title bar's window
  controls, now `.titlebar-controls .btn`, and `.tab-panel`). `src/renderer/src/lib/designTokens.test.ts` fails if `outline` ever appears in
  the stylesheet with a second value, if a scale stops ascending, or if a validated palette colour
  moves — it's a test with no module under test, guarding the stylesheet itself.
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
  is not a TLS bug to fix. **Every** request is bounded by a whole-request deadline
  (`IBKR_GATEWAY_TIMEOUT_MS`, default 15s) defined once in `ibkrGateway`, because the gateway's
  usual failure is accepting the connection and *then* going quiet — which emits no error code
  at all and once hung the dashboard forever. It is deliberately not `request.setTimeout`
  (socket inactivity, reset by every byte). One bounded attempt, never a retry loop: a timed-out
  FX rate degrades to *rate unavailable* (DDR-0007), and no per-item loop over the gateway may
  pay the timeout once per currency/instrument (DDR-0022) — the sequential classification
  refresh stops at the first timeout, while `getExchangeRates` instead issues every pair
  **concurrently**, which bounds the wait the same way *and* keeps the rates that did answer
  (DDR-0024).
- **Portfolio gateway reads are coalesced and briefly reusable** — `gatewayCache` (DDR-0024)
  sits between `portfolioRepository` and `ibkrGateway`, so one overview costs one auth check,
  one account-id resolution, one positions read and one ledger read no matter how many methods
  the service calls, and a display-currency switch reuses figures fetched moments earlier
  (`SESSION_TTL_MS` 5min for auth/account, `LIVE_TTL_MS` 30s for positions/ledger/FX). A failed
  read is never cached, and an `IbkrNotConnectedError` *or* `IbkrTimeoutError` drops **every**
  entry — a memoized "authenticated" is exactly what a stalled gateway invalidates. The policy
  stops at the repository: services and the renderer get no cache-control parameter, and cached
  DTOs are re-mapped per call so no caller can mutate another's data.
- **A fresh clone needs `.env`** (copy `.env.example`; `.env` is gitignored). electron-vite
  splits variables by prefix: `MAIN_VITE_*` / `PRELOAD_VITE_*` / `RENDERER_VITE_*` are inlined
  into that bundle's `import.meta.env` at **build** time (renderer types live in
  `renderer/src/env.d.ts`); anything unprefixed — `IBKR_GATEWAY_URL` — stays in `process.env`
  and is main-process only. Without `RENDERER_VITE_MAPBOX_TOKEN` (a public `pk.` token) the
  Allocation map renders its own `no-token` placeholder rather than failing; every other view is
  unaffected.
- **The renderer's CSP admits exactly one external origin** (`https://api.mapbox.com`) and
  `events.mapbox.com` is **omitted on purpose**, so the platform blocks Mapbox telemetry no
  matter how the library is configured or upgraded. It looks like an oversight; it is the
  enforcement mechanism. Only basemap tiles and the viewport leave the machine — no portfolio
  data (ADR-0007).

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

`.claude/settings.local.json` enables `context7`, `filesystem`, `playwright`,
`interactive-brokers`, and `shadcn` (the `postgres` server has been retired following the move
to SQLite). The `shadcn` server is there to *read* component APIs for Epic #125 — the package is
not adopted; see the styling gotcha above before reaching for it.
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

* Node ≥22.12 (`@electron/rebuild` / `node-abi` require it; CI runs Node 24)
* npm
* Electron (desktop shell)
* React + Vite (renderer / UI)
* TypeScript (everywhere — renderer **and** main process)
* SQLite (embedded, local) via Drizzle ORM
* Zod
* Interactive Brokers (local Client Portal Gateway / MCP)
* Vitest
* Playwright

The full runtime dependency list is deliberately short — `better-sqlite3`, `drizzle-orm`,
`fast-xml-parser` (Flex statement parsing), `mapbox-gl` (the Allocation basemap only, ADR-0007),
`react`, `react-dom`, `zod`. Charts are hand-written SVG rather than a charting library.

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

Analytics operates from **locally stored history**, never by repeatedly querying Interactive
Brokers. As built there are two such stores, and they are not interchangeable: the **snapshots**
tables back the Portfolio view's history section, while the four analytics views (performance,
allocation, dividends, realized gains) read **imported Flex statements** through
`flexReadRepository` — Flex carries the dated, multi-currency, per-instrument detail that
on-open snapshots cannot reconstruct. The one analytics path that reaches IBKR at all is
`analytics:classifyInstruments`, which fetches sector data the Flex export omits (DDR-0009).

---

# Domain Structure

Primary domains:

* portfolio
* holdings
* snapshots
* flex (imported IBKR statement history)
* analytics
* dividends
* classification (instrument sector/industry)

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

Repositories expose domain-oriented methods. `src/repositories/README.md` lists the current
repositories by data source — keep it in step when adding one.

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
`renderer/src/lib/`** (`format`, `pie`, `worldGeo`, `countryDonuts`, `gainLoss`, `tableFilter`,
`column`, `dateRange`, `sectorMap`, `performanceRange`, `classifyProgress`, `dataVersion`,
`tabKeyboard`, `buttonVariants`, `cardVariants`, `statTileVariants`, `fieldVariants`,
`toggleGroupVariants`)
precisely so they can be tested — follow
that split when adding a component with real logic in it. `dataVersion` is the same move applied
to state rather than maths: the cross-view staleness signal is a plain subscribable store a hook
reads with `useSyncExternalStore`, so the part worth testing is testable without a renderer. The
map is the sharpest case: `countryDonuts` and `gainLoss` emit palette *classes* rather than values,
and every slice path, share normalization and disc threshold falls out of that — the whole
of the map's geometry and colour scale is testable under Node while the component keeps only the
parts that need a DOM (DDR-0030). Pure repository helpers that touch no data source
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