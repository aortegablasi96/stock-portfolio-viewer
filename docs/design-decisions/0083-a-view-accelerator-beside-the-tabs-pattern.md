# 0083. A view accelerator beside the tabs pattern, and the digit it draws

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
keyboard. `code` is the position, which is what a reader pressing the digit printed beside the view's
name actually strikes. The numpad is the same digit under a different code and is accepted too.

### Focus lands on the destination row, deliberately

Not a preference — a requirement. Focus may be standing inside the panel that is about to become
`hidden`, and a `hidden` ancestor blurs its contents to `<body>`; and the roving `tabindex` takes
focusability off the row being left. Without a deliberate move a jump would silently cost the reader
their place in the Tab order. So both keyboard paths go through one `selectAndFocus`, and land where
arrowing lands: on the destination tab, one Tab from its panel.

### The accelerator does not fire while text is being entered

With focus in a `Field`, `Select`, `DateInput` ([[0035-field-and-form-control-primitives]]) or
anything editable, the keystroke is the control's. This is Epic #253's standing rule, adopted as **the rule
and not the collision**: today's binding carries a modifier and so collides with none of the three.
It is implemented anyway because the rule is what survives a future story changing the binding, and a
bare digit would collide with all three at once. `isContentEditable` rather than the attribute, so an
element *inside* an editable host is caught as well as the host.

Its cost is stated: `Ctrl`+3 with the cursor in the display-currency field does nothing. That is the
rule choosing the control, and it is the choice the Epic makes.

### The binding is drawn on the row it reaches

A hint is required to exist and its placement was open. It is the digit itself, at the trailing edge
of each nav row — not a tooltip, because a sighted keyboard user never hovers, and not a legend under
"Views", because a legend states a range and leaves the reader to infer which row is which.

Two properties make it cheap:

- **It carries no ink of its own.** Like `.app-tab-icon`, it inherits `currentColor` and follows the
  row through muted → text → accent. It is therefore rendered in exactly the ink the label beside it
  already wears, on exactly the same ground, and adds **nothing to `lib/contrast.ts`** — a tone
  picked here would have needed measuring three times over: at rest on `--card`, on the hover's
  `--text` lift, and on the active row's `--accent` wash
  ([[0064-toned-badges-and-the-income-key]]). Subordination is by **size** instead: `--text-2xs`,
  the scale's smallest step.
- **It is `aria-hidden`,** for the reason the icon is. The row's accessible name is still the label
  alone, and `aria-keyshortcuts="Control+N Meta+N"` carries the same fact to a reader who is
  listening — the attribute the platform has for exactly this, and the reason the binding needs no
  legend elsewhere.

On the 56px rail the hint is **removed** (`display: none`), which is the one place in the sidebar
where that is right. The clip rule exists so a collapsed row keeps its accessible *name*
([[0057-sidebar-collapse-and-the-frameless-corner]]); the hint has no name to keep,
`aria-keyshortcuts` is width-independent, and a clipped-but-in-flow element would push the centred
icon off centre.

### `textContent` is no longer the row's name; the accessible name still is

The row was one text node, so its `textContent` and its accessible name were the same string, and
four e2e assertions across three specs were written against the easier of the two. The drawn digit
ends that: `textContent` is now `Portfolio1`.

The property that mattered is unchanged, and those assertions now test **it** —
`toHaveAccessibleName` in `tab-navigation.spec.ts`, `reduced-motion.spec.ts` and
`sidebar-collapse.spec.ts`. The convenience is gone; the invariant is stronger than it was, because
it is now asserted directly rather than through a coincidence.

## Consequences

Benefits:

* The app's most frequent action is one keystroke from anywhere, with no prior focus move.
* It selects **exactly** its destination: a first jump to an analytics view mounts that view and no
  other, where arrowing across the list mounts every view it crosses.
* No new IPC channel, service, repository, table or dependency. One pure module, one `useEffect`, one
  CSS rule and a span.
* No new contrast pairing and no new token — `--text-2xs` and the row's own ink.
* Four e2e assertions moved off `textContent` and onto the accessible name.

Tradeoffs:

* **`textContent` no longer equals the row's name**, above. A future assertion written the old way
  passes with `Portfolio1` in it, which reads as a typo rather than as a rule.
* **The accelerator is inert inside a text control**, above. The rule is Epic #253's and outlives
  today's binding.
* A fifth thing now shares the nav row's width. Measured against DDR-0075's numbers: a row leaves
  152.8px, "Performance" advances 89.35px, and the digit plus its gap is ~18px — so the label was not
  the binding constraint before and is not now. A sixth view, or a longer name, re-opens that.
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

### The hint as a tooltip on the row

`title` is already the collapsed rail's mechanism and would have cost nothing to extend. Rejected
because a tooltip is discoverable only by hovering, and the reader this story is for is not using a
pointer.

### The hint as a legend under "Views"

One line — "Ctrl 1–5" — stating the whole binding in one place, touching no row and leaving
`textContent` intact. Genuinely cheaper, and rejected on what it asks of the reader: it states a
range and leaves which digit reaches which row to be inferred from position. The digit belongs beside
the name it selects.

### Manual activation for the tablist, so arrowing stops mounting views

Would remove the accelerator's *reason* rather than the accelerator. Out of scope by construction:
automatic activation is [[0029-tab-shell-aria-pattern-and-keyboard-navigation]]'s decision, and the APG's caveat does
not bite here — every view paints its own loading or empty state immediately.

## References

* [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the tabs pattern this extends and does not alter.
* [[0055-vertical-sidebar-tablist]] / [[0057-sidebar-collapse-and-the-frameless-corner]] / [[0068-sidebar-toggle-beside-the-app-name]] —
  the sidebar, the rail, and the head row none of this moves.
* [[0027-analytics-views-persist-and-explicit-refresh]] — why arrowing past a tab mounts it, and what a direct jump
  therefore saves.
* [[0035-field-and-form-control-primitives]] — the three controls the accelerator must not shadow.
* [[0011-custom-frameless-window-shell]] — why there is no menu bar to hang an accelerator from.
* [[0064-toned-badges-and-the-income-key]] — the three grounds a picked tone would have had to be measured
  on, and the reason `currentColor` avoids all three.
* [[0053-bundled-typefaces-and-the-figure-role]] — why the digit is deliberately *not* in the figure role: it is the name of a
  key, not a quantity.
* `renderer/src/lib/viewShortcut.ts`, `renderer/src/lib/tabKeyboard.ts` — the two predicates, and the
  arithmetic they leave alone.
* `e2e/view-shortcuts.spec.ts` — its own app instance, so "the views it passed over were never
  mounted" is provable.
* Story #254, Epic #253.
