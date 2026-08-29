# 0103. Every standard period is precomputed, and the arithmetic that closes a drift is too

- **Status:** Accepted
- **Date:** 2026-08-29
- **Amends:** [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]] — `MAX_PROMPT_CHARS`
  is raised from 24,000 to 40,000. Everything else in `0096` stands: it is still a constant rather
  than an environment variable, still counted in characters rather than tokens, and still checked
  before anything is sent.
- **Extends:** [[0102-the-assistant-has-no-period-control]],
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0095-balance-drift-is-computed-by-a-service]],
  [[0099-a-return-is-not-a-change-in-value]],
  [[0101-a-summary-names-what-the-app-does-not-compute]],
  [[0085-ytd-anchors-to-the-data]],
  [[0072-a-chart-title-names-the-chart-not-the-window]],
  [[0022-gateway-timeout-and-not-responding-state]]

## Context

DDR-0102 removed the period control and took on a debt in the same breath: with nothing selecting a
window, the grounding became the whole imported history, and a question about a shorter period got a
full-history answer. It named the payment — "#287 restores per-period grounding for *every* period
rather than one" — and this is that payment.

Two halves, and they look unrelated until you notice they are the same move. **The model never
produces a figure** (ADR-0009). A question naming a period needs figures for that period; a question
asking how to rebalance needs the *size of the move*, which is percentage points spread across
positions. Both are arithmetic, both are the kind a model does not experience as arithmetic — "2025
beat 2024 by about three points", "trim four points of Apple and two of Microsoft" read as prose —
and both are therefore computed here or not available at all.

The half nobody would have designed unprompted is the **unavailable period**. Free text takes any
window; the app holds a fixed set. A per-question resolution that misses returns nothing, and
nothing is exactly what a model fills in — it reaches for the adjacent row and answers about that,
which is a right-looking figure under the wrong heading. Precomputing the whole set is what turns
the miss into something sayable: the context states what it holds, so the answer can name the
alternatives. DDR-0022's discipline — an unavailable thing is a **state**, not a silence — arriving
in prose.

## Decision

### The period set is precomputed, not resolved per question

`renderer/src/lib/periodSet.ts` derives every standard window from the performance report:
the full history, four trailing windows, up to `MAX_LISTED_YEARS` calendar years and
`MAX_LISTED_QUARTERS` calendar quarters, newest-first. Each row carries its return, its start and
end value, its change in value, its calendar length and its count of days with data.

Every window is anchored to `extent.to` — the last day the imported history holds — and never to
the clock (DDR-0085). A history ending last year yields *that history's* periods; anchored to today
every one of them would be empty, and an empty period reads as a flat one.

The windowing is `dateRange`'s and the endpoints are `performanceRange`'s. Nothing is
re-implemented, so a figure in an answer and the same figure on a chart are one number.

### A trailing year is named by its length, and that is a second vocabulary on purpose

`TRAILING_PERIODS` names `1y` **"Last 12 months"**, not `PERIOD_LABELS`' "Last year". DDR-0085's
one-vocabulary rule is about presets on a *control*, where "Last year" sits beside `1Y` and is
unambiguous. Here it would sit beside a row named `2025`, and *how did last year go?* would have two
rows to land on with nothing to choose between them — which is precisely the inference this story
exists to remove. `PERIOD_LABELS` is untouched and still governs `periodChange`.

### Consecutive differences are computed; every other comparison is a reading

Each year carries its difference against the previous year, and each quarter against the previous
quarter, in **percentage points**. Two periods side by side are an *ordering*, which a model may
read off the rows; "by how much" is subtraction, which it may not do. Only consecutive same-kind
pairs: that is linear in the number of periods where every pair would be quadratic, and it is the
comparison an owner actually makes.

A period holding no day of data takes part in **no** difference, on either side, and reports the
empty state instead of figures (DDR-0099). `valueAt` carries forward and would otherwise describe a
gap in the history as a calm, flat 0%.

Each row's rebasing is stated once for all of them: every return is chain-linked onto its own
period's start (DDR-0072), so no two are points on one scale, and the context says so and forbids
combining them.

### The drift-closing move is computed by a service, in percentage points only

`services/profile/driftMoves.ts` sizes the move for every out-of-range band, and
`balanceDriftService` attaches it: `DriftBand.move` is non-`null` **exactly** when `status` is not
`inside`, which makes "every out-of-range band carries its move" a property of the shape rather than
of a caller remembering.

- **The split is proportional, not greedy.** Points are spread across the band's positions in
  proportion to what each already holds, so the band's internal shape survives. A largest-first
  sweep would empty the biggest holding into the gap and call it a proposal — a ranking of the
  owner's positions the app has no basis to produce. Proportional is the one split that expresses no
  opinion.
- **Capacity is a hard stop.** A trim cannot take more out of a position than it holds; an add
  cannot push one past the owner's own concentration ceiling. One redistribution pass uses the room
  that genuinely exists, and what still does not fit is `uncovered` — *stated*, never pushed onto
  whatever had room beyond its share (DDR-0052's rule, applied to a proposal).
- **A band the owner holds nothing in is the interesting case.** "I want 10% in utilities and hold
  none" has no contributor and comes back wholly uncovered with `candidates` at zero. The context
  says closing it means buying an instrument the owner does not hold, and forbids naming one from
  the holdings list — which is what a model with a gap in front of it will otherwise do.
- **Cash is in a band and never in a move.** A currency band's weight can be part cash; cash is not
  a position anyone trims.
- **Percentage points, never money.** The `profile` category is disclosed as percentages only, so a
  euro figure in a proposal would change `disclosureFingerprint` and put the owner back through the
  consent panel (DDR-0097) — for a unit the profile is not even written in.

**The end state is computed, which is what makes verifying the model's answer unnecessary.** #289
wanted a check that a proposed allocation lands inside the ranges; verifying free text means asking
the model to emit a parseable structure, which fights the free-text surface this Epic settled on.
Computing the end state first makes the check *pointless* rather than merely cheaper — there is
nothing the model produced to verify. #289 is closed as superseded.

### An untargeted dimension is named as untargeted

A dimension the profile states nothing about is absent from the drift report, deliberately
(DDR-0095): a profile stating nothing about sectors is not a profile stating that sectors do not
matter. That absence is right in the report and **wrong in front of a model**, which reads a missing
heading as a question that came back clean and writes "your sectors are balanced". So the profile
section names the dimensions carrying no target, and says outright that they are neither balanced
nor unbalanced.

It is emitted only where the owner has stated *something*. An owner with no profile has not left
three dimensions untargeted; they have no profile, and the view says so beside the box.

### The kind of currency exposure is stated beside every currency breakdown

Currency here is the currency each position is **held and priced in**, not where the underlying
business earns its revenue. The sentence sits beside the breakdown in both the weights section and
the drift section rather than once at the top: a breakdown gets quoted on its own, and a
qualification three headings away is one that will not travel with it.

### `MAX_PROMPT_CHARS` is raised to 40,000

DDR-0096 justified 24,000 as "several times the largest context this Epic assembles". That was true
when nothing filled the context and stopped being true when something did. Measured at the worst
case the caps allow — sixty positions, thirty-three targets all out of range, twenty years of daily
history — the assembled prompt came to ~30,000 characters.

The ceiling's job is to stop **runaway growth**: a bug, a loop, a thousand-position book. It is not
a ration on grounding, which is the feature. Rationing it here would have meant a large portfolio
getting `too_large` on every question — the failure the constant exists to make *legible*, not one
it should cause. 40,000 characters is roughly 10k tokens, two orders of magnitude below the model's
own context window.

`services/assistant/promptBudget.test.ts` measures the worst case against the number, on the service
side because that is the one place the two halves of the real prompt meet: the ceiling is the
gateway's, the assembly is `buildPrompt`'s, the sections are the renderer's.

### Every cap states itself in the text it caps

`MAX_LISTED_YEARS` (8) and `MAX_LISTED_QUARTERS` (8) cut at the **oldest** end and the section says
how many of how many it holds. `MAX_LISTED_MOVES` (6) sizes the **largest gaps first**, across all
three dimensions from one budget, and every band still carries its verdict without one.
`MAX_MOVE_CONTRIBUTORS` (3) names the largest few, which carry the move **entirely** — a proposal
that hands most of its own size back as unallocated is not a proposal — with genuine capacity
shortfalls still reported as `uncovered`.

## Consequences

Benefits:

- **DDR-0102's debt is paid.** Per-period grounding is back for *every* standard period rather than
  the one a control happened to be showing.
- **A proposal narrates arithmetic instead of generating it**, and #289's post-hoc verification of
  model output is retired rather than deferred.
- **The disclosure does not move.** No category changes and no granularity changes: periods are
  returns and values out of the imported store, which `performance` already discloses; moves are
  percentage points, which `profile` already discloses. `disclosureFingerprint` is stable and the
  owner is not re-asked (DDR-0097). Asserted.
- **`DriftBand.move` makes the invariant structural.** A band cannot be out of range and carry no
  move, because both come out of one expression.

Tradeoffs:

- **A window the set does not hold is still not answerable.** It is a named state with alternatives,
  which is the honest outcome, but an owner asking "March to July" gets periods rather than an
  answer. Resolving arbitrary windows was rejected in DDR-0102 and nothing here reopens it.
- **The prompt roughly doubled.** More input tokens per question, and more room for a model to lose
  the thread — which is what #288's phrasing rules exist to bound.
- **A second period vocabulary now exists**, and the two must be kept from drifting into each other.
  `PERIOD_LABELS` names windows on a control; `TRAILING_PERIODS` names them in a list beside
  calendar years. Both are exhaustive records, so neither can silently gain an unnamed member.

Risks:

- **Proportional splitting is a choice, and it is visible.** An owner may want a different one. It
  is the neutral split, and the alternative — the app ranking their holdings — is a judgment the app
  is not entitled to make.
- **A move assumes the portfolio keeps its total.** Weight shifts between positions; nothing is paid
  in or taken out. Stated in the section, because a move read as "buy this much more" would change
  the denominator every other percentage is a share of.
- **The band list is still uncapped.** A profile with a hundred targets produces a hundred band
  lines. The budget test's fixture carries thirty-three and fits; a cap here would drop a target's
  *verdict*, which is worse than dropping its move, so the move cap absorbs the growth instead.

## Alternatives Considered

### Resolve the period from the question text

Rejected, as in DDR-0102 and for the same reason. Parsing "March to July" into bounds is either a
model producing a figure (ADR-0009) or a date parser this app would have to own, get wrong at
boundaries and localise. The precomputed set is the version where every window in play was computed
by the code that draws the charts.

### Compute the difference between every pair of periods

Rejected: quadratic in the number of periods, and almost all of the pairs are comparisons nobody
makes. Consecutive same-kind pairs cover *was last year better than the one before* and *how did
this quarter go against last* — which is the question — at linear cost.

### Compute the moves in the renderer, from the allocation report

Rejected, and it is the mistake that would have looked tidiest. The allocation report is **imported
Flex history**; drift is the **live** portfolio. A move sized off Flex positions against live drift
bands would mix two clocks inside one proposal, which DDR-0098's "each section names its store and
its clock" exists to prevent. The move belongs where the weights it is a share of are computed.

### Allocate a move largest-first instead of proportionally

Rejected. It empties the biggest holding into the gap, which is both a more disruptive suggestion
and an implicit ranking of the owner's positions. The app has no basis for either.

### Spread the move over the whole band and truncate the list

Rejected. It preserves proportionality across positions nobody will read about, at the cost of
handing back most of the move as unallocated — a proposal that mostly declines to propose. The named
few carry it, and the *statable* shortfalls (a trim that would empty a position, an add the ceiling
stops) are still reported.

### Cap the context by trimming sections instead of raising the ceiling

Rejected after measuring. Fitting 24,000 would have meant roughly three sized moves, five years and
five quarters — a grounding crippled for realistic portfolios to satisfy a constant chosen before
any of the grounding existed. The ceiling is the cheaper thing to move, and moving it costs nothing
the model or the bill notices.

### Put the money value of a move beside its percentage points

Rejected outright. It would change `disclosureFingerprint`, withdraw consent, and make the owner
re-read a disclosure — to add a unit the profile is not written in and the move does not need.

## References

- `src/renderer/src/lib/periodSet.ts` — the set, the caps, the consecutive differences
- `src/services/profile/driftMoves.ts` — the proportional split and its capacity rules
- `src/services/profile/balanceDriftService.ts` — which positions carry a band, and the ceiling
- `src/renderer/src/lib/assistantContext.ts` — the sections, the untargeted lines, the currency note
- `src/services/assistant/promptBudget.test.ts` — the worst case, measured
- `src/repositories/assistant/aiGateway.ts` — the raised ceiling, and the paragraph beside it
- ADR-0009 / ADR-0010 — the advisory scope, and that portfolio data leaves the machine for this
- Epic #5, Story #287; Story #289, closed as superseded
