# 0007. Portfolio view display currency: live IBKR FX source + selector/display conventions

- **Status:** Accepted
- **Date:** 2026-07-22

## Context

M3 was reopened (Epic #4) to refine the built views. Story #28 adds a user-selected
**display currency** to the **live Portfolio view** so positions held in different
currencies can be compared like-for-like.

Two things must be decided once, here, so they are not re-litigated later:

1. **Where the FX rate comes from.** The analytics views already convert to base currency
   (EUR) using the per-row `fxRateToBase` carried by imported Flex data
   ([[0005-analytics-read-model-and-base-currency-conversion]]). But the Portfolio view is
   **live** — sourced from the IBKR Client Portal Gateway (positions + ledger), not from
   Flex — and IBKR positions carry a `currency` but **no rate to base**. So #28 cannot reuse
   the Flex conversion path; it needs a live rate.
2. **How the conversion is shown.** A converted figure must never be mistaken for a native
   quote, and the control that drives it should set a reusable precedent for the filter/select
   controls stories #32/#33 will need (the app has no `<select>` today).

A latent correctness issue motivates the story: `portfolioService.getOverview()` currently
sums each holding's `marketValue` with **no regard to `currency`**, so any multi-currency
total is a currency-mixed (meaningless) sum. Converting before summing fixes it.

## Decision

### FX source: live IBKR gateway rates, not Flex rates

The Portfolio view converts using **live rates from the IBKR gateway**, following the
existing ADR-0004 integration pattern (gateway HTTP + Zod at ingress → repository maps →
service converts). Rationale: the view shows live IBKR prices; converting them with
imported/historical Flex rates would pair a fresh price with a stale rate, and Flex rates
only exist once an import has happened.

- The **gateway** gains one read method (IBKR CPAPI `/iserver/exchangerate`), Zod-validated
  at ingress exactly like `getPositions`/`getLedger`. The endpoint's response shape and
  source/target direction were verified against the live gateway (2026-07-22): it returns
  `{ "rate": <number> }` where the rate is units of `target` per unit of `source`
  (USD→EUR → `0.8765`, EUR→USD → `1.1408`, EUR→EUR → `1.0`), confirmed for all currencies
  in the owner's live portfolio (CAD, EUR, JPY, USD) against both EUR and USD targets.
- The **repository** exposes a domain method `getExchangeRates(currencies, base)` returning a
  native→display rate map. It does **not** convert (same rule as
  [[0005-analytics-read-model-and-base-currency-conversion]]: conversion is business logic,
  testable with the repository mocked).
- The **service** (`portfolioService.getOverview(displayCurrency)`) converts each holding's
  monetary fields, **recomputes the total and allocation weights from the converted values**,
  and converts the base-currency balances by the base→display rate. Native amount + currency
  are retained for display.

Consequence to accept knowingly: the Portfolio view and the analytics views can show slightly
different EUR figures for the same instrument (live rate vs. imported Flex rate). This is
intentional — each view is internally consistent with its own data source.

### Rate-unavailable is modelled as data, not an error

If a currency's rate can't be fetched, the affected positions are flagged **unconverted**
(native value + a per-position flag) rather than injected into the total as a wrong/zero
number; the total is computed from the positions that did convert. This mirrors the
connection-state-as-data convention ([[0002-connection-state-as-ipc-result]]).

### UI convention 1 — display-currency selector in the view header

A labelled native `<select>` ("Display currency") lives in the existing dashboard header
action cluster, defaulting to the account base currency (**EUR**). Its candidate list is
**base + the distinct currencies actually present in the holdings** — not an exhaustive ISO
list. Changing it refetches (conversion is server-side); the current data stays visible with
a subtle `role="status"` busy hint rather than blanking the view. This is the app's first
`<select>`; it is styled once against the existing button/spacing system so stories #32/#33
reuse it instead of inventing divergent one-off dropdowns.

### UI convention 2 — native quote vs. converted value split

Per position: **Price** stays in the instrument's **native** quote currency (a quote is a
native-currency fact; converting it misleads), while **Market value** shows the **converted**
value in the display currency with the native currency always visible per row (a muted ISO
chip on the value cell). The active display currency is labelled on the balances tiles and
the view. Reuses the existing `formatCurrency(value, currency)` helper.

## Consequences

Benefits:

* The live view's total and weights become correct (converted before summing), fixing the
  currency-mixed-sum defect.
* One documented FX-source rule per view prevents the live and Flex conversion paths from
  being conflated later.
* A single reusable selector/filter control precedent for the remaining M3 refinement stories.

Tradeoffs:

* Live vs. Flex rates can disagree across views for the same instrument (accepted above).
* Switching currency refetches positions + a small rate set from IBKR each time; acceptable
  for a single-user local app. Fallback if it ever feels slow: bundle the rate set with the
  overview and re-derive client-side (heavier contract — avoid unless needed).

Risks:

* **`/iserver/exchangerate` shape/direction** — verified live (2026-07-22); the ingress Zod
  guard remains as protection against a future API drift.
* **Parts-must-equal-whole rounding**: the total must be the sum of converted per-position
  values (never native total × one rate), with rounding at presentation and a stated
  tolerance in tests.

## Alternatives Considered

### Reuse the Flex `fxRateToBase` rates for the Portfolio view

Rejected: those rates are historical/imported and only exist after a Flex import; pairing a
stale rate with a live price is internally inconsistent, and the view would silently depend on
an unrelated import having happened.

### Convert in the repository (or client-side in the renderer)

Rejected: conversion is business logic and must be unit-testable with the repository mocked
(consistent with DDR-0005). Client-side conversion would also push rates and calculation into
the renderer, which may not reach data sources.

### Exhaustive ISO currency list in the selector

Rejected: only the base currency and currencies actually held are meaningful for this
portfolio; a full list adds noise and irrelevant options.

## References

- [[0005-analytics-read-model-and-base-currency-conversion]] — the Flex-sourced conversion
  path this view deliberately does **not** reuse; the "convert in the service" rule it shares
- [[0002-connection-state-as-ipc-result]] — result/flag-as-data convention reused for the
  rate-unavailable case
- [[0001-dashboard-layout-and-load-states]] — the header/tiles/table chrome extended here
- ADR-0004 (`docs/decisions/0004-interactive-brokers-integration.md`) — the gateway
  integration pattern the new `/iserver/exchangerate` read follows
- GitHub Issues #4 (Epic M3), #28 (Story)
