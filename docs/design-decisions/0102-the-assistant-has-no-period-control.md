# 0102. The assistant has no period control; a question carries its own period

- **Status:** Accepted
- **Date:** 2026-08-28
- **Supersedes:** the period-*selection* half of [[0099-a-return-is-not-a-change-in-value]] — its
  `RangeFilter`, the `GroundingReports` / `GroundingInputs` split, and the `empty_period` notice.
  Everything else in `0099` stands unchanged: return and value stay apart under separate headings
  return-first, a statement row is summed whole, an empty period is a state, and no cause is ever
  offered.
- **Extends:** [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0085-ytd-anchors-to-the-data]],
  [[0072-a-chart-title-names-the-chart-not-the-window]],
  [[0022-gateway-timeout-and-not-responding-state]],
  [[0101-a-summary-names-what-the-app-does-not-compute]]

## Context

Story #285 put a `RangeFilter` above the question box, on an argument that read well at the time:
the app has **one** range vocabulary (DDR-0085), a period means the same window in every view, and a
question about "the period" should mean the period a chart would draw.

What that argument missed is that **the box is free text, and free text already carries a period.**
The owner types *how did last year go?* The control, meanwhile, says `Full history`. Two statements
of one fact, in two vocabularies — one typed, one clicked — and the control wins silently, because it
is what `buildAssistantContext` reads. The owner gets an answer about the whole history to a question
about last year, with nothing on screen that looks wrong.

That is the same failure DDR-0098 was built to prevent from the other direction. Its rule is that a
figure in an answer and the same figure on a page are one number; the corollary nobody wrote down is
that **a question and its grounding must be about one period**, and a control beside a text box
cannot guarantee that. The control could only ever be right by coincidence.

The reframing of #287–#289 (Epic #5, after #286 landed) is what forced the decision. Those stories
were rewritten around the owner naming periods **in the question**, which leaves the picker with
nothing to do that the question does not do better.

## Decision

**The Assistant view has no period control.** `RangeFilter` is removed from
`AssistantConversation.tsx`; the three analytics views keep theirs, and `RANGE_OPTIONS` is untouched.

**The grounding is the whole imported history.** `wholeHistory()` replaces `selectedPeriod()` and
resolves `{ range: 'all', custom: null }` against the performance report. `all` here is **not a
default standing in for a missing selection** — it is the only honest window when nothing has been
asked yet, and it is the *identity* case of rebasing that DDR-0072 already argued the curve's
baseline note out of being conditional on.

**`GroundingInputs` collapses back into `GroundingReports`.** DDR-0099 split them because a period
was a *selection* rather than a read, and changing it had to reframe an explanation without
re-issuing four IPC calls. With no selection the split has nothing to hold apart, and the grounding
is once again a function of the reads alone. What replaces the selection is not another input but
**more computation over the same report**: #287's period set is derived from `performance`, with
nothing to pass in.

**The `empty_period` notice goes with the control it was about, and the *state* does not.** The
notice said "the period selected above holds no day of imported history"; there is nothing selected
above. Over the full extent the case is unreachable — `periodChange` returns `null` for an empty
series and `boundsFor('all')` *is* the extent — so no notice can fire. But `periodChange`'s empty
window handling and `performanceSection`'s `days === 0` short-circuit **both stay**, with their
tests: they are that function's contract, not the view's, and #287 windows this report again, where a
quarter with no data in it is exactly that state. `assistantAsk.test.ts` pins the notice's **absence**
rather than deleting the case quietly, so a notice for it comes back deliberately or not at all.

**A question about a period the context does not hold is a state, not an approximation** — DDR-0022
in prose. This is the cost the decision takes on, and #287 pays it: the context will say which
periods it holds, so the model names the alternatives instead of quietly answering about a
neighbouring window. Until #287 lands, the context holds exactly one period and says so.

## Consequences

Benefits:

- **One statement of the period, in the owner's own words.** The question is the whole input; nothing
  beside it can disagree with it.
- **The disclosure does not move.** No category changes, no granularity changes, so
  `disclosureFingerprint` is stable and the owner is not re-asked for consent (DDR-0097). Removing a
  control removes no data from the payload — the section was always the whole report windowed.
- **Two types became one**, and the view lost a hook, a memo dependency, three derived values and a
  conditional render. `AssistantConversation` is now reads, writes and wiring, which is what
  DDR-0098 said it should be.

Tradeoffs:

- **Between this and #287 the assistant can only be grounded in the full history.** A question about
  a shorter window gets a full-history answer, where before it got the window the owner had clicked.
  This is a real, temporary loss of capability, taken knowingly: the picker's answer was only correct
  when the question happened to agree with it, and #287 restores per-period grounding for *every*
  period rather than one.
- **`.assistant-ask > .field`'s child combinator stops being load-bearing.** It scoped the block
  layout away from the `RangeFilter`'s two `DateInput`s; with one field left it scopes nothing new.
  Kept, with the comment corrected, because the rule means "the question itself" — a wrong comment
  is worse than a redundant selector.

Risks:

- **The model may answer about a period it was not given figures for.** This is the failure the
  removal makes possible and #288 is the guard against it — but a prompt rule is a second line of
  defence, and the first is #287's stated list of available periods. Until that lands, the risk is
  live and bounded only by the section naming the period it describes.
- **`PERIOD_LABELS` now has five entries nothing renders.** It stays: it is `periodChange`'s
  vocabulary, a `Record<RangeId, string>` so a new preset is still a compile error, and #287 uses
  every one of them.

## Alternatives Considered

### Keep the control and let the question override it

Rejected. It puts the model in charge of deciding which of two conflicting period statements to
honour, and the one it cannot honour is the *figures* — those are assembled before it sees anything.
The best it could do is notice the conflict and refuse, which is a worse outcome than either input
alone.

### Keep the control, and add the period set beside it

Rejected as the shape that survives longest by pleasing everyone. The picker would keep framing the
detailed section while the question ranges freely over the set, so the two grounding paths would
differ in *precision* as well as period — and the owner would have no way to tell which one an
answer came from.

### Remove the control as part of #287, not before it

Genuinely close, and the reason to prefer it is the temporary capability loss above. Rejected because
it leaves a control on screen whose decision has already been made against it, and because the
removal is what makes #287's design legible: the period set exists *because* nothing selects a
period. Landing them together would also merge a deletion with a feature in one diff.

### Resolve an arbitrary window from the question text

Rejected, and not close. Parsing "March to July" into bounds is either a model producing a figure
(ADR-0009) or a date parser the app would have to own, get wrong at boundaries, and localise. The
precomputed set is the version where every window in play was computed by the same code that draws
the charts.

## References

- `src/renderer/src/components/AssistantConversation.tsx` — the view the control left
- `src/renderer/src/lib/assistantContext.ts` — `wholeHistory`, and the collapsed type
- `src/renderer/src/lib/assistantAsk.ts` — the notice's absence, and why the state survives it
- ADR-0009 — the model never produces a figure
- Epic #5, Stories #287 / #288 — the reshaping that forced this decision
