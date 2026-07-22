# 0005. M3 analytics: read model, base-currency conversion, and per-period aggregation

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

M3 Story #20 imports IBKR Flex Query statements into the immutable `flex_*` tables
([[0004-flex-import-persistence-and-dedupe]]). The four analytics stories — #21
Performance, #22 Allocation, #23 Dividends, #24 Realized gains & trade history — all read
from that store and present figures in the account base currency (EUR). This DDR fixes the
choices they share, so they are decided once rather than re-litigated per story.

Four forces shape the design:

1. **A read path that respects the layering.** `flexRepository` is write-only (parse +
   persist). Analytics need reads, but services must not touch `@db` (ESLint-enforced,
   ADR-0003).
2. **Where base-currency conversion happens.** Flex is multi-currency; some records carry a
   per-row `fxRateToBase` and some are already in base currency. Conversion must be applied
   consistently and only where needed.
3. **Continuous vs. as-of vs. per-period reads.** DDR-0004 de-dupes event tables globally
   but scopes as-of/aggregate tables to their statement. Each view must read from the right
   tier.
4. **The empty state.** Every view must degrade to a clear needs-import state when no Flex
   data exists, modelled as data (consistent with [[0002-connection-state-as-ipc-result]]).

## Decision

### A dedicated read-only repository

A new `flexReadRepository` is the single new layer that touches the `flex_*` tables for
analytics. It is **read-only** (companion to the write-only `flexRepository`) and returns
plain row subsets; all calculation and FX conversion live in the services, which reach data
only through it and stay unit-testable with it mocked. Services live in the **analytics**
domain (`performanceService`, `allocationService`, `realizedGainsService`) and the
**dividends** domain (`dividendService`).

### Base-currency conversion is applied per record type, in the service

- `ChangeInNAV` (performance) and `FIFOPerformanceSummaryUnderlying` (realized/unrealized
  P&L) carry **no per-row FX rate** — IBKR reports them already in base currency. They are
  used as-is.
- `OpenPosition`, `Trade`, and `CashTransaction` carry `fxRateToBase`; the service multiplies
  native amounts (market value, cost basis, realized P&L, dividend/withholding amounts) by
  it to obtain base-currency figures. The native amount and currency are retained for display
  ("original and base currency", per the story ACs).
- Position **weight** uses the Flex-provided `percentOfNav` (share of NAV, which includes
  cash), not a recomputed share of the position total, so grouped breakdowns sum those
  percentages and remain "% of NAV" as the AC requires.

### Read tier per view

- **Performance (#21)** reads all `flex_nav_changes` periods (oldest→newest) and chains the
  per-period TWR — cumulative TWR = ∏(1 + twrᵢ/100) − 1. The value trend is the first
  period's starting value followed by each period's ending value. Realized/unrealized totals
  sum the FIFO summaries; net contributions sum the periods' `depositsWithdrawals`.
- **Allocation (#22)** reads `flex_open_positions` and `flex_securities` from the **latest**
  statement (max `to_date`) — an as-of snapshot of current holdings.
- **Dividends (#23)** reads `flex_cash_transactions` of type `Dividends`, `Payment In Lieu Of
  Dividends`, and `Withholding Tax` across the whole history (globally de-duped tier).
- **Trade history (#24)** lists `flex_trades` across the whole history (globally de-duped
  tier); the realized-P&L rollup per symbol — with short-/long-term split — sums the FIFO
  summaries.

### Per-period aggregation assumes non-overlapping statements

Performance totals and the realized-gains rollup **sum statement-scoped rows across
statements** (FIFO summaries; NAV periods). This is exact only when imported statements cover
**non-overlapping periods** — which is how Portfolio Analyst exports are produced in practice
(per-year buckets), and which the statement-identity de-dupe (DDR-0004) preserves for
identical re-exports. Overlapping re-exports of the *same* period would double-count. This is
the same statement-scoped caveat DDR-0004 raised for lots, carried forward explicitly.

### Needs-import as data

Each analytics IPC channel returns a discriminated union `{ status: 'ok', report } |
{ status: 'needs_import' }`; `needs_import` is returned when no statement has been imported.
The handlers are thin pure reads (no payload, no connection state). The renderer renders
`needs_import` as a first-class empty state with an inline import action.

## Consequences

Benefits:

* One read repository and one conversion convention shared by all four views; the layering
  and mocking story match the existing services exactly.
* Each view reads from the correct de-dupe tier, so continuous history (trades, dividends) and
  as-of state (allocation) are both correct.

Tradeoffs / risks:

* **Non-overlap assumption.** Summing statement-scoped rows is wrong under overlapping
  re-exports. Acceptable for the manual, per-year import workflow M3 targets; a future
  improvement is to select a single covering statement per period (or prefer one full-history
  export) before summing.
* `real`-valued money is aggregated per currency then converted; presentation-layer rounding
  is currency-aware (`Intl.NumberFormat`). Consistent with DDR-0004.

## Alternatives Considered

### Add read methods to the existing `flexRepository`

Rejected: it would mix the write-only immutability guarantee (no read-then-mutate surface)
with a growing query surface. A separate read repository keeps each module's responsibility
single and the write repository's "insert + read-for-dedupe only" shape intact.

### Recompute position weights as share of the position total

Rejected: the ACs ask for "% of NAV", and Flex already provides `percentOfNav` (NAV includes
cash). Recomputing over positions would silently change the denominator.

### Convert to base currency in the repository

Rejected: conversion is business logic and must be testable without the database. The
repository returns native amounts + `fxRateToBase`; the service converts.

## References

- [[0004-flex-import-persistence-and-dedupe]] — the store this reads; the statement-scope caveat
- [[0002-connection-state-as-ipc-result]] — result-as-data convention reused for `needs_import`
- [[0005-flex-query-file-import]] (ADR-0005) — the Flex data source
- GitHub Issues #4 (Epic M3), #21–#24 (Stories)
