# 0050. Daily NAV comes from IBKR's equity summary, and composition is 100%-stacked

- **Status:** Accepted (supersedes the reconstruction in [[0008-daily-portfolio-value-reconstruction]]; extends [[0005-analytics-read-model-and-base-currency-conversion]], [[0015-allocation-cash-as-asset-class]], [[0018-content-measure-and-chart-aspect]])
- **Date:** 2026-08-12
- **Story:** #171, under Epic #99

## Context

Story #171 asked for a chart showing how the portfolio's composition — stocks, options, cash —
shifted across a range, and opened by declaring itself unbuildable: `flex_prior_period_positions`
is daily but carries no quantity, `flex_open_positions` carries quantity but is one snapshot per
statement, and [[0015-allocation-cash-as-asset-class]] establishes that cash is the NAV
residual while `ChangeInNAV` is per statement. The story proposed three routes and reserved the
choice for the owner, the largest of them requiring a reconfigured Flex Query and a re-export.

**The premise was wrong, in the owner's favour.** `EquitySummaryInBase` is section 13 of the
repo's own field reference (`docs/flex-queries/`), it is *already selected* on the owner's Flex
Query, and both committed sample exports carry it — 196 daily rows in the 2025 file, 160 in the
2026 one. Each row is one report date's NAV split into cash, stock, dividend accruals, interest
accruals and broker-fee accruals, **already in base currency**, with IBKR's own grand total. It was
parsed by nothing and stored nowhere. Route 1 therefore needed no owner action at all, and routes 2
(reconstructing quantities from trades) and 3 (one point per statement) were moot.

This is the second time in three stories that a Flex question was settled by reading
`docs/flex-queries/` rather than reasoning about it — [[0049-daily-return-bars-thin-rather-than-aggregate]]
records the first. The directory is ground truth; the standing instruction to check it before
assuming an XML shape now has a corollary: check it before declaring something *absent*, too.

## Decision

### The value curve is the broker's series, not a reconstruction

[[0008-daily-portfolio-value-reconstruction]] built the day-by-day curve by cumulating daily
mark-to-market and dated contributions from each period's `startingValue`, then spreading the
unexplained residual linearly in time so both endpoints landed exactly. That was the best available
answer when no daily NAV existed. One does exist, so the curve is now simply `total` per report
date, and there is nothing left to model.

**The swap is endpoint-preserving, which is why it moves no headline figure.** The last daily total
equals `ChangeInNAV.endingValue` to the last decimal place — verified on the real export at
`38510.982350092` — and the series opens the day before the statement period at `startingValue`.
`flexStatementParser.test.ts` pins both identities against the real files rather than a fixture, so
a future export that broke them would fail rather than silently shift the Portfolio value tile.

The reconstruction is **kept as the fallback**, not deleted: a statement imported before this story,
or exported without the section, still draws a curve. `buildDailyValueSeries` prefers the daily rows
and falls through to `buildValueSeries` when there are none.

`returnSeries` is deliberately **untouched**. It is chain-linked from IBKR's per-period TWR and the
daily MTM shape and never reads a value difference, so the daily-return bars built on it
([[0049-daily-return-bars-thin-rather-than-aggregate]]) are unaffected by this change.

### The composition chart is 100%-stacked, not absolute

Composition is a question about proportions — *did the portfolio change shape?* — so the y axis is
share of NAV. An absolute stacked area whose top edge is NAV was the alternative and was rejected
for a second reason beyond the first: it would sit next to the value curve in Story #172's grid
saying the same thing twice, and any divergence between them would read as a contradiction rather
than as two views of one series.

### Negative bands hang below the baseline; they are neither clamped nor normalised away

Cash goes negative on margin, and when it does stock exceeds 100% of NAV. Normalising by `Σ|value|`
would put the stack back inside 0–100% by drawing a borrowed position as an asset — hiding exactly
the shape the chart exists to reveal. So positive shares stack up from zero, negative shares stack
down, and the domain widens to fit. The domain is anchored to always include 0 and 1, so two
windows at the same proportions are drawn at the same scale.

A zero-NAV day yields all-zero shares rather than `NaN`. This is not hypothetical: the owner's 2025
export opens the day before the account was funded, at `total="0"`.

### `other` is a residual, and it is surfaced rather than redistributed

The bands are stock, options, cash and accruals, plus `other` = `total − Σ components`. The Flex
query selects NAV categories per asset class held, so an owner who starts holding bonds gets a
figure inside IBKR's `total` that this parser does not read. Spreading that gap across the bands
that *are* read would misstate every one of them.

This is [[0015-allocation-cash-as-asset-class]] applied a second time, and for the same reason:
deriving a slice from the parts rather than from the whole shipped broken once already. The
threshold for "material" is relative to the day's own NAV, not an absolute epsilon, so it means the
same thing on a €400 account and a €400k one — and float residue on real IBKR figures does not
invent a band.

### The three accrual components are one band

Dividend, interest and broker-fee accruals are part of NAV and cannot be dropped without breaking
the sum, but on this account they total ~0.13% of it. Three hairline bands would cost three legend
entries to say nothing. Folding them into Cash was the alternative and was rejected: an accrued
dividend is not cash, and the Dividends view already treats it as its own thing (Story #31).

### A band is emitted only when it is non-zero somewhere

An account that has never held options gets no options band, rather than a flat zero one with a
legend entry no reader can account for. **The owner's Flex query does not select `options` at all**
— the field reference marks it ❌, "asset classes not held" — so the parser defaults every missing
category to 0 rather than erroring. Checking that box later is the only step needed for an options
band to appear.

### All eight palette slots; asset class is not sector

`SECTOR_SLOT_OFFSET` reserves slot 1 for the Allocation map's weight donut and applies to *sectors*
only ([[0030-allocation-map-country-donut-pairs]]). Asset class is a different dimension, so this
chart calls `sliceColorClasses` at no offset. `other` is mapped onto `OTHER_KEY` so it takes the
neutral gray the donuts give their aggregated tail — a hue means a named category.

### No separator stroke between bands

`.pie-slice` carries a 2px surface-coloured stroke so adjacent slices never rely on hue alone.
`.stack-band` deliberately does not. A donut's slices meet at radial edges and need delimiting; a
stacked band is delimited by the colour change itself and carries three other identity channels —
its position in the stack, its legend entry, and a hover readout that names it and states its
share. And a stroke thick enough to see is thicker than a 0.1% band: on this portfolio, which runs
~99.9% stocks, a 1px stroke painted the card colour straight over the cash and accrual slivers it
was supposed to separate, so they read as dark specks rather than as their own hue. Caught on
screen, not in a test — no assertion here would have failed.

### The maths is a pure module; the aspect ratio matches `LineChart`

Every proportion, the signed stack, the domain and the ribbon paths live in `lib/composition.ts`,
unit-tested under Node — the split [[0018-content-measure-and-chart-aspect]] and this repo's testing
rule both require, since Vitest has no DOM. The `viewBox` is 1080×240, matched to `LineChart`
deliberately: the four charts share a card and a `RangeFilter` today, so nothing should jump when
the selection changes.

### The window is sliced, never carried forward

`sliceComposition` filters to the days the window really contains. `sliceSeries`' carry-forward
anchoring is right for a scalar — the portfolio had *some* value on any given day — but a
composition point is a simultaneous observation of every band, and a synthetic one would draw a
portfolio shape on a date it was never measured. The series is daily, so the real first point is at
most a day from the edge.

## Consequences

- `flex_equity_summaries` is the first `flex_*` table that is **statement-scoped *and* daily**. Two
  overlapping statements each carry a row for the same calendar day, so a read across the whole
  history returns duplicates. `latestPerDay` keeps the row from the statement that ends latest.
  This is the daily analogue of Bug #103, but the failure mode is worse: duplicated days do not
  double a total, they put two points on one date, so the curve doubles back on itself. Hence a
  plain index on `report_date` rather than a unique one — uniqueness would reject a legitimate
  overlapping import.
- It is also the only monetary `flex_*` table with **no `fx_rate_to_base` column**. IBKR reports
  this section in base currency, so [[0005-analytics-read-model-and-base-currency-conversion]]'s "convert in the service" rule
  applies but has no work to do.
- `total` falls back to the sum of components when absent, rather than being required. Deselecting
  one field must not fail an import that four other views depend on.
- The chart is added as a fourth `ToggleGroup` option. Retiring that switcher for a 2×2 grid is
  Story #172's scope, and this record's fixed aspect ratio is what that story will have to revisit.
- **Already-imported statements carry no equity summaries, and re-importing the same file will
  not add them.** Statement de-dupe is on `(accountId, fromDate, toDate, whenGenerated)`, so a
  re-import of an identical export is skipped whole and never reaches the new table. The owner
  must use the sanctioned full reset (`flex:clear`, ADR-0006) and import again — which is
  precisely the case that reset exists for, so no partial-backfill path is added. Until then the
  value curve falls back to the reconstruction and the composition chart shows its empty state
  naming the section to enable; nothing errors.
- Un-skipping `flexStatementParser.test.ts`'s real-export block (see below) found its row counts
  stale by nine trades and one dividend accrual. They are now invariants rather than inventory.

## Alternatives Considered

- **Reconstructing daily quantities from `flex_open_positions` + `flex_trades`** (the story's route
  2). Rejected: it re-derives what the broker already reports, and drift from corporate actions,
  transfers or option assignment would surface as a wrong chart with no error. `OptionEAE` and
  `CorporateActions` exist precisely because those events are not rare.
- **One point per imported statement** (route 3). Rejected: with two yearly statements that is a
  two-point "series".
- **An absolute stacked area, or a toggle between absolute and percentage.** Rejected above; a
  switcher inside the card also cuts against Story #172, which exists to remove one.
- **Requiring `total`.** Rejected: a `ValidationError` naming a field the owner had every right to
  omit would block the whole import.
- **Swapping `valueSeries` in a separate story.** Offered to the owner, who chose to do it here on
  2026-08-12 — the two charts share the series, and shipping composition against authoritative NAV
  while the curve beside it stayed reconstructed would have put two disagreeing answers in one card.

## Note on a test that was not running

`flexStatementParser.test.ts` and `performanceService.test.ts` both guard their real-export blocks
with `skipIf(!hasRealExports)`, resolving `portfolio-analyst-<year>.xml`. The owner's files were
named `portfolio-analyst - <year>.xml` — IBKR's export-dialog spelling — so both blocks had been
skipping silently, and a skipped test reads exactly like a passing one in a green run. The files are
renamed to the canonical form and the lookup now accepts both spellings, which is what stops it
recurring on the next re-export. The stale assertions this uncovered were replaced with invariants
(cross-section identities, ordering, sign) rather than refreshed row counts, since a count against a
gitignored file that is periodically regenerated only ever asserts that it has not been regenerated.
