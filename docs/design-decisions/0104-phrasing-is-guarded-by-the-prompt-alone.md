# 0104. Phrasing is guarded by the prompt alone, and the seam is stated rather than hidden

- **Status:** Accepted
- **Date:** 2026-08-29
- **Amends:** [[0101-a-summary-names-what-the-app-does-not-compute]] — its consequence "`SYSTEM_PROMPT`
  is twelve rules" no longer holds. It is **seventeen**, and the count is now declared in code and
  asserted. Everything else in `0101` stands.
- **Extends:** [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]],
  [[0102-the-assistant-has-no-period-control]],
  [[0099-a-return-is-not-a-change-in-value]],
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0097-consent-is-to-a-list-and-the-list-is-the-code]],
  [[0095-balance-drift-is-computed-by-a-service]],
  [[0072-a-chart-title-names-the-chart-not-the-window]],
  [[0022-gateway-timeout-and-not-responding-state]]

## Context

Story #287 put the figures in front of the model — every standard period, and the arithmetic that
closes a drift. Story #288 is the other half of that split: it bounds the **sentences built around
those figures**, and it is the first story in this Epic whose entire deliverable is wording.

That makes the guarantee change shape, and the change is worth recording explicitly because it is
easy to mistake for a weaker version of the same thing.

**For a figure there are two lines of defence.** It is computed by a service, and the assembled text
is asserted character by character (`assistantContext.test.ts`, `periodSet.test.ts`,
`driftMoves.test.ts`). A wrong number is a failing test.

**For a sentence there is one.** No test can reach whether the model said a return was annual,
whether it said two periods were rebased, or whether it presented an instrument recalled from
training in the same voice as a position it was handed. A test can assert a rule is **present** in
`SYSTEM_PROMPT`; it cannot assert the rule was obeyed.

The previous story shape hid that seam by giving each question its own tests, some of which were
checking prose all along. Naming it is the point of this record: the boundary is acceptable for
wording and unacceptable for arithmetic, which is precisely why the arithmetic went to #287 and only
the wording is here.

## Decision

### The rules are a declared array, and the count is part of the record

`SYSTEM_PROMPT_RULES` is an exported `readonly string[]`; `SYSTEM_PROMPT` renders it as bullets. It
is **seventeen** rules, up from twelve, and the number is asserted twice — over the array, and over
the bullets that actually reach the model, so a rule appended to the prompt *around* the array is
still visible.

The literal `17` in the test is the mechanism, not decoration. **A long list of rules is a list a
model weights less**, so growing it has to be a decision rather than an edit: a story adding an
eighteenth has to come to that number and choose to change it. The same count is stated in the
module's own doc comment and in `CLAUDE.md`.

### Five rules were added and two sharpened; nothing was duplicated

Where a rule already existed, it was **sharpened rather than restated**. The marking rule is the case
that matters — ADR-0009 names *the unverified marking becoming decoration* as this mitigation's
failure mode, so the rule now says the marking goes **beside each claim and never once at the end**,
and names what "unverified" actually covers: not price-checked, not checked to exist, not checked to
be available at the owner's broker, subject to the knowledge cutoff. The closing brevity rule was
adjusted in the same pass, because "no disclaimers beyond the one above" pointed at a single rule and
there is now more than one caveat these rules require.

The five additions each bound a claim the grounding makes possible and does not itself prevent:

- **A comparison of two periods** carries three obligations in one rule, because they are one act.
  Rebasing is disclosed ([[0072-a-chart-title-names-the-chart-not-the-window]]): every return is
  chain-linked onto its own period's start, so two are never points on one scale. Both periods'
  lengths are stated, so an unequal comparison cannot read as an equal one. And the line between a
  reading and a calculation is drawn where [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]]
  drew it: *which period was larger* is an **ordering**; *by how much* is subtraction, quotable only
  where the row carries the difference the app computed.
- **A period the context does not hold** is answered as unavailable, with the periods that exist
  named. The failure this is against is not a refusal — it is the adjacent row answered as though it
  were the one asked for, a right-looking figure under the wrong heading.
- **A currency weight** is held-and-priced-in, never economic, geographic or revenue exposure. The
  app does not know where a business earns its money.
- **No tax claim**, and a proposal says that trading costs and spreads are outside what the app
  models. Tax is Epic #8.
- **Nothing to propose, and no profile, are answers.** With every band inside its range there is no
  move to make, and manufacturing one to have something to say is the same invention as filling a
  gap. With no profile section in the context at all there is no standard of the owner's, and the
  rule gives the actionable state — set one on the Profile view — rather than an invented standard or
  an error.

### Every rule is obeyable from the context, and one deliberately has no context half

[[0101-a-summary-names-what-the-app-does-not-compute]] set the pattern: name the absence in the
context, then repeat it in the prompt as the second line of defence. Four of the five additions
follow it, and #287 already built their first line — the period set states that it is the only set
and forbids answering about a neighbour, the rows carry rebasing and lengths and the computed
differences, `CURRENCY_EXPOSURE_NOTE` sits beside every currency breakdown, and the drift report says
outright when every target is inside its range.

**The tax and costs rule has no context half, and that is not an oversight.** There is no section to
name the absence in, because tax is not a section of the context — it is a category of claim about
every one of them. Adding a "we do not model tax" line to `performance` or `profile` would attach it
to one heading and leave it unattached to the rest. A rule is the right shape for a claim that ranges
over the whole answer.

### No figure, no report, and no view changed

The story adds nothing to the grounding. If a rule here needed a number to be obeyable, that number
would be a gap in #287's grounding rather than a missing sentence — the division the split was made
along, restated so a later story does not close a grounding gap by writing a rule.

`disclosureFingerprint` does not move: the system prompt is not a disclosure category and carries no
portfolio data, so the owner is not re-asked for consent ([[0097-consent-is-to-a-list-and-the-list-is-the-code]]).

## Consequences

Benefits:

- **The seam is documented rather than discovered.** A future story reading these tests can see that
  a presence assertion is the whole guarantee for wording, and will not mistake it for the guarantee
  the figures get.
- **The rule count cannot drift silently.** Two assertions and three documented statements of `17`.
- **The largest risk in the Epic is addressed where ADR-0009 said it fails.** Marking beside each
  claim, rather than a blanket caveat that stops being read.

Tradeoffs:

- **The prompt nearly doubled**, 2,095 → **4,160** characters, and the worst case the caps allow is
  now **32,537** against `MAX_PROMPT_CHARS`' 40,000. That is inside the ceiling but at **81%** of it,
  where `promptBudget.test.ts` gates at 85% — roughly **1,400 characters of headroom** before the
  gate trips. The gate, not the ceiling, is now the binding constraint, and the next story growing
  either half must measure rather than assume ([[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]]'s
  rule, inherited).
- **Seventeen rules is more than a model weights evenly.** The mitigation is that no rule restates
  another and related rules sit adjacent; there is no mitigation for the count itself beyond refusing
  to grow it casually, which is what the asserted literal is for.
- **A presence test passes on a prompt the model ignores.** Accepted knowingly. It is the only
  assertion available for prose, and the alternative — parsing what the model wrote — was rejected in
  [[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]] and closed #289.

Risks:

- **Rule inflation.** The cheapest response to any future misphrasing is an eighteenth rule, and each
  one dilutes the seventeen. The asserted count makes that a decision; it does not make it a good one
  automatically.
- **A sharpened rule can lose a clause.** The marking rule now carries five specifics in one
  sentence; each is pinned by its own assertion so a rewrite that drops one fails.
- **The tax rule is the widest.** It bounds a claim the app has no data about at all, which is
  exactly the register a model is most fluent in.

## Alternatives Considered

### Add the rules and leave `SYSTEM_PROMPT` a string literal

Rejected. The story asks for the count to be stated so a silent thirteenth is visible, and a literal
gives nothing to count. The array costs one `map` and makes the length assertable from both ends.

### Group the rules under headings to help a model weight seventeen of them

Rejected for this story. It is a real prompt-design idea and it addresses the cost this record names,
but it restructures the whole prompt to solve a problem no observed answer has yet exhibited — and
the restructuring would be untestable in exactly the way this record is about. Adjacency of related
rules is the cheaper half of the same idea and was taken.

### Verify the model's output against the rules before showing it

Rejected, and already closed. #289 wanted this for proposals; parsing free text means asking the
model for a parseable structure, which fights the free-text surface the Epic settled on
([[0103-every-standard-period-and-the-arithmetic-that-closes-a-drift]]). For phrasing there is not
even a computed end state to compare against, so the check would be a second model judging the first.

### Put the tax and costs absence in the context as well as the prompt

Rejected on shape rather than on cost. Every other absence names a thing a section would otherwise
have contained; tax names a claim that ranges over all of them, and attaching it to one heading would
imply the others were exempt.

### Fold nothing-to-propose and no-profile into the existing profile rule

Rejected. "Never propose changes to the profile" is a prohibition; these two are **states**, and
[[0022-gateway-timeout-and-not-responding-state]]'s discipline is that a state gets named with what
the owner does next. Merging them would put an actionable message inside a prohibition.

## References

- `src/services/assistant/assistantService.ts` — `SYSTEM_PROMPT_RULES` and the count
- `src/services/assistant/assistantService.test.ts` — one assertion per rule, and the two counts
- `src/services/assistant/promptBudget.test.ts` — the worst case, re-measured
- `src/renderer/src/lib/assistantContext.ts` / `lib/periodSet.ts` — the first line of defence these
  rules are the second of
- ADR-0009 — the advisory boundary, and the marking whose failure mode it names
- ADR-0010 — the one outbound channel
- Epic #5, Story #288; Story #287 (the grounding these rules are written against); Story #289, closed
  as superseded
