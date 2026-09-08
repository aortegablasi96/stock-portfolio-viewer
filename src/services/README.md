# `src/services`

**Business logic**, one directory per domain. A service orchestrates, calculates and decides; it
reaches data only through a repository and knows nothing about where that data lives (ADR-0003).
Services are the **primary unit-test target** — every one of them has a `*.test.ts` beside it, with
its repositories mocked.

Services may not import `@db` or `electron`. A service that needs something from Electron takes it
as a parameter (plain geometry rectangles) or emits through a callback the main process supplies.

| Directory | Covers |
| --- | --- |
| `portfolio/` | the live IBKR read — holdings, balances, allocation, converted to a display currency |
| `snapshots/` | immutable local history; reads IBKR only *through* `portfolioService` (DDR-0003) |
| `flex/` | Flex Query import and the imported-statement store, split write / read (`flexImportService` / `flexStatementsService`) |
| `analytics/` | performance, allocation and realized gains over imported Flex history |
| `dividends/` | income received, withholding, per-share history and upcoming accruals |
| `classification/` | sector and industry, cache-first with a gateway fallback |
| `profile/` | the investor profile, balance drift against it, the app's baseline, and the moves that close a gap |
| `assistant/` | the one caller of the OpenAI gateway: tools, reports, prompt and budget |
| `dataCoverage/` | what has been imported and captured, and over what span |
| `meta/` | install id and other small application metadata |
| `window/` | window geometry and sidebar collapse, remembered across launches |
| `system/` | `ping` — the minimal slice, and the reference for the test style |

## Conversion is a service concern

**Base-currency conversion happens here** — never in a repository, never in the renderer. The
portfolio domain converts with **live gateway FX**, not Flex's own `fxRateToBase`; a row that
cannot be converted carries `displayValue === null` and leaves the totals and the allocation
rather than being guessed at (DDR-0007). Analytics convert to base (EUR) in the service too, each
returning `ok | needs_import`.

## Results, not exceptions

A service method returns a named state. `ok`, `needs_import`, `not_connected`, `not_responding`,
`invalid`, `canceled`, `error` — and the successes that are not `ok`: `captured`, `imported`,
`saved`, `cleared`. The distinctions are about **how the owner recovers**, which is why a timeout
is not a subclass of not-connected (DDR-0022).

## The two that are not like the others

**`profile/`** computes balance drift **deterministically — no model ever does this arithmetic**.
It measures the **live** portfolio against the owner's targets, and where the profile is silent it
applies the app's own published baseline and marks every line with whose standard it is
(ADR-0012, DDR-0095, DDR-0109). Residuals are surfaced, never redistributed.

**`assistant/`** is the only caller of `aiGateway`. Its tools each return a *computed report* —
never data for the model to derive from — and the model phrases figures it may not produce
(DDR-0111). A question is a bounded tool loop with three bounds on it, and no round is a retry.
Read `CLAUDE.md`'s **assistant** entry before changing anything here; it is the densest set of
constraints in the app, and `promptBudget.test.ts` measures what a change costs.
