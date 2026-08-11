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
Epics** so no single Epic grows unbounded again. **Which Epics are open is not recorded here** —
the backlog is the source of milestones, and a roster in this file goes stale the day an Epic
closes. Read it (`gh issue list --state open --label epic`; see *Current Priority* below for the
rest of the queries). What is stable is the **lifecycle rule**: an Epic closes when its stories
close, and new refinement opens a *new* Epic under the current milestone rather than reopening a
delivered one — with **one narrow exception**, added 2026-08-07: an Epic may reopen when its own
stated problem is provably unfinished, meaning its acceptance criteria under-scoped the finding
in its Summary, so the new stories close the *original* scope rather than adding refinement.
That requires a dated note on the Epic naming which criterion under-scoped which finding.
Epic #125 (Shared UI primitives, reopened 2026-08-07 for Round 2 and closed 2026-08-09) is the
precedent and `docs/github-issues.md` holds the rule. **Read the backlog before assuming a view
is final** — a view you are told is "done" has usually been reworked several times. The Stack and
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
                 portfolio/, snapshots/, flex/, analytics/, dividends/, classification/)
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
  a pixel width, because they scale to a shared `--content-max` column (DDR-0018). The Performance
  view's **daily-return bars** are that same rule under density (DDR-0049): the ratio is fixed and
  the *bars* thin with the series, because aggregating days into weeks would destroy the volatility
  the chart exists to show. Two traps — the returns are **chain-linked** from the cumulative TWR
  series (`lib/dailyReturns`, reusing `performanceRange`'s exported `chainLink`), never differenced
  from `valueSeries`, or a deposit draws as a spectacular day; and the maths takes the
  **unwindowed** curve, so the window's opening bar measures against the day that really preceded
  it rather than against the synthetic point `sliceSeries` anchors at the edge. `BarChart` is its
  own component rather than a `ColumnChart` flag — that one stacks two series, legends them, and
  labels every column, which at 191 trading days is a 45:1 strip under 191 overlapping labels. The
  **Allocation map is the one scoped exception**: a Mapbox GL JS basemap (ADR-0007) carrying, per
  issuer country, **two donuts side by side** — left, the country's weight in the portfolio (its
  share of NAV in blue against a muted remainder, on an **absolute 0–100% scale**); right, one
  slice per sector — with the pair's area proportional to the country's market value and anchored
  to ISO-3166 alpha-2 centroids, which makes the map deliberately *approximate*: positioned by
  issuer country, not by company (DDR-0030, superseding DDR-0020). All of its geometry and colour
  lives in `lib/countryDonuts`, testable under Node because it emits palette *classes* rather than
  values. Six things to know before touching it.

  - The marks are **SVG carried by `mapboxgl.Marker`, not painted into the canvas** — a circle
    layer paints one flat fill per feature, so donut slices have no canvas equivalent. A palette
    class on a `<path>` *is* the fill, so colour needs no `getComputedStyle` and a colour change is
    an ordinary re-render, not `setPaintProperty`. A country under an **8px radius collapses to a
    single disc** in its largest sector's hue, and an SVG `<g>` is only ever hit *through its
    children* — grouping slices and putting `pointer-events: auto` on the group catches nothing.
  - **`pie-series-1` — the palette's only blue — is reserved for the country weight, so the
    *sector* dimension starts at slot 2** (`SECTOR_SLOT_OFFSET` in `lib/pie`), applied everywhere a
    sector appears (map, legend, Sector donut, its table), because the invariant is one sector/one
    hue *everywhere*. Only sectors pay it; asset class, currency and country keep all eight slots.
    Don't place a new chart using slot 1 beside sectors, and don't un-reserve the blue — widen the
    palette instead.
  - **Holdings are not on the map at all**, which retires DDR-0020's per-holding granularity: the
    Positions table is where one company is read, and the `aria-label` says so. A losing holding
    inside a winning country is aggregated away before anything colours it, so a portfolio can hold
    several losers and show one red mark — that is granularity, not colour.
  - **The 2% slice floor applies to sectors only** — applying it to the weight donut would
    overstate every small country, the one thing a proportion chart must not do.
  - **One view, coloured by sector** (DDR-0045). The gain/loss mode was withdrawn in Story #160,
    taking `--diverge-1..7` and `.map-diverge-*` with it; `designTokens.test.ts` pins that
    **absence**. Don't "simplify" the map by painting wedges green and red — DDR-0021 stays
    *Superseded-but-applicable* as the record of when `--pos` / `--neg` may be spent (never as the
    only channel on a mark, since green/red measures ΔE 4.1 under deuteranopia against the basemap;
    freely where a figure accompanies the colour), and `mapPopupTint.test.ts` fails if any
    `.country-mark*` rule references those tokens. The **popup** is the carved-out case: it *is*
    tinted by the hovered subject's return, with a figure two rows below the tint.
  - **That tint is banked into the popup's top and bottom edges, and the geometry is what lets it
    be loud** (DDR-0041): a `linear-gradient` `--popup-edge` → `--card` → `--popup-edge` whose two
    inner stops sit at `--popup-pad-y`, the content's own vertical padding, so the coloured band is
    exactly the gutter above the first line and below the last and no glyph is ever on it. Four
    things to keep — the stops are an **absolute length, not a percentage** (a percentage band
    creeps under the text of the taller six-row sector popups); `--popup-edge-hold` must stay
    **strictly below** `--popup-pad-y`, or the first line lands on undiluted `--pos`; the **tip
    takes `--popup-edge`**, because Mapbox flips the popup onto whichever edge is loud; and both
    tones carry the same percentage, since a stronger "up" than "down" would encode degree on top
    of sign. `lib/mapPopupTint.test.ts` pins the *geometry* — the stops are the padding — rather
    than the colour that depends on it.

  See DDR-0005, DDR-0006.
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
  accent colour: accent-on-pill is two cues but both are colour. Don't drop the bar. **Each tab
  also carries an icon, and it is a second channel rather than a name** (Story #168, DDR-0048).
  The five glyphs live in `components/TabIcons.tsx` — not at the bottom of `App.tsx`, where
  seventy lines of path data would sit between a reader and the invariants above — and every one
  renders through a private `Glyph` wrapper, so the module declares **exactly one `<svg>`** and a
  sixth icon inherits `aria-hidden`, `focusable="false"` and `stroke="currentColor"` by
  construction rather than by remembering. Three things follow. The label stays a **bare text
  node** beside the icon, which is why `e2e/tab-navigation.spec.ts` passes unmodified: an SVG
  contributes no text node, so the tabs still read exactly their five names. `currentColor` is the
  whole colour decision — the glyph follows the tab through `--muted` → `--text` → `--accent` and
  adds **no pairing** for `lib/contrast.ts` to cover (DDR-0046), so a literal hex or a palette
  token in an icon is a colour nothing measures. And the size is **`1em`, not a step**: an icon
  sitting *in* a line of page text must track `--text-sm`, which is the mirror of DDR-0018's rule
  that an SVG `<text>` label scaling from a `viewBox` must stay *off* the page scale.
  `lib/tokenAdoption.ts` guards neither `width` nor `height`, so `lib/tabIcons.test.ts` is the
  only thing that catches a px icon — it strips comments first, the trap DDR-0042 and DDR-0047
  both record. Icons stop at the tablist: the analytics sub-tabs, the breakdown strip and the
  `RangeFilter` presets are `ToggleGroup`s, not tabs (DDR-0036), and giving them icons is a
  separate judgement.
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
- **So is the window's size, position and maximized state** (DDR-0028): with no OS frame,
  nothing restores it for you. `windowStateService` keeps one overwritten JSON value under the
  `app_meta` key `window_state` — metadata, not history, so no new table. Three traps: the
  service may not import `electron`, so `main` passes display geometry **in** as plain
  rectangles and the off-screen recovery stays a pure function; what is persisted is
  **`getNormalBounds()`**, never the maximized bounds (a **minimized** window is skipped
  entirely — it reports neither useful bounds nor, on Windows, its maximized state); and a
  restored rectangle is re-applied with **`setBounds()`, not the constructor**, because only
  `setBounds` inverts `getNormalBounds()` past the invisible resize border Windows adds to a
  frameless window — a constructor round-trip grows the window a few pixels *every launch*.
  `e2e/window-state.spec.ts` opens the app three times to pin that. Reachability is judged on
  the 40px **title bar**, not the window's area.
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
  and `lucide-react`; a large share of the 2,200-line `renderer/src/app.css` is chart/donut/map
  styling shadcn has no equivalent for (so the app would run two styling systems); Radix Tabs
  would displace `lib/tabKeyboard.ts`, which exists precisely because Vitest is Node-only
  (DDR-0029); and DDR-0012 already rules out the modal components carrying much of shadcn's
  value. What *is* adopted is the API shape — a `variant`/`size` prop contract and
  `Card`/`CardHeader`/`CardContent` composition — for primitives under
  `renderer/src/components/ui/` styled by the existing CSS custom properties. Recorded as
  **ADR-0008**, so it is overridden by a superseding ADR, not by a pull request. The CVD-safe
  palettes stay untouched (DDR-0030).
- **`app.css` has a full token scale, and a rule uses a step rather than a raw length**
  (DDR-0031): `--space-1..8` (a 4px grid with a deliberate 6px half-step at `--space-2`, where
  the app's dense controls sit), composite `--control-pad-*` / `--surface-pad-*` in `sm|md|lg`
  (the same vocabulary as the primitives' `size` prop, so CSS and component API agree by
  construction), `--radius-sm|md|lg|pill` in **px** so a corner doesn't grow with the type
  scale, and `--text-2xs..2xl` + `--leading-tight|normal`. Deliberately *off* the scale: chart
  and map SVG label sizes, which scale from a `viewBox` rather than the page (DDR-0018), and
  sub-6px radii, which are chart geometry. One collision to know — `--text-xl` is **1.4rem, not
  1.5rem**, because `.stat-row` packs tiles into `minmax(11rem, 1fr)` columns where a bigger
  figure wraps.
- **Adoption is held by a ratchet; don't re-baseline it** (DDR-0042). `lib/tokenAdoption.ts`
  carries `BASELINE` (may only shrink — currently **empty, and must stay empty**) and
  `EXEMPTIONS` (permanent, eleven entries, each with a reason). `tokenAdoption.test.ts` fails
  three ways: a raw value in neither list, a *baseline* entry that stopped matching, and an
  *exemption* that stopped matching — the second is what makes it a ratchet rather than a
  suppression file. Two traps: the scanner (`lib/cssDeclarations.ts`) is text-based and
  **blanks comments in place** so line numbers survive, because `app.css` quotes lengths in
  prose; and **the exemptions are enumerated by hand, never derived from a rule** — a selector
  prefix and a "sub-6px radius" rule were both tried and both leaked.
- **Motion is two durations and two easings, and reduced motion zeroes the durations rather
  than listing what moves** (DDR-0044). `--duration-fast` (90ms, feedback on something the
  pointer is already on) · `--duration-base` (120ms, something arriving or a value moving under
  its own steam) · `--ease-out` · `--ease-linear` (for a width that *reports a number* — easing
  `.classify-progress-bar` would claim the classification sped up). One
  `@media (prefers-reduced-motion: reduce) { :root { --duration-*: 0ms } }` covers animations
  added later too, which a selector list never does. Three things to keep: **source order is the
  mechanism** (same specificity, no media-query bonus), so the block sits directly under
  `:root` and `designTokens.test.ts` fails if it moves; a **raw duration is the only way out**,
  which `lib/motionTokens.ts` guards; and the scroll-driven table fade is the one structural
  exemption (`animation-timeline: scroll(self block)` has no duration to zero and is the "more
  rows below" affordance), which is why the blanket `*{animation-duration:0.01ms!important}`
  reset was rejected. Mapbox's own camera is already honoured —
  `respectPrefersReducedMotion` defaults true and `CountryMap.tsx` passes no `essential: true`
  — so **don't file a story for it**; what's missing is only a guard, since `motionTokens.ts`
  reads `app.css` and a call-site opt-out lives in a `.tsx`.
- **The renderer has one of each control, and adding a variant means naming a role rather than
  writing CSS** (Epic #125, Stories #127–#134). Each primitive under `components/ui/` replaced
  several hand-rolled class families, and each has a guard test in `lib/*Variants.test.ts` that
  fails the same three ways: a superseded selector reappears, an axis value has no rule in
  `app.css`, or the primitive re-declares something the shared rules own (a focus ring,
  `:disabled`, `outline`). **Read the DDR before changing an axis** — each one records call
  sites and rejected alternatives this table can only name.

| Primitive | Axes | The rule that isn't obvious |
| --- | --- | --- |
| `Button` (DDR-0032) | `variant` = colour + border (`outline` default · `primary` · `secondary` · `danger` · `ghost` **borderless** · `link` · `surface`) × `size` (`sm\|md\|lg` are the `--control-pad-*` steps; `icon` is a *shape*) | `ghost` changed meaning — the old `.ghost-button` had a border and is now `secondary`. `type` defaults to `"button"`. `className` is appended for **placement, not colour**. `.btn` declares no `line-height` on purpose. |
| `Card` / `CardHeader` / `CardTitle` / `CardContent` (DDR-0033) | `variant` = surface colour (`default` `--card` · `nested` `--bg`) × `size` = the `--surface-pad-*` steps | `CardContent` is a **scope**: the rules `.panel` declared on its descendants hang off `.card-content`, not `.card`, which keeps a state panel's prose out of their reach. `as` is a prop, because the superseded surfaces weren't one element. |
| `StatTile` / `StatRow` (DDR-0034) | `tone` only — a headline figure is always a panel-level tile, so `variant`/`size` would each have one value | A tile **is** a `Card`, so it declares no surface of its own. **Neutral is the absence of a rule** (`toneClassName('neutral')` returns `''`); `.stat-positive` / `.stat-negative` are the app's tone semantic, worn by a table cell and the map popup too. |
| `Field` + `Select` + `DateInput` (DDR-0035) | `kind` (`select \| date`) only — both call sites are the same dense box | **`Field` generates the id with `useId()` and takes no `id` prop**: analytics tabs stay mounted (DDR-0027), so all three `RangeFilter`s can be in the document at once and a fixed id would name only the first. The control is passed as a function of that id. |
| `ToggleGroup` (DDR-0036) | `mode` (`single \| multiple`), and the mode is **worn** — `--radius-md` vs `--radius-pill` | **Never a tablist**: `aria-pressed`, not `role="tab"` — only `.app-tab` is a real tablist (DDR-0029). The active item carries a doubled stroke (`box-shadow: inset 0 0 0 1px`) as well as the accent. `ToggleOption.title` is a tooltip. |
| `Badge` (DDR-0037) | `variant` = boundary + ink (`neutral` · `accent` · `plain`) × `size` = type + box padding | **Never a pill** — that corner means multi-select (DDR-0036) — and **never a background**. `sm` carries no vertical padding: an inline-block with it grows every holdings row by ~7px. |
| `StatePanel` (DDR-0038) | `variant` = the state (`loading \| empty \| notice \| error`) × `surface` (`panel` = a `Card` at `lg` · `inline`) | Only `error` paints; the other three declare no CSS — the axis exists because the copy and the *announcement* differ. `role` is derived (`error` → `alert`, else `status`); no heading → the panel **is** a `<p>`. Parts render in a fixed order, recovery action last. |
| `DataTable` (DDR-0039) | the *container's* axes: `surface` (`inline \| card`) × `height` (`auto \| capped`) | Sorting is **opt-in per column** (a `sortValue` gets a header button). A **missing value sorts last in both directions**. It composes with the view's filters rather than replacing them, so the "N of M shown" count is untouched. The sort control is not a `Button` — the header cell already is the box. |

- **An analytics view is a subject noun and a function of its report** (DDR-0043).
  `components/analytics/AnalyticsShell.tsx` owns the four-branch guard all four views had spelled
  out byte-for-byte — loading, error + Retry, `NeedsImport`, then the `.analytics-view` wrapper
  and the `RefreshBar`. Three things to know. The children are a **function of the report, not
  elements**: three of the four states have no report, so a `ReactNode` shell would force every
  view to guard *again*. **The shell holds no state whatsoever**, which is what keeps DDR-0027
  intact — range selection, chart tab, type chips and map colour mode stay in the view *above*
  it, so `loading` still means the first load. And the `<Report>` type argument is written
  **explicitly** at all four call sites, because inferring it out of a union member is where
  TypeScript is weakest. `lib/analyticsShell.ts` holds the branch mapping and the wording; its
  test reads the four views as text and fails if one re-declares the guard, the wrapper or the bar.
- **The Allocation breakdown's table and donut are linked, and the link is keyed on the slice's
  `key`, never on position** (DDR-0040) — the table sorts by any column (DDR-0039), so row order
  and arc order have no reason to agree. The emphasis **never touches `fill`** (hue is identity,
  DDR-0030): the active wedge keeps its colour and gains a `--text` stroke while the rest drop to
  0.35 opacity — muting the others is what makes the active one read. `DataTable` carries
  `activeRowKey` + `onRowActivate` for this, and supplying `onRowActivate` is also what makes rows
  focusable, so an ordinary table adds nothing to the tab order. `.data-table-row-active` is
  **neutral, not accent** — the row is pointed at, not selected, and the accent already means
  "this column holds the sort".
- **The Allocation map is a `group`, not an `img`, and its graphics are deliberately inert**
  (DDR-0047). `role="img"` over a subtree holding a focusable canvas, six markers and Mapbox's
  **attribution control** is what axe reported as `nested-interactive`; making the subtree inert
  **cannot work**, because `attributionControl: true` is required by Mapbox's terms and its links
  must stay reachable. Hence `role="group"` keeping its `aria-label`, `keyboard: false`, the
  canvas at `tabindex="-1"`, and **every marker host at `tabindex="-1"` set *before* the `Marker`
  is constructed** — Mapbox assigns its own `tabindex="0"` only when the element doesn't already
  carry one, so setting it afterwards is silently undone. The zoom buttons are **siblings** in
  their own labelled group; don't move them inside. `lib/mapAccessibility.test.ts` guards this and
  **strips comments before matching** — the component explains itself in prose, and deleting the
  real `keyboard: false` left the assertion green off the commentary alone (the trap DDR-0042
  also records for `app.css`).
- **The loss tone is two tokens, and picking the wrong one is silent** (DDR-0046). `--neg` is a
  **fill only** (`.btn-danger:hover`, `.chart-bar-loss`, `.chart-bar-upper`,
  `.legend-swatch-upper`, the map popup's tint) and `--neg-text` `#e56c6c` is **text only**
  (`.btn-danger`, `.stat-negative`), because `--neg` `#d03b3b` measured 3.62:1 on `--card` as text
  while the value that fixes that drops `.btn-danger:hover` under white to 3.14:1. Same shape for
  the accent: `--accent-strong` fills `.btn-primary` alone, while `--accent` stays the focus ring,
  the active-tab bar and the sort arrow. Three things to know. **The hover is the binding
  measurement** — `.btn-primary:hover` applies `brightness(1.08)`, which *lowers* contrast against
  a white label (5.45:1 → 4.81:1) where axe tests resting state only, so `lib/contrast.ts` models
  the filter. `contrast.test.ts` pins the **split** as well as the ratios: a fill adopting
  `--neg-text`, or a text rule going back to `--neg`, fails even though both still pass. And the
  pairing list is **enumerated by hand** (resolving a colour against its inherited background
  needs a layout engine, which Node-only Vitest lacks), so it lists passing pairs too — a guard
  listing only what once failed would have missed this finding. Known and deliberately open: the
  tab panels sit outside a landmark (axe `region`, best-practice), because `.tab-panel` wraps the
  view's `<main>` and unpicking that means restructuring DDR-0029 across every view.
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

# Run a single e2e spec (Playwright launches out/, so build first — test:e2e always rebuilds):
npm run build && npx playwright test e2e/tab-navigation.spec.ts

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
`column`, `dateRange`, `sectorMap`, `performanceRange`, `dailyReturns`, `classifyProgress`, `dataVersion`,
`tabKeyboard`, `buttonVariants`, `cardVariants`, `statTileVariants`, `fieldVariants`,
`toggleGroupVariants`, `badgeVariants`, `statePanelVariants`, `tableSort`, `dataTableVariants`,
`sliceHighlight`, `mapPopupTint`, `cssDeclarations`, `tokenAdoption`, `motionTokens`, `contrast`,
`analyticsShell`)
precisely so they can be tested — follow
that split when adding a component with real logic in it. `dataVersion` is the same move applied
to state rather than maths: the cross-view staleness signal is a plain subscribable store a hook
reads with `useSyncExternalStore`, so the part worth testing is testable without a renderer. The
map is the sharpest case: `countryDonuts` emits palette *classes* rather than values, and every
slice path, share normalization and disc threshold falls out of that — the whole
of the map's geometry and colour is testable under Node while the component keeps only the
parts that need a DOM (DDR-0030). `gainLoss` is what remains of the withdrawn gain/loss scale: one
function, `returnPercent`, for the popup's return row (DDR-0045). Pure repository helpers that touch no data source
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