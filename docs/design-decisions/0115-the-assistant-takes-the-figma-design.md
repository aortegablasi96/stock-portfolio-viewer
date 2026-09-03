# 0115. The Assistant takes the Figma design, and what that amends

- **Status:** Accepted
- **Date:** 2026-09-03
- **Amends:** [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]],
  [[0102-the-assistant-has-no-period-control]],
  [[0044-motion-scale-and-reduced-motion]],
  [[0113-the-conversation-remembers-itself-and-the-models-prose-stays-the-models]],
  [[0037-badge-primitive-variants-and-sizes]]
- **Extends:** [[0107-the-assistant-view-is-the-chat]],
  [[0108-the-profile-is-a-section-of-the-assistant]],
  [[0057-sidebar-collapse-and-the-frameless-corner]],
  [[0068-sidebar-toggle-beside-the-app-name]],
  [[0031-design-token-scales]],
  [[0042-token-adoption-ratchet]]

## Context

Story #342 of Epic #341, and the whole of it. **There is no code in this story.** The Figma file
under `docs/figma_design/` has been redrawn, and its `AssistantView` (`src/App.tsx:1786-2474`,
`2483` for the shell's scroll rule) is the design this app adopts. Six decisions already on the
record currently say one thing and will shortly say another, and the four build stories behind this
one (#343–#348) would each have to argue the same amendment again, in a component comment, where
nobody looking up `0037` or `0094` would find it.

#307 blocked M11 and #323 blocked M13 for the same reason. This is the cheap version: the
amendments are known before the first component moves, so writing them once costs less than
discovering them six times.

**The design is chosen.** This record does not weigh it against alternatives, ask whether a recorded
rule should have held, or reopen anything the owner settled by picking the file. What it does is say
**what each amendment amends and in what respect**, so that the record it touches stays readable
beside it rather than being contradicted in silence.

### Adopting a design means adopting its shape, not its stylesheet

`docs/figma_design/` is gitignored, is Tailwind over inline styles, and carries CSS variables this
app does not have (`--accent-bright`, `--surface-2`, `--positive-dim`, `--negative-dim`,
`--text-dim`). It also carries its own `CLAUDE.md`/`AGENTS.md`, which **replace** the root one for
work inside it.

What is adopted is the **design** — the two columns, the rail, the bubbles, the pinned composer, the
chip row, the pill tags, the empty states, the wording. What is not adopted is a second token
system. This is ADR-0008's reading of shadcn applied to a Figma file: take the shape and the API,
never the package. `lib/tokenAdoption.ts`'s `BASELINE` is **empty and stays empty**
([[0042-token-adoption-ratchet]]).

## Decision

### 0. This Epic is presentation only, and that is stated rather than inferred

**ADR-0009, ADR-0010, ADR-0011 and ADR-0012 are untouched.** Nothing here changes what is sent, what
may be computed, what the model may say, or whose standard a claim is measured against. Twelve
tools, the bounded loop, the absences, the baseline and the grounding rule are exactly as M13 left
them.

Concretely: no story in Epic #341 edits `services/assistant/`, `repositories/assistant/aiGateway.ts`,
the tool registry, `BASE_CONTEXT`, `SYSTEM_PROMPT_SECTIONS`, `lib/assistantContext.ts` or
`assistantMarkdown`'s parser. `promptBudget.test.ts`, `aiGatewayIsolation.test.ts` and
`zodIsolation.test.ts` pass **unchanged** — not "amended and passing". A story that finds itself
editing one of those files has left the Epic, and the honest move is to stop and say so rather than
to widen the story.

This is worth a section of its own because the view being redrawn is the one view where a
presentation change *can* reach the wire: the transcript is both what the owner reads and what
`rememberedTurns` selects from (decision 7).

### 1. The Assistant has no page header, and `OWNER_SOURCE` is deleted

The design opens on an `AI ASSISTANT` eyebrow over `<h2>Investor Profile` in the left column
(`App.tsx:1877-1917`) and `<h2>Ask about your portfolio` in the right (`App.tsx:2137-2142`). There
is no `PageHeader` anywhere in it.

`OWNER_SOURCE` (`'Set by you'`, `lib/pageHeader.ts:31`) is [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]'s
third `source` value, the one naming no data source because there isn't one, and
`AssistantView.tsx:78` is its only call site. With the header gone it is dead, so it is **deleted**
rather than left behind as a constant nothing renders: `pageHeader.test.ts`'s three assertions on it
go, and `e2e/page-header.spec.ts:57`'s Assistant row goes with them, leaving that spec covering the
five views that still have a header.

`0094`'s claim — *the header slot is where a page says whether its standard is the owner's or the
app's* — is **amended with an exception, and the exception says it better.** The eyebrow, the column
title and the intro paragraph (*"Your own policy for how this portfolio should be invested. Nothing
here is required — state only what you have a view on."*) say in full sentences what three words in
a provenance slot could only gesture at. The rule still holds for the five data views, which do have
a source to name.

The view keeps an `<h1>` for the document outline — it declares its own `<main>` and heading and has
no `AnalyticsShell` to wear ([[0107-the-assistant-view-is-the-chat]]) — and the design's eyebrow is
the natural host for it.

### 2. Two collapsing edges, and both affordances ship

The profile column collapses to a **48px rail** carrying an expand button and a profile-completeness
dot (`App.tsx:1850-1875`), beside the nav's own **56px** rail
([[0057-sidebar-collapse-and-the-frameless-corner]]). The design *also* draws an **Edit profile**
chip in the chat header while the column is collapsed (`App.tsx:2214-2239`). **Both ship.** The rail
is the reversible gesture at the edge; the chip is the labelled one where the owner is already
looking.

[[0068-sidebar-toggle-beside-the-app-name]]'s *never widen the nav column* is **untouched**: this is
a second column with a second meaning, and `--sidebar-width` remains an input to both Performance
breakpoints. The two rail widths are **separate constants and may not be unified** — 48 and 56 are
different numbers for different reasons (one holds a 32px expander and a dot, the other holds an
icon tile and a status dot), and a shared `--rail-width` would make either one impossible to tune
without moving the other and the grid behind it.

Two collapsing edges is the cost, stated plainly: at the narrowest window an owner can end up with
two rails and a chat, which is three vertical rules in about 104px of chrome. That is the design's
call and it is taken, not softened.

### 3. The gateway's state is said twice, and `groundingNotices` folds into those two

A chip in the chat header (`IBKR offline`, `App.tsx:2145-2161`) and a line with an info icon
directly above the composer (`IBKR gateway is offline — live portfolio drift is not included in
answers`, `App.tsx:2371-2386`). The chip is the **state**; the line is the **consequence**. Today's
`assistant-notices` `<ul>` (`AssistantConversation.tsx:238`, from `groundingNotices`) is a *third*
wording of the same facts, and it **folds into those two surfaces** rather than becoming a third
voice under a redesigned box.

[[0102-the-assistant-has-no-period-control]]'s *one fact, one vocabulary* is **narrowed to what it
was actually about**: a **control** competing with free text — a period picker silently answering a
question the typed sentence had already answered differently. Nothing in that argument reaches a
status line that restates a chip in the same voice and cannot disagree with it, because both read
the same report. The narrowing is recorded here so the next reader does not cite `0102` against a
design it never contemplated.

Record the source too, because the two readings of *is the gateway answering* can legitimately
differ and both are correct. The sidebar's badge is **derived from the last
`portfolio:getOverview`** ([[0056-sidebar-context-rail]]) and this view never makes that call; the
Assistant's reading comes from the **drift report**, the one `profile:*` channel carrying gateway
states ([[0095-drift-is-measured-live-and-a-residual-is-never-absorbed]]). A rail saying
`Last seen 14:32` beside a chat header saying `IBKR offline` is not a bug — it is two clocks, and
#346 must not "fix" it by making one read the other.

### 4. The waiting dots animate, and take the motion budget's documented exit

Three 6px dots, `pulse 1.2s ease-in-out` staggered by `0.2s` (`App.tsx:2316-2328`, keyframes at
`2466-2471`), inside an assistant-shaped bubble, replacing the words *Asking the assistant…*.

[[0044-motion-scale-and-reduced-motion]]'s budget is two durations and two easings, and 1.2s is
neither, so this takes the **one documented way out: a raw duration, declared at the call site with
its reason.** A third token is refused — `--duration-slow` would be a scale step existing for one
keyframe, and the next thing off the scale would take it as a precedent rather than as the exception
it is.

The consequence is the part that is not obvious, and it is why this needed recording before the
build: `0044`'s `prefers-reduced-motion` block **zeroes the tokens** rather than listing what moves,
which is exactly what makes it cover later additions — and a raw duration is *outside* that
mechanism. So the dots need an **explicit** reduced-motion rule, or they freeze mid-pulse at
whatever opacity the keyframe last left them, which is worse than not animating: a permanently
half-faded dot reads as a rendering fault. The same applies to the transcript's smooth scroll
(`App.tsx:1827`). The block must still sit **directly under `:root`** — `designTokens.test.ts` fails
if it moves — so the explicit rule joins it there rather than travelling with the component.

### 5. Clear chat is a plain button

The design's header carries a bare **Clear chat** button, disabled when there is nothing to clear,
tinting to the negative tone on hover (`App.tsx:2185-2212`).
[[0113-the-conversation-remembers-itself-and-the-models-prose-stays-the-models]] decision 7 put a
`ConfirmAction` on it, under the label *New conversation*. **The design wins**, and the label
becomes the design's.

Why this is a UI decision and not a data one: **nothing stored is touched.** ADR-0006 governs
history in the database and the transcript is session state — there is no row to delete and no
`clearAll()` behind it. `ConfirmAction` ([[0012-in-place-destructive-confirm]]) remains the app's
pattern **everywhere it guards stored data**, and *Clear the profile* keeps it in #347, which is the
line between the two: one clears an overwritten `app_meta` value, the other clears a React array.

What it costs, recorded rather than glossed: the owner's record of what they asked is gone in one
click, with no undo and no confirmation. The design's own guard is the **disabled state** — the
button cannot be pressed when there is nothing to lose — and that is the whole of the protection
now. `NEW_CONVERSATION_CONFIRM_LABEL`, `NEW_CONVERSATION_BUSY_LABEL` and
`NEW_CONVERSATION_WARNING` go with the confirm; the warning's second half (*the assistant will stop
remembering them*) is a real fact losing its only home, and #346 decides whether the button's
`title` carries it.

### 6. A pill corner marks a small standalone control

The design uses a **20px radius** for the header chips (`App.tsx:2150-2151`), the profile's style
tags (`1975-1977`) and the suggestion chips (`2343-2344`) alike.
[[0037-badge-primitive-variants-and-sizes]] says a `Badge` is **never a pill** because
[[0036-toggle-group-mode-axis-and-pressed-semantics]] spent that corner on *pressable, and takes any
number of choices*.

The design puts all three on one corner, and one of the three — the style tags — genuinely **is**
multi-select. So the meaning is **amended rather than contradicted**: the pill corner marks **a
small standalone control**, and multi-selection is carried by `aria-pressed` and the checkmark
(`App.tsx:1987`), which is where a screen reader was always reading it from. `0036`'s
`mode` axis keeps its two values and `ToggleGroup` stays **never a tablist**; what it loses is the
claim that the corner alone tells the two apart.

How it is built is left to #346 and #347 — either a new value on `Badge`'s existing axes or a
distinct presentational element — under one constraint recorded now: whichever it is,
`badgeVariants.test.ts` still fails the **same three ways** (a superseded selector reappears, an
axis value has no rule in `app.css`, the primitive re-declares something the shared rules own).

### 7. What the transcript draws, and what may never reach the model

The design draws `YOU · 5:31 PM` / `ASSISTANT · 5:31 PM` above every bubble (`App.tsx:2266-2279`).
That is **new state on `Turn`**, and it is new state the model must never see.

`rememberedTurns` sends a question and an answer under a role and **nothing else**
([[0113-the-conversation-remembers-itself-and-the-models-prose-stays-the-models]]). A time drawn in
a bubble is a **render concern in exactly the way [[0114-an-answer-is-formatted-and-the-parser-is-the-app-s-own]]
made formatting one**: the raw string is what the next turn carries, and the app's rendering of it
is the app's. The time is formatted through `@shared/format` at **`APP_LOCALE`, never the host's** —
two processes resolve `undefined` differently, in silence — and `@shared/format` has **no time
formatter today**, so #344 adds one there rather than reaching for `toLocaleTimeString` at the call
site. At `en-GB` that draws **`17:31`**, not the `5:31 PM` the design's demo literals show; the
design's own `sendMessage` already formats `en-GB` two-digit (`App.tsx:1808`), so the literals are
the stale half and the app follows the code.

And the trap the ordering flip walks into, which is the reason this section exists. Turns are held
**newest-first** and `rememberedTurns` walks the array **backwards** to emit oldest-first, then
`trimHistory` drops whole turns **from the oldest end**. The design renders **oldest-first**. If
#344 gets that by reversing the *stored* array rather than the *rendered* one, the loop inverts in
silence: the model reads the conversation backwards and the trim discards the **newest** turns —
three turns of memory that are all wrong, with nothing on screen looking wrong and no test failing
unless one is written for it. The rule: **the array's order is the wire's; the transcript's order is
the transcript's.**

### 8. The design's measurements are the specification

420px, 48px, 44px, 82%, the 20px pill radius and the 2px bubble corner are **not rounded to
`--space-*`**. Each lands as a token or a **named, tested layout constant**, the way
`--donut-column-width` and `GRID_CONTENT_BREAKPOINT_PX` already do; [[0031-design-token-scales]]'s
scale is what a value joins when it *is* a scale step, not a grid every measurement must snap to.
`lib/tokenAdoption.ts`'s `BASELINE` stays **empty** and `EXEMPTIONS` gains **no entry** — the
exemption list is for values `0031` puts off the scale permanently (chart label sizes, sub-6px
radii), not for a design's own dimensions, which are tokens with names.

### 9. The counted guards the build stories inherit

Named here so #343–#348 **meet** them rather than discover them one failing test at a time:

- **`--surface-raised` has exactly three adopters and `sidebarRail.test.ts` counts them**
  ([[0069-boxed-gateway-chip-and-the-raised-surface]], [[0070-hover-card-restyle-and-the-series-ink-ramp]]).
  Every ink measured on that surface is an ink one of those three renders. A fourth — a chip row, a
  bubble, a rail — owes its own pairings, and the count in the test moves with it.
- **`lib/contrast.ts` enumerates pairings by hand.** Every new one the design introduces is added
  and measured **on the ground it actually renders on**: white on `--accent` for the owner's bubble,
  each chip on its own fill, every tone inside a bubble on the bubble
  ([[0046-contrast-split-tone-tokens]], [[0064-toned-badges-and-the-income-key]]). A tint mixed into
  a surface is a measured number, never eyeballed.
- **`--font-figure` is applied by exactly one rule** and `lib/figureRole.ts` **throws** rather than
  merging if a second appears ([[0053-bundled-typefaces-and-the-figure-role]]). `.assistant-answer
  code` is already its thirteenth selector; a bubble does not get a second family rule.
- **No focus rule is written.** The zero-specificity `:where(...)` base ringed every control in this
  app before it existed, and it rings the icon buttons, the pill chips and the rail's expander too.
- **The transcript is the `aria-live` region itself, present from mount**, and a new turn and its
  answer are still two announcements. Moving the list into a scrolling column does not move the
  region ([[0107-the-assistant-view-is-the-chat]]).

### 10. One sentence of the design is wrong, and is corrected

The chat subtitle reads *"Portfolio data + your investor profile are included with every question"*
(`App.tsx:2140`). That was true when the file was drawn and stopped being true at **#327**: the
assembled context is **empty** and the model fetches what it needs through tools
([[0111-the-model-asks-and-the-app-answers-in-computed-reports]]).

The **slot, the register and the placement are the design's**; the sentence is corrected in #346.
This is the one place the design is not followed to the letter, and it is recorded as a correction
of fact rather than as a preference, so that nobody reconciles the app back to the Figma text later.

## Consequences

Benefits:

- Six rules that are about to change say so on the record, each beside the record it amends, before
  any component moves. The next reader of `0037` or `0094` finds an amendment, not a drift.
- #343–#348 inherit the counted guards, the measurement rule and the ordering trap as constraints
  they were told about, rather than as build failures they discover.
- The line the Epic does not cross is written in as many words, which is what makes "this story is
  editing `assistantContext.ts`" a recognisable mistake rather than a judgement call.

Tradeoffs:

- Six records now need reading in pairs. Each amendment names its record and its respect, but
  `0037`, `0044`, `0094`, `0102` and `0113` are all now partly historical, and this file is where
  the current reading lives.
- The Assistant becomes the app's exception on four counts at once — no page header, two rails, an
  unconfirmed destructive control, a raw duration. Each is argued, and the accumulation is real: it
  is the one view whose rules have to be looked up rather than assumed.

Risks:

- **A record-first story can be wrong about the build.** These six were read off the design, not off
  working code; if #343–#348 find a seventh, it belongs here as an amendment to this file, not in a
  component comment — which is the failure this story exists to prevent, and would be it recurring.
- **Decision 7 is the one with teeth.** Every other amendment is visible on screen if it is got
  wrong. An inverted history is invisible, and the only thing standing in front of it is a test #344
  has to be told to write.

## Alternatives Considered

### Amending each record in its own file

Rejected on the same ground `0068` was not written into `0057`. This app's rule is that a decision
that changes gets a **new record referencing the old**, never a silent edit — six edits across five
files would leave the reasons distributed and the design's own argument nowhere.

### Recording each amendment inside its build story's DDR

The default, and it is what #342 exists to avoid. Six amendments arriving in four DDRs written
weeks apart means each is argued from its own story's vantage point, and the two that no build story
naturally owns — the presentation-only line and the timestamp rule — belong to all of them and would
land in none.

### One ADR instead

Rejected: nothing here reverses an architectural decision. ADR-0009 through ADR-0012 are confirmed
untouched, which is the opposite of an amendment, and the six are UI decisions in the ordinary
sense.

### Deferring the record until the build finds the conflicts

Rejected on #307's and #323's precedent, and on decision 7: the ordering trap is not a conflict a
build story trips over — it is one it ships.

## References

- Story #342, Epic #341
- `docs/figma_design/src/App.tsx:1786-2474` (`AssistantView`), `1667-1697` (tags, demo transcript,
  suggested prompts), `1699-1784` (the section shape), `2483` (the shell's scroll rule). The
  directory is **gitignored** and carries its own `CLAUDE.md`/`AGENTS.md`.
- ADR-0008 (adopt the shape, never the package — the reading applied here to a Figma file),
  ADR-0009, ADR-0010, ADR-0011, ADR-0012 (all untouched), ADR-0006 (what a confirm guards)
- [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]] (amendment 1),
  [[0057-sidebar-collapse-and-the-frameless-corner]], [[0068-sidebar-toggle-beside-the-app-name]]
  (amendment 2), [[0056-sidebar-context-rail]],
  [[0095-drift-is-measured-live-and-a-residual-is-never-absorbed]],
  [[0102-the-assistant-has-no-period-control]] (amendment 3),
  [[0044-motion-scale-and-reduced-motion]] (amendment 4),
  [[0012-in-place-destructive-confirm]],
  [[0113-the-conversation-remembers-itself-and-the-models-prose-stays-the-models]] (amendments 5
  and 7), [[0036-toggle-group-mode-axis-and-pressed-semantics]],
  [[0037-badge-primitive-variants-and-sizes]] (amendment 6)
- [[0107-the-assistant-view-is-the-chat]], [[0108-the-profile-is-a-section-of-the-assistant]],
  [[0114-an-answer-is-formatted-and-the-parser-is-the-app-s-own]],
  [[0111-the-model-asks-and-the-app-answers-in-computed-reports]],
  [[0031-design-token-scales]], [[0042-token-adoption-ratchet]],
  [[0046-contrast-split-tone-tokens]], [[0053-bundled-typefaces-and-the-figure-role]],
  [[0064-toned-badges-and-the-income-key]], [[0069-boxed-gateway-chip-and-the-raised-surface]],
  [[0070-hover-card-restyle-and-the-series-ink-ramp]], [[0027-analytics-views-persist-and-explicit-refresh]],
  [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the constraints the build stories
  inherit
- #307, #323 — the precedent for a record-first story
- #309, #310, #319, #321, #327 — how this view arrived at its current shape
