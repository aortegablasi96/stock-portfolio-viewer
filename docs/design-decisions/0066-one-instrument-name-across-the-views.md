# 0066. One instrument name, decided against the symbol rather than the asset category

- **Status:** Accepted
- **Date:** 2026-08-19

## Context

Three views draw a ticker with a secondary line under it — the instrument's `description` as IBKR
exported it. Seven cells, one CSS class, and two different treatments:

| Call site | Before |
| --- | --- |
| `DividendsView` ×3 | `formatCompanyName(description)` → `Serabi Gold` |
| `TradeHistoryView` ×3 | raw → `SERABI GOLD PLC` |
| `AllocationView` ×1 | raw → `SERABI GOLD PLC` |

`formatCompanyName` had existed since the dividend tables were built, and its own docstring
scoped it to them. Nothing failed; the same holding simply read two ways depending on which view
was open. Story #193 found it while restyling the Trades highlight cards and left it alone,
because the obvious fix — call the function in four more places — ships a worse bug than the one
it cures.

**`formatCompanyName` assumes its input is a company name.** It title-cases, and title-casing a
string that is not a name destroys it.

## Decision

### The test is whether the description says anything the symbol does not

```ts
export function instrumentName(symbol: string, description: string): string | null {
  const name = description.trim()
  if (name === '') return null
  if (name.toUpperCase() === symbol.trim().toUpperCase()) return null
  return formatCompanyName(name)
}
```

The alternative that suggested itself — and that Story #211 was filed proposing — was a **shape**
test for a currency pair, `/^[A-Z]{3}\.[A-Z]{3}$/`. It would have shipped broken. Querying the
owner's actual imported statements rather than reasoning from the trade history found **two**
non-company shapes, in two different tables, both already on screen:

```text
flex_trades          CASH   symbol "EUR.CHF"  description "EUR.CHF"    a currency pair
flex_fifo_summaries  CASH   symbol "CAD"      description "CAD"        a bare currency code
flex_securities      STK    symbol "SBI"      description "SERABI GOLD PLC"
```

A regex for `XXX.YYY` catches the trade history and renders every row of the realized-gains
rollup as `Cad`, `Usd`, `Chf`, `Gbp` — and those four are not hypothetical rows: they carry
realized P&L (−€30.88, −€22.51, −€21.76, −€7.05), so they are in the *Realized gains by Ticker*
table today and are candidates for the `Worst` highlight card.

What unites both shapes is not their form but their origin: **IBKR writes the identifier again
when an instrument has no name of its own.** That is a property of the row, and the row is what
the caller already has.

### Not the asset category

`assetCategory` would answer the same question for two of the seven call sites, and this decision
declines it for the reason Story #192 declined a list of Flex type strings (DDR-0064): a category
is a vocabulary that grows, and a branch on today's members is right today and silent when a bond,
an option or a future arrives. It also simply does not work here — `RealizedBySymbol`, which feeds
the realized-gains table *and* both highlight cards, carries no `assetCategory` at all, so two of
the four broken cells could not have asked.

### `null`, and the caller renders nothing

Returning the raw string would leave the FX rows as they were: `EUR.CHF` on one line and
`EUR.CHF` directly under it, in a dimmer ink. That is not a quieter name — it is the same text
twice, and on the trade history, where FX conversions are the bulk of the rows (DDR-0017), it read
as a rendering fault rather than as data.

So `instrumentName` returns `null` and `InstrumentName` renders `<></>`. The rows lose a line and
the table fits five where it fitted four. Row heights now vary within the trade history — a row
with a name is taller than one without — which is the honest consequence: the height reports
whether there is a second line, and there is.

### One component, so "identical on every view" is structural

`components/analytics/InstrumentName.tsx` is four lines and holds no logic, because Vitest runs
Node-only (DDR-0029). What it holds is the *only* remaining reference to `.flex-import-file`
inside `components/analytics/`, which is what `instrumentNameUsage.test.ts` asserts — scanning the
**directory** rather than a list of three files, so a fourth view added later cannot quietly
reintroduce the split. It also subsumes the `{x.description && …}` guard three call sites already
carried and four did not.

`.flex-import-file` outside that directory is untouched: `DataSources.tsx` uses it for what it was
named after, an imported statement's filename, which is not an instrument and has no symbol to
repeat.

## Consequences

- The same holding reads the same way on Dividends, Trades and Allocation: `SBI` → `Serabi Gold`
  on all three, verified in the running app against a real import.
- A view that wants this line calls `InstrumentName`. Calling `formatCompanyName` from a view is
  now a test failure, which is the only way this stays true — the previous state was not a bug in
  a function but four call sites that did not call it.
- **The formatter's audience widened from dividend payers to every instrument the owner has ever
  traded or held**, and its suffix list is a judgement call that had only been exercised against
  the former. Two cases are now visible and deliberately unchanged, because changing either
  changes what Dividends has shown for milestones: `SPA` is stripped, right for the Italian
  *S.p.A.* (`FILA SPA` → `Fila`) and wrong for a name genuinely ending in "Spa"; and `GROUP` is
  stripped before a legal form, so `JUROKU FINANCIAL GROUP INC` → `Juroku Financial` rather than
  `Juroku Financial Group`. Either is a formatting story with its own acceptance criteria.
- The evidence for this decision came from querying the owner's real database, not from reading
  the parser. `better-sqlite3` is built for Electron's ABI and cannot load in plain Node
  (CLAUDE.md), but Node's own `node:sqlite` reads the file fine — which is the cheap way to check
  what a Flex export actually contains before designing against a guess.

## References

- Story #211 — One instrument name across Dividends, Trades and Allocation
- Story #193 — where the split was found and deliberately deferred
- [[0064-toned-badges-and-the-income-key]] — polarity from the row, not from a list of type strings
- [[0017-analytics-table-time-range-filter]] — why FX rows dominate the trade history
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — Vitest is Node-only, so the decision lives in `lib/`
- [[0042-token-adoption-ratchet]] — a text-scanning guard must strip comments first
