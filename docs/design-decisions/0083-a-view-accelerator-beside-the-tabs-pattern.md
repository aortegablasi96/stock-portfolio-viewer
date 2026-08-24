# 0083. A view accelerator beside the tabs pattern, disclosed in the row's tooltip

- **Status:** Accepted

- **Date:** 2026-08-24

## Context

The view list is the full WAI-ARIA tabs pattern
([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]), rotated into a vertical sidebar
([[0055-vertical-sidebar-tablist]]) that collapses to a rail
([[0057-sidebar-collapse-and-the-frameless-corner]]). Every part of it is correct and none of it is
in question here.

What the pattern does not give is a way to *reach* the tablist. Its four keys — Up, Down, Home, End
— only fire while focus is already inside it, and before this story the tablist's handler was the
**only** keyboard handler in the renderer: a grep for `keydown` across `renderer/src` returned
`App.tsx` and nothing else. So from a working position — a sorted `DataTable` header, a
`RangeFilter` field, the map — switching view meant Shift-Tab back to the rail through however many
stops lay between, and then arrowing.

The arrowing is not free either. Tabs use **automatic activation**, so crossing from Portfolio to
Trades selects Performance, Allocation and Dividends on the way and mounts each one for the session
([[0027-analytics-views-persist-and-explicit-refresh]]). That is the pattern behaving correctly. It
is simply not what "take me to Trades" should cost.

There was no accelerator table to add a row to. `src/main/index.ts` sets no `Menu` and registers no
`globalShortcut`, and the window is `frame: false` with in-app chrome
([[0011-custom-frameless-window-shell]]), so there is no menu bar to hang one from on any platform.
Whatever handled this was new.

## Decision

### `Ctrl` (or `Cmd`) and the view's own digit, from anywhere

Rows are numbered 1–5, top to bottom, which is the order they are read in. The modifier is the
conventional one for "go to the nth thing" and it shadows nothing: Chromium's tab-switching
`Ctrl`+digit is browser chrome an Electron `BrowserWindow` does not have, and Electron's default
menu binds reload, devtools, zoom and the clipboard — no digits. Nothing the platform owns is
intercepted, which was the constraint rather than a preference.

### It is handled in the renderer, on `window`

A `keydown` listener in `App.tsx`, not main's `before-input-event`. Main-side would mean carrying a
keystroke the renderer already receives back across a new `window:*` event — a channel bought for
nothing. On `window` rather than on the tablist because reaching the tablist is the entire problem;
scoping the listener to it would reproduce the thing being fixed.

### The pattern is extended, not changed — and the two handlers never negotiate

`nextTabIndex` is untouched and still returns `null` for every key it does not own. The roving
`tabindex`, the single Tab stop, automatic activation, `aria-controls` on the selected tab alone,
Up/Down/Home/End and Left/Right's deliberate inertness are all exactly as they were.

The two handlers see the same events and neither checks for the other, because they read **different
properties of the event**: the tablist reads `key`, the accelerator reads `code`. A digit's `key` is
`'1'`, which `nextTabIndex` declines like any other key it does not own. That is asserted from both
sides in one test rather than assumed.

Reading `code` is not incidental. `event.key` is the *layout's* answer, and on AZERTY the unshifted
top row is `&`, `é`, `"`, `'`, `(` — a binding read off `key` would simply not exist on that
keyboard. `code` is the position, which is what a reader told "Ctrl and the row's number"
actually strikes. The numpad is the same digit under a different code and is accepted too.

### Focus lands on the destination row, deliberately

Not a preference — a requirement. Focus may be standing inside the panel that is about to become
`hidden`, and a `hidden` ancestor blurs its contents to `<body>`; and the roving `tabindex` takes
focusability off the row being left. Without a deliberate move a jump would silently cost the reader
their place in the Tab order. So both keyboard paths go through one `selectAndFocus`, and land where
arrowing lands: on the destination tab, one Tab from its panel.

### The accelerator does not fire while text is being entered

With focus in a `Field`, `Select`, `DateInput` ([[0035-field-and-form-control-primitives]]) or
anything editable, the keystroke is the control's. This is Epic #253's standing rule, adopted as
**the rule and not the collision**: today's binding carries a modifier and so collides with none
of the three. It is implemented anyway because the rule is what survives a future story changing
the binding, and a bare digit would collide with all three at once. `isContentEditable` rather than the attribute, so an
element *inside* an editable host is caught as well as the host.

Its cost is stated: `Ctrl`+3 with the cursor in the display-currency field does nothing. That is the
rule choosing the control, and it is the choice the Epic makes.

### The binding is written in the row's tooltip, and nowhere else on screen

A hint is required to exist and its placement was open. Each nav row's `title` becomes
`Portfolio (Ctrl+1)`.

That amends [[0057-sidebar-collapse-and-the-frameless-corner]], which gave a row a `title` **only
while its label was clipped** — because a tooltip repeating text legible beside it says nothing.
That reasoning is untouched, and it is exactly why the tooltip may now stand in both states: it no
longer repeats the label, it adds the one thing the sidebar cannot otherwise state.

It remains **an addition, never the mechanism**. A `title` is consulted for an accessible name only
where an element has no content to take one from, and the label is content — clipped rather than
removed on the rail, so the row is still named by its own text in both states. The e2e assertion
that all five rows are reachable by name is *sharper* than it was, because the title is no longer
the same string as the name.

`aria-keyshortcuts="Control+N Meta+N"` carries the same fact to a reader who is listening — the
attribute the platform has for exactly this. The tooltip names **one** modifier, chosen from the
platform, because a tooltip is read rather than parsed and "Ctrl+1 / Cmd+1" states a choice the
reader does not have. The platform is a *parameter* of `shortcutLabel` rather than a `navigator`
read inside it, so the function stays pure and one Node test asks it both questions; `App.tsx`
holds the app's only `navigator` read.

### A drawn digit was built, seen, and withdrawn

The first implementation drew the digit itself at the trailing edge of each row — `currentColor`
like `.app-tab-icon`, `aria-hidden`, `--text-2xs`, removed rather than clipped on the rail. It
worked and it cost `lib/contrast.ts` nothing, and it was **withdrawn on the owner's call** after
being seen in the running app: five persistent digits are permanent weight in the app's primary
navigation, spent on something a reader learns once.

The withdrawal takes a real cost back with it. A row is one text node again, so its `textContent`
and its accessible name are the same string — the property `.app-tab` has carried since Story #184.
The four e2e assertions that briefly had to move off `textContent` keep `toHaveAccessibleName`
anyway: that is what they always meant, and asserting it directly rather than through a coincidence
costs nothing.

## Consequences

Benefits:

* The app's most frequent action is one keystroke from anywhere, with no prior focus move.
* It selects **exactly** its destination: a first jump to an analytics view mounts that view and no
  other, where arrowing across the list mounts every view it crosses.
* No new IPC channel, service, repository, table or dependency. One pure module, one `useEffect`
  and two attributes.
* Nothing is added to the sidebar's layout, ink or type: the disclosure is an attribute, so
  `app.css` is untouched and there is no new contrast pairing and no new token.
* A row's `textContent` is still exactly its accessible name, and four e2e assertions now say so
  directly rather than relying on the two being the same string.

Tradeoffs:

* **A tooltip is discoverable only by hovering.** A reader who never reaches for the pointer learns
  the binding from `aria-keyshortcuts` or not at all. That is the accepted cost of leaving the
  sidebar unweighted, and it is why `aria-keyshortcuts` is not optional here.
* **The accelerator is inert inside a text control**, above. The rule is Epic #253's and outlives
  today's binding.
* Four of the five rows previously showed no tooltip at all when expanded. Every row shows one now,
  which is new furniture for a pointer user who wanted none.
* The listener is on `window`, so it is live whenever the app is. That is the feature; it is also why
  the text-entry guard is asked *before* the key is examined.

Risks:

* A later story adding a second global binding will be tempted to put it beside this listener rather
  than to ask whether the app now wants a shortcut table. One binding is not a table, and this record
  is not a licence for the fifth.
* Digits 6–9 return `null` rather than clamping, so a sixth view needs nothing here but a sixth row.
  A tenth would need a different scheme, and the module says so by bounding on `count`.

## Alternatives Considered

### `Alt` + digit, or a bare digit

`Alt`+digit is the menu-mnemonic gesture on Windows and belongs to a menu bar this app does not have,
which makes it free but unfamiliar. A bare digit is the most direct and the least safe: it collides
with `<select>` typeahead, with `<input type="date">`'s segments, and with every text field a later
story adds — the exact shadowing Epic #253 rules out.

### Main's `before-input-event`

Rejected above. It buys reach the renderer already has, at the price of a channel.

### A digit drawn on each row

Built and reviewed on screen before being withdrawn, above. It is the strongest disclosure — nothing
to hover for and nothing to infer — and it is the only option that puts permanent weight into the
app's primary navigation to state something a reader learns once.

### No disclosure at all, only `aria-keyshortcuts`

The lightest possible sidebar. Rejected because Story #254 requires the binding to be discoverable
from inside the app, and an attribute that only a screen reader surfaces does not reach the reader
the accelerator was built for.

### A legend under "Views"

One line — "Ctrl 1–5" — stating the whole binding in one place and touching no row. Rejected on what
it asks of the reader: it states a range and leaves which digit reaches which row to be inferred
from position, where a tooltip answers for the row under the pointer.

### Manual activation for the tablist, so arrowing stops mounting views

Would remove the accelerator's *reason* rather than the accelerator. Out of scope by construction:
automatic activation is [[0029-tab-shell-aria-pattern-and-keyboard-navigation]]'s decision, and
the APG's caveat does not bite here — every view paints its own loading or empty state immediately.

## References

* [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the tabs pattern this extends and
  does not alter.
* [[0057-sidebar-collapse-and-the-frameless-corner]] — the rail, and the tooltip rule this amends.
* [[0055-vertical-sidebar-tablist]] / [[0068-sidebar-toggle-beside-the-app-name]] — the sidebar and
  the head row, neither of which this moves.
* [[0027-analytics-views-persist-and-explicit-refresh]] — why arrowing past a tab mounts it, and
  what a direct jump therefore saves.
* [[0035-field-and-form-control-primitives]] — the three controls the accelerator must not shadow.
* [[0011-custom-frameless-window-shell]] — why there is no menu bar to hang an accelerator from.
* `renderer/src/lib/viewShortcut.ts`, `renderer/src/lib/tabKeyboard.ts` — the two predicates, and the
  arithmetic they leave alone.
* `e2e/view-shortcuts.spec.ts` — its own app instance, so "the views it passed over were never
  mounted" is provable.
* Story #254, Epic #253.
