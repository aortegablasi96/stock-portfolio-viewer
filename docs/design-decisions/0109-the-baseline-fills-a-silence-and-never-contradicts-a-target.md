# DDR-0109 — The baseline fills a silence and never contradicts a target

- **Status:** Accepted
- **Date:** 2026-08-31
- **Story:** #315 (Epic #306)
- **Implements:** [[../decisions/0012-the-app-holds-a-baseline-and-says-whose-standard-it-is]]

## What was decided

The app holds a default standard for the *shape* of a portfolio and applies it to what the owner's
profile leaves silent. ADR-0012 is the record that permits it; this is how it is built, and the four
things a later story must not undo.

### The baseline is data, in one dependency-free module

`@shared/domain/portfolioBaseline.ts` holds the whole standard: a version, four declared checks,
three ceilings, and the coverage vocabulary. Nothing about it is computed, prompted for, or
inferred, and `BASELINE_VERSION` travels into the assembled context so an answer the owner kept says
which standard produced it.

The ceilings are **10%** for a single position, **30%** for a single sector, **15%** for uninvested
cash. Only the first has an external anchor — UCITS' *5/10/40* caps one issuer at 10% for a
diversified fund, and it is the same shape as the profile's own `positionSize` field, which is what
makes deferring to that field a clean swap. The other two are deliberately loose: the baseline
exists to catch a portfolio that is obviously out of shape, not to nag one that is merely tilted,
and a default that fires on most real portfolios is one that gets read past.

`BASELINE_CHECKS` is a declared list and its length is asserted, for the reason
`SYSTEM_PROMPT_RULES`' seventeen is (DDR-0104). The risk this module runs is **accretion** — a check
per story until the app is a robo-advisor by increments — and a length nobody asserts is one a story
can grow without saying so.

### The owner's profile wins, dimension by dimension

`BASELINE_CHECK_GOVERNED_BY` maps each check to the profile field that silences it, and that mapping
*is* the rule, written once:

| Check | Silenced by | Ceiling |
| --- | --- | --- |
| `position` | `profile.positionSize` | 10% |
| `sector` | `profile.sectorTargets` | 30% |
| `cash` | `profile.assetClassTargets` | 15% |
| `coverage` | `profile.assetClassTargets` | — |

A silenced check computes nothing, returns nothing, and is reported as **deferred**. Measuring an
owner's stated 40% technology target against a 30% default would be *proposing the policy*, which
ADR-0009 forbids in the half ADR-0012 leaves standing. Filling a silence and contradicting a
statement are different acts and only the first is permitted.

`cash` and `coverage` share a governor because uninvested cash sits in the asset-class dimension
under `CASH_ASSET_KEY`: an owner who has said what weight of each class they want has already said
what weight of cash.

A **style tag is not a statement**. It describes an intent, and there is nothing in one to measure a
weight against, so a profile carrying only tags leaves every check applied.

### It is computed in the drift report, from the same reading

`balanceDriftService.getBalanceDrift` returns the baseline inside `BalanceDriftReport`, derived from
the same live read, the same `placedValue` and the same weights as the drift half. **A second
service was rejected** (ADR-0012, Option F): it would derive its own denominator and could disagree
with the first about how large a position is, and two verdicts contradicting each other inside one
answer is the failure hardest to see.

Three consequences follow, and each is a residual DDR-0095 refuses to absorb, refused here too:

- Cash carries **no sector**, so it cannot become the largest one.
- An **unclassified** instrument is not a sector and one absent from imported history is not an
  asset class. Counting either would report a gap in local reference data as a concentration, or
  make coverage look better than it is.
- Positions are summed **by conid**, exactly as `positionDriftFor` sums them, so a split holding
  cannot slip under the app's ceiling while the owner's own ceiling catches it.

Weights are **unrounded** and sitting exactly on a ceiling is **inside** it — both are the drift
report's own `verdict` conventions, kept identical because the two verdicts are read side by side. A
baseline that faulted a portfolio at exactly 10% would disagree with an owner's own 10% ceiling about
the same portfolio.

There is **no `move`**. `driftMoves` sizes a move that closes a gap against a target the owner wrote
(DDR-0103); sizing one against the app's own default would be proposing the policy in an arithmetic
disguise. What is stated is the gap.

### Two states were removed, and one became nullable

`no_profile` and `no_targets` are **gone** from `BalanceDriftResult`. They short-circuited before the
portfolio was read, which is exactly the case the baseline exists for: an owner who has written
nothing still has a portfolio with a shape. What they carried is not lost — the profile itself sits
beside the report in the assembled context, so *"they have not set one"* is still sayable, and is now
said from the profile rather than from the absence of a measurement.

`report.balanced` is **`boolean | null`**, `null` where the owner set no targets. This fixes a wart
the schema documented before the story: it could be *vacuously* true, and `true` is the answer a
model would phrase as *"your portfolio is balanced"*. The baseline reports its own verdict
separately, in `withinBaseline`, against its own standard.

`profileSection` is likewise **no longer nullable**. There is always something to say about the
owner's policy, and *"they have not written one"* is the most important of those things — without it
the baseline below is a standard with no owner named, which is exactly how a default becomes a
policy the model attributes to them.

## What is said out loud, and where

The marking is the whole of what ADR-0012 traded for the capability, so it lives in the
**grounding** and not only in the prompt: a rule can be asserted present and can never be asserted
obeyed, and a rule that needs a fact to be obeyable is a gap in the grounding (DDR-0104).

- Every ceiling line names the standard: *"against the app's default 30%"*.
- The block opens by saying these are the app's defaults, that a judgement must say so beside the
  claim, and that they are **not a profile to adopt** — the record's own stated risk, which is an
  answer saying *"consider setting a 10% ceiling"*.
- **Deferred checks are listed**, so an absent verdict cannot read as a clean one (DDR-0101).
- **Currency is named as uncovered**, with the reason: a currency weight is where a position is
  priced, not where a business earns, so a default there would assert an exposure the app cannot see.
- **The sector universe is named as absent.** The app's "sector" is IBKR's `industry` field, and what
  it returns is an open vocabulary — the real database holds `Banks`, `Mining`, `Food`, `Textiles`,
  `Diversified Finan Serv` — so the app cannot know which sector a portfolio is missing. The context
  gives the *count* of names held and forbids naming an absent one. A canonical taxonomy with a
  mapping was rejected on that evidence (ADR-0012, Option D): an unmapped name joins with nothing and
  reads as **0%**, DDR-0094's named failure.
- **Asset class is the one absence the app will name**, because that vocabulary is fixed and the app
  owns it. Only `BOND` and `CASH_ASSET_KEY` are checked: `STK`/`ETF`/`FUND` are alternative wrappers
  for the same exposure so their absence says nothing, and the derivatives are not a diversification
  gap.

Three `SYSTEM_PROMPT_RULES` were **rewritten in place** and the count stays **seventeen** — CLAUDE.md
asks for a sharpened rule rather than an eighteenth. The permission rule now names both standards,
the profile rule now also forbids suggesting a target, and the nothing-to-propose rule points at the
baseline instead of closing the subject. It also stopped naming the *Profile view*, which has not
existed since #310 (DDR-0108).

`DISCLOSURE_CATEGORIES` gains **no category**: the baseline's thresholds are the app's own constants
and the figures against them are weights the `profile` category already declared. Its wording is
updated, which is free now that the consent fingerprint is gone (ADR-0011).

## The prompt budget

Measured, because DDR-0103 makes the **85% gate the binding constraint** and CLAUDE.md asks for a
measurement before either half grows. `promptBudget.test.ts` now measures **two** cases, because the
two halves of this section cannot both be maximal in one reading — a check runs only where the
profile is silent, so every target that lengthens the drift block shortens the baseline block:

| Case | Chars | Of `MAX_PROMPT_CHARS` |
| --- | --- | --- |
| Every target set, so the baseline defers | 33,095 | **82.7%** |
| No profile at all, so the baseline runs | 24,090 | 60.2% |

The binding case rose from **81%** to **82.7%**, leaving about 900 characters under the gate. Two
things paid for it. The prose was written twice: the first draft measured 35,383 (88.5%) and failed,
which is the gate working. And **a baseline that applies to nothing is one sentence, not a section** —
with every check deferred there is no figure to mark, nothing to misapply to currency and no headings
to earn, and that is precisely the fully-targeted case which is also the longest prompt the app
assembles, so the saving lands where the budget binds.

## Alternatives considered

**A baseline that also judges a targeted dimension.** Rejected — it is ADR-0012's Option C, and
contradicting a stated target is proposing the policy.

**A baseline only where there is no profile at all.** Rejected — ADR-0012's Option B. A profile with
currency targets and nothing else is not an owner who decided sectors do not matter, and it is the
shape almost every real profile has.

**A canonical sector taxonomy.** Rejected on evidence from the owner's own database; see above.

**A separate `profile:getBaseline` channel.** Rejected — a second denominator is a second answer.

**Keeping `no_profile` / `no_targets`.** Rejected: they refuse to read the portfolio in exactly the
case the story exists for. They are recoverable from the profile, which is already in the context.

**Sizing a move that closes a baseline gap.** Rejected — see above. The gap is stated; what to do
about it is the owner's.

**A fifth check on currency.** Rejected as a decision rather than an omission, and recorded as one in
`BASELINE_CEILINGS`' own comment so it is not re-proposed as an oversight.

## Related

- [[../decisions/0012-the-app-holds-a-baseline-and-says-whose-standard-it-is]] — the record.
- [[../decisions/0009-ai-assistant-grounding-and-advisory-boundary]] — amended by it; the grounding
  rule and *never acts* are untouched.
- [[0095-drift-is-measured-live-and-a-residual-is-never-absorbed]] — the live reading, the residuals,
  and the untargeted dimension said out loud.
- [[0098-the-assistant-is-grounded-in-text-the-app-wrote]] — the context boundary and what a section
  may carry.
- [[0101-a-summary-names-what-the-app-does-not-compute]] — the rule the uncovered dimensions follow.
- [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]] — `driftMoves` and the
  budget's gate.
- [[0104-phrasing-is-guarded-by-the-prompt-alone]] — why the sector universe's absence is grounding
  rather than a rule.
- [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]] — the profile as the owner's own setting,
  and the 0%-join failure a sector taxonomy would have reopened.
- [[0108-the-profile-is-a-section-of-the-assistant]] — where the prompt now sends an owner who has
  set no profile.
