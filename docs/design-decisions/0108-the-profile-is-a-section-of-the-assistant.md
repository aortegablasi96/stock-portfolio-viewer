# 0108. The investor profile is a section of the Assistant view, and the seventh row goes

- **Status:** Accepted
- **Date:** 2026-08-30
- **Supersedes:** [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]] — *only* its placement
  half (the profile as a sidebar row, and the page box, `<main>`, `<h1>` and `PageHeader` that row
  carried). Everything else in `0094` stands and is restated below: the profile is a **setting**
  stored in one overwritten `app_meta` value, `metaRepository.remove` is not ADR-0006's refused
  delete-by-id, "clear" removes the key so *never written* and *cleared* are one state, the key is
  suggested and never constrained, and `OWNER_SOURCE` names no data source. Half of
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]] — `profileDataVersion` as a module-level
  store. Its reason for existing is gone; what it *did* is still done, one level down.
- **Extends:** [[0106-a-collapsible-primitive-with-a-level-axis]] (this is its first and only call
  site, and it uses both levels), [[0107-the-assistant-view-is-the-chat]] (the surface this folds
  into), [[0027-analytics-views-persist-and-explicit-refresh]], [[0056-sidebar-context-rail]]
- **Story:** #310, under Epic #306 (M11)

## Context

M11 set out to reduce the Assistant to what the owner uses. [[0107-the-assistant-view-is-the-chat]]
took the three decisions off the top of it — the consent gate, the disclosure list, the key
management — and left a conversation. This story is the other half of the Epic's title: **one view,
not two rows**.

The two pages were already the same page twice, and had been built that way for the same reason:

- neither is an `AnalyticsShell` view, because neither answers the four-branch
  `loading | error | needs_import | loaded` guard the shell exists for
  ([[0043-analytics-view-shell]], [[0058-one-page-header-pattern]]);
- both therefore declare their own `<main>` and `<h1>`;
- both carry **`OWNER_SOURCE`** in the page header — the one provenance value that names no data
  source, because the standard on the page is the owner's rather than the app's
  ([[0094-the-profile-is-a-setting-and-a-range-is-a-policy]],
  [[0098-the-assistant-is-grounded-in-text-the-app-wrote]]).

They were adjacent rows six and seven precisely so the list read *five views of the data, then the
surface that talks about it, then the policy the owner sets over it*
([[0097-consent-is-to-a-list-and-the-list-is-the-code]]). Merging them is the conclusion of that
sentence, not a departure from it: the standard and the conversation about the standard are one
subject, and the owner who opens the Assistant to ask whether they are balanced is one keystroke and
one page-load away from the thing that defines "balanced".

The cost of leaving it as it was is small and constant. Two rows, two page headers saying the same
sentence, and a profile that could only be read by leaving the answer that provoked the question.

## Decision

### One view, six rows, and the Assistant is the last

`TABS` loses `profile`. `ProfileView.tsx` becomes **`ProfileSection.tsx`** and renders inside
`AssistantView`, above `AssistantKeyCard` and `AssistantConversation`. `ProfileIcon` goes with the
row — a glyph with no row is a row waiting to be restored, and `profileSection.test.ts` asserts both
absences together.

Nothing about the accelerators changed, and that is the point rather than a happy accident:
`viewShortcutIndex` derives a row's binding from its index and `rotatedTabIndex` wraps over
`TABS.length`, so six rows renumber themselves ([[0083-a-view-accelerator-beside-the-tabs-pattern]],
[[0090-ctrl-tab-rotates-and-the-list-carries-the-hint]]). Both handlers still decline while text is
being entered, which matters more on this page than on any other — it is the one that holds a
textarea the owner types paragraphs into *and*, now, eight more inputs beside it.

**All five profile sections stay.** `balanceDriftService` measures every one of them and
`driftMoves` caps a move by the position-size ceiling, so dropping a table would silently narrow the
drift report rather than simplify the page.

### The profile is a `Collapsible` group holding five `Collapsible` sections

Six surfaces, which is the count [[0106-a-collapsible-primitive-with-a-level-axis]] built the
primitive for. The group is `level="group"` and **closed on arrival**; its five sections keep the
primitive's own default of open, whose stated reason is that a section hiding its content unasked is
lost. They are disclosures, not an accordion: opening one says nothing about its siblings.

Closed means `hidden`, **never unmounted**. That is
[[0027-analytics-views-persist-and-explicit-refresh]]'s decision applied one level down and it is
load-bearing here: the sections hold a form, and folding one away must not discard what has been
typed. The two-piece form state — `stored` from `app_meta`, `form` as typed — is untouched, so a
half-finished profile still survives a trip to Allocation and back, and now also survives being
folded shut.

### Folded, it shows its name and its summary; everything actionable is inside

The head row carries the trigger and, in the primitive's slot beside it, `profileSummary(stored)` —
the same counted sentence the page has shown since #280, in the one place that is still on screen
when the section is shut.

**Discard, Save and the notice that answers them sit inside the panel**, with the form they act on.
This is the corner the story turned on. Put in the head row they would be pressable while the
section was closed — and a `role="status"` live region inside a `hidden` subtree announces nothing,
so the owner would have started a write whose reply they could neither see nor hear. Keeping the
press and its answer in one panel is what makes the announcement honest; the summary changing in the
head row is what reports the result to a reader who then folds it away.

### The five cards lose the ruled header strip, and that follows `0059` rather than breaking it

A `Collapsible` at `section` level replaces `CardHeader`/`CardTitle` inside each card, and the strip
— the negative margin, the re-applied padding and the 1px rule — does not come with it.
[[0059-card-strip-and-table-density]]'s own rule is the argument: `.card-header:last-child` gives
the strip back precisely because *a strip with nothing under it is a rule drawn across the bottom of
a card*. A closed disclosure is that case for as long as it stays shut, and a strip that appeared
and disappeared with the panel would be the card changing shape as a side effect of a visibility
toggle. So the profile's cards are padded surfaces with a head row, which is what
`.card-header:last-child` already produces elsewhere in the app. The two static cards below them —
the key card and the question box — keep their strips, and the difference now marks the difference
in kind.

One rule is added, `.profile-group > .collapsible-panel`, giving the stack of five cards
`.analytics-view`'s own `--space-7` instead of the panel's `--space-5`: the panel default is the
measure between one card's head and its body, and taking it here would tighten the profile alone.

### `profileDataVersion` becomes local state in `AssistantView`

The story asked for this to be **re-examined and its outcome recorded**, and the outcome is that the
store is removed.

It existed for a reason that no longer holds.
[[0098-the-assistant-is-grounded-in-text-the-app-wrote]] created it because the profile was written
on one view and read on another — two siblings of the shell, with nothing between them to hold a
counter — and the Assistant stays mounted, so an owner who set a profile and walked back arrived at
a view still holding the reading it took before there was one. Found by `e2e/assistant-ask.spec.ts`,
not by reasoning.

After this story the writer is a **sibling of the reader inside `AssistantView`**, which is
therefore their common ancestor. A plain `useState` counter there is the same call `App` makes for
every fact the sidebar and a view share ([[0056-sidebar-context-rail]]: "plain `useState` in the
shell rather than a store or a context, because the shell is already the only common ancestor"), and
it takes a global out of the renderer whose only two users are now siblings. `ProfileSection` takes
an `onWritten` callback; `AssistantConversation` takes `profileVersion` as a prop and keeps it in
the same effect dependency list it was in before, beside `flexDataVersion`'s.

**`flexDataVersion` stays exactly as it is.** Nothing about it changed: the Flex store is written on
the Portfolio view and read by four views that are not its descendants. `dataVersion.test.ts` now
asserts the module's *exports* — a store nothing imports is invisible to every other gate in the
toolchain, so the absence has to be stated somewhere.

### What did not change

The allocation channel the three vocabularies are built from, and `needs_import` still not being an
error there. The drift arithmetic, `driftMoves`, the period set, the seventeen prompt rules, and
everything `AssistantContext` may carry. What the profile stores, and which dimensions it targets.
`aiGatewayIsolation.test.ts` and `zodIsolation.test.ts` pass unchanged.

## Consequences

**Benefits**

- One page holds the standard and the conversation about it, so adjusting a target and asking what
  it implies no longer costs a navigation and a re-read.
- A profile saved here reaches the grounding beside it with no restart and no trip through a second
  row — the criterion, now asserted directly in `e2e/assistant-ask.spec.ts` rather than across two
  panels.
- The sidebar is six rows, and the one non-data row is last.
- A module-level store leaves the renderer; the seam it stood for is visible in the component tree.
- The `Collapsible` primitive has its call site, and uses both values of its one axis — which is
  what keeps `level` from being an axis with a single value in use.

**Tradeoffs**

- The profile is one click further away than a sidebar row was, and two for a section that has been
  folded shut. It is a setting the owner states rarely and reads occasionally, which is what the
  collapsed default is a bet on; the head row's summary is what pays that bet back.
- A tall page. Open, the profile is five cards above the key card and the question box. The five
  sections folding independently is the answer, and the group folding is the answer to the answer.
- Two card treatments on one page — disclosures without strips, static cards with them. Deliberate,
  and argued above, but it is a difference a reader can see.
- `e2e/investor-profile.spec.ts` now opens a disclosure before every assertion, because the state is
  uncontrolled and per-mount rather than stored
  ([[0106-a-collapsible-primitive-with-a-level-axis]]).

**Risks**

- A future story adding a sixth profile section will add a sixth disclosure, and six is where the
  APG's landmark caveat starts to bite for a `role="region"` accordion — which is exactly why
  [[0106-a-collapsible-primitive-with-a-level-axis]] left `role="region"` out. Keep it out.
- The head row now carries a summary that grows with the profile. It wraps rather than truncating
  (`.collapsible-head` is `flex-wrap: wrap`), which is right, but a much longer summary would push
  the trigger onto a line of its own.

## Alternatives Considered

### Keep both rows, and cross-link them

Rejected. A link from the Assistant to the Profile is a navigation with a page-load and a lost
transcript position, and it leaves both page headers saying "Set by you" about two different pages.
The Epic's own criterion is *one* view.

### Put the profile behind a settings drawer, a modal or a gear

Rejected, and the story excludes it. [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]]
argued the profile is a page — five sections, a form, an owner-confirmed reset — rather than a
preference, and that argument did not change because the page moved. A modal would also make
"unsaved edits survive collapsing" unexpressible.

### Put Save and Discard in the head row, beside the trigger

Rejected, and this was the close call. It keeps the actions reachable while the profile is folded,
which is friendlier for an owner who typed something and shut the section. But the notice cannot
follow them there without giving the head row four things to hold, and left in the panel it becomes
a live region inside a `hidden` subtree — a write with no audible or visible reply. Keeping the
press with its answer is worth the extra click.

### Put the summary in the trigger's label

Rejected. The label is the trigger's accessible name, and a name that changes every time the profile
is saved is a name that is not one. The primitive's slot beside the trigger is where a fact about
the section goes, and it is the shape `PageHeader` already uses — title left, what is true of the
page right.

### Keep `profileDataVersion` as it is

Weighed seriously, and it is defensible: it works, it is tested, and leaving it costs nothing today.
Rejected because the story asked for the mechanism to be examined rather than left in place
unexamined, and the examination has an answer — a module-level store exists to cross a gap between
components with no common ancestor, and that gap closed. Leaving it would leave a global whose
justification, read a year from now, would be false.

### Unmount a closed section instead of hiding it

Rejected by [[0106-a-collapsible-primitive-with-a-level-axis]] before this story existed, and this
is the call site that proves it: unmounting would discard a half-typed target the moment the owner
folded a section away to read the one below.

## References

- Story #310; Epic #306; ADR-0011; ADR-0009 (the advisory boundary, unchanged)
- [[0094-the-profile-is-a-setting-and-a-range-is-a-policy]] — superseded in its placement half only
- [[0098-the-assistant-is-grounded-in-text-the-app-wrote]] — superseded in its
  `profileDataVersion` half only
- [[0106-a-collapsible-primitive-with-a-level-axis]] — the primitive, and its first call site
- [[0107-the-assistant-view-is-the-chat]] — the surface this folds into
- [[0027-analytics-views-persist-and-explicit-refresh]], [[0056-sidebar-context-rail]],
  [[0059-card-strip-and-table-density]], [[0083-a-view-accelerator-beside-the-tabs-pattern]],
  [[0090-ctrl-tab-rotates-and-the-list-carries-the-hint]]
- `e2e/assistant-ask.spec.ts`, `e2e/investor-profile.spec.ts`,
  `src/renderer/src/lib/profileSection.test.ts`
