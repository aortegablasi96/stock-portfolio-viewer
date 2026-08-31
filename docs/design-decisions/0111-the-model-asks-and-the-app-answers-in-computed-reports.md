# 0111. The model asks, and the app answers in computed reports

- **Status:** Accepted
- **Date:** 2026-08-31
- **Extends:** [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]],
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0101-a-summary-names-what-the-app-does-not-compute]],
  [[0102-the-assistant-has-no-period-control]],
  [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]],
  [[0105-the-owner-sets-the-key-and-the-environment-wins]],
  [[0110-the-prompt-is-eight-sections-and-the-owner-wrote-them]],
  [[0022-gateway-timeout-and-not-responding-state]]

## Context

Epic #322 replaces the assembled context with **tools**: the model asks for the report it needs, a
service computes it, and only that reaches the prompt. Story #323 is the record, and it changes no
code — the shape #307 took before M11 and #315 took before the baseline.

**ADR-0009 needs no amendment, and confirming that in writing is half this record's job.** The ADR
anticipated this exact change and named the conditions:

> **This constrains what the model may compute, not how it obtains a report.** Whether it is handed
> an assembled context, or selects among reports through tools mapped 1:1 to service methods, is an
> implementation choice and belongs to the story that builds the view. Both satisfy this ADR
> provided every tool returns a **computed report and never raw data**, and provided no tool is a
> general query. The first Assistant story deliberately starts without tool calling, for simplicity
> rather than for safety; **adopting it later needs no amendment here.**

So the four conditions are already accepted and are not re-decided below. **Option E — *give the
model tools and let it compute* — stays rejected**, and the line between it and this Epic is exact:
a tool that **returns** a computed report is permitted; a tool that lets the model **derive** one is
Option E under a new name. Nothing here moves that line.

What *is* undecided is everything the ADR left to "the story that builds the view", and there are
six of them. Each is a place where two reasonable implementations disagree, and each would otherwise
be settled by whoever writes the first tool.

## Decision

### 1. A tool is *backed by* one service method; the bijection runs the other way

ADR-0009's *"mapped 1:1 to service methods"* is ambiguous in one direction only, and the ambiguity
has a real case behind it: `analytics:getPerformance` returns **one** report carrying
`valueSeries`, `compositionSeries`, `returnSeries`, `periods` and the roll-up totals. Four proposed
tools are slices of it.

**Many tools may share one method. No tool may span two.**

That asymmetry is not a compromise; it is the ADR's own concern applied. The rule exists so the
model never assembles or computes. Four tools over one report **narrow** — they add no arithmetic
and no join, and each returns a subset of figures the service already produced. One tool over two
methods **joins**, and a join is computation performed in the tool layer, which is the layer least
covered by the service tests that make the grounding rule true.

The consequence is stated rather than discovered: **where no service method exists, the method is
added.** That is ADR-0009's sanctioned route in as many words — *"adding the computation is the
sanctioned route, and it is the more expensive one"* — and it lands in two places in this Epic:

- **`get_position` (#328)** has no per-position method today. `portfolioService` gains one, with the
  conid resolution and its *ambiguous* / *not held* states **in the service**, tested there. This
  also disposes of the Epic's worry that `get_position` is the closest thing to a general query: the
  projection stops being a tool-layer filter and becomes a named, unit-tested service operation.
- **`get_data_coverage` (#329)** was sketched over `flex:listStatements` **plus** `snapshot:list`,
  which the rule above forbids. It gains a small service of its own that composes the two and
  returns one coverage report.

`get_rebalance_gaps` needs no exception: `profile:getDrift` already carries the owner's targets and
ADR-0012's baseline in **one** payload, off one reading and one denominator. Splitting them into two
tools is the second answer ADR-0012 refused, and is forbidden here for the same reason.

### 2. Tools execute in main, and the formatters move to `@shared` first

The Epic named three ways out and asked for one on the record. **The first two are not
alternatives — they are sequential**, and the reason to prefer them turns on a fact worth checking
before arguing: `renderer/src/lib/format.ts` **imports nothing at all.** 312 lines, zero import
statements, no React, no Zod, no renderer-only global. `@shared/domain/assistantDisclosure.ts` is
the same shape and the renderer already imports it at runtime, which is the precedent
[[0105-the-owner-sets-the-key-and-the-environment-wins]] established.

So the move is a path change, not a port:

1. **`format.ts` moves to `@shared`.** `zodIsolation.test.ts` is satisfied **by construction** — a
   module that imports nothing cannot pull Zod into the renderer bundle — rather than by a rule
   somebody has to remember. This is the cheap step the Epic's framing implied was expensive.
2. **Tools then execute in main against services**, formatting with the same functions.

[[0098-the-assistant-is-grounded-in-text-the-app-wrote]]'s criterion is *strengthened*, not traded
away. Its worry was a **second** implementation of "how this app writes a percentage". After the
move there is still exactly one, now reachable from both processes — which is a better guarantee
than the one that held while the module happened to sit where only one process could reach it.

**The renderer keeps assembling the base context** (decision 6). It is not being rewritten to import
from `@shared`; the module it already calls simply lives somewhere both processes can see.

**One trap that is new and is not obvious.** Every formatter in `format.ts` passes `undefined` as its
locale — `new Intl.NumberFormat(undefined, …)` — so it resolves the *host's* default locale. That is
correct and invisible while there is one host. With two, main and the renderer can resolve
differently, and the failure is the exact one DDR-0098 exists to prevent: a figure in prose and the
same figure on a dashboard disagreeing, silently, in a digit or a separator. **The locale becomes an
argument with a single resolved source**, and a test asserts main and the renderer format the same
value identically. Left implicit, this would be found by an owner reading `1,234.50` in one place and
`1.234,50` in the other.

**Rejected: the renderer precomputes every tool payload.** It preserves DDR-0098 exactly and defeats
the Epic entirely — the model asks for the next report *mid-request*, so precomputing every payload
is the assembled context with extra steps, and the send ceiling still decides what the assistant is
allowed to know.

### 3. The absences are in the base context, not behind a tool

[[0110-the-prompt-is-eight-sections-and-the-owner-wrote-them]] recorded the coupling in as many
words:

> a later story that trims the absence blocks would silently unbind three prohibitions.

**This is that story**, and the danger is precise: three prohibitions — cause, risk statistic,
benchmark — became conditional (*"unless the available data supports…"*, *"unless explicitly
supplied…"*, *"unless comparison data is explicitly available"*), and they are obeyable only because
[[0101-a-summary-names-what-the-app-does-not-compute]] states each absence **before any figure**. A
tool the model may decline to call is not a statement before any figure. If the absences become
fetchable, the three unbind and **nothing fails** — no test, no type, no state.

So: **the absence block rides in the base context that goes with every question** (decision 6), and
is not a tool, not a tool argument, and not conditional on any tool having been called.

A second, weaker copy sits in the tool results: a performance or baseline report restates the
absences that qualify **its own** figures, which is DDR-0101's *before any figure* property applied
per report. That is belt-and-braces and is not what holds the prohibitions — #325's central test is
that a conversation in which **no tool is called** still carries all three.

**The prompt stays at eight sections.** The Epic's *Not Included* says *"the prompt will need a
tool-use section"*, and DDR-0110 says *"sharpen a section, don't add a ninth."* Those conflict, and
this record resolves it toward DDR-0110: the tool-use rules **sharpen existing sections** — *Numerical
integrity* already owns "you are given figures, you do not derive them", which is the whole of what a
tool-use rule has to say. If a ninth section is genuinely needed, it is a **record change** that
supersedes DDR-0110's count, never an edit — which is the entire mechanism DDR-0104 built and
DDR-0110 kept.

### 4. The loop is bounded twice, and it is not a retry

[[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]]'s *one bounded attempt, never a
retry loop* stands **untouched**, and the distinction is worth writing down rather than assuming:

> A retry re-sends **the same** request after a **failure**. Each round of a tool loop sends a
> **different, larger** message array after a **success**. A failed round is still not retried.

That matters because DDR-0096's reason was cost against a metered endpoint, and that reason applies
to a loop too — which is why the loop is bounded rather than merely distinguished.

**Two bounds, named separately, because they measure different things:**

- **`MAX_TOOL_ROUNDS`** — a declared constant in the gateway, the shape `MAX_PROMPT_CHARS` already
  has and for the same reason: *a value someone can raise in `.env` is one a stalled afternoon will
  raise.*
- **`MAX_PROMPT_CHARS` re-pointed at the whole message array**, checked **before every round**. The
  per-question ceiling stays 40,000 characters; what changes is that it is now cumulative rather than
  `system.length + user.length`. `promptBudget.test.ts` measures the same number against the new
  shape.

**The deadline splits in two, and this is a genuine change to DDR-0096.** Its whole-request deadline
is a *transport* property and stays exactly where it is — per HTTP request. A question that makes N
requests would otherwise be bounded at N × the deadline, which is not a bound anyone chose. So a
**whole-question deadline** is added above the loop. Two bounds with two names, rather than one
number quietly meaning something new.

**An eighth state: `incomplete`.** A loop that ends at either bound with tool calls outstanding and
no answer is not `too_large`. `too_large` means **nothing was sent** — the one distinction ADR-0010
exists to keep clear and the reason DDR-0096 refused to fold it into `refused`. Mid-loop, things
*were* sent, so folding these together would repeat exactly the misattribution DDR-0096 rejected.
`incomplete` names what happened, says how many rounds ran, and its recovery is the owner's: ask a
narrower question. It is never presented as a partial answer that is complete.

### 5. A tool result is a discriminated union, rendered as the app's own prose

Two rules, both inherited rather than invented.

**States divide by recovery** ([[0022-gateway-timeout-and-not-responding-state]]), and **an empty
report never stands in for a state.** A tool that returns nothing where it means *nothing has been
imported* is the failure that rule exists to prevent, and it is worse here than at the IPC boundary:
a model handed an empty report will phrase it as a finding.

| Tool | Backing method | Arguments | States beyond `ok` |
| --- | --- | --- | --- |
| `get_portfolio_overview` | `portfolio:getOverview` | **none** | `not_connected`, `not_responding` |
| `get_position` | `portfolioService` (**new**) | `query` (symbol or name, *resolved* to a conid) | `ambiguous` (candidates listed), `not_held`, `not_connected`, `not_responding` |
| `get_investor_profile` | `profile:get` | **none** | `not_set` — "never written" and "cleared" are one state (DDR-0094) |
| `get_rebalance_gaps` | `profile:getDrift` | **none** | `not_connected`, `not_responding` |
| `get_allocation` | `analytics:getAllocation` | `dimension` (enum), optional `limit` for largest-N | `needs_import` |
| `get_performance_periods` | `analytics:getPerformance` | **none** — the discovery tool | `needs_import`, `empty_period` |
| `get_performance` | `analytics:getPerformance` | `period` (**enumerated key**) | `needs_import`, `period_not_available` (**with alternatives**) |
| `get_daily_returns` | `analytics:getPerformance` | `period` (**enumerated key**) | `needs_import`, `empty_period` |
| `get_portfolio_history` | `analytics:getPerformance` | `period` (**enumerated key**), `series` (`value` \| `composition`) | `needs_import` |
| `get_dividend_income` | `analytics:getDividends` | `period` (**enumerated key**) | `needs_import` |
| `get_realized_gains` | `analytics:getRealizedGains` | **none** | `needs_import` |
| `get_data_coverage` | coverage service (**new**) | **none** | — always answers; "nothing imported" is a coverage report |

**No argument is a predicate.** No tool takes a filter, a sort, a comparison, a threshold or a free-form
range — those are the general query ADR-0009 forbids, arriving as a parameter rather than as a tool.
`get_allocation`'s `limit` is the one bounded exception and it is a *count*, not a condition:
largest-N by weight, which is a shape the allocation report already computes. `get_position` takes an
identity and nothing else. `get_portfolio_history`'s `series` is the split
[[0013-performance-twr-curve-and-chart-hover]] requires — value and return may not arrive in one
payload, or the model attributes a deposit to performance.

`get_concentration` is **not in the inventory**. It is folded into `get_allocation` (largest-N by
weight) and `get_rebalance_gaps` (the baseline's own 10% ceiling). A third computation would run off
a possibly-different denominator, and `CLAUDE.md` records that the ceiling is a **lower bound** —
an unconvertible holding is unplaced and gets no percentage (Bug #68) — so an independently computed
figure can legitimately disagree with the baseline's verdict, with the model unable to tell which is
which.

`period_not_available` carries **alternatives**, which is [[0102-the-assistant-has-no-period-control]]'s
decision arriving through a new door: the set holds every standard period precisely so a question
about a window it does not hold is *"a named state with alternatives, not the adjacent row"*, and a
tool accepting a free-form range is the period picker that record refused. **Tools accept enumerated
period keys only.**

**A tool result is rendered into the app's own prose, not handed over as JSON.** The formatters rule
(decision 2) then applies to a tool result exactly as it applies to a context section, and DDR-0098's
four pinned properties — no money in a section declared as names or percentages, absent never empty,
the app's own formatters, every figure naming its store *and clock* — carry over unchanged rather
than needing a second set for a second delivery mechanism.

### 6. A base context survives, and it is what the tools cannot be trusted to carry

Not a foregone conclusion, and the answer is **yes** — but it shrinks to only what must be
unconditional:

- **scope**: the display currency, the clock, and which stores hold anything;
- **the absence block** (decision 3);
- **ADR-0012's framing**: that a judgement says whose standard it is, and that the app's baseline
  applies only where the profile is silent.

Every **figure** moves behind a tool. What stays is the material whose whole value is that the model
cannot decline to receive it.

**`DISCLOSURE_CATEGORIES` must reach tool results, or a tool becomes the way around the boundary.**
Today it types `AssistantContext` and `pickDisclosedSections` drops an undeclared section at the IPC
boundary — *"an undeclared section cannot be sent"* (DDR-0098, ADR-0011). Tool results are assembled
in **main** and never cross that boundary, so the bound does not reach them for free. So: **every tool
declares the disclosure category it falls under**, and a test asserts the tool registry's categories
are a subset of `DISCLOSURE_CATEGORIES`. Without this, the Epic's own acceptance criterion — *"no
section crosses the boundary that `DISCLOSURE_CATEGORIES` does not type"* — would be true of the base
context and false of everything else.

## Alternatives Considered

**A strict bijection: one tool per service method, with a `section` argument.** Honest to the ADR's
literal wording, and it makes the tool count small. Rejected: a `section` argument on
`get_performance` is a discriminated tool wearing a disguise, the model has to know the sections
before it can ask for one, and the states differ per section — `period_not_available` is meaningless
for `get_portfolio_history`. Four named tools with four state sets are more legible to the model and
to a reader, and they add no computation.

**Allow a tool to span two service methods where it only joins metadata.** The case was
`get_data_coverage` over `flex:listStatements` + `snapshot:list`, and the join really is trivial.
Rejected: "only metadata" is not a line anyone can hold, and the next such tool joins two figures. A
small service is cheap, is tested where the rest of the app's logic is tested, and keeps the rule
exceptionless.

**Keep `format.ts` in the renderer and duplicate the formatters in main.** Rejected: it is the exact
drift DDR-0098's criterion exists to prevent, and it is now known to be unnecessary — the module has
no dependencies, so the move costs a path change.

**Have the renderer precompute every tool payload.** Preserves DDR-0098 with no move at all, and
defeats the Epic: the ceiling still decides what the assistant may know, and the 41st position stays
invisible.

**Put the absences behind a `get_absences` tool.** Tidy, and symmetrical with everything else.
Rejected on DDR-0110's own coupling — a prohibition whose supporting fact the model may decline to
fetch is not a prohibition, and nothing would fail when it stopped being one.

**Add a ninth prompt section for tool use.** Rejected here and left available as a *record* change:
DDR-0110 asserts eight three ways, and the tool-use rule is a sharpening of *Numerical integrity*
rather than a new subject.

**Fold `incomplete` into `too_large`.** Rejected: `too_large` means nothing was sent, which is the
distinction ADR-0010 exists to preserve. Mid-loop, data has already left the machine.

**One whole-question deadline replacing the per-request one.** Simpler, one number. Rejected: the
per-request deadline is a transport property that stops a *socket* going quiet, and a question-level
number cannot do that job. Both exist, named apart.

**`MAX_TOOL_ROUNDS` as an environment variable.** Rejected for DDR-0096's reason verbatim: the
ceiling exists to be hard to raise.

**Drop the base context entirely once tools exist.** Rejected: it is where the absences live, and the
display currency and clock qualify every figure any tool returns.

## Consequences

- **`CLAUDE.md`'s *"the model gets no tools and no data access"* is corrected in this change.** It
  described the build and read as a prohibition; once tools exist it is a **trap stated backwards**,
  which that file's own budget note calls worse than saying nothing. `docs/architecture.md`'s *AI
  Principles* and `assistant-builder`'s tool rules are updated in the same change, which is
  ADR-0009's own convention — *each is updated in the same change so no pair of documents
  contradicts.*
- **`assistant-builder`'s framing stops being provisional.** Its rules were written for an assistant
  that might one day have tools (*"where tools are used at all"*, *"the first Assistant story starts
  without tool calling"*). That day is scheduled, so the hedges go and the rules become the rules.
- **The formatter move is a prerequisite of #326–#329, not a step inside them.** It belongs to #324
  or to a slice of its own, and every tool story depends on it. A tool story that starts by writing
  its own percentage formatter has already lost the property this Epic must not cost.
- **The locale trap is a new bug class**, created by the second process and not by tools. It is
  recorded here because the first tool story would otherwise meet it as a mystery.
- **Two service methods are added** — per-position lookup and coverage — and both are ordinary
  service work, tested where services are tested.
- **The gateway gains an eighth state**, and `FAILURE_HEADINGS` is asserted exactly equal to the
  gateway's non-`ok` statuses in both directions (DDR-0107), so the renderer cannot ship without a
  heading for it.
- **Nothing in this story is code.** #324 carries the loop, #325 the absences, #326–#329 the tools.

## Related

- [[../decisions/0009-ai-assistant-grounding-and-advisory-boundary]] — the four tool conditions,
  Option E, and *"adopting it later needs no amendment here."* **Unamended by this record.**
- [[../decisions/0012-the-app-holds-a-baseline-and-says-whose-standard-it-is]] — one reading, one
  denominator; why `get_rebalance_gaps` is one tool.
- [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]] — the states, the ceiling and
  the no-retry rule this extends; the deadline it splits.
- [[0098-the-assistant-is-grounded-in-text-the-app-wrote]] — why assembly is in the renderer, the four
  pinned properties, and the disclosure bound that must reach tool results.
- [[0101-a-summary-names-what-the-app-does-not-compute]] — the absence blocks, stated before any
  figure.
- [[0102-the-assistant-has-no-period-control]] — the named state with alternatives, and why a
  free-form range is the picker refused.
- [[0110-the-prompt-is-eight-sections-and-the-owner-wrote-them]] — the coupling this record answers,
  and the eight-section count it keeps.
- [[0105-the-owner-sets-the-key-and-the-environment-wins]] — `zodIsolation.test.ts` and the
  dependency-free `@shared` module the formatters follow.
- GitHub Issues: Epic #322, Story #323 (this record), #324–#329.
