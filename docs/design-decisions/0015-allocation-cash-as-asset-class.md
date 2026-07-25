# 0015. Allocation view: cash as an asset class, derived from position NAV weights

- **Status:** Accepted
- **Date:** 2026-07-25

## Context

Story #47 (Epic #4, M3 refinement) asks the Allocation view's **asset-class** breakdown to
include **uninvested cash**, so the breakdown reflects the full portfolio rather than only the
invested positions. The acceptance criteria require cash to be converted to base currency
consistently with the other figures, the class percentages to account for cash so they sum to
the full portfolio, and — crucially — **no cash slice at all when there is no cash**.

`allocationService.getAllocation()` values the *latest* imported statement's Flex
`OpenPosition` rows and groups them by asset class, currency, country and sector
([[0005-analytics-read-model-and-base-currency-conversion]]). The problem: **cash is not an
open position.** The imported Flex sections (`OpenPositions`, `ChangeInNAV`, trades, cash
transactions, accruals) carry no cash-balance line — there is no `CashReport` in the exports,
and the `CASH` asset category that already exists denotes *forex positions*, not an uninvested
balance.

Two sources could supply cash:

- **`ChangeInNAV.endingValue`** — the statement's authoritative total NAV in base currency.
  Cash would be the residual `NAV − Σ invested`.
- **`OpenPosition.percentOfNAV`** — each position's share of NAV, and IBKR's NAV denominator
  *includes* cash. So the shortfall of the positions' summed weights below 100% is exactly the
  cash share.

Checking both of the owner's exports (2025, 2026) was decisive: in each, the positions'
`percentOfNAV` sum to **exactly 100.00** (fully invested, ~zero cash). The NAV-residual route,
by contrast, left a small non-zero remainder (~355 EUR in 2026) — dividend/interest accruals
and rounding — that would render a spurious "cash" slice, directly violating the "no cash → no
slice" criterion.

## Decision

### Derive cash from the position NAV weights, not from NAV residual

Cash is computed entirely from data the positions already carry:

```
investedPercent = Σ position.percentOfNav
cashPercent     = 100 − investedPercent
cashValueBase   = totalMarketValueBase × cashPercent / investedPercent
```

`cashValueBase` scales the invested base-currency total by the cash-to-invested weight ratio,
so cash stays consistent with the percentages the chart already shows and needs **no separate
NAV figure** — hence **no new repository read, IPC channel, table, or domain schema**. The
whole change lives in `allocationService` (plus doc comments). This mirrors #46
([[0014-allocation-world-map-bubble-map]]), which likewise added a view feature over data the
service already produced.

### A guard band so full investment shows nothing

Flex reports `percentOfNAV` to two decimals, so summing N positions can drift by ~N × 0.005.
A cash slice is emitted only when `cashPercent ≥ 0.1` (and `investedPercent > 0`). Below that
the gap is treated as rounding noise and the breakdown is returned unchanged — so a
fully-invested portfolio (both sample statements) behaves exactly as before, and an
over-weighted sum (negative `cashPercent`, e.g. leverage) never produces a negative slice.

### Cash is an asset-class-only slice with a reserved key

The slice is `{ key: '__cash__', label: 'Cash', marketValueBase, percentOfNav }`, appended to
`byAssetClass` and re-sorted by value. The key is deliberately distinct from the Flex `CASH`
category (forex positions, labelled 'Cash / FX') so the two never merge, and — being non-empty
and not the `Other` key — it is **not** a residual slice, so the donut gives it a real
categorical hue rather than the neutral gray ([[0009-sector-classification-cache-and-allocation-donuts]]).

Cash appears in the asset-class breakdown **only**. It is not added to `byCurrency`,
`byCountry`, `bySector`, the positions table, or `totalMarketValueBase` (the "Invested value"
stat tile stays invested-only). Splitting cash by currency is explicitly out of scope for #47
— that belongs to the currency breakdown from #30.

## Consequences

- The asset-class donut now sums to the full portfolio (positions + cash) while the other
  breakdowns remain invested-only; this is intended, and their legends still don't sum to 100
  ([[0005-analytics-read-model-and-base-currency-conversion]]).
- "Cash" here is genuinely *uninvested cash* as IBKR weights it. Because it is derived from
  `percentOfNAV` rather than the NAV residual, it excludes accrual/receivable noise — the
  trade-off is that the magnitude is proportional to the rounded weights, which is acceptable
  for an allocation view.
- The renderer required **no change**: the existing `PieChart` renders the new slice from its
  label, value and percent.

## Alternatives considered

- **Cash = `ChangeInNAV.endingValue − Σ invested`.** Authoritative NAV, but the residual folds
  in accruals and rounding, producing a spurious cash slice for fully-invested statements —
  fails the "no cash → no slice" criterion. Rejected.
- **Read a cash balance from Flex.** No `CashReport`/cash-balance line is present in the
  exports, so there is nothing to read without changing the Flex query and import pipeline —
  disproportionate to the story. Rejected.
- **Add cash to `totalMarketValueBase` and the positions table.** Broadens the story beyond the
  asset-class breakdown and muddies the "Invested value" metric and per-instrument table.
  Rejected.
