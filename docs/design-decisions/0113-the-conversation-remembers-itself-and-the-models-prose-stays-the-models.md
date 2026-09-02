# 0113. The conversation remembers itself, and the model's prose stays the model's

- **Status:** Accepted
- **Date:** 2026-09-02
- **Extends:** [[0111-the-model-asks-and-the-app-answers-in-computed-reports]],
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]],
  [[0112-the-last-three-reports-and-what-they-cost-the-ceiling]],
  [[0027-analytics-views-persist-and-explicit-refresh]]

## Context

Story #320 of Epic #319. Every question the assistant has ever been asked has been **single-shot**:
`assistantService.ask` builds `[system, user]`, the model asks for the reports it needs, it answers,
and the array is discarded. The transcript on screen is a record for the owner — *the model has
never seen it*. So a follow-up like *"and the second one?"* resolves against nothing, and the owner
restates the whole question every time.

Making it remember is four lines of plumbing. What it is not is four lines of *decision*, and the
story says so: **carrying a previous answer into the next prompt puts model-authored prose where
grounded context goes.** That is precisely the seam ADR-0009 exists to keep open — *the model never
produces a figure; every number in an answer is computed by a service and phrased by the model.* A
prior answer is the one artefact in this app that is neither: it is the model's own sentence built
around a figure a service computed. Feed it back unmarked and the next turn cannot tell it from a
report.

Three things had already changed since the story was written, and all three help.

**The gateway takes a message array.** Story #324 rebuilt `aiGateway.complete` around
`AiRequest.messages` for the tool loop, so there is no `{ system, user }` refactor left to do — the
sequencing concern recorded on the story is spent. The array already carries four roles the provider
itself distinguishes: `system`, `user`, `assistant`, `tool`.

**The renderer assembles nothing.** Story #327 moved every figure behind a tool, so the first round
is the system prompt, the absences and the question — 6,379 characters, and it does not grow with
the portfolio at all.

**`MAX_PROMPT_CHARS` is 60,000** ([[0112-the-last-three-reports-and-what-they-cost-the-ceiling]]),
not the 40,000 the story quotes. The measured headroom under [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]]'s
85% gate is real rather than the ~1,100 characters the story budgeted against.

Measured before deciding anything, at the worst case the caps allow:

| | characters | of 60,000 |
| --- | --- | --- |
| First round (system prompt, absences, question) | 6,379 | 10.6% |
| First round + the largest single report | 16,568 | 27.6% |
| First round + the six largest reports | 37,082 | **61.8%** |
| All twelve reports in one round | 47,775 | **79.6%** |

The gate is 51,000 characters. What is left over the multi-part question — the row
[[0112-the-last-three-reports-and-what-they-cost-the-ceiling]] says decides the ceiling — is
**13,918 characters**, and what is left over the exhaustive round before the *ceiling* is 12,225.
Whatever history costs has to fit inside the smaller of those with room to spare, because a history
that fits only just is one the next story breaks.

## Decision

### 1. Prior answers are carried, and the role **is** the marking

A remembered turn crosses as **two messages**: the owner's question as `user`, the model's answer as
`assistant`. Nothing else about the turn is carried.

The alternative the story names — carrying only prior *questions* — avoids the seam entirely and
loses most of the value. *"And the second one?"* is unanswerable from the questions alone: what
enumerated the positions was the **answer**. A memory that cannot resolve the pronoun the story is
named after is not the feature.

So the answers are carried, and what makes that safe is that they are carried **as what they are**.
`role: 'assistant'` is not a label this app invented and hopes the model reads; it is the provider's
own vocabulary for *text you wrote*, the same field that distinguishes a tool result from a
question. Every grounded channel in this conversation is structurally a different role:

| what it is | how it arrives | who authored it |
| --- | --- | --- |
| a computed report | `tool` | the app |
| the absences, the disclosed sections, the question | `user` | the app and the owner |
| a remembered answer | `assistant` | **the model** |

The seam ADR-0009 keeps open is therefore kept open **by construction** rather than by a sentence
the model is asked to honour. This matters because DDR-0104's finding applies here in full: *for
phrasing, the prompt is the only defence.* A rule saying "do not treat your own previous answer as
data" could be asserted present and never asserted obeyed. A rule the message array enforces needs
no obedience.

### 2. No tool call and no tool result is ever remembered

This is the other half of decision 1, and it is the part that has teeth.

A remembered turn carries the question and the answer **text**. It does not carry the
`assistant` turn's `toolCalls`, and it does not carry the `tool` messages that answered them. The
reports that produced the figures in a remembered answer are **gone from the array**.

The consequence is the one worth wanting: a figure that survives into the next turn survives only
*inside a sentence the model is told it wrote*, with no report behind it. If the model needs that
figure as a **fact** — to compare it, to judge it against a target, to state it again as current —
it has to call the tool again, and the tool answers from the services as it always did. Nothing
model-authored is ever presented to a later turn as grounded fact, which is the Epic's own
acceptance criterion, and it is true of the *array* rather than of the prompt.

It is also what makes the budget affordable. Reports are the expensive material — the largest single
one is 10,189 characters — and re-sending three turns' worth of them would cost more than the reports
the current question needs.

### 3. The grounding block appears exactly once

A remembered `user` message is the **bare question the owner typed**. `buildPrompt` — the base
context under *Before any figure*, the disclosed sections, the `## Question` heading — is applied to
the **current** question only.

Emitting it per remembered turn would restate every absence three times and, worse, would put three
copies of *"the app computes no annualised figure"* in front of a model that has to weigh which one
is current. [[0101-a-summary-names-what-the-app-does-not-compute]]'s rule is that the absences come before any figure; it is not that they come
before every figure.

### 4. Three turns, eight thousand characters, and the unit of forgetting is a whole turn

Two declared constants in `@shared/domain/assistantHistory`, both asserted by test:

```ts
export const MAX_REMEMBERED_TURNS = 3
export const MAX_HISTORY_CHARS = 8_000
```

`trimHistory` keeps the **newest** turns and drops from the oldest end until both bounds hold. A
turn that alone exceeds the character budget is **not carried at all**: memory is measured in whole
turns, never in a truncated one. Half an answer fed back to its author is a worse artefact than no
answer — the model would be reading a sentence of its own that stops mid-clause, with nothing saying
which part it is missing.

**Why a character budget as well as a turn count.** A turn count alone does not bound the cost: a
question may be 2,000 characters and an answer runs to `MAX_OUTPUT_TOKENS`, so three turns at the
caps is ~24,000 characters — 40% of the ceiling, and 101.8% of it once the six-report question is
added. The count is what the story asks to be a declared decision; the budget is what keeps the
decision from being a promise. Measured with both in force:

| | characters | of 60,000 |
| --- | --- | --- |
| First round **+ a full history at the cap** | 14,377 | 24.0% |
| + the largest single report | 24,566 | 40.9% |
| + the six largest reports | 45,080 | **75.1%** |
| All twelve reports in one round, with a full history | 55,773 | **93.0%** |

The gate holds on the row that matters with **9.9 points to spare**, and the exhaustive round —
which is measured against the ceiling rather than the gate, for
[[0112-the-last-three-reports-and-what-they-cost-the-ceiling]]'s reason — still fits.

**Why three.** A typical exchange in this app is a question of ~150 characters and an answer of
~1,500, so three turns is ~5,000 — comfortably inside 8,000, which is what makes the count the
binding constraint in ordinary use and the budget the backstop. Three is also the depth at which
pronouns actually resolve: *what do I hold* → *and the second one?* → *is that one over my ceiling?*
Growth is a decision, not an edit, and the test says so.

### 5. A stale turn is forgotten, not re-asserted

A turn records the Flex version it was grounded at ([[0027-analytics-views-persist-and-explicit-refresh]]).
**A turn grounded before the current version is not carried.**

The on-screen transcript is unchanged: the answer stays, with `STALE_NOTE` beside it, because it was
true when it was given and deleting it would be a stranger thing to do than labelling it. But a
remembered turn is not a record — it is an **assertion made again**, to a model that has no way to
see the note the owner can see. The store has moved past it, so it is dropped.

This is free of the awkward case it looks like it should have. `groundedAt` is non-decreasing across
a transcript, so the stale turns are always the **oldest** ones and dropping them leaves a
contiguous, chronological suffix. A remembered conversation never has a hole in it.

`STALE_NOTE` gains one sentence saying the assistant no longer remembers the turn, because the owner
should not have to infer a rule from the absence of one.

### 6. A failed turn is not remembered

Only a turn whose answer is `answered` is carried. A turn that is still `thinking` has no answer
yet, and a `failed` one has an app-authored failure notice where an answer would be — carrying it as
`role: 'assistant'` would attribute this app's own error copy to the model, and carrying the
question alone would invite the model to answer a question it was never asked.

### 7. Starting fresh is one control, and it discards the transcript

A **New conversation** control beside the Ask button, as a `ConfirmAction` ([[0012-in-place-destructive-confirm]]) — the
transcript is not recoverable and the app's rule for an irreversible action is an in-place
confirmation, never a modal. It clears the turns, so the model sees nothing from the discarded
conversation because there is nothing left to select from. Nothing is stored, so nothing is deleted:
this is session state, and ADR-0006 does not reach it.

### 8. The boundary re-applies the policy, as the context's does

`assistantAskRequestSchema` gains `history`, bounded per entry by Zod and then passed through
`trimHistory` — the same shape `context` already has, where `pickDisclosedSections` reduces at the
boundary rather than trusting the renderer to have done it. The renderer's selection is a *policy*;
this is the *bound*, and the two being the same function is the point rather than a duplication.

The caps live in `@shared/domain/assistantHistory`, which imports no Zod, because the renderer needs
them at runtime — [[0105-the-owner-sets-the-key-and-the-environment-wins]]'s trap, and the one it was written for.

## Consequences

Benefits:

- A follow-up resolves against the turns before it. The feature the Epic is named for.
- The seam is structural. `assistant` prose and `tool` reports are different roles in the array, and
  no prompt rule is asked to carry the distinction.
- A figure cannot silently become a fact by age: the report behind it is not in the array, so
  re-asserting it as current means calling the tool again.
- The grounding cost of memory is bounded and measured, and the measurement is in the suite that
  already fails when a story grows into the ceiling.

Tradeoffs:

- **Three turns is short**, and a fourth-turn pronoun will not resolve. That is the honest cost of a
  ceiling that also has to fund the reports; the alternative is a summarisation step, which the
  story excludes for a good reason (see below).
- **A verbose conversation forgets sooner than a terse one.** Three answers of 2,500 characters
  exceed the budget, so the third is dropped. The count is the promise; the budget is the bound, and
  which one binds depends on how much the model wrote.
- Every question now costs up to 8,000 characters more, which is 8,000 fewer for reports before a
  question ends as `incomplete`. Measured to fit; still a real subtraction.

Risks:

- **The model may restate a figure from its own prior answer rather than re-fetching it.** This is
  the residual seam and it is stated rather than solved. What bounds it: *Numerical integrity* already
  forbids deriving or transforming figures; the stale rule removes the case where the figure is
  actually wrong under a changed store; and the base context's *two stores, two clocks* already tells
  the model a live figure was true when it was read. What it does **not** bound is a live drift
  figure that moved without any version changing — the app has no signal for that, which is
  [[0027-analytics-views-persist-and-explicit-refresh]]'s standing limit and not this story's to fix.
- A remembered answer that was itself wrong is now an input. The mitigation is the same one: it
  arrives as the model's own prose, not as a report.

## Alternatives Considered

### Carry only the prior questions

Avoids the seam completely and needs no record. Rejected: *"and the second one?"* refers to a list
the **answer** enumerated, so the story's own example does not work. It would ship the plumbing and
none of the value.

### Carry the prior tool results as well

The most faithful memory: the model would see the reports it read, not only what it said about them.
Rejected on both counts. It is the expensive material — three turns of reports would not fit beside
the current question's — and it re-asserts a computed report from an earlier clock as though it were
this turn's, which is the staleness problem multiplied by twelve tools. A report is cheap to fetch
again and always current when it is.

### Mark a remembered answer with a prefix in its text

E.g. `[your earlier answer, not a report]` prepended to each carried answer. Rejected: it is a
weaker version of what `role: 'assistant'` already says, in a channel the model may or may not weigh,
and it puts app-authored text inside a message attributed to the model — which is the exact
confusion the decision is trying to prevent, inverted.

### Add a ninth prompt section about memory

Rejected on scope and on principle. The Epic excludes changes to the eight sections
([[0110-the-prompt-is-eight-sections-and-the-owner-wrote-them]]), and DDR-0104's finding is that a
prompt rule can be asserted present and never asserted obeyed. The message array enforces this one.

### Summarise older turns with the model to save budget

Explicitly out of scope in the story, and rightly: it is the model producing content the app then
treats as context, which is the seam this record exists to keep shut, taken the other way round.

### A character budget alone, with no turn count

Simpler, and it bounds the cost exactly. Rejected because the story asks for the depth of memory to
be a **declared decision** rather than a consequence of how verbose the model happened to be — and
because "how many turns do you remember?" is a question the owner may reasonably ask and get a
number for.

## References

- ADR-0009 — the grounding rule and the advisory boundary. Not amended: this record keeps its seam
  open by construction and adds nothing the model may produce.
- ADR-0010, ADR-0011 — the network policy, and the key as the authorization. Unchanged: more text
  down the one channel, and no second one.
- [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]] — the result union, and
  `MAX_PROMPT_CHARS` as a character count.
- [[0111-the-model-asks-and-the-app-answers-in-computed-reports]] — the message array, the tool
  loop's three bounds, and `incomplete`.
- [[0112-the-last-three-reports-and-what-they-cost-the-ceiling]] — the ceiling this budget is
  measured against, and the row that decides it.
- [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]] — the 85% gate.
- [[0104-phrasing-is-guarded-by-the-prompt-alone]] — the declared-constant
  mechanism the two caps reuse, and the finding about what a prompt rule can be held to.
- [[0027-analytics-views-persist-and-explicit-refresh]] — the stay-mounted view and `flexDataVersion`.
- [[0012-in-place-destructive-confirm]] — the New conversation control's shape.
- Epic #319, Story #320.
