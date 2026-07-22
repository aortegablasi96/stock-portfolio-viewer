# 0008. Performance view: daily portfolio-value reconstruction from Flex MTM history

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

M3 was reopened (Epic #4) to refine the built views. Story #29 asks the Performance view to
show portfolio value **day by day** so the owner can read the *trajectory* — dips, rallies,
contribution steps — rather than only the endpoints.

Today `performanceService` builds `valueSeries` from the `ChangeInNAV` period endpoints only:
the first period's `startingValue` followed by each period's `endingValue`
([[0005-analytics-read-model-and-base-currency-conversion]]). With the owner's two per-year
Portfolio Analyst exports that is **three points** — a straight line that hides everything
between imports.

The issue explicitly deferred the **data source for daily granularity** to planning ("denser
Flex history, daily snapshots, or interpolation"). The imported Flex statements already carry
a dense daily record that is currently parsed away: the `PriorPeriodPositions` section — one
`PriorPeriodPosition` row per held instrument **per trading day**, with that day's `price` and
`priorMtmPnl` (mark-to-market P&L vs. the prior day) in the instrument's native currency plus
its `fxRateToBase`. The 2026 export alone contains 141 distinct daily dates. The owner chose
to **reconstruct the daily curve from this MTM history** over the trivial carry-forward of the
existing endpoints (which would still be a straight line) and over a full per-day holdings
revaluation (accurate but fragile: it needs FIFO quantity reconstruction and a rebuilt cash
ledger — disproportionate for a single-user local tool).

## Decision

### Data source: the `PriorPeriodPositions` daily MTM series, persisted like other as-of Flex rows

`PriorPeriodPosition` rows are parsed, validated at ingress (like every other Flex record),
and persisted into a new **append-only, statement-scoped** table
`flex_prior_period_positions` — the same tier as `flex_open_positions` (DDR-0004): fresh
insert per statement, no global de-dupe, cascade-deleted with its statement. The write-only
`flexRepository` persists them; the read-only `flexReadRepository` exposes reads. This reuses
the existing flex import + read-model slice exactly; it adds no new domain and no new IPC
channel — `PerformanceReport.valueSeries` is already `ValuePoint[]`, so a denser series is a
drop-in.

### Reconstruction: cumulative daily MTM + dated contributions, anchored to the authoritative endpoints

The daily base-currency value curve is built **in the service** (conversion and calculation
never live in the repository — DDR-0005), one `ChangeInNAV` period at a time, oldest→newest:

1. **Daily MTM increment** for each date `d`: `Σ (priorMtmPnl × fxRateToBase)` over that
   date's `PriorPeriodPosition` rows (base currency).
2. **Dated contributions**: `Deposits/Withdrawals` cash transactions, converted
   (`amount × fxRateToBase`) and bucketed to their UTC day. These are the large NAV *steps*
   that must land on the correct date — a smooth interpolation cannot reproduce them.
3. **Raw curve**: starting from the period's `startingValue`, cumulate MTM + contributions
   across the union of MTM dates and contribution dates within the period.
4. **Endpoint anchor**: the raw curve rarely lands exactly on the period's `endingValue` — it
   deliberately omits the smaller, non-daily components (dividends, withholding, interest,
   fees, FX translation, accruals, and the MTM of positions opened intraperiod). The residual
   `endingValue − rawEnd` is spread **linearly in time** across the period. So every point at
   `fromDate` equals `startingValue` exactly and every point at `toDate` equals `endingValue`
   exactly (the authoritative figures are never contradicted), while the interior carries the
   real MTM shape and the contribution steps.

The series is the concatenation of all periods' anchored points (shared period boundaries are
not duplicated). Explicit points exist only on dates the Flex data covers (trading days +
contribution days); intervening non-trading days (weekends/holidays) are **carried forward** —
the line connecting consecutive points is the documented, consistent gap-fill (AC).

**Graceful degradation:** a period with no `PriorPeriodPosition` data (older imports, or a
Flex config without the section) falls back to its two endpoints — identical to today's
behaviour — so the change is backward compatible and the empty/`needs_import` state is
unchanged.

### Rendering: the shared line chart drops per-vertex markers for a dense series

`LineChart` renders a `<circle>` with a hover `<title>` per vertex — right for 3 points, wrong
for 140+. For a dense series (more points than a small threshold) it renders the line and area
only, keeping the axis endpoints legible; the sparse-series dots are retained below the
threshold. `role="img"` + `aria-label` remain the non-visual path (a per-day data table is out
of scope). No new charting dependency.

## Consequences

Benefits:

* The Performance view shows the real day-by-day trajectory, reconciled exactly to IBKR's
  authoritative period start/end values.
* Pure reuse of the flex import → read-model → analytics slice; no new domain, IPC, or
  dependency. The daily curve is a foundation later work (e.g. benchmark overlay, Epic #7) can
  build on.

Tradeoffs:

* The interior of the curve is a **reconstruction**, not IBKR's own daily NAV: the linear
  residual spread approximates the sub-daily components it doesn't model. It is faithful in
  shape and exact at the endpoints, not to-the-cent every day. Documented here as intentional.
* Persisting one row per instrument per day grows the flex store (~1–2k rows per yearly
  statement) — trivial for a local single-user SQLite database.

Risks:

* **MTM does not fully reconcile to period MTM** (e.g. 2026: `Σ priorMtmPnl` ≈ 4755 vs.
  `ChangeInNAV.mtm` 5554) because positions opened intraperiod aren't "prior period"
  positions. The endpoint anchor absorbs this; the shape is unaffected in practice.
* **Overlapping statements** would double-count daily rows just as DDR-0005 noted for period
  sums. Same non-overlap assumption, same manual per-year workflow; unchanged here.

## Alternatives Considered

### Carry-forward the existing endpoints to daily granularity

Rejected: with only per-year statement endpoints this still draws a straight line between
imports — it satisfies the AC wording but not the intent ("understand the trajectory").

### Full per-day holdings revaluation (quantity × daily price + reconstructed cash)

Rejected: most conceptually precise but requires FIFO quantity reconstruction across 250+
trades and a rebuilt cash ledger — high complexity and fragility disproportionate to a
single-user local analytics tool.

### Aggregate/convert the MTM in SQL in the repository

Rejected: base-currency conversion is business logic and must stay unit-testable with the
repository mocked (the rule shared by DDR-0005 and [[0007-portfolio-display-currency-and-live-fx]]).
The repository returns native `priorMtmPnl` + `fxRateToBase`; the service converts and groups.

## References

- [[0005-analytics-read-model-and-base-currency-conversion]] — the performance read model and
  the "convert in the service" rule this extends; the non-overlap statement caveat
- [[0004-flex-import-persistence-and-dedupe]] — the append-only, statement-scoped tier the new
  table joins
- [[0007-portfolio-display-currency-and-live-fx]] — the sibling M3 refinement DDR; shared
  conversion-in-service rule
- ADR-0005 (`docs/decisions/0005-flex-query-file-import.md`) — the Flex file data source
- GitHub Issues #4 (Epic M3), #29 (Story)
