# 0012. The app holds a default baseline, and every judgement says whose standard it is

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

[[0009-ai-assistant-grounding-and-advisory-boundary]] moved the advisory boundary from *never
advises* to *never acts*, and kept one thing back:

> The app does not judge a portfolio against a standard of its own — it judges against the
> **investor profile the owner authored** … So the assistant **proposes moves toward the policy and
> never proposes the policy**. … That is the part of the old guardrail that survives intact, and it
> is the part that mattered most.

That decision is implemented in four places, and each is visible today:

- `balanceDriftService` returns `no_profile` when nothing is stored and `no_targets` when style tags
  are set but no ranges are — both **before** it reads the portfolio, so no weight is computed.
- `assistantContext.profileSection()` returns `null` for an empty profile, and deliberately
  suppresses its *untargeted* lines in that case, so the context carries no profile section at all.
- `SYSTEM_PROMPT_RULES` — *"Never propose changes to the owner's investor profile"* and *"Do not
  supply a standard of your own"*.
- `docs/product.md`, `CLAUDE.md` and `assistant-builder` state the same rule in their own words.

**The consequence is an assistant that cannot judge until the owner has authored a policy.** On a
fresh install it can describe a portfolio and must decline every question about its shape. That is
also true of the far more common case: a profile with currency targets and nothing about sectors,
where two thirds of the questions an owner asks fall in the silence.

**The owner took the decision to change this**, on 2026-08-30, and Story #315 is the work. This
record is what that story is blocked on, for the reason #279 and #307 were: `CLAUDE.md` and
`docs/decisions/README.md` both state that an accepted decision is never silently overridden.

This is written as an **amendment** rather than a superseding record. One section of ADR-0009 is
narrowed; the grounding rule, the *never acts* boundary, the marking of grounded against repeated
claims, and the enforcement section all stand exactly as written. The precedent is
[[0011-the-key-is-the-authorization]] amending one section of ADR-0010.

## Decision

### The app may hold a default standard, and it is data the app owns

The app gains a **baseline**: a small, versioned set of thresholds about the *shape* of a portfolio,
declared in one dependency-free module, readable by anyone reviewing the repository, and constant
between two runs over the same portfolio.

It is not a model's opinion. **The model never supplies the baseline, never varies it, and never
computes a gap against it** — the ADR-0009 grounding rule reaches this exactly as it reaches every
other figure. A default the model produced from training data would be the one failure this app is
built to exclude: a number that reads identically whether it is right or wrong.

### The owner's profile always wins, dimension by dimension

The baseline applies to a dimension **only where the profile states nothing about it**. Where the
owner has written a target, the baseline for that dimension is not computed, not sent, and not
mentioned.

This is the line that keeps ADR-0009's surviving half intact. An app that measured an owner's stated
40% technology target against a 30% default would be **proposing the policy** — telling them their
own decision is wrong — and that stays forbidden. Filling a silence is a different act from
contradicting a statement, and only the first is permitted here.

It follows that the baseline is *additive on top of* a profile rather than an alternative to one. A
partial profile, which is the normal case, gets both: the owner's verdict where they have spoken and
the app's where they have not.

### Whose standard it is travels with every claim

ADR-0009 already requires that a claim the app computed and a claim the model is repeating are not
delivered in the same voice, *"beside each claim and never once at the end"*. This record extends the
same discipline to a second distinction: **a judgement against the owner's target and a judgement
against the app's baseline must be marked apart, beside the claim.**

The reason is the same one. Both read as verdicts, both are computed, and only one carries the
owner's own authority. An answer that blurs them hands the owner their own policy back with the
app's defaults mixed into it, and there is nothing in the text to tell them which is which.

The page header's `OWNER_SOURCE` — *"Set by you"*, the one provenance value naming no data source
(DDR-0094) — stops being accurate for part of an answer. That is the visible cost, and the marking
is what pays it.

### The baseline covers what the app can see, and names what it cannot

The baseline is about **shape**, never about performance. It states no return, no benchmark and no
market view; ADR-0009's grounding and the prompt's benchmark rule are untouched.

Two boundaries are decided here rather than left to a later story:

**Currency is never covered.** The app knows the currency a position is priced in and *not* where a
business earns its money — a distinction the prompt already carries as its own rule. A default
ceiling on currency weight would assert an exposure the app cannot see, so there is no default
currency ceiling and the baseline says so out loud.

**No sector is ever named as missing.** The app's "sector" is IBKR's `industry` field, and the values
it actually returns are an open-ended, fine-grained vocabulary — `Banks`, `Mining`, `Food`,
`Textiles`, `Diversified Finan Serv` — not a fixed taxonomy of a dozen sectors. The app therefore
holds **no universe of sectors** and cannot know which one a portfolio is absent from. What it can
state is concentration and coverage over the names it does hold, and it must say plainly that naming
a missing sector is outside what it computes.

The one place a *gap* can be named honestly is the **asset class**, because that vocabulary is fixed
and the app owns it (`@shared/domain/assetClass`).

### The assistant still never acts, and still never writes the profile

Unchanged, and restated here because this record is where a reader will look for it. No order path,
no broker write. **No baseline observation is ever written to the stored profile**, there is no
control that adopts the baseline as targets, and the model may not suggest a target for the owner to
set. The baseline is a default the app applies in the *absence* of a decision; it is not a
recommended decision, and presenting it as one is the failure mode this record is most exposed to.

## Consequences

### Benefits

- The assistant is useful from the first launch, and useful about the parts of a portfolio an owner
  has not written a policy for — which is most of it, most of the time.
- The thresholds are in the repository rather than in a prompt, so they can be reviewed, argued
  with, and changed in one place with a test that fails when they move.
- The `no_profile` / `no_targets` short-circuit disappears, and with it a documented wart: `balanced`
  could be *vacuously* true. It is now `null` where there is nothing of the owner's to judge.

### Tradeoffs

- **The app now holds an opinion.** It is a small, stated, defensible one, but ADR-0009's clean claim
  — *the standard is only ever the owner's* — is no longer true as written, and no marking makes an
  opinion not an opinion.
- **The marking is a mitigation, not a fix**, exactly as ADR-0009 says of the unverified-claim
  marking. An owner who reads past it gets the app's defaults as though they were their own.
- A second standard is a second thing to keep consistent with the profile's vocabulary. An
  asset-class key that drifts from `@shared/domain/assetClass` reads as 0% rather than as an error —
  DDR-0094's named failure, now with one more way in.
- Every answer about shape is longer, and the prompt budget is already the binding constraint.

### Risks

- **The baseline becoming a recommended profile.** The nearest slip is an answer that says *"consider
  setting a 10% ceiling"*, which is proposing the policy in the baseline's clothes. Mitigated by a
  prompt rule stating it directly, and by there being no control anywhere that writes it.
- **Threshold creep.** A baseline that grows a check per story ends up a robo-advisor by accretion.
  Mitigated by the checks being a declared, counted list in one module, and by currency's exclusion
  being recorded here as a decision rather than an omission.
- **False confidence in the numbers.** 10% and 30% are defensible defaults, not findings. They are
  stated as the app's defaults in every answer that uses them, which is the only honest framing
  available.
- **The sector gap being filled by the model.** Asked what sectors are missing, a model will happily
  answer from training data. Mitigated in the *grounding* rather than by a rule alone: the context
  states that the app holds no sector universe, which is the fact the rule needs to be obeyable.

## Alternatives Considered

### Option A — Keep ADR-0009's standard intact (status quo)

Rejected by the owner. Recorded because it was a deliberate position and not an oversight: it is the
half of the old analytics-only guardrail that ADR-0009 kept on purpose, and what is traded away is
the clean claim that the app never has an opinion about anyone's allocation.

### Option B — Baseline only where there is no profile at all

Simpler, and it keeps the owner's authority absolute. Rejected because it misses the case the story
is mostly about: a profile with currency targets and nothing else is not an owner who has decided
sectors do not matter, and it is the shape almost every real profile has.

### Option C — Baseline everywhere, including over the owner's own targets

The app would say what it thinks even where the owner has spoken. Rejected: contradicting a stated
target *is* proposing the policy, which ADR-0009 forbids in the half this record leaves standing.

### Option D — A canonical sector taxonomy with a mapping from IBKR's strings

The way to answer *"which sectors am I missing?"* literally. Rejected on evidence rather than
principle: the values in the local classification cache are `Banks`, `Mining`, `Commercial Services`,
`Diversified Finan Serv`, `Food`, `Textiles` — an open vocabulary with no published closed set, so
the mapping would be unbounded, hand-maintained, and silently wrong for every string it had not seen.
An unmapped name joins with nothing and reads as **0%**, which is DDR-0094's named failure and
exactly the sort of quiet wrongness this Epic exists to avoid.

### Option E — Let the model apply investing common sense in its own words

No baseline module, no computation: the prompt permits general investing judgement and the model
supplies both the standard and the arithmetic. Rejected on ADR-0009's central constraint. It is also
the option that looks most like what was asked for and is least defensible: the numbers would vary
between two identical questions, and nothing in the repository would record what the app believes.

### Option F — A second service and a second IPC channel for the baseline

Keeps `BalanceDriftResult` untouched. Rejected: it would compute the denominator and the weights a
second time, which is a second answer that can disagree with the first. The baseline is computed from
the same live reading, the same placed value and the same weights as the drift report, in the same
call.

## Supersedes

None.

This ADR **amends** [[0009-ai-assistant-grounding-and-advisory-boundary]], specifically its *The
policy is the owner's; the app only measures against it* section, which is narrowed as described
above. Every other section of that record stands, including *The model renders computed reports; it
never produces a figure*, *The advisory boundary moves from "never advises" to "never acts"*,
*Grounded and ungrounded claims are distinguishable by construction*, and *Enforcement is structural
where it can be, and tested where it cannot*. ADR-0009 carries a pointer to this record so the two
cannot be read separately.

`docs/product.md`, `docs/architecture.md`, `CLAUDE.md` and
`.claude/skills/execution-skills/assistant-builder/SKILL.md` are amended in the same change.

## References

- [[0009-ai-assistant-grounding-and-advisory-boundary]] — the record amended; the grounding rule and
  the *never acts* boundary are unchanged by this one. Its Option B and Option C are the narrower
  advisory scopes the owner weighed and declined.
- [[0010-openai-provider-and-the-network-policy]] — what leaves the machine. The baseline adds no new
  category of data: its thresholds are the app's own constants, and the figures against them are the
  weights already disclosed.
- [[0011-the-key-is-the-authorization]] — the amendment-not-supersession precedent this record
  follows.
- DDR-0095 — drift is measured live, an untargeted dimension is said out loud, and a residual is
  surfaced rather than absorbed.
- DDR-0098 — the context boundary, and the rule that a section is absent rather than empty.
- DDR-0101 — what the app does not compute is named before any figure, which is where the sector
  universe's absence belongs.
- DDR-0103 — `driftMoves`, and the prompt budget's 85% gate.
- DDR-0104 — phrasing is guarded by the prompt alone, and a rule that needs a number to be obeyable
  is a gap in the grounding.
- DDR-0094 — the profile as a setting the owner writes, and `OWNER_SOURCE` naming no data source.
- GitHub Issues: Epic #306, Story #315 (this record and the work it unblocks), #287 and #288 (the
  grounding and the phrasing rules extended here).
