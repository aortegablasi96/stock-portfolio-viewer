# 0015. Allocation view: cash as an asset class, derived from the NAV residual

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
open position.** The imported Flex sections carry no cash-balance line — there is no
`CashReport` in the exports, and the `CASH` asset category that already exists denotes *forex
positions*, not an uninvested balance.

Two sources could supply cash:

- **`OpenPosition.percentOfNAV`** — each position's share of NAV. If IBKR's NAV denominator
  *includes* cash, the shortfall of the positions' summed weights below 100% would be the cash
  share.
- **`ChangeInNAV.endingValue`** — the statement's authoritative total NAV in base currency.
  Cash is then the residual `NAV − Σ invested market value`.

The first route was tried first and **shipped broken**. Checking against the owner's live
account (via the IBKR gateway) was decisive: the account holds ~360 EUR cash (IBKR's own
Portfolio-Analyst allocation reports Cash at ~0.6% of NAV), yet **no cash slice appeared**. The
reason: in every imported statement the positions' `percentOfNAV` sum to **exactly 100.00**.
Flex's `percentOfNAV` is normalised to the invested positions — it does **not** include cash in
its denominator despite the field name — so the shortfall is always zero and cash is invisible
to it. (This was mis-read during the first design pass as "the portfolio is fully invested.")

The NAV-residual route, by contrast, is correct. For the 2026 statement, summing each
position's `position × markPrice × fxRateToBase` gives ≈ 63,275 EUR against a
`ChangeInNAV.endingValue` of 63,635.55 EUR — a residual of ≈ **360 EUR**, matching the live
cash balance almost exactly. The residual the first pass dismissed as "accrual/rounding noise"
was the actual cash all along.

## Decision

### Derive cash from the NAV residual, not from position NAV weights

Cash is the residual of the statement's ending NAV over the invested market value:

```
cashValueBase = navEndingValue − totalMarketValueBase
cashPercent   = cashValueBase / navEndingValue × 100
```

`navEndingValue` is the latest statement's `ChangeInNAV.endingValue`, already in base currency;
`flexReadRepository.getLatestOpenPositions()` now returns it alongside the positions (a single
extra column read on the statement already being loaded — **no new IPC channel, table, or domain
schema**). The whole change lives in the read repository and `allocationService`.

### Rebase the invested slices so the classes sum to 100%

Because Flex `percentOfNAV` sums to 100% over the positions alone, simply appending a cash slice
would push the asset-class legend past 100%. When cash is present, each invested slice's percent
is recomputed against the full NAV (`marketValueBase / navEndingValue × 100`) so every class —
positions and cash — shares one denominator and the breakdown sums to 100% (acceptance
criterion 3). When there is no cash, the invested slices keep their Flex-reported weights
unchanged.

### A guard band so full investment shows nothing

A cash slice is emitted only when `cashPercent ≥ 0.1` (and `navEndingValue > 0`). Our
per-position valuation and IBKR's reported NAV can disagree by small amounts; 0.1% of NAV
absorbs that so a fully-invested portfolio shows no slice. A *negative* residual (a margin/loan
balance, `Σ invested > NAV`) is below the threshold too, so a negative cash slice never appears.

### Cash is an asset-class-only slice with a reserved key

The slice is `{ key: '__cash__', label: 'Cash', marketValueBase, percentOfNav }`, appended to
`byAssetClass` and re-sorted by value. The key is deliberately distinct from the Flex `CASH`
category (forex positions, labelled 'Cash / FX') so the two never merge, and — being non-empty
and not the `Other` key — it is **not** a residual slice, so the donut gives it a real
categorical hue rather than the neutral gray
([[0009-sector-classification-cache-and-allocation-donuts]]).

Cash appears in the asset-class breakdown **only**. It is not added to `byCurrency`,
`byCountry`, `bySector`, the positions table, or `totalMarketValueBase` (the "Invested value"
stat tile stays invested-only). Splitting cash by currency is explicitly out of scope for #47
— that belongs to the currency breakdown from #30.

## Consequences

- The asset-class donut now sums to the full portfolio (positions + cash) while the other
  breakdowns remain invested-only; this is intended, and their legends still don't sum to 100
  ([[0005-analytics-read-model-and-base-currency-conversion]]).
- "Cash" here is the NAV residual, so it folds in any small disagreement between our per-position
  valuation and IBKR's NAV, plus genuine non-position balances IBKR counts in NAV (accrued
  dividends/interest). Against the owner's data this residual tracks the reported cash to within
  a euro, which is acceptable for an allocation view; the guard band keeps sub-0.1% disagreement
  from rendering.
- The renderer required **no change**: the existing `PieChart` renders the new slice from its
  label, value and percent.
- This decision **reverses the first (broken) design pass**, which derived cash from a
  `percentOfNAV` shortfall and rejected the NAV residual as noise. The lesson: `percentOfNAV` is
  normalised to positions and cannot represent cash — validate against live account data before
  recording an empirical premise.

## Alternatives considered

- **Cash from a `percentOfNAV` shortfall (`100 − Σ percentOfNAV`).** Fails outright: Flex
  `percentOfNAV` sums to 100% over positions and excludes cash, so the shortfall is always zero
  and no cash slice is ever produced — the bug this DDR corrects. Rejected.
- **Read a cash balance from Flex.** No `CashReport`/cash-balance line is present in the exports,
  so there is nothing to read without changing the Flex query and import pipeline —
  disproportionate to the story. Rejected.
- **Add cash to `totalMarketValueBase` and the positions table.** Broadens the story beyond the
  asset-class breakdown and muddies the "Invested value" metric and per-instrument table.
  Rejected.
