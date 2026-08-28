# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Budget: keep this file under 50 KB** (`wc -c CLAUDE.md` ≤ 51200) — it is loaded into every
> session, so its cost is paid before any work starts. **`src/claudeMdBudget.test.ts` enforces it**
> — unenforced, it was overrun for six commits unnoticed.
>
> Every ADR and DDR is 8–20 KB and carries its own reasoning, and
> `docs/design-decisions/README.md` indexes each in one line. So when a story lands, add *the
> trap* in a sentence with its DDR number — never the argument. If the budget is exceeded, cut a
> paragraph that argues a case rather than drop a trap.
>
> **Raised twice, deliberately: 36 KB → 44 KB → 50 KB.** The second raise paid for correcting a
> bullet that was *wrong* rather than merely absent — a trap stated backwards sends the next
> session looking in the right file for the wrong reason, which costs more than the paragraph it
> would have taken to say nothing. Cut what restates a machine-readable fact before compressing a
> trap; a dropped trap costs a DDR re-read or a re-shipped bug.

## Current Repository State

M0–M9 are delivered: live IBKR holdings/balances/allocation in a display currency, immutable
snapshots, Flex statement import, and four analytics views over it, behind a vertical sidebar.
M10 is in progress — the investor profile, the assistant's **surface** (grounded Q&A) and the first
question shape (a period explained) have landed; #286–#289 have not. Not built: multi-broker,
benchmarks, tax.

**Which Epics are open is deliberately not recorded here** — read the backlog (*Current Priority*).
The **lifecycle** is the rule: an Epic closes with its stories, and refinement opens a *new*
area-scoped Epic rather than reopening a delivered one (#240 → #245). `docs/github-issues.md` has
the one narrow exception; Epic #125 is the precedent.

### Domains

Each exists end-to-end and is the reference pattern for its shape.

- **portfolio** — live IBKR read. `portfolioService` → `portfolioRepository` → `ibkrGateway`
  (HTTP + Zod). Converts with **live gateway FX**, not Flex `fxRateToBase`; unconvertible rows
  carry `displayValue === null` and leave totals/allocation (DDR-0007). Its **one** local read is
  the instrument *name*, joined from `flexReadRepository` by conid — the gateway has none
  (DDR-0088).
- **snapshots** — immutable local history. `snapshotService` (12h de-dupe on open, always-write on
  demand) → `snapshotRepository` → SQLite. Reads IBKR only *through* `portfolioService` (DDR-0003).
- **flex** — imported Flex history, split **write-only** `flexRepository` / **read-only**
  `flexReadRepository` over immutable `flex_*` tables; services mirror the split
  (`flexImportService` / `flexStatementsService`). See ADR-0005, DDR-0004, DDR-0026.
- **analytics / dividends** — read-only over Flex through `flexReadRepository`, converting to base
  (EUR) **in the service**, each returning `ok | needs_import`. See DDR-0005, DDR-0010, DDR-0015.
- **profile** — the investor profile, and how far the portfolio sits from it.
  `investorProfileService` → `metaRepository` → **one overwritten `app_meta` value**: a profile is a
  *setting*, not history, so ADR-0006 does not reach it and `metaRepository.remove` is not its
  refused delete-by-id. "Clear" **removes the key**, so "never written" and "cleared" are one state
  (DDR-0094). `balanceDriftService` computes drift **deterministically — no model ever does this
  arithmetic** — over the **live** portfolio, not Flex, which is why it is the one `profile:*`
  channel with gateway states (DDR-0095).
- **assistant** — `assistantService` is the **only** caller of `aiGateway` and checks consent
  **before** the key, before a prompt, before a socket. Consent is stored like the profile and is to
  a **specific list**: `DISCLOSURE_CATEGORIES` renders the panel, *types* `AssistantContext` (an
  undisclosed section cannot be sent) and is fingerprinted into the stored consent, so changing it
  re-asks the owner. Revoking **removes the key**; an unreadable value means *no consent*
  (DDR-0097). `assistant:ask` is the **one outbound channel**; context is assembled in the
  **renderer** (`lib/assistantContext.ts`) so figures use the app's own formatters, and the boundary
  drops undisclosed sections. A section is **absent, never empty**; no money goes in one disclosed
  as names or percentages; each names its store *and clock* — composition is Flex, drift live
  (DDR-0098). An **explained period** keeps return and value in separate fields under separate
  headings, return first — the curve is TWR, so a deposit moves value alone; the period is the
  shared vocabulary anchored to `extent.to`, an overlapping statement row is summed **whole** and
  names the span it covered, an empty window is a *state* not a flat period, and no cause is ever
  offered (DDR-0099).
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
  services/      pure business logic; beyond the domains above, system/ (app:ping) and
                 window/ (windowStateService, sidebarStateService)
  repositories/  the ONLY layer touching a data source (SQLite, the IBKR gateway, or both)
  db/            client.ts (better-sqlite3 + Drizzle singleton), migrate.ts, schema.ts
  shared/        ipc/contract.ts (Zod + inferred types), ipc/channels.ts, domain/, errors.ts
e2e/             Playwright specs launching the built app
```

### Reference slices to copy

- **Minimal slice / test style** — `app:ping` and `metaService.getInstallId()`; see
  `services/meta/metaService.test.ts` for the repository-mocking pattern.
- **Fire-and-forget command + state event** — the `window:*` channels. DDR-0011.
- **Destructive action** — `flex:clear` / `snapshot:clear`: the in-place `ConfirmAction` control —
  no modal, no `window.confirm`. ADR-0006, DDR-0012.

## Enforced boundaries & gotchas

### Enforced by the platform, not by convention

**ESLint layer boundaries** (`eslint.config.mjs`, ADR-0002/0003): the renderer may not
import `@services`/`@repositories`/`@db`/`@main`/`electron`, services may not import `@db` or
`electron`.

### Build, runtime, environment

- **Path aliases live in three files that must stay in sync**: `tsconfig.json`,
  `electron.vite.config.ts`, `vitest.config.ts`.
- **`better-sqlite3` is native**, rebuilt for Electron by the `postinstall` hook. On an ABI
  mismatch: `npm install` or `npx electron-rebuild -f -w better-sqlite3`.
- **Runtime DB vs tooling DB** — the app opens `app.getPath('userData')/portfolio.db` and applies
  migrations on launch; drizzle-kit (`db:*`) runs *outside* Electron against `./local.dev.db`.
- **A fresh clone needs `.env`** (copy `.env.example`) — but **`.env` supplies the prefixed half
  only.** electron-vite inlines `MAIN_VITE_*` / `PRELOAD_VITE_*` / `RENDERER_VITE_*` at **build**
  time; its `loadEnv` reads *those prefixes and no others* and assigns nothing to `process.env`,
  and nothing else here loads the file (no `dotenv`, no `--env-file`). So an **unprefixed variable
  reaches the app only from the OS environment** — `OPENAI_API_KEY` in `.env` alone leaves the
  assistant permanently `not_configured` (Bug #297). Unprefixed still means never bundled, which is
  ADR-0010's point and is untouched. **Two tests look like they cover this and do not**:
  `assistant-consent.spec.ts` passes the key through `electron.launch({ env })` and
  `ibkrGateway.test.ts` writes `process.env` — both exercise *reading* a variable, never *loading*
  one. `IBKR_GATEWAY_URL` has the same defect, invisible since M1 behind its default. Without
  `RENDERER_VITE_MAPBOX_TOKEN` the map renders a placeholder; nothing else is affected.
- **Electron security is locked down** — `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`, and `frame: false` with an in-app `TitleBar` (DDR-0011). Keep it.
- **The renderer's CSP admits exactly one external origin** (`https://api.mapbox.com`);
  `events.mapbox.com` is **omitted on purpose**, so the platform blocks Mapbox telemetry however
  the library is configured. Only tiles and the viewport leave the *renderer* — no portfolio data
  (ADR-0007). **The CSP is not the app's boundary**: the assistant sends figures to OpenAI from
  **main**, which the CSP never sees. Don't add an origin here for it (ADR-0010).
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
  `ok`: capture returns `captured`, import `imported`, the profile save `saved`, every clear
  `cleared`.
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
- **Drift's residuals are surfaced, never redistributed** (DDR-0095). Cash has no sector, an
  instrument the classification cache missed has none either, one absent from imported history has
  no asset class — each is its own weight, and `Σ bands + Σ residuals + untargeted === 100` per
  dimension. An **unconvertible** holding is *unplaced* and gets **no percentage**: the gap against
  IBKR's `netLiquidation` is two rate paths disagreeing, not a quantity (Bug #68) — which also makes
  the concentration ceiling a **lower bound**. The asset-class vocabulary lives in
  `@shared/domain/assetClass` because the profile stores the allocation report's own key; a second
  copy would leave targets joining with nothing and reading 0%.

### The OpenAI gateway

- **`repositories/assistant/aiGateway.ts` is the only code that reaches OpenAI** (ADR-0010,
  DDR-0096). Plain HTTPS, **not** the `openai` SDK — its retry must be off, its socket timeout is
  the wrong bound, and its errors get re-mapped anyway. It **returns a result union, never throws**:
  one operation, seven states. `not_configured` (no key) is OpenAI's `not_connected` and a fresh
  clone's resting state; **`too_large` is not `refused`** — the first means *nothing was sent*;
  `not_responding` absorbs stall, unreachable host **and 5xx**, because DDR-0022 divides by
  *recovery*; a `200` with no answer is `invalid`, never an empty `ok`. `MAX_PROMPT_CHARS` is a
  **constant, not an env var**, and counts characters — a tokenizer is a dependency for a ceiling
  that only has to stop runaway growth. A refusal is **redacted** before it leaves the file: a wrong
  key comes back quoting a masked fragment of itself.
- **The key is read in one place and never bundled.** `OPENAI_API_KEY` is unprefixed on purpose;
  `aiGatewayIsolation.test.ts` fails if `src/renderer` or `src/preload` so much as names an
  `OPENAI_` variable, if anything outside main imports the gateway, or if the CSP's `connect-src`
  gains an origin.

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
- **`avgCost` is per share and IBKR's own `unrealizedPnl` beats deriving one** (DDR-0087): read as
  a position total it scales each row by its quantity and still looks right, and the derivation
  needs **no multiplier term** (both sides carry it). This build also sends **no `ticker`**, so
  `symbol` and `description` both fall back to `contractDesc` — DDR-0066's trap, on every live row,
  and why a live holding's name is `companyName` (Flex, by conid) *before* `description` (DDR-0088).
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
  figure, asserted in `statTileVariants.test.ts`. Both ends bind (DDR-0060).
- **Adoption is held by a ratchet; don't re-baseline it** (DDR-0042). `lib/tokenAdoption.ts` has
  `BASELINE` (may only shrink — **currently empty and must stay empty**) and `EXEMPTIONS`
  (permanent, **nine**, each with a reason). The test fails three ways, including on a *dead*
  entry.
- **A figure is a role, not a font** (DDR-0053). `--font-figure` + `--tracking-figure` +
  `font-variant-numeric: tabular-nums` are **one rule** listing its selectors — they only work as a
  set. It declares no `font-size`, which keeps DDR-0018 intact in SVG `<text>`. `lib/figureRole.ts` **throws rather than merging** if a second rule applies it. Mono is ~20% wider for digits — a story adding a column should re-measure.
- **Motion is two durations and two easings** (DDR-0044): `--duration-fast` (90ms) ·
  `--duration-base` (120ms) · `--ease-out` · `--ease-linear` (for a width *reporting a number*).
  One `prefers-reduced-motion` block **zeroes the tokens** rather than listing what moves, covering
  later additions. **Source order is the mechanism** — the block sits directly under `:root`
  and `designTokens.test.ts` fails if it moves. A raw duration is the only way out.
- **The loss tone is two tokens and picking the wrong one is silent** (DDR-0046, DDR-0054): `--neg`
  is **fill only**, `--neg-text` **text only**; same shape for `--accent` (labels + ring) vs
  `--accent-strong` (the primary button's fill alone). `--neg-text`'s constraint is **not** 4.5:1
  but `--pos − 0.5`. `contrast.ts` **enumerates pairings by hand**; it models
  `.btn-primary:hover`'s `brightness(1.08)`, which *lowers* contrast where axe tests rest only. A tint mixed into a surface is a **measured** number, never eyeballed (the sidebar's active row is
  4.95:1 at 16%; 22% fails), and a tone rendered on a **hovered row** is measured on the
  lift, not on `--card` (DDR-0064).
- **The palette is navy/indigo; the eight `--series-*` slots did not move** (DDR-0054).
  `designTokens.test.ts` guards the stylesheet itself: it fails if `outline` gains a second value,
  a scale stops ascending, or a validated colour moves.
- **A text-scanning guard must strip comments first.** Bitten five times (DDR-0042, DDR-0047,
  DDR-0048, DDR-0058, DDR-0070) — `app.css` and the components quote their own values in prose, so
  an assertion can pass off the commentary alone. **Its inverse is worse**: prose left *outside* a
  comment becomes rules and the browser drops every declaration after it, which shipped `.app-tab`'s
  rule dead past every gate. `designTokens.test.ts` now walks the delimiters (DDR-0075).

### Renderer: structure and behaviour

- **shadcn/ui was declined** (ADR-0008, Epic #125). The CLI/MCP server are for *reading* the
  component API: no `shadcn add`, no re-proposing it. Adopted is the *shape* — `variant`/`size`,
  `Card`/`CardHeader`/`CardContent`.
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
  re-ellipsise it, and never widen the column (DDR-0068). Accelerators sit **beside** the pattern,
  never in it — one `window` listener in `App.tsx` holds both: `Ctrl`/`Cmd`+`1`–`5` per row
  (DDR-0083) and `Ctrl`(+`Shift`)+`Tab` rotating (DDR-0090), the latter **`Ctrl`-only**, `Shift`
  the *direction*, reading `key` where the digits read `code`. For `Tab` both are `'Tab'`, so the
  handlers' separation is **`nextTabIndex` declining `'Tab'`**: delete that case and plain Tab
  rotates. `preventDefault` is load-bearing there (the default *is* a focus move); wrapping is
  `stepIndex`, shared with the arrows. Both **decline while text is being entered**, and each is
  disclosed at **the scope of what it acts on** — a row's `title` for its digit (amending
  DDR-0057), the "Views" label's `title` + the tablist's `aria-keyshortcuts` for the rotation. Two
  bindings are still not a table. A drawn digit per row was built and **withdrawn** — don't
  re-propose it, or a legend. **Two rows are not data views**: Assistant (6) then Profile (7), so
  the order reads data · the surface that talks about it · the policy over it (DDR-0094, DDR-0097).
  Both **stay mounted** and declare their own `<main>`/`<h1>`, having no four-branch guard to wear;
  no accelerator counts rows. Adding a row is a **list edit in six e2e specs**.
- **An analytics tab mounts on first visit and then stays mounted**, hidden rather than unmounted,
  so view-local state survives; unvisited tabs issue no IPC (DDR-0006, DDR-0027). The consequence:
  a mounted view can go stale, so both Flex write paths bump `lib/dataVersion` and every
  `useAnalytics` re-reads. A **profile** write bumps `profileDataVersion`, a *second* store only
  the Assistant reads (DDR-0098). **`loading` means the first load only**; a reload reports through
  `refreshing`. **Portfolio is deliberately excluded** and re-reads on every visit — it shows live
  data that changes with no event to signal it.
- **The page header's `source` has three values, not two** — `LIVE_SOURCE`, `IMPORTED_SOURCE` and
  `OWNER_SOURCE` ("Set by you"), the last naming **no** data source because the Profile page has
  none. That slot is where a page says whether its standard is the owner's or the app's (DDR-0094).
- **`AnalyticsShell` owns the four-branch guard, the `<main>`, and the page header** (DDR-0043,
  DDR-0058). Children are a **function of the report, not elements**, and **the shell holds no
  state**, which is what keeps DDR-0027 intact. The status
  row is **absent, not empty**, where there is nothing to refresh. `lib/analyticsShell.ts` holds
  the branch mapping; its test fails if a view re-declares the guard, wrapper, or header.
- **A row of two cards takes its height from the row, not from either card** — `.dashboard-sources`
  is `align-items: stretch` (DDR-0093): its two contents can never agree, so `start` left whichever
  was shorter above the row. The contents stay blocks — a flex card or a `height: 100%` content
  spreads the slack *through* the controls instead of below them. `.performance-charts` keeps
  `start`; four identical charts already agree.
- **The range presets are one vocabulary** (DDR-0085): `RangeFilter` renders `RANGE_OPTIONS`
  unfiltered, so a preset lands in all three views or none. All anchor to `extent.to`, **never
  `Date.now()`** — a clock empties a history ending last year — and `boundsFor` carries **no
  `default`**: a missing case must be a compile error, not a silent `all`.
- **Charts are dependency-free inline SVG** sized by **aspect ratio, never a pixel width**
  (DDR-0018): an axis label is 11 *viewBox units*, so halving the column halves the label.
  Performance's four charts share one geometry (`lib/chartGeometry`), and both grid breakpoints
  derive from **one** number (`GRID_CONTENT_BREAKPOINT_PX`, 1200) with the sidebar width as a
  defaulted parameter, so neither can be tuned alone. Don't "restore" the old breakpoint by
  lowering it — that ships illegible labels; capping a chart's width stays **rejected**
  (DDR-0051, DDR-0057). **A `viewBox` clips an overflowing label in silence**, so `pad.left` is
  *derived* from a glyph advance and a character budget — **one per axis kind**, because too much
  gutter never clips and so is never reported; only `left` varies. The budget is measured against
  the **rounded** domain, so the currency clip arrives at €800k of portfolio, not €1M (DDR-0051
  §#190, DDR-0091, DDR-0092). A stacked chart's key lives in the **card header**, not a
  `<figcaption>` — `ColumnChart` and
  `StackedAreaChart` both emit a bare `<svg>` (DDR-0052, DDR-0064). **A chart title never varies
  with the range**; the return curve's rebasing is disclosed by a *fixed* header note beside the
  key (DDR-0072).
- **One chart tooltip, drawn inside the `viewBox`** (DDR-0061). `ChartTooltip` over
  `lib/chartTooltip` draws in the plot's own space — so it **cannot** cover the neighbouring chart
  — **pinned to the plot's top** in all four, never tracking the mark. It floats on
  `--surface-raised`; its padding, corner and `MIN_WIDTH` are **viewBox units**, not CSS lengths.
  The income chart is **two bars a month across one baseline** (never a stack), sized in **pixels**
  (`COLUMN_UNIT_PX` = 1, from the label floor) inside `.chart-scroll` — the app's one chart off
  DDR-0018's aspect rule. Gross rises, **withholding hangs below zero**: direction is the
  **series'**, never the value, and a *net* bar is the signed series DDR-0078 refused (DDR-0080). A bar or row with no figure is **absent, not zero**; only the undrawn net is toned.
  `pairedDomain` is **not** `columnDomain` — the step is the dominant side's and the tax side keeps
  its own scale, so the axis is **uneven across zero on purpose** (DDR-0081). Its **value axis is
  HTML**, sticky **inside** the scroller — outside it a scrollbar puts every tick 15px low once the
  plot scrolls; the month labels stay in the `viewBox` (DDR-0077–0081).
- **A `--series-*` slot is a fill; as ink it is `--series-ink-*`** (DDR-0070) — three of the eight
  fail AA as text. A composition row resolves its band's class through that ramp; the slots don't
  move. Daily return's row is toned by **sign**, a zero day not.
- **A curve is `--accent`; a *signed* one splits at zero** into the bars' `--pos`/`--neg` — SVG
  writes both as `fill` (DDR-0071). The split is **clipped geometry, never two series**, and its
  wash anchors on **zero**, not the domain floor. `lib/signedCurve` clamps the clip — a range never
  crossing zero gives a **negative height**, and SVG then renders *nothing*. Gradient `fill`s are
  per element (`useId()`). Dots need a **doubled** selector; `.chart-dot` out-orders a bare one
  (DDR-0059; shipped once).
- **A value axis is `lib/column`'s, never a chart's own** (DDR-0092): `seriesDomain` rounds both
  extremes *outward* to `niceStep`, always ticks zero — so the emphasised rule is the class **that**
  line takes and `showZero` asks whether the series *crosses* zero — and never draws more than
  `MAX_SERIES_TICKS` (6).
- **Chart maths that has drawn a wrong picture before.** The performance curve is **cumulative
  TWR**, not a value curve, so deposits and withdrawals don't move it (DDR-0013). Daily returns are
  **chain-linked from that curve** (`lib/dailyReturns`), never differenced from `valueSeries`, and
  take the **unwindowed** series, so the opening bar measures against the day that really preceded
  it; bars **thin rather than aggregate** (DDR-0049). Composition stacks **cumulatively in base
  currency** with the top edge as NAV: a negative band **hangs below the zero line** (never
  clamped or folded), and `other` is the **residual, surfaced and never redistributed** — drop a
  category into it instead and nothing will look wrong (DDR-0052). The report's `bands` order is
  the **palette**, not the stack: `lib/composition`'s `stackOrder` draws bottom-up Accruals · Cash ·
  `other` · Options · Stocks, so reordering `BAND_SPECS` repaints every band instead of moving one
  (DDR-0073). A slot publishes `--series-hue`; `.stack-hue` mixes it to `--band-tint` — bands
  soften by **mix, not opacity** (only a value is measurable) and stay *under* their full-strength
  edge (DDR-0076). A ribbon carries **no** palette class: a CSS `fill` beats `url(#…)` and the
  tint, hence the `<g>`.
- **The map popup's tint is banked into its edges** (DDR-0041): the gradient's inner stops sit at
  `--popup-pad-y`, an **absolute length, never a percentage** (which creeps under taller popups'
  text), and `--popup-edge-hold` must stay **strictly below** it or the first line lands on
  undiluted `--pos`. `--pos`/`--neg` may never be a mark's *only* channel — a figure must
  accompany them (DDR-0021, superseded but still governing).
- **The sidebar's gateway badge is derived, never polled** (DDR-0056) — its source is the last
  `portfolio:getOverview` result, which is why that tab is excluded from stay-mounted. The one
  `setTimeout` in `SidebarRail.tsx` is a **clock** arming the moment a live reading goes stale,
  not an interval. `displayCurrency` is the **app's** selection, so the control is never disabled,
  and it is a boxed chip too — its `<select>` giving up its resting `border-color` and
  `padding-inline`, and **nothing else** (amends DDR-0035; DDR-0075). The badge is a **boxed chip** on `--surface-raised`, one of **three**
  users (the hover card and that currency field are the others) — so every tone is measured
  **there**, not on `--card`, and `SURFACE_EDGE` is not a WCAG bar (DDR-0069).
  `sidebarRail.test.ts` **counts** its uses — a fourth adopter must measure its own inks
  (DDR-0070). The nav's **"Views" title is the tablist's `aria-labelledby`**, not a caption beside
  it (DDR-0075).
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
  `lib/countryDonuts`, which emits palette **classes** rather than values. It sits **above** the
  breakdown, and its ratio and floor are **one budget** derived from `WINDOW_DEFAULT_HEIGHT` — a
  taller map puts the breakdown's title below the fold (DDR-0074, superseding DDR-0063's ordering).
  Its popup is **not** clipped by the map: Mapbox flips one above or below a mark and nowhere else,
  so the clip lives on `.mapboxgl-canvas-container`, which needs `position: absolute; inset: 0` to
  be the marks' containing block — left static and unsized it clips nothing, and they draw over the
  tiles, the title and the sidebar (#272). The popup may overlap the card below. Marks **name**
  their holdings — bounded, `instrumentName`, `Badge` via `badgeClassName`.
- **The Allocation breakdown's table and donut link on the slice's `key`, never on position** — the
  table sorts by any column, so row order and arc order have no reason to agree. Emphasis **never
  touches `fill`**: the active wedge keeps its colour and the rest drop to 0.35 opacity (DDR-0040).
  The donut's track is **fixed** (`--donut-column-width`) and its stacking breakpoint derived;
  `allocationLayout.test.ts` has the arithmetic (DDR-0063).
- **The basemap and the weight donut's track are one decision** (DDR-0063): the track was `--card`
  at 42%, a grey ring *only over a white map*, and vanishes on `dark-v11`. Move both or neither.

### UI primitives (`components/ui/`, Epic #125)

Each has a guard test in `lib/*Variants.test.ts` failing the same three ways: a superseded selector reappears, an axis value has no rule in
`app.css`, or the primitive re-declares something the shared rules own (focus ring, `:disabled`,
`outline`). **Read the DDR before changing an axis** — each records call sites and rejected
alternatives this table can only name.

| Primitive | Axes | The rule that isn't obvious |
| --- | --- | --- |
| `Button` (DDR-0032) | `variant` × `size` (`icon` is a *shape*) | `ghost` changed meaning — the old `.ghost-button` is now `secondary`. `type` defaults to `"button"`. `className` is for **placement, not colour**. |
| `Card` (DDR-0033, DDR-0059, DDR-0084) | `variant` (surface colour) × `size` (`--surface-pad-*`) | `CardContent` is a **scope** — descendant rules hang off it, keeping a state panel's prose out of reach. The ruled header strip bleeds to the edges by negating `--card-pad`, which each size **restates beside its `padding`** (change one, change both). `.card-header:last-child` gives it back; so does `.card-header.chart-card-header`, **compound or it ties** (DDR-0084). Its third host is `.data-table-scroll-card`, which has no `--card-pad`: that rule **restates** `margin`/`padding` (inherited, the bleed `calc()` is invalid and drops) and is `sticky` (DDR-0087). |
| `StatTile` / `StatRow` (DDR-0034, DDR-0060) | `tone` only | A tile **is** a `Card`, so it declares no surface. **Neutral is the absence of a rule.** Its label is the app's *one* micro-label — the same four declarations as `.data-table thead th`; don't grow a second. |
| `Field` + `Select` + `DateInput` + `PercentInput` + `TermInput` + the Assistant's textarea (DDR-0035, DDR-0094, DDR-0098) | `kind` only — **five**, and still no size axis | **`Field` generates its id with `useId()` and takes no `id` prop** — tabs stay mounted, so all three `RangeFilter`s can be in the document at once and a fixed id would name only the first; `TermInput`'s `<datalist>` id is generated for the same reason. A `kind` carries cursor, colour-scheme and **measure**: `percent` is 5ch so a column lines up, `term` takes the row's slack. `percent` is `type="text"` + `inputMode="decimal"` **on purpose** — a number input alters its value on a passing scroll wheel and drops a comma decimal, which `parsePercent` accepts. `prose` is a `<textarea>` and caps `resize` to `vertical`. |
| `ToggleGroup` (DDR-0036) | `mode`, which is **worn** (`--radius-md` vs `--radius-pill`) | **Never a tablist**: `aria-pressed`, not `role="tab"`. Only `.app-tab` is a real tablist. |
| `Badge` (DDR-0037, DDR-0064, DDR-0065) | `variant` × `size` | **Never a pill** (that corner means multi-select) and **never a background** — the toned pair keeps both: `--pos` / `--neg-text` ink, the *borders* take the fill tokens. `BADGE_VARIANTS` ⊇ `STAT_TONES`, so `toneOf()` names a variant. `sm` carries no vertical padding — with it, every holdings row grows ~7px; alone in a cell it also needs `BADGE_CELL_CLASS`, because CSS cannot see that an inline chip follows a *text node*. Trades' side badge **is** toned (DDR-0086 reverses DDR-0065): the *box*, not the hue, separates it from the figure. |
| `StatePanel` (DDR-0038) | `variant` (the state) × `surface` | Only `error` paints; the axis exists because the copy and the *announcement* differ. `role` is derived. No heading → the panel **is** a `<p>`. |
| `DataTable` (DDR-0039, DDR-0059, DDR-0065, DDR-0087) | the *container's* `surface` × `height` | Sorting is **opt-in per column**; a **missing value sorts last in both directions**. `.data-table-dim` is the absent-value cell — a *neutral* tone is the **absence** of a class, so an untoned cell keeps `--text`. The 11px column head and its `0.06em` tracking are a **pair**. The linked row's lift is scoped to match the hover's specificity and win on source order — unscoped, `tr:hover > th` silently out-specifies it. `title` is a **slot, not a third axis** — it puts the card's strip on `surface="card"` (see `Card`). |

## Stack

Node ≥22.12, CI runs 24 — **no `engines` field enforces it**; the requirement lives in `ci.yml`'s
comment (`@electron/rebuild` / `node-abi` need it). The rest of the stack is `package.json`; the
one external dependency is the IBKR Client Portal Gateway.

Runtime dependencies are deliberately few (`mapbox-gl` is the Allocation basemap and nothing
else). **Avoid adding dependencies without clear long-term value.**

## Commands

```bash
# package.json lists the scripts, and they do what their names say. What it does NOT tell you:

npm install            # postinstall: electron-rebuild for better-sqlite3 (native)
npm run lint           # eslint . — also enforces the layer-boundary import rules
npm test               # vitest run — Node env, *.test.ts under src/
npm run test:e2e       # builds first, then Playwright launches the built app
npm run db:migrate     # applies to ./local.dev.db, NOT the app's DB (override: DATABASE_URL)

npx vitest run src/services/meta/metaService.test.ts   # a single unit test
npx vitest run -t "generates and persists"             # by test-name substring
npm run build && npx playwright test e2e/tab-navigation.spec.ts   # a single e2e spec
```

There is no lint-fix or aggregate `check` script. **CI** runs exactly `lint`, `typecheck`, `test`
and `build` on every push to `main` and every PR (Node 24, Ubuntu); Playwright is **intentionally
excluded** (needs a display server). Run all four, plus `test:e2e` locally, before opening a PR.

## Testing

Mock repositories and external providers; services are the primary target.

**Vitest runs every test under `src/` in a Node environment with no jsdom, so no test may render a
React component.** This shapes the renderer: chart maths, filtering, sorting, formatting and state
are **extracted into pure modules under `renderer/src/lib/`** so they can be tested — follow that
split when adding a component with real logic. Pure repository helpers are tested alike.

Several `lib/*.test.ts` files have **no module under test** — they guard `app.css`, the components,
a view's composition, or accessibility by scanning source text. What a text scan cannot see is
pinned by Playwright (`ls e2e/`; enumerating it here goes stale): a **cascade** resolving, a
**measured width**, a key reaching the app.

Every completed feature should include unit tests, regression review, edge-case validation, and a
Testing Report.

## Skills System (`.claude/skills/`)

Four tiers, each stage's artifact the next stage's input; execution skills consume only *approved*
artifacts and must not redefine requirements, design, or architecture. They are
**plain `SKILL.md` files, not `Skill`-tool skills** — nested one level deeper
than the loader looks, so read `.claude/skills/<tier>/<name>/SKILL.md` directly; invoking one by
name resolves nothing. **`run-app` is the exception**: top level and *is* invocable (`/run-app`),
launching the app for the owner **or** capturing view screenshots, never both at once.

- **workflow-skills** (planning) — `product-manager` → `ui-designer` / `architect` →
  `database-designer` → `implementation-engineer` → `testing`.
- **execution-skills** — seven builders; the Implementation Engineer selects the minimum set.
- **governance-skills** — `adr-writer` (→ `docs/decisions/`), `design-recorder`
  (→ `docs/design-decisions/`), `refactoring-reviewer` (required before significant restructuring).
- **project-management** — `issue-writer` drafts backlog issues, `project-historian` backfills
  historical ones. These track work; they never design it.

Work **originates in GitHub Issues** — the owner authors Epics and Stories, and the Product Manager
**reads them before planning**. Issues are never created after implementation to record work done.

Small bug fixes may skip planning artifacts. **Any change to an already-approved decision must stop
and return to the owning workflow skill rather than being made inline.**

## Documentation

`docs/` holds `architecture.md`, `database.md`, `product.md`, `mcp.md`, `github-issues.md`, plus
`decisions/` (ADRs) and `design-decisions/` (DDRs), each with a README indexing every record in one
line. Adding a repository means keeping `src/repositories/README.md` in step; the layering itself
is `docs/architecture.md`.

Two `docs/` subdirectories are **gitignored**, absent from a fresh clone: `flex-queries/` (see
*Flex data traps*) and `figma_design/` — a design reference, never built or imported by `src/`,
carrying **its own `CLAUDE.md`/`AGENTS.md` that replace this file** for work inside it.

Consult documentation in this order: **`docs/decisions/` → `docs/design-decisions/` →
`docs/product.md` → GitHub Issues → `docs/architecture.md` → `docs/database.md`.** On a conflict:
identify it, explain the tradeoffs, and request clarification or propose a new ADR. **Never silently
override an accepted decision.**

## MCP Servers

Which are enabled is `.claude/settings.local.json`. The `interactive-brokers` entry in `.mcp.json`
still has a **placeholder runtime** (`REPLACE_WITH_RUNTIME`), so enabling it does not make it
functional. A connected
`Interactive_Brokers_IBKR` MCP has read-only account/market tools allowlisted — **no order-placing
tools**.

**Prefer Context7 over model memory** for framework or library documentation. Setup notes: `docs/mcp.md`.

## Product guardrails

Stock Portfolio Viewer is a **standalone, single-user, local-first desktop application** for
personal portfolio analytics.

**The AI assistant proposes; it never acts, and it never sets the policy** (ADR-0009, reversing the
former analytics-only guardrail — don't restore it from an older doc). It may explain, summarize,
compare periods, judge balance against the owner's **investor profile**, and suggest rebalancing
**naming positions**. It may not place an order or reach any path to one, propose changes to the
profile itself, or rebalance on a schedule. The profile is the allocation decision and the owner
writes it.

**The model never produces a figure.** Every number in an answer is computed by a service and
*phrased* by the model; context assembly is deterministic and unit-tested, and the model gets no
tools and no data access. A trim is grounded; an instrument the owner doesn't hold is repeated from
training data — unverified, not price-checked — and the two are **marked apart** in the answer.

**Portfolio data leaves the machine** for that one feature (ADR-0010): `gpt-4.1-mini`, from **main
only**, gated on consent.

## Current Priority

Milestones live in GitHub Issues. Read the backlog to find the active milestone and its work items:

```bash
gh issue list --state open --label epic
gh issue list --state open --milestone "<milestone title>"
gh api repos/:owner/:repo/milestones --jq '.[].title'
```

Prioritize the current milestone over future ones unless explicitly instructed otherwise.
