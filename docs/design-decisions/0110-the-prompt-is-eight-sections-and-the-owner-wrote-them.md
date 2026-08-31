# DDR-0110 — The prompt is eight sections, and the owner wrote them

- **Status:** Accepted
- **Date:** 2026-08-31
- **Supersedes in part:** [[0104-phrasing-is-guarded-by-the-prompt-alone]] — its *shape* half only

## What was decided

`SYSTEM_PROMPT` stops being seventeen flat bullets and becomes **eight `##` sections**, written by
the owner. DDR-0104's guarantees survive; its list survives only as a mechanism, re-pointed at
sections.

### DDR-0104 rejected exactly this, and the owner reversed it

That record's own words, under *Alternatives considered*:

> Rejected: grouping the rules under headings (real, but it restructures the prompt to fix a problem
> no answer has yet shown, and untestably).

Both halves of that objection are answered rather than ignored, and only one of them by argument.

**"A problem no answer has yet shown"** was true when written and is not the test any more: the
owner drafted this prompt themselves and prefers it. Register and structure are theirs to choose —
the same authority that reversed the analytics-only guardrail in ADR-0009 and the consent gate in
ADR-0011. Nothing in this repository makes flatness a correctness property.

**"Untestably"** was the objection worth taking seriously, and it is answered by construction rather
than accepted as a cost. See below.

### The mechanism outlives the shape

DDR-0104's point was never that the list was flat. It was that the literal is **declared**, so its
length is assertable, *because growing the prompt must be a decision rather than an edit*. A ninth
section is the same failure an eighteenth rule was.

So the prompt is a declared array of `{ heading, body }` and **not** one long template string, which
is the form that would have made the objection true — prose in a single backtick literal can grow by
a paragraph in a diff nobody counts. Three assertions carry it:

- `SYSTEM_PROMPT_SECTIONS` has **8** entries, `SECTION_HEADINGS` has **8**, and the rendered prompt
  contains exactly **8** lines starting `## `. All three, because a section appended around the
  array would otherwise be invisible — the same reason DDR-0104 counted both the array and the
  bullets.
- The declared headings and the rendered headings are **equal, in order**.
- Every declared section reaches the prompt *verbatim*, heading and body together.

`SECTION_HEADINGS` is a second literal rather than a `map` over the sections on purpose: a list
derived from the thing it is checking asserts nothing. It is the same reason DDR-0104 counted the
bullets rather than trusting the array.

### What the tests pin, and what they cannot

Unchanged from DDR-0104, and worth restating because this record rewrote every assertion: **a test
asserts a passage is present and can never assert the model obeyed it.** For phrasing there is no
first line of defence. That is acceptable for wording and unacceptable for arithmetic, which is why
the arithmetic is #287's and only the wording is here.

The assertions were re-pointed at *the guarantees the records make*, not at the owner's sentences:
ADR-0009's grounding rule and advisory boundary, ADR-0012's two standards and its refusal to invent
a third, DDR-0101's three named absences, DDR-0013's return-is-not-value, DDR-0072's rebasing,
DDR-0108's *Assistant profile section*. The prose is the owner's and may be rewritten again; a
rewrite that dropped one of those guarantees has to fail a test.

## Two things the rewrite changed that the owner should know

Both were reported. The first was answered by a follow-up the owner asked for; the second is
recorded as accepted rather than missed.

### Forecasting comes back narrower than the rule it replaces

The owner's draft dropped *"Never forecast. What changed, not what will."* and nothing in the eight
sections replaced it. On being asked *"why would I deny it?"* the omission turned out to be the
better instinct, and the rule that returned is **not** the one that left.

**Half of it was never open.** *Numerical integrity* forbids the model to `estimate` a figure, and
an estimated future figure is an estimate — so a **numeric** forecast was blocked by the owner's own
draft. What was open is the **qualitative** claim: *"well-positioned for the year ahead"* carries no
number, so nothing caught it.

That half is worth closing, and for a reason peculiar to it. A forecast is the one claim the
**marking discipline cannot reach**: an unheld instrument is labelled as repeated from training
data, a baseline judgement is labelled as the app's own standard, and a forecast has *no source to
name*. It is also where ADR-0009's knowingly-accepted *owner over-trust* risk is largest, because a
retrospective figure is checkable against the app's own views and a forecast is not checkable until
it is too late.

**But "Never forecast" was too broad**, and that is the owner's point. It forbids the model to
invent a forecast *and* forbids it to phrase one the app computed — and a projection is buildable
here: *"if your trailing dividend yield holds, income over the next 12 months is €X"* is
deterministic arithmetic a service can do, with a stated assumption, needing no amendment to
ADR-0009. A blanket rule would foreclose the version actually worth trusting.

So the line added to *Evidence and causality* is:

> Do not state what will happen. Where the application supplies a projection, phrase it and name the
> assumption it rests on; never produce one of your own.

Which is the shape of every other rule here — the model phrases what a service derived — rather than
a prohibition on a subject.

### Three absolute prohibitions became conditional

| Old | New |
| --- | --- |
| *"Never say why … You have no news, no fundamentals and no market data"* | *"…unless the available data supports the explanation"* |
| *"Never state a volatility, standard deviation, Sharpe ratio…"* | *"…unless explicitly supplied by the application or a tool"* |
| *"Never compare to a benchmark… This app holds none"* | *"…unless comparison data is explicitly available"* |

The old forms carried **the reason** — *you have no news*, *this app holds none* — and the reason is
what makes a rule obeyable without a check. The new forms ask the model to judge whether the data
"supports" it, and a model reading its own context generously is the failure mode.

**The grounding is what saves this**, and it is DDR-0101's doing: the performance section states
*"WHAT THIS APP DOES NOT COMPUTE"* before any figure, naming the annualised figure, the benchmark
and the risk statistic; the baseline block names the uncovered currency and the absent sector
universe (DDR-0109). So the absence the prompt stopped asserting is still asserted, one layer down,
where DDR-0104 says it belongs — *a rule that needs a fact to be obeyable is a gap in the grounding*.
The conditionals are safe **because** the context is explicit, which makes the two now coupled: a
later story that trims the absence blocks would silently unbind three prohibitions.

The same prompt names **market-data tools** as a source of truth. There are none — ADR-0009 gives
the model no tools and no data access, and the app holds no market data by design (Epic #7 is not
built). The clause is conditional (*"when available"*), so it degrades to nothing today. It is
recorded here because it describes a capability the app does not have, and a reader of the prompt
alone would conclude otherwise.

## The cost, measured

The prompt got **shorter**, which was not the aim and is worth recording so nobody spends it twice:

| | Before | Sections | Plus the forecasting line |
| --- | --- | --- | --- |
| `SYSTEM_PROMPT` | 4,454 chars | 4,071 | **4,226** |
| Worst case, every target set | 33,095 (82.7%) | 32,708 (81.8%) | **32,863 (82.2%)** |
| Worst case, no profile | 24,090 (60.2%) | 23,707 (59.3%) | 23,862 (59.7%) |

DDR-0103's **85% gate** remains the binding constraint, with roughly 1,100 characters of headroom —
still more than the 900 the rewrite started from, because the sections are more compact than the
seventeen bullets even after a rule was added back.

## Alternatives considered

**Keep the flat seventeen and re-word them.** The conservative option, and it keeps DDR-0104 whole.
Rejected: the owner wrote sections, and the shape is theirs to choose.

**One template string.** Simplest to read against the owner's draft, and it makes DDR-0104's
"untestably" objection come true — the length stops being assertable and a paragraph can arrive in a
diff nobody counts. Rejected.

**Derive `SECTION_HEADINGS` from `SYSTEM_PROMPT_SECTIONS`.** Removes a duplicated literal. Rejected:
a list derived from the thing it checks asserts nothing, which is DDR-0104's own reason for counting
the bullets as well as the array.

**Restore the forecasting rule inside the rewrite itself.** Rejected as out of scope — the owner
supplied a complete replacement, and adding a prohibition to it unasked would be editing their draft
rather than applying it. Raised instead, and added as a follow-up on the owner's instruction, in the
narrower form above.

**Restore the old "Never forecast" verbatim.** Rejected once the question was put properly: it
forbids the model to invent a forecast *and* forbids it to phrase a projection the app computed,
foreclosing a feature ADR-0009 already permits.

**Re-point the tests at the owner's sentences.** Rejected: the assertions would then guard the
wording rather than the guarantee, and every future rewrite would fail them for no reason. They pin
what the records require.

## Related

- [[0104-phrasing-is-guarded-by-the-prompt-alone]] — superseded in its *shape* half only. Its seam
  (a test asserts presence, never obedience), its declared-literal mechanism, and the reason tax has
  no context half all stand.
- [[../decisions/0009-ai-assistant-grounding-and-advisory-boundary]] — the grounding rule and the
  advisory boundary the sections restate. Unchanged.
- [[../decisions/0012-the-app-holds-a-baseline-and-says-whose-standard-it-is]] — the two standards
  the *Portfolio standards* section names, and the refusal to invent a third.
- [[0101-a-summary-names-what-the-app-does-not-compute]] — the absence blocks the conditional
  prohibitions now lean on.
- [[0109-the-baseline-fills-a-silence-and-never-contradicts-a-target]] — the baseline's own
  absences, and the 85% gate this re-measures.
- [[0108-the-profile-is-a-section-of-the-assistant]] — why the prompt says *Assistant profile
  section* and not *Profile view*.
