# 0010. Upcoming dividends from Flex open accruals; net-of-withholding chart reading

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

Story #31 (Epic #4, M3) asks the Dividends view for two things: a bar chart that reads as
**net of withholding tax**, and a list of dividends **announced but not yet paid**. The
issue explicitly defers the second one's data source to planning, noting that
"announced-but-unpaid dividends are not in the Flex history".

That framing was right about the *history* but not about Flex as a whole. The dividends
view is assembled from `CashTransaction` rows
([[0005-analytics-read-model-and-base-currency-conversion]]), and a cash transaction exists
only once money has moved — by construction it cannot describe a dividend that has been
declared but not paid. Two sources could:

- The **Client Portal Gateway**, whose market-data snapshot exposes a next-dividend amount
  and ex-date per contract. Per-share, per-instrument, and it would make an otherwise
  offline analytics view depend on a running gateway — the same objection DDR-0009 records.
  The gateway was also not running when this was planned, so the field shapes could not be
  verified.
- The Flex **`OpenDividendAccruals`** section, an optional section of the same Activity
  Flex Query the app already imports. It reports, per instrument, exactly what the story
  asks for: `exDate`, `payDate`, `quantity` held prior to the ex-date, `grossRate` per
  share, `grossAmount`, `tax`, `fee` and `netAmount`, with `currency` and `fxRateToBase`.

The first half of the story turned out to be largely satisfied already: Story #23 shipped a
stacked column chart whose lower segment is net income and upper segment is withholding.
What was missing was that nothing in the view *said* so.

## Decision

### Upcoming dividends come from the Flex accruals section, not the gateway

A new append-only table `flex_open_dividend_accruals` stores the section, **statement-scoped**
like `flex_open_positions` — it is an as-of balance, not an event, so it carries no global
de-dupe key and each import inserts a fresh set. `flexReadRepository.getLatestOpenDividendAccruals()`
reads the **latest statement only**, alongside that statement's end date as `asOf`. Reading
older statements would resurrect accruals that have since been paid and are already counted
in the cash history.

This keeps every `analytics:*` read offline and inside the existing Flex read model. No new
IPC channel: the payload rides on the existing `analytics:getDividends` result.

### Withholding is derived, never trusted from a sign

IBKR's own field description for `netAmount` ("adding the tax and fee amounts and then
subtracting it from the gross amount") does not pin down whether `tax` and `fee` arrive as
negatives or as magnitudes. `netAmount` is unambiguous, so the service computes
`withholdingBase = grossBase − netBase` and reports it as a positive magnitude — the same
convention the realised half of the view already uses for `DividendGroup.withholdingBase`.
The raw `tax` / `fee` are still persisted, so a future decision can revisit this without a
re-import.

### Past-dated accruals are dropped; `now` is injected

An import can be weeks old. `dividendService.getDividends(now = Date.now())` filters out
accruals whose `payDate` is before the current UTC day, so nothing that has already been
paid is presented as upcoming (it would also double-count against the cash history).
Accruals with no pay date are kept — IBKR sometimes declares before scheduling — and sort
last. `now` is a defaulted parameter purely so the cut-off is deterministic under test.

### Three empty states, not one

Because the accruals section is **optional on the Flex query** and the owner's existing
exports predate it, "nothing to show" is ambiguous. The payload therefore carries
`sectionPresent`, and the panel distinguishes:

1. **No accrual rows in the import at all** → tell the owner to enable *Open Dividend
   Accruals* on their Flex Query and re-import. Saying "no upcoming dividends" here would be
   a false negative.
2. **Section present, nothing pending** → "No announced dividends are pending as of `asOf`."
3. **Populated** → a table (pay date, ex-date, symbol, quantity, per-share rate, gross,
   withholding, net) under a summary line, with `asOf` always visible so a stale import is
   obvious.

The parser treats the section as optional and degrades to an empty list, so importing an
older export never fails.

### The chart states its own reading

The stacked form from Story #23 is kept — the owner chose refinement over a rewrite. What
changed is that it now says what it shows: series relabelled to "Net received" / "Withholding
tax", a caption above the chart explaining that the solid segment is what reached the account
and the full height is gross, and an optional `totalLabel` on `ColumnChart` so every segment's
tooltip also reports the column's gross total. The `aria-label` carries the same reading.

## Consequences

Benefits:

- Upcoming dividends are the owner's *actual* accruals — real quantity, real withholding,
  real net — not a per-share estimate multiplied by an assumed position.
- The Dividends view stays fully offline and stays on one IPC channel.
- Deriving withholding from `netAmount` is immune to IBKR's sign convention for `tax`/`fee`.

Tradeoffs:

- **The feature shows nothing until the owner enables a Flex Query section and re-imports.**
  This is the cost of the choice and is surfaced directly in the UI rather than hidden.
- Freshness is bounded by import cadence: an accrual announced after the last export is
  invisible. `asOf` makes that visible instead of implicit.
- Accruals from superseded statements are unreadable by design (latest-statement-only), so
  the table is not a history of what *was* announced.

Risks (resolved):

- **The `OpenDividendAccrual` attribute mapping is now verified against a real export.** It
  was originally written from IBKR's published field list, since the owner's exports predated
  the section. On 2026-07-24 the owner enabled *Open Dividend Accruals*, re-exported both
  statements and imported them in the running app; the upcoming panel rendered the accrual
  correctly (VBNK, pay date 2026-07-31, ≈€3.15 net). The real export confirmed the field
  names verbatim (`currency`, `fxRateToBase`, `exDate`, `payDate`, `quantity`, `grossRate`,
  `grossAmount`, `tax`, `fee`, `netAmount`) and that IBKR reports `tax` as a **positive
  magnitude** — the derive-from-`gross − net` choice agrees with it (4.24 − 3.6 = 0.64)
  rather than depending on that sign. The mapping is pinned to that export in
  `flexStatementParser.test.ts`. The defensive parsing still stands: `tax`/`fee`/`grossRate`
  optional, the four amount/rate fields required, so a future shape change degrades or
  surfaces a `ValidationError` at import (ADR-0005) rather than corrupting a total.

## Alternatives Considered

### Client Portal Gateway next-dividend fields, cached like sector classification

Would need no Flex reconfiguration, and DDR-0009 already established the gateway-plus-cache
pattern. Rejected: it yields a per-share estimate rather than the account's own accrual (no
withholding, no quantity), requires a live gateway at least once, and its field shapes could
not be verified with the gateway down.

### Read accruals across all statements rather than the latest

Would give a longer list and survive an old import. Rejected: accruals are an as-of balance,
so older rows are dividends that have since been paid — they would double-count against the
cash transactions and present settled income as upcoming.

### Forecast the next dividend from the payment history

No new data source at all. Rejected outright — the story's "Not Included" section excludes
forecasting dividends that have not been announced, and a projected dividend presented
alongside real ones is exactly the kind of implied advice the product avoids.

### Rewrite the chart as net-only bars with a separate gross marker

Considered for making "the bars are net" unmistakable. Rejected by the owner in favour of a
light refinement: the stacked form already carries both series, and labelling it cost far
less than reworking `ColumnChart` and its consumers.

## References

- GitHub Story #31, Epic #4 (M3)
- [[0005-analytics-read-model-and-base-currency-conversion]]
- [[0004-flex-import-persistence-and-dedupe]]
- [[0009-sector-classification-cache-and-allocation-donuts]]
- `docs/decisions/0005-flex-query-file-import.md`
- IBKR field reference: <https://www.ibkrguides.com/reportingreference/reportguide/open%20dividend%20accrualsfq.htm>
