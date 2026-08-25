# 0090. `Ctrl`+`Tab` rotates through the views, and the list carries the hint

- **Status:** Accepted

- **Date:** 2026-08-25

## Context

[[0083-a-view-accelerator-beside-the-tabs-pattern]] answered *"take me to Trades"*: `Ctrl`/`Cmd` and
a view's own digit, from anywhere. It did not answer *"show me the next one"*, which is a different
gesture. It needs no destination in mind, it is the one a reader reaches for while comparing two
views against each other over time, and it is the one that costs nothing to learn — there is no
mapping from row to digit to recall, only a direction.

The wrapping arithmetic already existed and was already tested: `nextTabIndex` wraps down from the
last view to the first and up from the first to the last
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]). What did not exist was a way to ask for
that movement from outside the tablist, which is the same gap `0083` opened the digits for.

**The feasibility premise was probed rather than assumed.** In a browser `Ctrl`+`Tab` is chrome and
never reaches the page. An Electron `BrowserWindow` has no tab strip, `src/main/index.ts` binds
nothing to it, and a probe against the built app confirmed all three things this needed: both
combinations arrive in the renderer, `preventDefault()` suppresses the focus move, and plain `Tab`
still moves focus afterwards.

That probe also found the thing this record most has to state, and it is not about the key.

## Decision

### `Ctrl`+`Tab` is the next view, `Ctrl`+`Shift`+`Tab` the previous, both wrapping

Sidebar order, top to bottom — the order the rows are read in and the order the arrows already move
in. It joins the existing `window` listener in `App.tsx` rather than main's `before-input-event`,
for `0083`'s reason: main-side would carry a keystroke the renderer already receives back across a
channel bought for nothing.

### The separation between the two handlers changes what it rests on

`0083` recorded that the tablist's handler and the accelerator never negotiate **because they read
different properties of the event**: the tablist reads `key`, the accelerator reads `code`. For a
digit those differ — `'1'` against `'Digit1'` — and the separation is incidental, a property of the
keys rather than a decision.

**For `Tab`, `event.key` and `event.code` are the same string.** So that argument is gone, and what
keeps the two handlers apart is now `nextTabIndex` **explicitly declining `'Tab'`** — which
`tabKeyboard.test.ts` has asserted since Story #111, with the note that *Tab must stay the browser's,
or the roving `tabindex` would have nothing to hand off to*. That assertion stops being a formality
and becomes the guarantee. It is annotated as such where it lives, and cross-asserted from the
rotation's side, the way `0083` asserted its own from both.

This is the honest form of the change: the property choice is no longer doing the work, and saying
so is cheaper than engineering a separation that was never the real one.

### The rotation reads `key`, not `code`

Deliberately the opposite of the digits, and for the reason that made `code` right there. `code` is
the *physical position*, which is what a reader told "Ctrl and the row's number" actually strikes —
on AZERTY the unshifted top row is `&`, `é`, `"`, `'`, `(`, so a digit read off `key` would not
exist on that keyboard. `Tab` prints no character. There is no layout that renames it, and `code`
would instead insist on the physical key rather than on the reader's Tab.

### `Ctrl` on every platform, and no `Meta` variant

`Cmd`+`Tab` is the macOS application switcher. It never reaches the window, and announcing
`Meta+Tab` in `aria-keyshortcuts` would name a binding the app cannot honour. So this diverges from
the digits, which take either modifier, and `ROTATION_KEYS` lists `Control` twice rather than
`Control` and `Meta`.

### `Shift` is the direction, not a disqualifier

`viewShortcutIndex` rejects any keystroke carrying `Shift` — deliberately, to keep `Ctrl`+`Shift`+1
free rather than let it become a second name for `Ctrl`+1. A reverse rotation needs the opposite
rule, so it cannot reuse that predicate: `rotatedTabIndex` is its own function in its own module,
beside `viewShortcut.ts` rather than inside it.

### One implementation of "next/previous, wrapping"

`stepIndex(current, delta, count)` moves out of `tabKeyboard.ts`'s private `wrap` into its exported
surface; `nextTabIndex` calls it for `ArrowDown`/`ArrowUp` and the rotation calls it directly. The
rotation deliberately does **not** go through `nextTabIndex` by passing `'ArrowDown'`: that would
name a key it does not use and would break the moment the tablist changed its own. A test asserts
the two agree at every index rather than trusting the refactor.

### `preventDefault` matters more here than it does for a digit

For `Ctrl`+1 it is tidiness — nothing else was going to happen. For `Ctrl`+`Tab` the default *is* a
focus move, so without it the rotation would select a view and simultaneously throw focus at
whatever came next in the document, fighting the roving `tabindex` it depends on. Both predicates
therefore answer into one variable and one `preventDefault`, which is also what keeps a single
landing spot: `selectAndFocus` on the destination row, for `0083`'s requirement — the panel focus
was standing in is about to be `hidden`, and a `hidden` ancestor blurs its contents to `<body>`.

The listener now reads the selected view, so its effect depends on `tab` and is re-seated on every
switch. That is one `removeEventListener` and one `addEventListener` per view change, and it is
preferred to a ref mirroring `tab`, which buys nothing and can go stale.

### Two bindings are not a shortcut table

`0083` flagged exactly this arrival: *"A later story adding a second global binding will be tempted
to put it beside this listener rather than to ask whether the app now wants a shortcut table. One
binding is not a table, and this record is not a licence for the fifth."* The question was asked and
answered: two is not a table either. A registry mapping combinations to actions would be
indirection over two entries, and both of these are the *same* question — which view does this
keystroke name — asked of two predicates. The listener asks them in turn. The fifth binding is still
where the table starts.

### The disclosure hangs on the list, because the binding has no row

This is the part `0083`'s mechanism could not extend to. A digit has a destination, so its tooltip
hangs on that destination's row. **A rotation has no destination and therefore no row.** So it hangs
one level up, on the element that stands for the views collectively: the "Views" label
([[0075-sidebar-nav-rhythm-and-the-boxed-currency]]) takes
`title="Ctrl+Tab next view, Ctrl+Shift+Tab previous"`.

That gives the app a rule rather than a patch: **a binding is disclosed at the scope of what it
acts on** — a row for a row, the list for the list. A third binding over the list would join this
tooltip; a binding over something else would hang on that.

It cannot become a second name for the tablist, and the reason is the same one that keeps a row's
tooltip off its name: the label is `aria-labelledby`'s target and contributes its **content**, and a
`title` is consulted only where there is no content to take a name from. The tablist is still named
"Views", asserted in Playwright rather than reasoned about.

`aria-keyshortcuts="Control+Tab Control+Shift+Tab"` goes on the **tablist**, not on any row — that
is the element the rotation acts upon, and the rows keep their own attribute for the digit that
reaches each of them.

**Nothing is drawn.** `0083` built a digit per row, saw it in the running app and withdrew it on the
owner's call, because the primary navigation should not carry permanent weight for something a
reader learns once. That call applies unchanged to a rotation hint, which would be a whole line of
prose rather than a glyph. `app.css` is untouched: no rule, no token, no contrast pairing, no
`tokenAdoption` entry.

### The rotation does not fire while text is being entered

Epic #253's standing rule ([[0035-field-and-form-control-primitives]]), and it costs more here than
it did for a digit: `Ctrl`+`Tab` inside the display-currency `<select>` does not change view, it
moves focus, because the app declined it and the browser took it back. That is the rule choosing the
control, which is the choice the Epic makes.

## Consequences

Benefits:

* The neighbouring view is one keystroke away with nothing to recall — no mapping from row to digit,
  only a direction.
* The wrapping rule is stated once. The arrows and the rotation cannot drift, and a test asserts
  they agree at every index rather than assuming the extraction was faithful.
* No new IPC channel, service, table, dependency, CSS rule or token. One pure module, one exported
  helper on an existing one, three attributes.
* The app now has a stated rule for *where a binding is disclosed*, which is what `0083` left open
  and what the next binding would otherwise have to invent.

Tradeoffs:

* **`nextTabIndex`'s Tab decline is now load-bearing.** Deleting that case would silently make plain
  `Tab` inside the tablist rotate views *and* fight the roving `tabindex`. It is annotated in both
  test files, which is the whole mitigation.
* **The tooltip is discoverable only by hovering**, and it hangs on a `<p>` rather than on a control,
  so it is not focus-reachable either. `aria-keyshortcuts` is the channel for a reader who is
  listening. Same accepted cost as `0083`, one notch weaker.
* **The rotation is inert inside a text control**, above.
* The listener is re-seated on every view change. Cheap, and stated so it is not read as an
  oversight later.
* Every step of a rotation mounts the view it lands on
  ([[0027-analytics-views-persist-and-explicit-refresh]]). Unlike arrowing, each of those is a stop
  the reader chose, so nothing is mounted that was only passed over.

Risks:

* `Ctrl`+`Tab` is muscle memory for "next browser tab" and for "next document" in many editors. Here
  it is "next view", which is the same shape; a reader expecting a *most-recently-used* order will
  find list order instead. MRU is explicitly out of scope — it needs a stack in state and a
  held-modifier overlay to be usable, and across five views it degenerates into a two-view toggle.
* The third global binding is the one that should re-ask the shortcut-table question, and the answer
  may still be no. The fifth is where this record stops being a defence.

## Alternatives Considered

### Reuse `viewShortcutIndex` with a `Shift` allowance

Rejected on what it would cost that predicate. Its `Shift` rejection is a decision — it keeps
`Ctrl`+`Shift`+1 free — and relaxing it to serve a second binding would make one function answer
two questions with two modifier policies. Two small total functions are cheaper to read than one
with a mode.

### Call `nextTabIndex('ArrowDown', …)` from the rotation

The most literal reading of "reuse the arithmetic", and wrong: the rotation would be naming a key it
does not use, and a change to the tablist's own key mapping would silently change the rotation.
Extracting `stepIndex` shares the *movement*, which is the thing both actually have in common.

### `Ctrl`+`PageDown` / `PageUp`

Free of every collision and genuinely the browser's convention for "next tab" as well. Rejected
because it is the *less* known of the two gestures for the same movement, and because `PageDown`
belongs to a scrolling panel — a view with a long table would have to negotiate for it.

### A shortcut overlay, dialog or command palette

The table `0083` warned against, arriving one binding early. Out of scope for the Epic and
disproportionate to two bindings; a searchable command surface is a different capability in a
different Epic.

### A drawn hint under "Views"

The visible-legend option, and the one `0083` rejected for the digits because it stated a range and
left which digit reached which row to be inferred. That objection does **not** apply here — a
rotation has nothing to infer — so this was the strongest candidate. Rejected anyway on the same
call that withdrew the drawn digits: a line of prose is permanent weight in the primary navigation,
larger than the glyph that was already judged too much, spent on something learned once.

### A `title` on the tablist itself rather than on its label

Semantically the closest fit — the element the rotation acts on. Rejected because the rows fill the
tablist, so the only hoverable part of it is the gaps between them; the hint would appear almost
nowhere. `aria-keyshortcuts` takes that spot instead, where the argument holds and hovering does not
apply.

## References

* [[0083-a-view-accelerator-beside-the-tabs-pattern]] — the accelerator this sits beside; its
  `window` listener, focus landing, text-entry rule, per-row disclosure, and the risk it flagged
  that this record answers.
* [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the tabs pattern, the roving `tabindex`,
  and why `Tab` must stay the browser's.
* [[0027-analytics-views-persist-and-explicit-refresh]] — what a view costs the first time it is
  landed on.
* [[0035-field-and-form-control-primitives]] — the controls the rotation must not shadow.
* [[0075-sidebar-nav-rhythm-and-the-boxed-currency]] — the "Views" label the hint hangs on, and its
  role as the tablist's `aria-labelledby`.
* [[0055-vertical-sidebar-tablist]] / [[0057-sidebar-collapse-and-the-frameless-corner]] /
  [[0068-sidebar-toggle-beside-the-app-name]] — the sidebar, the rail and the head row, none of
  which this moves.
* `renderer/src/lib/viewRotation.ts`, `renderer/src/lib/tabKeyboard.ts` — the predicate and the
  shared step.
* `e2e/view-shortcuts.spec.ts` — both directions, both wraps, the suppressed focus move, plain `Tab`
  still handing off, and the text-entry exclusion.
* Story #259, Epic #253.
