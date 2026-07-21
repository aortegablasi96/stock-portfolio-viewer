# 0004. Flex import persistence: real-valued multi-currency amounts, append-only, two-tier de-dupe

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

[[0005-flex-query-file-import]] (ADR-0005) establishes that M3 imports IBKR Flex Query XML
statements into local SQLite through the `flex` domain. This DDR fixes the persistence-level
choices that every M3 story then inherits, so they are decided once here rather than per story —
mirroring how [[0003-snapshot-persistence-and-capture-policy]] fixed the snapshot money model.

Three forces shape the design:

1. **Money representation.** DDR-0003 stores snapshot money as **integer minor units** (×100),
   which is exact *because snapshots are single-base-currency (EUR) and 2-decimal*. Flex data
   breaks both assumptions: it is **multi-currency** (EUR, CAD, JPY — and JPY has **zero** minor
   digits, so ×100 is simply wrong), and it carries **high-precision non-money fields** —
   `fxRateToBase="0.62268"`, `tradePrice="148.406666667"`, `twr="7.123739826"`. A fixed ×100
   integer scale cannot represent this data faithfully.
2. **Idempotent re-import.** The owner will re-export overlapping periods (e.g. a later 2026 YTD
   export is a superset of an earlier one). The same trade or dividend must not be counted
   twice, while genuinely new records must merge into one continuous history.
3. **Immutability.** Imported records are authoritative historical facts and must be
   append-only, consistent with the snapshot guarantee.

## Decision

### Numeric fields stored as SQLite `real`

All Flex numeric fields — monetary amounts, prices, FX rates, quantities, and P&L — are stored
as `real` (double), holding the decimal value directly. The original `currency` and
`fxRateToBase` are retained on every monetary row so base-currency conversion is reproducible
without re-import. This is a **deliberate deviation from DDR-0003's integer-minor-units
convention**, scoped to the `flex_*` tables, justified by multi-currency + high-precision data.
The snapshot tables keep their minor-units model unchanged.

### Dates stored as epoch-milliseconds (UTC)

Flex `YYYYMMDD` and `YYYYMMDD;HHMMSS` values are parsed to integer epoch-ms (UTC) in the parser,
consistent with the app-wide timestamp convention (`captured_at`, `created_at`).

### Append-only header + child tables

A `flex_statements` header row per imported statement, with child tables
(`flex_nav_changes`, `flex_open_positions`, `flex_trades`, `flex_lots`,
`flex_cash_transactions`, `flex_fifo_summaries`, `flex_securities`) referencing it
`ON DELETE CASCADE`. As with `snapshotRepository`, `flexRepository` exposes **only insert and
read** methods — no update/delete path — so immutability is structural, not conventional. Each
statement and all its child rows commit in a **single transaction** (all-or-nothing per file).

### Two-tier de-duplication

- **Event records** that can appear in overlapping statements de-dupe **globally** via a unique
  key, using SQLite insert-or-ignore (never update):
  - `flex_cash_transactions` — `UNIQUE(dedupe_key)`, where `dedupe_key` is the Flex
    `transactionID` when present (clean natural key), else a deterministic content hash.
  - `flex_trades` — `UNIQUE(trade_key)`. This Flex configuration omits `tradeID` on `Trade`
    rows, so `trade_key` is a deterministic composite of stable fields
    (`conid|dateTime|quantity|tradePrice|openCloseIndicator|ibCommission`).
- **As-of / aggregate records** (`flex_nav_changes`, `flex_open_positions`,
  `flex_fifo_summaries`, `flex_securities`, `flex_lots`) are **scoped to their `statement_id`**;
  they are not de-duped across statements. Downstream views select the appropriate (latest
  covering) statement rather than unioning across statements.

### Statement identity

`flex_statements` carries `UNIQUE(account_id, from_date, to_date, when_generated)`. Re-importing
the exact same exported file is a no-op; a fresh export of the same period (new
`when_generated`) is a new statement whose event rows merge by the tier-1 keys above.

## Consequences

Benefits:

* Faithfully represents multi-currency amounts and high-precision prices/rates that
  integer-minor-units cannot.
* Re-importing overlapping exports is safe and idempotent; history stays continuous and
  de-duplicated.
* Immutability is a property of the repository surface, matching the snapshot precedent.

Tradeoffs:

* Two numeric conventions now coexist — minor-units for snapshots, `real` for Flex. The boundary
  is clear (per-table) but must be understood when reading the schema.
* `real` money is subject to floating-point representation; acceptable here because Flex figures
  are imported facts displayed and aggregated per-currency, not the driftless cross-snapshot
  `SUM` that motivated DDR-0003's integer choice. Currency-aware rounding happens at the
  presentation/service layer.

Risks:

* **`trade_key` collision.** Without a native `tradeID`, two genuinely identical fills would
  collapse to one row. Low likelihood; revisit if the owner enables `tradeID` in the Flex Query
  definition, which would give a clean natural key.
* **Statement-scoped lots** duplicate across overlapping statements by design; the realized-gains
  view (#24) must read lots from a single covering statement, not union across statements.

## Alternatives Considered

### Option A — Reuse DDR-0003 integer minor units for Flex money

Rejected: a fixed ×100 scale mis-represents zero-decimal currencies (JPY) and cannot store FX
rates or high-precision prices at all. It would require a per-currency scale table and still fail
the non-money fields.

### Option B — Store amounts as decimal text

Preserves exactness without a scale assumption, but blocks SQL aggregation/ordering and pushes
all arithmetic into application code for every analytics query. Rejected as heavier than the
analytics need; `real` keeps figures directly queryable.

### Option C — Statement-level de-dupe only (no record-level keys)

Rejected: it cannot merge overlapping exports — either it drops a whole re-exported statement
(losing genuinely new rows) or double-counts events. Record-level keys for events are required
for a correct continuous history.

## References

- [[0005-flex-query-file-import]] (ADR-0005) — the data-source decision this DDR implements
- [[0003-snapshot-persistence-and-capture-policy]] — the money model this deliberately deviates
  from; [[0002-connection-state-as-ipc-result]] — result-as-data convention
- Architecture Review & Database Review — M3 Story #20 (this session)
- `docs/database.md`, `docs/flex-queries/`
- GitHub Issues #4 (Epic M3), #20 (Story)
