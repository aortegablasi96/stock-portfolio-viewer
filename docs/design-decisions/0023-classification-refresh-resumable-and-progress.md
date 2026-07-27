# 0023. A classification refresh is resumable, and reports its progress

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

`classificationService.refreshClassifications()` fetches sector data one instrument at a time
(sequentially, on purpose — DDR-0009), accumulating rows and calling
`classificationRepository.upsertMany()` **only after the loop finished**. Any failure on the way
— a closed gateway, a stall, an unexpected 500 — skipped that call entirely, so a run that died
on instrument 30 of 40 threw away all 29 successful lookups. The next attempt started from zero
and hit the same wall in the same place.

The run was also silent. `instrument_classifications` is a *cache*, so the correctness cost was
only wasted round trips — but wasted round trips are the whole cost of this operation, and the
owner saw nothing but "Classifying…" for however long N sequential HTTP calls take, with no way
to tell a slow refresh from a hung one.

Bounding each request (DDR-0022) fixed the hang but sharpened this: a stall now ends the loop
promptly and *deliberately*, which makes discarding the work up to that point the more obviously
wrong half of the behaviour.

## Decision

**A refresh persists what it fetched, whatever happens next.** The fetch loop's failure is
captured rather than propagated; `upsertMany` then runs on both paths — completed and
interrupted — and only afterwards is the outcome mapped to a result variant. A partial run
therefore leaves the cache strictly better off, and because the next refresh derives its work
list by diffing the latest statement's positions against the cache, it asks only for what is
still missing. Resuming needs no new state: the cache *is* the progress record.

Persistence is one write at the end of the run, not one per lookup. The failure being defended
against is a gateway that stops answering, and that path now writes; a process that dies mid-run
is a different (and unaddressed) failure, not worth N transactions to cover.

**Every failure variant carries how far the run got.** `not_connected`, `not_responding` and
`error` each gain a `partial: { fetched, classified, remaining }`. Reporting only the error would
tell the owner the run failed while hiding that most of it succeeded — and `remaining` is what
makes "try again" a proposition rather than a shrug. A closed gateway fails before the first
lookup, so its `partial` is legitimately all zeros; the renderer says nothing extra in that case
rather than announcing that nothing happened.

**Progress is a main→renderer event, not part of the invoke response.** `analytics:classifyProgress`
carries `{ completed, total }` after each lookup, plus one leading `{ completed: 0, total }` so
the renderer can show a total before the first result returns. The service takes an optional
`onProgress` callback — it must not import Electron, so *sending* the tick is the IPC handler's
job, in the same shape as `snapshot:captured` (DDR-0011). The callback is a courtesy: a listener
that throws is swallowed, because a refresh must not fail over its own telemetry.

`total` counts the *uncached* instruments this run will fetch, not every position — it is a
measure of work remaining, and counting positions already in the cache would show a bar that
starts partly done and finishes instantly.

Lookups stay strictly sequential (DDR-0009). Parallelism would make progress arrive faster and is
still the wrong trade against a single local gateway session.

## Consequences

Benefits:

- Interrupted refreshes converge: repeated attempts against a flaky gateway each advance,
  instead of each starting over.
- The owner sees movement and a total, so a slow refresh is distinguishable from a stuck one.
- A failure message now names what was salvaged, which is usually most of the run.
- No new persistence, table, or resume token — the existing cache carries the state.

Tradeoffs:

- Three result variants grew a field, which every consumer of a failure branch must now account
  for. It is required rather than optional so a new consumer cannot quietly ignore it.
- Progress arrives per completed lookup, so a single slow instrument still looks like a stall for
  as long as it takes. Its bound is DDR-0022's, and the count makes it obvious *where* it stopped.

Risks:

- A crash between the last lookup and the write still loses the run. Accepted: the cache is
  derived reference data and rebuilding it costs only time.

## Alternatives Considered

### Write each row as its lookup returns

Rejected for now: it survives a process crash too, but pays a write per instrument to cover a
failure mode that is not the one being reported. The single end-of-run write covers every failure
the operation actually surfaces.

### Report progress in the invoke response instead of an event

Not possible in the shape that matters — the response arrives when the run is over, which is
exactly when progress stops being useful. An event is the only way to say anything *during* it.

### Have the service send the progress event itself

Rejected: services may not import `electron` (ESLint-enforced, ADR-0002/0003), and the callback
keeps the service unit-testable — the progress sequence is asserted directly with a plain spy.

### Track progress as a separate persisted "refresh run" record

Rejected as speculative: it would duplicate what the cache already implies, and nothing in the
app needs the history of past refresh attempts.

### Cache-bust and re-fetch everything on each refresh

Rejected: it makes resumption meaningless and re-asks for instruments the gateway already
answered — including the ones it answered "no sector" for, which DDR-0009 caches as `sector: ''`
precisely so they are asked about once.

## References

- GitHub Issue #105 (Epic #102 — Gateway & data reliability)
- [[0009-sector-classification-cache-and-allocation-donuts]] — the cache, and sequential lookups
- [[0022-gateway-timeout-and-not-responding-state]] — the bound that ends the loop
- [[0002-connection-state-as-ipc-result]] — the result-variant pattern the `partial` field extends
- [[0011-custom-frameless-window-shell]] — the main→renderer event shape reused here
- `src/services/classification/classificationService.ts`, `src/shared/domain/classification.ts`
