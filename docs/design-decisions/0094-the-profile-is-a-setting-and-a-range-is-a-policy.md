# 0094. The profile is a setting, and a range is a policy

- **Status:** Accepted
- **Date:** 2026-08-27
- **Amends:** [[0035-field-and-form-control-primitives]], [[0028-window-state-persistence]]
- **Extends:** [[0029-tab-shell-aria-pattern-and-keyboard-navigation]],
  [[0055-vertical-sidebar-tablist]], [[0058-one-page-header-pattern]],
  [[0083-a-view-accelerator-beside-the-tabs-pattern]], [[0012-in-place-destructive-confirm]]

## Context

Story #280 is Epic #5's foundation, and it comes first for a reason the Epic states plainly:
**"is my portfolio balanced?" has no honest answer without it.** Balance is not a property of a
portfolio, it is a relation between a portfolio and an intent. With no stated intent the assistant
would either invent a standard — which is the app deciding the owner's allocation, the one thing
ADR-0009 does *not* license — or answer in prose that cannot be checked.

Everything downstream inherits its authority from that: the drift report (#281) measures distance
from a standard the owner set, and the rebalancing proposal (#289) proposes moves back toward it.
So the decisions here are not form design. They are what makes the rest of the Epic honest.

Four questions had to be settled, and the story named the first as its hardest.

## Decision

### It is a single overwritten `app_meta` value, not a table

Three shapes were available and two are wrong for reasons worth writing down rather than
inferring.

A **mutable table** would claim [[0009-sector-classification-cache-and-allocation-donuts]]'s
exception, and that exception is narrower than "mutable": `instrument_classifications` is a *cache
of derived reference data*, upserted by conid, re-derivable from IBKR at any time, and losing it
costs a refresh. A profile is neither derived nor a cache — it is the only thing in this database
the app cannot reconstruct from any source, because its source is the owner. Filing it beside a
cache would say the opposite of what it is.

**Versioned rows** would satisfy ADR-0006 literally by making the profile append-only, and would
be the honest shape if anyone wanted to read a past profile. Nobody does: the Epic puts profile
history explicitly out of scope. It would be an append-only store whose every read discards all
but the newest row — an overwrite with extra steps and a growing table.

**ADR-0006 is not being argued around, because it does not reach here.** Its subject is *history*:
the snapshots and `flex_*` tables record things that happened, and a delete rewrites the past. The
profile records nothing that happened. It is a **setting** — the same class of fact as the window's
own bounds and the sidebar's collapsed state, both of which are single overwritten `app_meta`
values for exactly this reason ([[0028-window-state-persistence]]). It is a bigger value than
either, and that is a difference of size, not of kind.

Two consequences. `metaRepository` gains a `remove(key)`, which is **not** the delete-by-id variant
ADR-0006 refuses — un-setting a current value is the same class of act as re-writing it, and
`app_meta` holds nothing else. And "Clear" removes the key rather than storing an empty profile,
so **"never written" and "written and then cleared" are the same state**; storing a cleared profile
would leave an `updatedAt` claiming the owner had said something.

The stored JSON is **parsed, never trusted**, the rule `sidebarStateService` already follows: the
value is a hand-editable row in a local database and can predate a change to this shape. The case
that matters most is a percentage edited by hand past the boundary's guard — reading it back would
defeat the boundary, so an unparseable value is treated as absent. A corrupt value costs the owner
their profile, not their launch.

### Every target is a range, the position ceiling included

A point target is drifted from the moment the market moves; a range is a policy. All four targets
are therefore `{ low, high }` in percent, and that includes the single-position **ceiling** — which
Epic #5 names as a ceiling and which is modelled as a band anyway, so that four targets share one
shape, one validator and one control. `high` is the ceiling; `low` is the smallest position worth
holding, which an owner who cares only about the ceiling leaves at 0.

Three rules follow, and each is an *asymmetry* that a naive form would get backwards:

- **A blank is not a zero.** "No policy on cash" and "a policy of no cash" are different
  statements, and only one of them was made. `parsePercent('')` is `null`, and a partial profile
  is stored partial — nothing is required to sum to 100 and the app never fills a blank with a
  default of its own choosing.
- **A blank *row* is not a fault.** An empty row is the form's own affordance for "add one", and
  complaining about it the moment it appears would fault the owner for clicking the button. It is
  dropped at save rather than reported.
- **A degenerate range is valid.** `50–50` is a point the owner chose to state, which is different
  from a point the app imposed.

Validation is written **twice, deliberately**: Zod at the IPC ingress rejects the document
(ADR-0002), and `lib/investorProfile` reports the fault under the row it belongs to. Neither can
be the other — the renderer cannot import Zod (the contract is types-only in that bundle), and a
sentence about the document is not what tells an owner which of eight rows to look at. A rejected
save is `invalid`, not `error`: a range typed backwards is a correctable statement about the form,
not a failure of the app ([[0022-gateway-timeout-and-not-responding-state]]).

### The vocabularies are suggested, never enforced

A sector target only means something against the names the classification domain produces
([[0009-sector-classification-cache-and-allocation-donuts]]), so the app offers those. But the
story's other half pulls the opposite way: **a target naming a category the portfolio does not
currently hold is preserved rather than dropped or read as zero**, because an owner may state a
policy for an exposure they intend to take before they take it.

A `<select>` was the first shape and it could express neither half of that. It cannot name an
unheld currency at all, and on a fresh install — which holds nothing — it can name *nothing*, so
the form would ship unable to state a single target. The control is therefore a **`<datalist>`**
(`TermInput`): the known terms drop down, an unheld one is offered with "not currently held"
written beside it, and anything can still be typed. `availableTerms` withholds a term another row
claims, which makes a duplicate hard to reach through the control; `rowMessage` still reports one,
because only the validator is a guarantee.

The source is the **existing** `analytics:getAllocation` channel rather than one of the profile's
own: its three breakdowns are precisely the three vocabularies, already grouped and labelled, and
a second channel computing the same thing would be a second answer that could disagree. It follows
that `needs_import` is not an error here — it is a portfolio the app has never seen — so the report
is read where it exists and is `null` where it does not.

One term is filtered from the *suggestions* only: the allocation report's `Unclassified` sector
slice. "I intend 10% of my portfolio to be instruments IBKR has not told me the sector of" is not a
policy. It is preserved like any other unheld key if one somehow reaches a stored profile.

### It is the sixth sidebar row, and the first that is not a data view

The story left the surface open and named three candidates. The profile is a **page** — five
sections, a form, an owner-confirmed reset — not a preference behind a gear, and the sidebar is
already a complete, tested, accessible way to reach a page
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]], [[0055-vertical-sidebar-tablist]]). A
title-bar affordance would need an overlay, a focus trap and a dismissal rule the app has
deliberately never built ([[0012-in-place-destructive-confirm]]); a panel inside the Assistant view
would put the standard *inside* the thing that measures against it, and that view does not exist
yet (#284).

It takes the **last** row so the five data views stay contiguous, and it needed **no change to
either accelerator**: `viewShortcutIndex` has always covered digits 1–9 and derives a row's binding
from its index, and `rotatedTabIndex` wraps over `TABS.length`
([[0083-a-view-accelerator-beside-the-tabs-pattern]], [[0090-ctrl-tab-rotates-and-the-list-carries-the-hint]]).
It **stays mounted** like the four analytics views, which is what lets a half-finished profile
survive a trip to Allocation and back ([[0027-analytics-views-persist-and-explicit-refresh]]);
Portfolio is still the one exception, because it reads live data.

It is **not** an `AnalyticsShell` view and declares its own `<main>` and `<h1>`. The shell exists
for the four-branch `loading | error | needs_import | loaded` guard ([[0043-analytics-view-shell]]),
and this page answers none of it — its content is a form the owner can fill in with nothing
imported at all. What it *does* share is the one page header
([[0058-one-page-header-pattern]]), whose provenance slot carries a third sentence:
**`OWNER_SOURCE`, "Set by you"** — the first that names no data source, because this page has none.
Saying so where the other five say where their figures came from is the point rather than a
formality: it is where the page states which of "a standard the owner set" and "a standard the app
invented" it is holding (ADR-0009).

Its glyph is a **target with a band around its centre**. `TabIcons`' standing rule is that a glyph
names what its view *draws*, and the sixth row is the first where that rule had a wrong answer
ready — a gear or a person would say "settings" and "user", and this page is neither.

### Two control kinds, not a size axis

`Field` + `Select` + `DateInput` ([[0035-field-and-form-control-primitives]]) gains `PercentInput`
and `TermInput`, as two new `kind` values rather than a size axis. DDR-0035's reason for refusing a
size scale still holds — every control here is the same dense box — and what actually differs is
the measure the *content* implies: a percentage is at most five characters and is set to exactly
that, so a column of them lines up; a vocabulary term takes whatever the row can spare.

`PercentInput` is `type="text"` with `inputMode="decimal"`, **not `type="number"`**, and the
reasons are the form's rather than a preference. A number input silently changes its value on a
scroll wheel passing over it, which on a page of eight of them is a way to alter a policy without
noticing; it reports a value it does not like as the empty string, so `12,5` typed on a keyboard
whose decimal key is a comma vanishes rather than parses — and `parsePercent` accepts that comma
deliberately, because the owner's locale is not the app's; and its spinner is chrome `.control` has
no rule for.

Both `Field` and `TermInput` generate their ids with `useId()`, which is load-bearing rather than
tidy: the Profile tab stays mounted, so every row's label *and* every row's suggestion list are in
the document at once, and a fixed id would point every one of them at the first row's.

## Alternatives Considered

- **A mutable `investor_profile` table**, or versioned rows. Both above.
- **A `<select>` for the target key.** Rejected: it can express neither an anticipated exposure nor
  any target at all on a fresh install. This was built first and replaced.
- **A bare number for the position ceiling.** Coherent, and rejected for uniformity: four targets
  sharing one shape share one validator, one control and one drift calculation in #281.
- **Free-text keys with no suggestions.** Rejected: it invites `Techonolgy`, a policy that will
  never match anything and will never say why.
- **A settings surface reached from the title bar.** Rejected: a new overlay pattern, a focus trap
  and a dismissal rule, for a page the existing tablist already reaches.
- **Enforcing that targets sum to 100.** Rejected outright by the story, and rightly: a partial
  profile is valid, and a profile carrying only currency targets must still answer currency
  questions.
- **`type="number"` for the percentages.** Above.

## Consequences

- `app_meta` holds a second application setting beside the window's geometry and the sidebar's
  width. `metaRepository.remove` exists and has exactly one caller.
- The sidebar has six rows. `Ctrl`/`Cmd`+`6` reaches Profile with no code change, and five e2e
  specs that enumerated the views were extended rather than rewritten — the pattern derives from
  the list, which is what made that a list edit.
- **Nothing about the profile reaches the model.** It is stored and shown; who reads it is #282's
  and #283's concern, and `profileView.test.ts` fails on a network call of any kind from either
  Profile component.
