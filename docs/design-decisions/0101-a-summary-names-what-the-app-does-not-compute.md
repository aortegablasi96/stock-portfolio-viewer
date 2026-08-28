# 0101. A summary names what the app does not compute, before it names a figure

- **Status:** Accepted
- **Date:** 2026-08-28
- **Extends:** [[0099-a-return-is-not-a-change-in-value]],
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0097-consent-is-to-a-list-and-the-list-is-the-code]],
  [[0013-performance-twr-curve-and-chart-hover]],
  [[0049-daily-return-bars-thin-rather-than-aggregate]], [[0085-ytd-anchors-to-the-data]]

## Context

Story #285 built the section that explains a chosen period. Story #286 asks the same material to
survive being **summarised**, and that is a different failure surface: a summary is compression,
and compression is where a model reaches for the conventional phrasing of finance regardless of
whether the underlying history supports it.

The material is unchanged and sufficient — cumulative TWR ([[0013-performance-twr-curve-and-chart-hover]]),
the daily return series chain-linked from it ([[0049-daily-return-bars-thin-rather-than-aggregate]]),
realised gains, dividends, composition. The story adds no report and no figure. What it adds is a
bound, and the bound is needed for three claims that are **specific enough to test for**:

**An annualised return.** Two months of history scaled to a year is a number with no meaning, and
it is the most common way a summary becomes misleading. The general rule — *never calculate* —
already forbids it, and would not have stopped it: annualising is the one derivation a model does
not experience as a derivation. "Roughly 30% a year" reads as a *restatement* of "+5% over two
months", in the same register as the figure it replaces.

**A benchmark.** The app has none. Benchmark comparison is Epic #7, a different data source in a
different milestone. "Which outperformed the market" is invented wholesale, and invented in the
register that sounds most authoritative — the same hazard [[0099-a-return-is-not-a-change-in-value]]
recorded for a *cause*.

**A risk statistic.** No volatility, standard deviation, Sharpe ratio, beta or drawdown figure is
computed anywhere in this app. Dispersion nonetheless *can* be described honestly, from the daily
return counts and the two extremes that are already in the section — so the rule is not "say
nothing about the ride" but "say only that", and the two are one sentence apart.

## Decision

### Absence is stated in the context, not left to the prompt

The three refusals are a block inside the `performance` section, assembled by
`assistantContext.uncomputedBlock`. This is [[0098-the-assistant-is-grounded-in-text-the-app-wrote]]'s
rule applied to a thing that does not exist: *absent is absent, never zero*, and a gap the model
finds is a gap the model fills. A heading with nothing under it invites an invention; a section
that never mentions a benchmark is a section with a benchmark-shaped hole in it.

`SYSTEM_PROMPT` carries the same three rules, and is the **second** line of defence exactly as it
is for the return/value split. The first is that the context says what does not exist.

### The block goes second, ahead of every figure

[[0099-a-return-is-not-a-change-in-value]] decided that **the order is the argument**: a reader who
meets the value change first reaches for performance to explain it, and by the time the deposit
appears the sentence is written. The same argument reaches further than the pair it was made for. A
model that has already read `+2.00%` over six days has, by the time it meets a caveat, largely
phrased the summary the caveat was meant to prevent.

So the section now runs: the period and its anchor · **what this app does not compute** · RETURN ·
VALUE · FLOWS · DAILY RETURNS · COMPOSITION · WHOLE IMPORTED HISTORY. Pinned by a test asserting the
block precedes `RETURN over this period`.

### The honest fact replaces the scaled one

`periodChange` gains `PeriodSpan`: how many **calendar days** the chosen window covers, how many the
whole history covers, and whether the window is itself a year or longer. This is the fact a summary
states *instead of* annualising — "over these 47 days" rather than "roughly 30% a year".

Calendar days, not trading days, and both ends included. `PeriodChange.days` already counts the
trading days with data in it, and the two answer different questions: *how much of this did we
observe* and *how long was it*. A summary asks the second, and a one-day window is one day long
rather than zero.

`coversAYear` (at `ANNUALISATION_MIN_DAYS`, 365) is **not a licence to annualise** — the app
computes no annualised figure at any length, so producing one is always arithmetic. It selects
between two sentences that are exclusive:

> This period is shorter than a year, so never describe a return over it as annual, annualised,
> yearly or per year. State the period instead.

> This period covers a year or more, so a return over it may be given as the return over this
> period — still never scaled, compounded or annualised to any other period.

The second exists because naming a year-long period *as a year* is not a scaling, and a rule that
forbade the word outright would have the model refuse a true sentence.

### Dispersion is bounded to what is in front of the model

The risk line does not say "describe no risk". It says which two facts are the only description of
dispersion this app has — the daily-return counts and the best and worst day — and that any other
risk figure is not available. The test asserts **both halves**: the refusal, and that the facts it
points at are actually in the section. A bound that licenses a description of nothing is worse than
no bound.

### The empty period keeps all three refusals

[[0099-a-return-is-not-a-change-in-value]] short-circuits a window holding no day to one sentence.
The block is emitted **above** that short-circuit and therefore survives it, deliberately: an empty
window is where an ungrounded comparison has the most room, since there is no figure to anchor a
sentence and "roughly in line with the market" costs nothing to write.

### The disclosure does not move, and that is a decision

Story #285 re-worded the `performance` category and paid a re-consent for it, which
[[0097-consent-is-to-a-list-and-the-list-is-the-code]] calls the mechanism working. This story sends
**no new class of data**: two calendar-day counts derived from period bounds already in the section,
and otherwise statements of absence. `disclosureFingerprint` is therefore untouched and the owner is
not asked again. Sending *less* than the disclosure names is what it permits; sending a fact about a
period whose dates are already disclosed is not a new category.

## Consequences

- **The prompt's headroom is now stated rather than assumed.** Measured at the 40-position cap with
  a fully populated profile and drift report, the four sections come to **~13,000 characters**
  against `MAX_PROMPT_CHARS`' 24,000 — `performance` is ~3,300 of it, having grown ~1,100 here.
  [[0099-a-return-is-not-a-change-in-value]] said the context was "an order of magnitude under" the
  ceiling; at the cap it is under **twice**. A story adding a section must measure, not assume, and
  the ceiling is the gateway's `too_large` — nothing is sent, so the failure is loud rather than
  truncated.
- **`PeriodChange` gained a field, and `periodSpan` is exported.** Anything constructing a
  `PeriodChange` by hand supplies a `span`; the real constructor computes it.
- **`SYSTEM_PROMPT` is twelve rules, three of them special cases of the first.** That redundancy is
  paid on purpose — none of the three *feels* like a calculation, which is why the general rule did
  not cover them in practice.
- **`ANNUALISATION_MIN_DAYS` is 365 and takes no account of leap years.** A 366-day year would make
  one window in four read as "shorter than a year" one day before it is not. The cost is one
  sentence being slightly more conservative than it had to be, on the safe side of the only error
  that matters here.
- **No view changed.** The story is entirely in the assembled context and the prompt; the surface,
  the range control and the notices are #284's and #285's, unaltered.

## Alternatives considered

**Compute a dispersion statistic so the summary has one.** Rejected. `lib/dailyReturns` gives the
series a standard deviation could be taken from, but no page shows one, and
[[0098-the-assistant-is-grounded-in-text-the-app-wrote]]'s claim is that a figure in an answer and
the same figure on a page are **one number**. A statistic that exists only inside the assistant's
context is a figure the owner cannot check — the shape of the problem grounding exists to solve. If
dispersion is worth quoting it is worth charting, and that is a story.

**Let the prompt carry the three rules alone.** Rejected, and it is the cheaper option. The
prompt is where every one of these rules is *repeated*; none of them is only there. A model that
never reads the word "benchmark" in its context is meaningfully less likely to produce one than one
told not to, and the context is the half a test can assert against the text that is actually sent.

**Scope the annualisation rule to the history rather than the period.** Rejected as the primary
bound. The overclaim is committed about *the period being described*, and the window is capped by
the history anyway (`boundsFor` clamps to `extent`), so the period is the tighter of the two tests.
Both spans are reported, so a summary can still say the history is shorter than the window a preset
names.
