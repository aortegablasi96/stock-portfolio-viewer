# 0098. The assistant is grounded in text the app wrote

- **Status:** Accepted
- **Date:** 2026-08-28
- **Extends:** [[0097-consent-is-to-a-list-and-the-list-is-the-code]],
  [[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]],
  [[0095-drift-is-measured-live-and-a-residual-is-never-absorbed]],
  [[0043-analytics-view-shell]], [[0058-one-page-header-pattern]],
  [[0027-analytics-views-persist-and-explicit-refresh]], [[0022-gateway-timeout-and-not-responding-state]],
  [[0035-field-and-form-control-primitives]], [[0029-tab-shell-aria-pattern-and-keyboard-navigation]]

## Context

#282 built the gateway; #283 built the gate. Neither can be asked anything. Story #284 is the
surface: the question box, the answer, and the machinery that turns one into the other.

The Epic names one risk above every other, and it is not a bug that would crash anything:

> **The model must not do arithmetic.** Every figure in an answer comes from a service that already
> computed it. This is the single largest correctness risk in the Epic, and grounding is the only
> defence.

A wrong figure in a confident paragraph has no symptom. It does not throw, it does not render
oddly, and the reader has no way to catch it — which is what makes this the one story where the
design *is* the safety argument.

## Decision

### The context is text the app wrote, and it is a pure module

`renderer/src/lib/assistantContext.ts` turns the reports the app already computed into the sections
the disclosure declares. The model is handed those sections and asked to **explain** them. It is
never asked to derive one, and `assistantService`'s system prompt says so in the register the model
reads — but the prompt is the second line of defence. The first is that no un-computed number is in
front of it.

It is pure, and it is in `lib/` for the reason everything in `lib/` is: Vitest runs Node-only with
no jsdom ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), so a string built inside a component is a string nothing can
assert. Here the whole of the grounding is a function from reports to text, and
`assistantContext.test.ts` is the Epic's largest risk written down as assertions.

Four properties are pinned, and each is a way the feature could be quietly wrong:

1. **A section carries no more than its disclosure allows.** `holdings` is declared as names,
   `weights` and `profile` as percentages only, so no amount of money appears in any of the three —
   however useful one would be. The test reads the sections back and fails on a currency symbol or
   a grouped thousands figure. Without it the disclosure ([[0097-consent-is-to-a-list-and-the-list-is-the-code]])
   becomes a lie by convenience, one helpful addition at a time.
2. **Absent is absent, never zero.** A report that could not be read produces **no section**, not
   an empty one: a heading with nothing under it tells the model a thing exists and is blank, which
   is an invitation to fill it in. Its sharpest case is [[0007-portfolio-display-currency-and-live-fx]]'s — an
   unconvertible holding is *unplaced*, reported as a count and a currency, and the text says
   outright that **no percentage exists for it**.
3. **Every figure goes through the app's own formatters.** `formatPercentValue` and
   `formatSignedPercent`, the same functions the dashboards call, so a weight in prose and the same
   weight on a chart agree to the digit. The one deliberate exception is a **date**, written ISO:
   a locale date read back is ambiguous (`03/04` is two dates), and unlike a figure a date is prose
   the model rewrites rather than a number it must quote.
4. **Every section names its store and its clock.** The composition sections read the **imported
   Flex store** and are as of the latest statement; the drift section reads the **live** portfolio
   at a stated minute. An answer that silently mixed the two would be wrong in a way no reader
   could catch.

Two traps are inherited rather than re-derived: `instrumentName` is what names an instrument, so a
description that only repeats the ticker resolves to nothing rather than to `Cad`
([[0066-one-instrument-name-across-the-views]]); and the list is capped at the 40 largest positions,
**stated in the text** — the gateway's own `MAX_PROMPT_CHARS` would otherwise cut the last section
arbitrarily, and a cut the model can read about is one it can answer honestly.

### The context is assembled in the renderer, and that is a decision

The alternative was a service in main. It was rejected on the criterion the story is held to:
*figures in answers are formatted by the app's own formatters, so a number in prose and the same
number on a dashboard agree*. Those formatters are `renderer/src/lib/format.ts`. Assembling in main
would mean a second set of them, and two implementations of "how this app writes a percentage"
is precisely the drift the criterion exists to prevent.

The renderer is not thereby trusted. Three things still hold from main:

- **Consent is checked before anything else** — before the key, before a prompt, before a socket
  ([[0097-consent-is-to-a-list-and-the-list-is-the-code]]).
- **The request schema reduces the context to the disclosed categories.** `pickDisclosedSections`
  drops an unknown key at the boundary, which is the runtime half of the promise
  `AssistantContext`'s key type makes at compile time. A section the owner never read cannot cross
  even if the renderer offered one.
- **The renderer still holds no key and no HTTP client**, and the CSP still admits one external
  origin. `aiGatewayIsolation.test.ts` is untouched by this story, and `assistantGate.test.ts` now
  asserts the same over the two components.

### `assistant:ask` is the app's one outbound channel

It arrives now rather than in #283 because a channel that could send is an un-consented path in all
but name until there is a view asking a question through it.

Its handler is the only one in the app that reaches the internet, and it is where three bounds
meet: the schema (an empty or oversized question, an undisclosed section), the service (consent),
and the gateway (the deadline, the send ceiling, the result union). The gateway returns a result
rather than throwing ([[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]]), so the
only exception that can reach the handler's `catch` is a rejected payload — which is why it maps to
`invalid` rather than `error`.

### The view sits beside `AnalyticsShell`, not inside it

The story left this open and asked for it to be **stated rather than settled by drift**. It is
stated: the Assistant brings its own `<main>` and `PageHeader`, as `ProfileView` does.

The shell's shape is four branches and no state, and holding no state is exactly what keeps
[[0027-analytics-views-persist-and-explicit-refresh]] intact for the four views that use it
([[0043-analytics-view-shell]], [[0058-one-page-header-pattern]]). This page has seven states —
no consent, stale consent, no key, nothing to ground on, thinking, answered, failed — only two of
which are a report arriving, and it holds a conversation. Extending the shell would change it for
four views to serve one, and would have to make it stateful to do so.

`analyticsShell.test.ts` is unaffected: it guards the four analytics views and `App.tsx`, and none
of them re-declares anything. The page header's `source` is `OWNER_SOURCE` — a page whose standard
is the owner's names no data source ([[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]).

### Blocking and missing are different states

Consent and the key **block**. A missing profile and an empty Flex store do **not**: they narrow
what an answer can be grounded in, and a question the remaining sections can answer is still worth
asking. They are named beside the box as notices, so the owner learns what the assistant cannot see
*before* reading an answer shaped by the gap rather than after.

The one case where a gap blocks is when **every** source is absent — nothing imported, no live
reading, no profile. There is then no context at all, and an answer would come from training data
alone, which is the one thing ADR-0009 says an answer must never quietly be.

Nothing here is toned as an error. `too_large` gets its own heading saying **nothing left this
machine**, because presenting it as a refusal would tell the owner OpenAI rejected their portfolio
when in fact it never left ([[0096-the-model-gateway-inherits-a-discipline-and-adds-two-states]],
ADR-0010).

### A second version store: the profile is a write path too

Found by the e2e suite, not by reasoning. The Assistant stays mounted
([[0027-analytics-views-persist-and-explicit-refresh]]), so an owner who sets a profile and walks back to it arrives
at a view still holding the reading it took *before* there was one — and with nothing imported and
no gateway, that reading says there is nothing to ground an answer in while a profile sits on the
next page.

`profileDataVersion` is a second store beside `flexDataVersion`, bumped by the profile's save and
clear. Two stores rather than two bumps of one, because they are not the same fact: a Flex write
replaces the **figures** an answer quotes, a profile write replaces the **standard** they are judged
against, and the four analytics views care about the first alone. Folding them together would send
all four back to the database every time a target was typed.

An answer records the Flex version it was grounded at. One the store has since moved past is
**labelled, not withdrawn** — it was true when it was given — and the label says what to do
about it.

**The grounding is also re-read at the moment of asking**, and *that* reading is what the question
goes with. The mounted reading answers whether the box should be open; it can be minutes old by the
time a question is typed, and its drift half is a live figure nothing signals a change to — which
is why the Portfolio tab is excluded from stay-mounted at all.

### The transcript is the live region

One mechanism for both halves of the accessibility criterion — the wait is perceivable and the
answer is announced as it arrives. The list carries `aria-live="polite"` and is **in the document
from mount**, because a region that arrives together with its first content announces nothing.
Inserting a turn announces the wait; replacing that turn's body announces the answer.

A second, hidden copy of the answer for a screen reader was built and removed: two strings for one
answer is the shape this codebase keeps refusing, and the visible text is the announced text.

The **newest turn is first**. A conversation usually reads downward, but this one lives in a panel
that may have been hidden for minutes and has no scroll position to restore, and the answer to the
question just typed has to be adjacent to the box that typed it.

### `prose` is the fifth control kind

The question box is a `<textarea>`, and it fits [[0035-field-and-form-control-primitives]]'s axis rather than
straining it: a `kind` names the element and the measure its content implies, and a question is
several lines of ordinary writing. It is still the shared `.control` box — same padding, border,
radius, hover and disabled treatment — which is what keeps a textarea from reading as a foreign
control on a page of them. What it adds beyond a measure is `resize: vertical`; a textarea resizes
in both axes by default, and the horizontal one would let a control drag itself past its card.

Figures quoted inside an answer are **prose, not figure slots**: `.assistant-answer` applies no
`--font-figure`, and `figureRole.ts` still finds exactly one rule ([[0053-bundled-typefaces-and-the-figure-role]]).

## Alternatives Considered

- **Assembling the context in a main-process service.** Rejected: it duplicates
  `renderer/src/lib/format.ts`, and the criterion is that prose and dashboard agree to the digit.
  Consent, the disclosure filter and the key all stay in main regardless.
- **Extending `AnalyticsShell` to a seven-branch, stateful shell.** Rejected: it changes the shell
  for four views to serve one, and the statelessness is what keeps DDR-0027 intact.
- **Blocking every question until a profile exists.** Rejected: a profile is the standard for
  *balance*, and "what do I hold" needs none. Named as a notice instead.
- **Letting a question through with no grounding at all.** Rejected: the answer would come from
  training data alone, unmarked.
- **A hidden `sr-only` copy of the answer for the live region.** Built, then removed — two strings
  for one answer.
- **Sending the `performance` section now.** Deferred to #285–#287, which is what those stories
  are. An answer about returns correctly says the figure is not available rather than reaching for
  one.
- **Streaming the answer.** Out of scope by the story: one bounded request, one answer. It would
  need its own IPC shape.
- **Persisting the transcript.** Out of scope: it lives in view state, which stay-mounted keeps for
  the session. A durable transcript is an append-only table and its own decision (ADR-0006).
- **Bumping `flexDataVersion` on a profile write.** Rejected: it would re-read four analytics views
  every time a target was typed.

## Consequences

- **The app now reaches the internet when the owner asks it to.** One channel, one handler, one
  gateway, gated on consent. Everything else still ends on the machine.
- `assistantGate.test.ts`'s "offers no way to ask anything yet" guard is **replaced, not deleted**.
  It would still have passed — the question box went into a sibling component — and a guard that
  keeps passing for a reason that has stopped being true is worse than none. What replaces it is
  that the view *composes* the conversation, plus the standing claim that neither file holds an
  HTTP client or names an OpenAI origin.
- `AssistantContext` now has three of its five sections filled. #285–#287 fill `performance`;
  #288 and #289 are phrasing and prompting over grounding that already exists.
- The five control kinds are `select · date · percent · term · prose`. There is still no size axis.
- `profileDataVersion` exists, and a future view that depends on the profile should subscribe to it
  rather than re-reading on a timer.
- **A stale answer stays on screen, labelled.** The alternative — deleting it on an import — would
  remove something the owner may still be reading, and it was not wrong when it was given.
