# 0016. Shares held per dividend reconstructed from the trade history; per-share divided out of the amount

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

Story #74 (Epic #4, M3) asks the Dividends transactions table to show, on each row, the
number of shares held of the instrument and the dividend paid per share — "so that I can
understand the size and yield of each dividend at a glance". It requires that the per-share
figure reconcile with the row's amount and share count, and that a row whose share count is
unavailable degrade to a blank rather than a wrong number.

The table is built from Flex `CashTransaction` rows
([[0005-analytics-read-model-and-base-currency-conversion]]), and a cash transaction carries
no quantity. The real export confirms it — the fields are `currency`, `fxRateToBase`,
`symbol`, `conid`, `description`, `dateTime`, `settleDate`, `amount`, `type`, `exDate`. So
the share count has to come from somewhere else. Four candidates existed in the imported
data:

- **`OpenPositions`** — carries `position`, but only *as of the latest statement's report
  date*. A dividend paid eight months ago was paid on whatever was held then, not now.
- **`PriorPeriodPositions`** — a genuine per-instrument *daily* series, but it reports
  `price` and `priorMtmPnl`, not quantity.
- **The transaction description** — IBKR embeds the declared rate in it verbatim:
  `"SBI(GB00BG5NDX91) CASH DIVIDEND CAD 0.093999 PER SHARE (Ordinary Dividend)"`. Shares
  could be divided out of it.
- **`Trades`** — globally de-duped across the whole imported history
  ([[0004-flex-import-persistence-and-dedupe]]), each row dated and signed, already read by
  `flexReadRepository.getTrades()` for the realized-gains view.

## Decision

### Shares held are the running trade quantity as of the day before the ex-date

`dividendService` builds a resolver over `getTrades()`, grouping by conid (falling back to
ticker when Flex reports no conid, so a renamed ticker still matches), and sums the signed
quantities of the trades dated strictly **before** the start of the event's UTC day. The cut
is exclusive because dividend entitlement requires holding the share *before* the ex-date —
a purchase on the ex-date itself is too late. This matches the meaning IBKR gives its own
`OpenDividendAccrual.quantity` field, "shares held prior to the ex-date", so the realized and
upcoming halves of the view state the same quantity the same way.

The event's date is `exDate ?? dateTime`, unchanged from Story #23. When only the pay date is
known the cut is approximate by a settlement lag, which cannot mislead about the share count
in practice — trades that near a dividend are rare and the alternative is showing nothing.

Verified against the owner's real exports: SBI's trades across the 2025 and 2026 statements
sum to 3,147 shares, matching that statement's `OpenPosition position="3147"`, and the
2026-06-26 dividend of CAD 295.81 over those shares gives CAD 0.09400 per share — IBKR's own
declared rate of `CAD 0.093999 PER SHARE`, to the precision the rounded amount allows.

### Per share is divided out of the row's own amount, not parsed from the description

`perShareNative = amountNative / sharesHeld`. This satisfies the story's reconciliation
criterion *by construction*: the three numbers on the row can never disagree, because two of
them produce the third. Parsing the description would give the declared rate to more decimal
places, but it would be a fourth number that only approximately agrees with the amount beside
it — and it would tie a displayed figure to the wording of a free-text field IBKR does not
version.

The same division is applied to `Withholding Tax` rows, where it reads as tax withheld per
share and comes out negative, matching the signed amount already in the row.

### Both figures are shown in the payment's own currency

The transactions table already pairs a native **Amount** with an **In EUR** conversion of it.
Shares are currency-neutral; the per-share figure sits beside the native amount it was divided
out of, in that same currency, which is also the currency the Upcoming table already shows its
`grossRate` in and the currency the dividend was actually declared in. The row's
base-currency conversion stays where it was, in the final column — nothing about it changes,
and the two new columns introduce no second conversion path (which
[[0005-analytics-read-model-and-base-currency-conversion]] would place in the service anyway,
not the renderer).

`formatCurrency`'s fixed two decimals would round a real rate of CAD 0.093999 to "0.09" and a
per-share withholding to "0.00", so a `formatPerShare` helper keeps up to four decimals. The
Upcoming table's per-share cell adopts it too, fixing the same latent rounding there.

### Unaccountable rows show "—", never a number

`sharesHeld` is `null` — and `perShareNative` with it — in four cases, each of which means the
imported history cannot honestly answer the question:

1. the event has no date to cut the history at;
2. the instrument has no imported trades at all;
3. the instrument has a trade that cannot be placed in time (a `dateTime` of `null`);
4. the running quantity is zero or negative by the ex-date.

Case 4 is the important one. A dividend was paid, so a long position existed; a non-positive
reconstruction is proof that the imported statements begin after the position was opened (or
that it was transferred in rather than bought). Showing "0 shares" or an absurd per-share
figure there would be worse than showing nothing, which is exactly what the story's fourth
acceptance criterion guards against. A note under the table says where the numbers come from
and what a "—" means, so the gap reads as a known limit of the import rather than a bug.

## Consequences

Benefits:

- The share count and rate are the account's own history, not an estimate, and the row's
  three numbers always reconcile.
- No new IPC channel, no new table, no new repository method — the payload rides on the
  existing `analytics:getDividends` result and reuses `getTrades()`.
- The view stays fully offline, and `dividendService` stays a pure unit-test target.

Tradeoffs:

- Correctness is bounded by how far back the imported statements reach. Positions opened
  before the earliest import degrade to "—" rather than being wrong, but they do degrade.
- Positions acquired other than by trade — transfers in, corporate actions, stock dividends —
  are invisible to the reconstruction and will also show "—". Flex reports these in sections
  the app does not yet import (`TradeTransfers`, `CorporateActions`); folding them in is a
  natural follow-up if the owner hits it.
- The per-share figure inherits the rounding of the amount IBKR reports (two decimals), so it
  can differ from the declared rate in the fourth decimal.

## Alternatives Considered

### Parse the per-share rate out of the transaction description

The declared rate is right there in the description string, at full precision, and shares
could be divided out of it. Rejected: it depends on the wording of a free-text field (the
owner's own export already shows two shapes — one with `PER SHARE`, one without), and the
resulting share count would be a division of two rounded numbers, landing on 3,146.84 rather
than 3,147. Deriving *from* the trades and dividing *by* them gets both numbers right and
keeps them consistent with the rest of the app.

### Use `OpenPositions.position` from the latest statement

Free, exact, already imported. Rejected outright: it is an as-of balance, so every historical
dividend would be shown against today's share count — the same double-counting trap
[[0010-upcoming-dividends-from-flex-accruals]] avoids for accruals.

### Store a reconstructed daily position series at import time

Would make the lookup a table read and serve future features. Rejected as a speculative
abstraction: the reconstruction is a sum over a few hundred trades run once per view load,
and persisting derived data would add a mutable-ish table to a store that is otherwise
append-only history ([[0004-flex-import-persistence-and-dedupe]], ADR-0006).

### Show the per-share figure in the base currency

Would read consistently down the "In EUR" column. Rejected: the dividend was declared per
share in the instrument's own currency, that is the number on the announcement the owner
recognises, and it is what the Upcoming table already shows. Converting it would also break
the visual reconciliation with the native Amount it is divided out of.

## References

- GitHub Story #74, Epic #4 (M3); references #31, #32
- [[0005-analytics-read-model-and-base-currency-conversion]]
- [[0004-flex-import-persistence-and-dedupe]]
- [[0010-upcoming-dividends-from-flex-accruals]]
- `docs/decisions/0006-append-only-immutable-flex-and-snapshot-stores.md`
- `docs/flex-queries/portfolio-analyst-2025.xml`, `portfolio-analyst-2026.xml` — the exports
  the reconstruction was verified against
