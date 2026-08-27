# 0009. The AI assistant's grounding and advisory boundary

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Epic #5 has been redefined. The AI assistant it describes still explains, summarizes and compares —
but it now also judges whether the portfolio is balanced against targets the owner sets, and
**proposes rebalancing and reallocation, naming instruments**. The owner took that decision
explicitly, after the conflict below was put to them and restated.

The conflict is not incidental. **Five documents currently state the opposite**, and they are the
documents the project treats as authoritative:

| Document | What it says today |
| --- | --- |
| `docs/product.md` | *Out of Scope*: "Investment recommendations", "Robo-advisor functionality"; the Vision line "without ever telling them what to buy, sell, or hold" |
| `CLAUDE.md` | *Product guardrails*: "AI must **never** recommend investments, suggest trades, decide allocations, or execute transactions" |
| `docs/architecture.md` | *AI Principles*, the same sentence |
| `.claude/skills/execution-skills/assistant-builder/SKILL.md` | *Single Owner & Analytics-Only*: "never recommend investments or decide allocations" |
| [[0007-mapbox-basemap-and-renderer-network-policy]] | the network half of the same posture — addressed in the companion [[0010-openai-provider-and-the-network-policy]] |

`CLAUDE.md` requires that an accepted decision is never silently overridden, and that a change to one
returns to its owning skill rather than being made inline. Hence this ADR.

**The scope decision itself is the owner's and is product, not architecture.** What belongs here is
what falls out of it: an assistant that asserts more needs a stricter account of where its assertions
come from, and a boundary that has moved needs its new position stated precisely enough that a later
story cannot drift across it by accident.

Two questions follow, and this record answers them.

1. **Where does a figure in an answer come from?** The app now produces statements an owner may act
   on with their own money. A wrong number in one reads exactly like a right one.
2. **What boundary remains, and what enforces it?** A guardrail that only says what is no longer
   forbidden describes no boundary at all.

## Decision

### The model renders computed reports; it never produces a figure

This is the assistant's central architectural constraint and it is a layering rule, not a prompt.

Every figure that appears in an answer is computed by a service, from repositories, exactly as the
four analytics views compute theirs. Context assembly — selecting which computed reports a question
needs and shaping them for the request — is **deterministic, pure, and unit-tested**. The model
receives figures and is asked to *phrase* them. It is never asked to derive, total, difference,
convert or weight anything.

The reason is that the failure is invisible. A model asked to subtract two returns will usually be
right, and the occasions when it is not are indistinguishable in tone and shape from the occasions
when it is. No amount of review catches that reliably, and the owner reviewing it is the person
least placed to. Removing the arithmetic from the model removes the class of failure rather than
mitigating it.

The corollary extends a rule `assistant-builder` already states: **the model never reaches the
database, the repositories or the IBKR gateway.** What it may read is the output of a service, which
is a computed report.

**This constrains what the model may compute, not how it obtains a report.** Whether it is handed an
assembled context, or selects among reports through tools mapped 1:1 to service methods, is an
implementation choice and belongs to the story that builds the view. Both satisfy this ADR provided
every tool returns a **computed report and never raw data**, and provided no tool is a general query.
The first Assistant story deliberately starts without tool calling, for simplicity rather than for
safety; adopting it later needs no amendment here.

### The advisory boundary moves from "never advises" to "never acts"

**The assistant may:** explain what changed and why the app's own figures say so; summarize
performance; compare periods; report drift against the owner's targets; and propose rebalancing and
reallocation, including naming instruments to trim or to add.

**The assistant never acts.** There is no order placement, no broker write, no modification of any
position, and no code path that could carry one. The `Interactive_Brokers_IBKR` MCP allowlist carries
no order-placing tool and must not gain one. A suggestion is text; the owner acts at their broker, or
does not.

### The policy is the owner's; the app only measures against it

This is what keeps "decide allocations" from quietly becoming true. The app does not judge a
portfolio against a standard of its own — it judges against the **investor profile the owner
authored**: style tags and numeric target ranges. The allocation decision *is* the profile, and the
profile is written by the owner.

So the assistant **proposes moves toward the policy and never proposes the policy**. Suggesting the
owner widen a target, adopt a different allocation, or change their stated style is out of bounds,
and stays out of bounds. That is the part of the old guardrail that survives intact, and it is the
part that mattered most.

### Grounded and ungrounded claims are distinguishable by construction

A proposal has two halves and the app can stand behind only one.

**Trimming is grounded end to end.** The app knows the position, its weight, its currency, its
sector, and the drift a change would close. Such a proposal carries its arithmetic, and the
arithmetic is verified in code — the proposed end state must land inside the profile's target ranges
before the answer is shown.

**Adding is not grounded.** The app holds no instrument universe, no prices for anything it does not
own, no fundamentals, no screening. An instrument the model names to buy comes from its training
data: subject to a knowledge cutoff, not price-checked, not checked for existence, for availability
at the owner's broker, or for accessibility from their jurisdiction.

The two must therefore be **visibly distinguished in the answer**. The owner asked for instruments,
so they are not withheld; what is required is that a claim the app computed and a claim it is
repeating are not delivered in the same voice.

### Enforcement is structural where it can be, and tested where it cannot

- **Layer boundaries** already prevent the renderer from reaching repositories, services or the
  database ([[0002-typed-ipc-contract]], `eslint.config.mjs`). The assistant is not an exception.
- **Any tool the model is given returns a computed report**, mapped 1:1 to a service method. No
  general query tool, and no direct database, repository or gateway access — the rule
  `assistant-builder` already carries.
- **Proposal verification is code**: an end state outside the target ranges is not displayed as a
  proposal.
- **What cannot be made structural is pinned by tests over the assembled context** — the grounding
  rule, the refusal to attribute causes the app cannot observe, the marking of unverified claims.
  Not by the model's disposition, and not by wording in a prompt alone.

## Consequences

### Benefits

- The owner gets answers they can act on, which is the capability the Epic exists to deliver.
- The class of error most dangerous here — a plausible wrong number — is removed by construction
  rather than reviewed for.
- The surviving boundary is sharper than the one it replaces. "Never acts" and "never proposes the
  policy" are testable; "analytics-first, not advice-first" was a posture.
- The grounding rule keeps the assistant's value proportional to the app's own analytics: improving a
  report improves every answer that quotes it.

### Tradeoffs

- **"Analytics-first, not advice-first" is no longer true as stated** and is replaced by a narrower
  claim. The framing in `docs/product.md` and `docs/architecture.md` is amended accordingly.
- The assistant can be confidently wrong about things that are not numbers. Grounding bounds the
  figures; it does not bound the adjectives around them.
- Suggestions that name instruments carry a category of claim the app cannot verify, permanently.
  Marking it is a mitigation, not a fix.
- Every question costs an assembly step that must be maintained alongside the reports it draws from.

### Risks

- **Boundary erosion.** "Never acts" sits one convenience feature away from an execute button, and
  the IBKR integration is already present. Mitigated by naming the MCP allowlist explicitly here, and
  by the absence of any order path being an acceptance criterion rather than an assumption.
- **Grounding erosion.** A later story wanting a figure the app does not compute will be tempted to
  let the model supply it. The rule is stated as a layering constraint for that reason: adding the
  computation is the sanctioned route, and it is the more expensive one.
- **The unverified marking becoming decoration.** If every answer carries a caveat, none of them is
  read. Mitigated by marking claims individually rather than appending a blanket disclaimer.
- **Owner over-trust.** The assistant's register is confident by nature and the owner is a single
  person with no second reader. This is accepted knowingly; it is the cost of the capability, and it
  is why the arithmetic is not the model's.

## Alternatives Considered

### Option A — Keep the analytics-only guardrail (status quo)

The standing decision until this record, and the one four documents still state. Rejected by the
owner after the conflict was raised and the guardrail restated to them. Recorded here because it was
a deliberate position rather than an oversight: the app's value was framed around understanding
rather than advice, and that framing is what is being traded away.

### Option B — Drift reporting only

The assistant reports the gap between actual and target and never proposes an action. Preserves the
guardrail almost intact, since measuring distance from an owner-set standard is arithmetic rather
than advice, and would have needed only a clarifying sentence in `docs/product.md`. Not chosen: the
owner wants the translation from gap to action, which is the step they find laborious.

### Option C — Directional actions without instruments

"Reduce USD exposure by roughly 22 percentage points" — sizeable, grounded, and fully within what the
app can verify, since every figure comes from the drift report. Not chosen, but it is worth recording
that **this is the subset of Option D that the app can actually stand behind**, and the
grounded/ungrounded marking above exists precisely to keep it visible inside the larger scope.

### Option D — Full suggestions, instruments included

Chosen. Its weakness is known and stated: the half of a proposal that names something the owner does
not already hold cannot be grounded in the app's data, and is repeated from the model rather than
computed.

### Option E — Give the model tools and let it compute

Let the model query services or repositories and derive its own figures. Rejected on the correctness
argument above, and it would also dissolve the layering the whole app is built on
([[0002-typed-ipc-contract]]). `assistant-builder` already forbids direct model access to the
database, repositories and internal details; this ADR keeps that rule and extends it to arithmetic.

## Supersedes

None.

This ADR **amends** the AI Principles in `docs/architecture.md`, the *Product guardrails* in
`CLAUDE.md`, the *Out of Scope* list and Vision line in `docs/product.md`, and the *Single Owner &
Analytics-Only* section of `.claude/skills/execution-skills/assistant-builder/SKILL.md`. Each is
updated in the same change so no pair of documents contradicts.

The network half of the same posture is amended by the companion
[[0010-openai-provider-and-the-network-policy]].

## References

- [[0010-openai-provider-and-the-network-policy]] — the companion record: provider, consent, and what
  leaves the machine.
- [[0007-mapbox-basemap-and-renderer-network-policy]] — the prior network posture, amended there.
- [[0002-typed-ipc-contract]] — the layering this grounding rule extends.
- [[0004-interactive-brokers-integration]] — the broker path, which gains no write.
- `.claude/skills/execution-skills/assistant-builder/SKILL.md` — the model's tool and data-access
  rules, retained.
- GitHub Issues: Epic #5, Story #279 (this record), #280 (the profile), #281 (the drift
  computation), #289 (the proposals this boundary governs).
