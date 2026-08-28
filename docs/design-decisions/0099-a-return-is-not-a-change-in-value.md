# 0099. A return is not a change in value, and a period is not the clock

- **Status:** Accepted
- **Date:** 2026-08-28
- **Extends:** [[0098-the-assistant-is-grounded-in-text-the-app-wrote]],
  [[0097-consent-is-to-a-list-and-the-list-is-the-code]],
  [[0013-performance-twr-curve-and-chart-hover]], [[0049-daily-return-bars-thin-rather-than-aggregate]],
  [[0052-composition-cumulative-and-chart-readability]],
  [[0085-ytd-anchors-to-the-data]], [[0022-gateway-timeout-and-not-responding-state]],
  [[0050-daily-nav-from-equity-summary]]

## Context

Story #284 built the surface and grounded it in three sections — what the owner holds, how it is
divided, and how far that sits from their profile. All three are *as-of* facts. Story #285 is the
first question about **change**, and change is where this app's own arithmetic is most easily
misread.

The performance curve is **cumulative time-weighted return** ([[0013-performance-twr-curve-and-chart-hover]]),
deliberately unmoved by deposits and withdrawals. So the two sentences an owner is most likely to
utter —

> my portfolio went up
> my portfolio returned

— are different sentences, and the app's curve only answers the second. A portfolio can be worth
20% more and have returned 2%. An explanation that conflates them is wrong in the direction an
owner is least likely to check, **because it flatters**: told that a 24% rise was performance, no
one goes looking for the deposit that caused it.

Two further hazards arrive with the same story. A period selected in words has no anchor, and this
app's range vocabulary anchors every preset to `extent.to` rather than to the clock
([[0085-ytd-anchors-to-the-data]]) — a history that stops last year still has a "1Y".
And the model, asked *what changed*, will reach for *why* it changed, in a register that sounds
authoritative and out of training data with a cutoff.

## Decision

### The return and the value change are two fields, two headings, and one stated order

`renderer/src/lib/periodChange.ts` computes the period. It keeps `twr` and `changeAbs` /
`changePct` in **separate fields with separate names**, and `assistantContext.performanceSection`
puts them under **separate headings that say which is which**, in a fixed order:

```
RETURN over this period (a return, not a change in value):
VALUE over this period (a change in value, not a return):
FLOWS AND INCOME … (these move value; none of them moves the return above)
```

The order is the argument. A reader — or a model — who meets the value change first reaches for
performance to explain it, and by the time the deposit appears the sentence is already written.
Return, then value, then what moved the value and not the return, is the explanation in the order
that makes it hard to get wrong. Each block also *says so in words*, because units do not: `+2.00%`
and `+24.50%` look like the same kind of number.

`SYSTEM_PROMPT` carries the same rule as a second line of defence, pinned by
`assistantService.test.ts`. The prompt is second, not first: the first defence is that the model
is never handed one figure it could mistake for the other.

### Nothing is computed here that the app does not already compute

`periodChange` re-uses `boundsFor` (the window), `windowStats` and `valueAt` (the endpoints and the
chain-linked TWR), `dailyReturns` (the per-day steps) and `sliceComposition` (the bands). Not one
of them is re-derived. A second implementation would be free to disagree with the chart the owner
is looking at, and the whole claim of grounding is that a figure in an answer and the same figure
on a page are **one number**.

The `performance` section is therefore the one section that carries money, which is what
[[0097-consent-is-to-a-list-and-the-list-is-the-code]] declared it as — and the category's detail
text was **re-worded** to be true of what actually goes in it: the figures are in the base currency
of the imported statements, not in the display currency the wording named, and they include the
portfolio's own value. The fingerprint moves and the owner is asked again. That is the mechanism
working, not a slip in it: a disclosure that named the wrong currency for the one category carrying
amounts would be a lie about exactly the fact the panel exists to state.

### A statement period is summed whole, never pro-rated

Flows, income and costs live on `NavPeriod` rows that are **statement-scoped**, and a window can
cut one in half. Splitting one would mean inventing a number — there is no pro-rated deposit in any
report this app holds — so every row that *overlaps* the window is summed whole, and `PeriodFlows`
reports the span those rows really cover plus a `partial` flag. The section then says, in the text:

> These statement periods are not cut to the chosen period: they run 2026-06-01 to 2026-06-30,
> which extends beyond it.

A total under a slightly wrong heading is the shape of error this Epic exists to prevent; a total
under an honest one costs a sentence.

### Realised and unrealised P&L are a finding, not a computation

The FIFO summaries give realised and unrealised profit and loss as **whole-history rollups**
(realised summed across statements, unrealised as-of the latest — the trap `CLAUDE.md` records).
There is no windowed figure for either, and Story #285 explicitly says a missing figure is a
finding to record rather than a computation to add. So both are placed under their own heading —
`WHOLE IMPORTED HISTORY, not the period above` — with a line telling the model to say it is not
available if asked for either over the period. Left under the period's heading they would read as
the period's own.

**The finding, recorded:** a per-period realised-P&L figure would need the FIFO summaries scoped by
statement end date the way `fromLatestStatement` scopes unrealised. That is a service change and a
story of its own, not a line in an explanation.

### An empty period is a state, not a flat one

`valueAt` is a carry-forward read: a custom window landing entirely outside the imported history
would return the first point at both ends and describe a **calm, flat, 0% period that never
happened** — a description of nothing, phrased as a description of something. So `PeriodChange`
carries `days`, the count of *real* points inside the window, and zero short-circuits the section
to one sentence that names the state and forbids the flattering reading:

> No day in the imported history falls inside this period, so there is nothing to report about it.
> Say the period is empty; do not describe it as flat or unchanged.

The view says it too, as a `groundingNotice` beside the box — only where a history exists to be
windowed, because with nothing imported the `no_import` notice already names the same absence and
its recovery ([[0022-gateway-timeout-and-not-responding-state]]).

### The period is a selection, not a read

The Assistant carries the **same `RangeFilter`** the three analytics views carry, over the same
vocabulary. A preset means one window everywhere or the vocabulary is not one
([[0085-ytd-anchors-to-the-data]]), and a period the assistant explains has to be the
period a chart would draw.

Because it is a selection over reports already in hand, `GroundingReports` (the four IPC reads) and
`GroundingInputs` (those, plus the period) are **held apart** and joined only when a context is
built. Clicking a preset reframes what the assistant would be told without re-issuing four IPC
calls, one of which waits on the IBKR gateway's bounded deadline.

The control appears **only where there is a history to window**. A period selector over nothing is
a control that can be neither right nor wrong, and the notice below already says why there is
nothing.

### The context states what changed and never why

The story's main guardrail. The app holds no news, no fundamentals and no market data beyond the
portfolio's own history, so a cause is never something it can offer — and "energy fell because of
the OPEC decision" is invented in a register that sounds authoritative.

It is held in two places. `SYSTEM_PROMPT` forbids it outright ("Never say why the market, a sector
or an instrument moved… where the cause is not in the context below, say the change happened and
that its cause is not something this app can see"), and `assistantContext.test.ts` fails if the
assembled section itself contains *because*, *due to* or *driven by* — the model must not be handed
a cause to repeat, either.

## Consequences

- **Consent is asked again on the next launch.** The `performance` category's detail text changed,
  so `disclosureFingerprint` changed. Deliberate, and the reason the fingerprint exists.
- **`GroundingInputs` gained a field that is not a report.** Anything constructing one now supplies
  a `PeriodSelection`; `GroundingReports` is the shape the IPC reads still return.
- **The prompt grew.** The performance section is the longest of the four, and the whole context is
  still an order of magnitude under `MAX_PROMPT_CHARS` (24,000). A story that adds a fifth section
  should re-measure rather than assume.
- **`.assistant-ask .field` became `.assistant-ask > .field`.** That rule stacks a `Field` because
  the question is the app's first *prose* control ([[0098-the-assistant-is-grounded-in-text-the-app-wrote]]);
  the `RangeFilter` brings two `DateInput` fields of its own, and those are compact boxes that must
  look like the ones on the three analytics views. The child combinator is now load-bearing —
  widening it back stretches two date pickers across the card.
- **`PERIOD_LABELS` is a `Record<RangeId, string>`**, so a seventh preset is a compile error here as
  well as in `boundsFor`. Its test asserts the labels are the control's own titles: a period the
  owner can pick and the assistant cannot name would be two vocabularies again.
- **Daily returns keep [[0049-daily-return-bars-thin-rather-than-aggregate]]'s rule**: computed from
  the **unwindowed** curve, so the window's first day measures against the trading day that really
  preceded it rather than against the synthetic point `sliceSeries` anchors at the edge.
- **Composition is sliced, never carried forward** ([[0052-composition-cumulative-and-chart-readability]]).
  A window holding one day has both ends on that day and the section says so; one holding none —
  the optional NAV-in-base section was never exported ([[0050-daily-nav-from-equity-summary]])
  — reports the absence rather than drawing a shape out of nothing.
