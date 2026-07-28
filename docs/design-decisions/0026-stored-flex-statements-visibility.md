# 0026. The Flex store describes itself: stored statements and their coverage

- **Status:** Accepted
- **Date:** 2026-07-28

## Context

Until Story #108 the imported Flex store was invisible. `FlexImport` rendered a summary table
only in the `imported` phase of its own local state — the moment after an import — so on
launch the panel showed an intro paragraph and two buttons and nothing else. There was no IPC
channel that listed stored statements at all.

That left the app unable to answer its most basic data question: *what are my analytics
actually built from, and how current is it?* The four analytics views read imported Flex
history (DDR-0005), so every figure they show depends on which statements are held and what
periods they cover — and none of that was on screen. Bug #103 (unrealized P&L double-counted
across two overlapping statements, 25% overstated) was invisible for exactly this reason: the
owner could not see that two statements existed, let alone that they overlapped.

## Decision

Add one read-only channel, `flex:listStatements`, and render its result as a permanent
"Stored statements" card on the Portfolio tab.

**The read describes the store, not an import.** `flexReadRepository.getStatements()` returns
the `flex_statements` header rows — account, period, base currency, source filename, import
time — **newest first, ordered by period end date**. End date rather than id or start date so
the top row is the same statement the statement-scoped reads treat as "latest" (#103): ids
follow import order, so a back-filled older statement would sort to the top, and a statement
that starts earlier but ends later would do the same under a start-date sort. This is
deliberately *not* `FlexStatementImport`, which
describes an import's outcome (inserted vs. skipped rows, "already imported") and is only true
in the instant it is produced. The two shapes answer different questions and both are kept: the
import summary still reports what a given import did, the store list reports what is held.

**Coverage is a min/max computed in the service.** `flexStatementsService.listStatements()`
derives the span from the earliest `fromDate` and the latest `toDate` across all statements,
not from the first and last row — statements may overlap or be imported out of order, so the
repository's ordering is a display convenience this calculation must not lean on. `coverage`
is `null` for an empty store. Calculation lives in the service like every other derived
figure; the repository returns rows.

**No result variant.** An empty store is an empty list and a `null` coverage, rendered as a
first-class empty state in the renderer. There is no `needs_import` here: unlike the analytics
services, this channel's whole job is to report emptiness, so emptiness is not a degraded
outcome. That matches `snapshot:list`, which also returns a plain list.

**A separate service from `flexImportService`.** The `flex_*` tables are fronted by a
write-only `flexRepository` and a read-only `flexReadRepository` (DDR-0004); the services
mirror that split. `flexImportService` writes (import, whole-store clear); `flexStatementsService`
reads and never touches IBKR or the write path.

**Shown, not judged.** The card states the coverage span and lists each statement's own period;
it does not warn about gaps or flag overlaps. A gap between two periods and a newest statement
that ended months ago are both apparent from the dates themselves. Detecting and labelling
overlap is a correctness concern that belongs with the aggregation rules (Bug #103,
`fromLatestStatement`), not with a panel that reports what is stored.

**The store stays append-only.** This story adds no delete-by-id and no per-statement removal;
the whole-store reset remains the only sanctioned deletion (ADR-0006). Both write paths —
import and clear — re-read the store afterwards rather than patching the list from their own
result, so the panel cannot drift from what is actually held.

## Consequences

Benefits:

* The question the app could not answer on launch — what history do I have, and how stale is
  it — is answered without an import, a file dialog, or a database tool.
* A class of bug that hid behind the invisible store (#103) becomes visible: two statements
  covering overlapping periods are now shown as two rows with their dates.
* The read/write split of the `flex_*` tables now holds all the way up through the services,
  so the read path stays free of anything that can mutate the store.

Costs and limits:

* A second table on the Portfolio tab, next to the transient import summary. They can be on
  screen together after an import; that is accepted, because they say different things ("what
  just happened" vs. "what you have").
* Coverage is a span, not a completeness claim. It says nothing about missing days inside the
  range, and it deliberately does not warn about overlap.
* The list loads on mount and after a write, and nothing else invalidates it. Keeping loaded
  data alive across tab switches with an explicit refresh is Story #109.

## References

- Story #108; Epic #99 — Analytics views polish
- ADR-0005 — Flex file import as an offline data source
- ADR-0006 — whole-store reset as the one immutability exception
- DDR-0004 — Flex persistence model and two-tier de-dupe
- DDR-0005 — analytics read model and base-currency conversion
- Bug #103 — unrealized P&L double-counted across statements
