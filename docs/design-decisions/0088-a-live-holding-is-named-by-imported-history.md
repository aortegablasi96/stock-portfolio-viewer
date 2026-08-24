# 0088. A live holding is named by imported history

- **Status:** Accepted
- **Date:** 2026-08-24
- **Amends:** [[0087-the-holdings-table-says-what-a-position-made]]

## Context

Story #263 routed the holdings table's second column through `instrumentName` and kept its header
as **Description**, on the reasoning that *Company* would assert something the data did not
support. Both halves of that were right about the data and wrong about the column, and the owner
said so on sight: the second column should be **Company**, and it should carry the name the rest
of the app already shows.

The finding behind #263 stands. Gateway build 10.46.2d sends **no `ticker` field**, so
`portfolioRepository`'s `symbol: ticker ?? contractDesc` and `description: contractDesc ?? ticker`
resolve to the same string and every row read `IBKR · IBKR`. `instrumentName` correctly reports
that as no name at all, so the column emptied to eight em dashes.

What #263 did not weigh is that **the app already knows these names.** The Allocation view names
the same instruments — `Serabi Gold`, `Interactive Brokers` — because it draws Flex data, and
`flex_securities` carries a real `SecurityInfo` description per instrument. The two views were
disagreeing about the same holding on the same screen, which is the exact defect
[[0066-one-instrument-name-across-the-views]] closed for the analytics views, reappearing at the
one table that reads the gateway instead of the import.

Checked against the real store before deciding, not after: all **eight** live positions resolve
from `flex_securities` by conid.

```text
43645865  -> INTERACTIVE BROKERS GRO-CL A     328452921 -> NUEVA EXPRESION TEXTIL SA
45090384  -> MONUMENT MINING LTD              648434877 -> SEZZLE INC
512459263 -> JUROKU FINANCIAL GROUP INC       514478839 -> VERSABANK
389383088 -> NEWPRINCES SPA                   322447809 -> SERABI GOLD PLC
```

That coverage is not luck. **A position exists because it was bought**, and a Flex statement that
covers the purchase carries the instrument — so the join succeeds for everything except a position
acquired since the last import.

## Decision

### The name is joined locally, not fetched

`portfolioService` builds an index from `flexReadRepository.getInstrumentNames()` and stamps
`companyName` onto each holding. #263 ruled out *fetching* names, and that ruling stands untouched:
this adds **no gateway request**, no endpoint and no per-item loop, so
[[0022-gateway-timeout-and-not-responding-state]] and
[[0024-gateway-read-coalescing-and-freshness-window]] are unaffected. It is one local `SELECT
DISTINCT` over 17 rows.

**By conid, falling back to symbol** — the same resolver `dividendService` has used since Story #23,
and the fallback order matters. `NWL` and `NWLm` are one instrument on two listings and the live
position is held under a third symbol; only the identifier gets that row its name. A symbol-first
join would have named it from whatever row happened to be first.

It goes in the **service**, where the app's other cross-source composition lives, rather than in
`portfolioRepository`. The repository states what its source knows — `companyName: null`, because
the gateway has no name to give — and the service resolves one. That keeps `portfolioRepository`
single-source, and it is why the domain type carries both fields rather than the repository
overwriting `description` with a nicer string: **the gateway's answer is preserved**, and the view
falls back to it wherever history is silent.

This does cost the portfolio domain its "**live IBKR read, no SQLite**" property, which CLAUDE.md
recorded as a fact about the app. The property was never the point — layering was. Reading local
reference data through the repository that owns it breaks no boundary, and the alternative was a
column that stayed empty while the same name sat in the same database two views away.

### The header can now say Company

Which is the whole reversal. #263's reasoning was sound *given* that the only candidate string was
the gateway's echo of the ticker; with a real `SecurityInfo` name in hand, **Company** is a claim
the data supports. `Description` would now be the inaccurate header — what the column shows is not
a description of anything.

### The renderer still shortens, exactly once

`holdingName(symbol, description, companyName)` prefers the imported name and hands the winner to
`instrumentName`. Two consequences worth stating:

- **The service carries the raw exported string**, never a shortened one. Shortening happens at the
  point of drawing, in the one function every view goes through — a pre-shortened `companyName`
  would be a second naming path, which is the thing DDR-0066 exists to prevent.
- **The rule still applies to the winner.** An imported name that merely repeats the symbol — a
  bare `CAD` row in the FIFO summary's shape — resolves to `null` just as the gateway's echo did.
  Preferring the Flex string is a change of *source*, not an exemption from the predicate
  ([[0067-shortening-a-name-to-a-name]]).

The gateway's description remains the fallback rather than the other way round, so a build that
does send real names keeps working, and a snapshot-sourced holding — which has a stored
`description` and no `companyName` — is named from what was captured.

### A snapshot stores no name

`rowToHolding` returns `null`, and a test asserts `toHoldingValues` never persists the field. The
name is *reference* data resolved at read time; freezing one into an immutable capture would pin a
holding to whatever that day's import happened to know. The same reasoning as DDR-0087's refusal to
persist a derived P&L, applied to a different kind of derived value — and the snapshot keeps the
gateway's own `description` unchanged, so nothing is lost.

## Consequences

- The Portfolio view names a holding the way Allocation does, from one source, through one
  shortening function. The disagreement between two views about one instrument is gone.
- **The join fails softly and visibly.** A position bought since the last Flex import — and every
  position when nothing is imported at all — falls back to the gateway's description, which on this
  build is the ticker, which `instrumentName` reports as no name. The cell shows an em dash in
  `.data-table-dim` and sorts last in both directions
  ([[0039-data-table-primitive-and-column-sorting]]). It never fails the view.
- **`portfolio` is no longer SQLite-free**, and CLAUDE.md now says so. A second local read into that
  domain should ask whether the service is still composing or has become a repository.
- The name is **not** re-resolved on a snapshot read, so the history section shows what was
  captured. If a snapshot-era name ever needs to look current, that is the same back-fill story
  DDR-0087 deferred, and it should be decided once for both fields.
- Covered by unit tests at both ends — eight in `portfolioService.test.ts` for the join (conid over
  symbol, missing conid, un-imported instrument, empty description, the converted branch,
  unshortened carry-through) and five in `format.test.ts` for the cell rule. What no test can see
  is the rendered header; that was checked in the running app.

(extends [[0087-the-holdings-table-says-what-a-position-made]],
[[0066-one-instrument-name-across-the-views]], [[0067-shortening-a-name-to-a-name]],
[[0039-data-table-primitive-and-column-sorting]], [[0007-portfolio-display-currency-and-live-fx]])
