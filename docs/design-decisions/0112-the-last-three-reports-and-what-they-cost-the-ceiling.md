# 0112. The last three reports, and what they cost the ceiling

- **Status:** Accepted
- **Date:** 2026-09-01
- **Extends:** [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]],
  [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]],
  [[0111-the-model-asks-and-the-app-answers-in-computed-reports]],
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0102-the-assistant-has-no-period-control]]

## Context

Story #329 is the last of Epic #322: dividend income, realised gains and data coverage — three
reports that have been services since M3, on IPC, drawn on two dashboards, and reachable by the
model nowhere. [[0111-the-model-asks-and-the-app-answers-in-computed-reports]] already settled their
contract: which method backs each, which arguments they take, and that coverage gains a small service
because a tool may not span two methods. Building them needed no new record.

**Two things arrived that the contract did not settle**, and one of them was recorded in advance as a
decision waiting for the owner.

**The ceiling.** `promptBudget.test.ts` measures the *conversation*, and its exhaustive case — every
report the app has, in one round, over a fixture larger than any real portfolio — stood at 98.7% of
`MAX_PROMPT_CHARS` with nine tools. The test said so in as many words, and named the two ways out:

> That leaves about 500 characters, and #329's three reports do not fit in them. The number is
> recorded here rather than absorbed, because what it costs is a decision and not an edit: either
> `MAX_PROMPT_CHARS` moves — a constant DDR-0096 made hard to raise on purpose, so a record change
> and never an inline one — or this fixture stops asserting that a model may call *every* report in a
> single round.

Measured with the three built, at every cap:

| | characters | of 40,000 |
| --- | --- | --- |
| First round (system prompt, absences, question) | 6,379 | 16.0% |
| First round + the largest single report | 16,568 | 41.4% |
| First round + the six largest reports | 37,082 | **92.7%** |
| All twelve reports in one round | 47,775 | **119.4%** |

**The middle row is what changed the answer.** The exhaustive row is a shape no question takes, and
the round bound and `incomplete` already ration it. But six reports on one conversation is a shape a
genuinely multi-part question does take — *how did I do, what do I hold, what does it pay me, am I
balanced* — and at 92.7% a seventh ends the question as `incomplete`: answered by nothing, after
every round was paid for. The ceiling had stopped rationing runaway growth and started rationing a
question, which is precisely the failure [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]]
raised it for the first time to avoid.

**The period vocabulary.** `get_dividend_income` takes an enumerated period key like the four
performance tools, and reaches **one** service method — the dividend service, which knows nothing
about the value series. So its windows cannot be the performance report's, and the alternative to
sharing the *naming* was a second list of window names, with `year:2025` meaning one shape of
question in a return and another in an income figure.

## Decision

### 1. `MAX_PROMPT_CHARS` is 60,000, and what it is for has not moved

Raised by the owner, 40,000 → 60,000, on the table above. At 60,000 the exhaustive round is 79.6% and
every existing assertion in `promptBudget.test.ts` survives, including the one that it fits **however
the reports are spread over the rounds**.

Everything else about the constant stands unchanged, and the reasons are DDR-0096's own:

- **Still a constant, not an environment variable.** *A value someone can raise in `.env` is one a
  stalled afternoon will raise.* Changing it means editing `aiGateway.ts`, which means reading the
  paragraph that explains it.
- **Still characters, not tokens.** A tokenizer is a dependency taken to price a request exactly, and
  the job here is to stop runaway growth. ~60k characters is roughly 15k tokens — two orders of
  magnitude below the model's own context window.
- **Still counted over the whole message array, before every round** (DDR-0111). Crossing it before
  the first round is `too_large` and nothing was sent; crossing it later is `incomplete`.
- **Still what rations a bug** — a loop, a thousand-position book — **and never the grounding.**

**DDR-0103's 85% gate is untouched and still binds the first round plus the largest single report**,
which is 41.4% of the old ceiling and 27.6% of the new one. The gate is what a real question costs;
the exhaustive figure is a bound, not a budget.

### 2. Income windows are cut from the dividend history's own extent, and every report says which

`@shared/domain/standardPeriods.ts` splits: `standardWindows(extent)` names and bounds the windows,
`standardPeriods(report)` measures a return and a value over each. `dividendPeriods.ts` cuts the same
windows out of the **first and last dated dividend event** and sums the two series inside one.

So the **keys are shared and the spans are not**, deliberately. A model that has just read
`get_performance_periods` will reuse a key, and it must: one vocabulary is what makes that safe. What
each report then carries is the span its own windows were cut from, because an account whose last
dividend landed in March and whose statements run to June has a `trailing:1y` that ends in March —
and a report that did not say so would answer about a window nobody asked for.

**A key that exists in one set and not the other is a named state with the alternatives**, listing
the periods the dividend history really holds ([[0102-the-assistant-has-no-period-control]]). It is
never the adjacent row.

**An undated cash event is inside no window at all**, `all` included, since `all` is cut from the
extent like every other. It is counted and stated rather than folded in somewhere: a total that
quietly absorbed it would be wrong, and one that silently omits it is only incomplete if nobody says
so.

### 3. Coverage declares a category of its own, and holds no state

**A sixth `DISCLOSURE_CATEGORIES` entry — `coverage`, at `names`.** What `get_data_coverage` sends —
statement counts, the span they cover, when the last import ran, base currency, snapshot counts — is
named by no existing entry, and that list is *"the only keys an assistant context may carry"*
(DDR-0098). Squeezing it under `holdings` would have been the cheap move and the dishonest one: the
declaration would then describe something the app does not send and omit something it does. Declaring
one is the mechanism working, not a hole in it.

**No `needs_import`, and it is the only report in the app without one.** Nothing imported is not a
failure to report coverage — it *is* the coverage. Everywhere else in this codebase an empty report
standing in for a state is the failure (DDR-0022); here a state standing in for a report would be
that same failure inverted.

**It asks the snapshot history for no conversion**, so it opens no socket. Coverage carries no money
at all, so it needs no rate — and the consequence is the one that matters: *how current is my data*
stays answerable with the IBKR gateway switched off, which is exactly when an owner asks it.

## Alternatives Considered

**Stop asserting that every report can be called in one round.** The cheaper answer, and defensible:
twelve reports at once is a shape no question takes, `MAX_TOOL_ROUNDS` is four, and crossing the
ceiling mid-loop is already a named state. Rejected on the middle row of the table — the ceiling was
also cutting into questions a person would actually ask, and weakening the fixture would have hidden
that rather than fixed it.

**Trim the three new reports until the exhaustive round fits.** They come to 8,211 characters against
roughly 500 of headroom, so this meant cutting reports that already shipped. It is the *trim until
the test goes green* move both `promptBudget.test.ts` and `assistant-builder` refuse by name.

**Make `MAX_PROMPT_CHARS` an environment variable now that it has moved twice.** Rejected for
DDR-0096's reason verbatim: the ceiling exists to be hard to raise. Twice in two milestones, each
time measured and on the record, is the mechanism working.

**Give `get_dividend_income` no period argument at all** and return the whole history. Simpler, and
it makes the second extent question disappear. Rejected: *how much did I earn last year* is the
question this report exists for, and answering it would then be the model subtracting one total from
another — the arithmetic ADR-0009 forbids it.

**Let `get_dividend_income` call the performance service for the period set.** It would give one
extent and one set of windows. Rejected on DDR-0111 decision 1: a tool may not span two service
methods, and this is exactly the join the rule refuses — with the added cost of reading a whole
performance report to name a window.

**Return the trade list from `get_realized_gains`.** The service already computes it and the view
already shows it. Rejected: a list of executions is raw data for a model to derive from, which is the
one thing ADR-0009 says a tool may not return. The report says individual trades are unavailable.

## Consequences

- **The measured numbers are on the record**, so the next story that grows a report starts from them
  rather than re-deriving them: first round 16.0%, largest single report 41.4% of the *old* ceiling,
  every report at once 79.6% of the new one.
- **`promptBudget.test.ts` keeps every assertion it had**, which is the point of raising rather than
  weakening: a conversation carrying every report still fits, however the rounds are spread.
- **`CLAUDE.md` and `assistant-builder` both state the new number**, and the skill's *"decision
  waiting"* paragraph is replaced by what was decided — a paragraph describing an open question is a
  trap stated backwards once the question is closed.
- **`standardPeriods.ts` now has two callers and one vocabulary.** A third history windowed by these
  keys goes through `standardWindows` too, and states its own extent.
- **The disclosure list is six categories.** A story sending something new declares it; the type and
  `pickDisclosedSections` make that the only route.
- **Epic #322 is complete**: twelve tools, the assembled context gone, and every report the app
  computes reachable by the model.

## Related

- [[0111-the-model-asks-and-the-app-answers-in-computed-reports]] — the tool contract this story is
  the last of, and the rules it did not have to re-decide.
- [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]] — the constant, why it is hard
  to raise, and the states either side of it.
- [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]] — the first raise, the 85%
  gate, and *the ceiling rations a bug, never the grounding*.
- [[0098-the-assistant-is-grounded-in-text-the-app-wrote]] — the disclosure bound a new category
  extends, and each figure naming its store and its clock.
- [[0102-the-assistant-has-no-period-control]] — the enumerated key and the named state with
  alternatives, applied to a second history.
- [[0010-upcoming-dividends-from-flex-accruals]] — the optional accruals section that degrades to
  empty.
- GitHub Issues: Epic #322, Story #329.
