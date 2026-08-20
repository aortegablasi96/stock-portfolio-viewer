# 0069. The gateway badge becomes a boxed chip, and the app gains one raised surface

- **Status:** Accepted
- **Date:** 2026-08-20

## Context

[[0056-sidebar-context-rail]] put two statements at the top of the sidebar: what the app *is*, and
whether the data source behind it is answering. It rendered them as two stacked blocks inside one
padded head — a brand tile with the product's name, and below it a dot beside two lines of text —
separated by nothing but a `gap`.

The redesign proposal draws them differently, and the owner's review of the shipped shell agreed:
the two read as **one run-on block**. Four lines of text in one padded box, in three type steps and
four colours, with a coloured dot somewhere in the middle. Nothing says where the app's identity
ends and the state of its gateway begins, and the badge — the one part of the head that *changes* —
has no edge of its own to make it findable.

The proposal answers it with two moves that only work together: a **boxed chip** around the badge
(`background: var(--surface-2)`, `border: 1px solid var(--border)`, `border-radius: 8px`,
`padding: 8px 10px`) and a **rule** splitting its block from the logo block above it.

The second move is nearly free. The first is not, and this record exists for it: the chip needs a
surface the app does not have, and it moves every colour the badge renders onto that surface, which
invalidates three measurements [[0046-contrast-split-tone-tokens]] and
[[0064-toned-badges-and-the-income-key]] took against the sidebar's own ground.

## Decision

### The badge is a boxed chip, and it is not the `Badge` primitive

`.gateway-badge` gains a fill, a 1px border in `--border`, `--radius-md` (which *is* the proposal's
8px) and `var(--space-3) var(--space-4)` of padding (8px/12px, the scale's nearest expression of
8px/10px — [[0031-design-token-scales]]).

It is deliberately **not** `Badge`. [[0037-badge-primitive-variants-and-sizes]] settled that a
badge is never a background and never a pill; it is an ink and a boundary on whatever surface it
lands on, and
`BADGE_VARIANTS` is a set of *data* tones. The gateway chip is the opposite thing on all three
counts: it is a rail element, it is a box, and its "variant" is a live reading rather than a
category. Making it a `Badge` would have meant a fourth axis on a primitive that carries two, to
serve exactly one call site. The story asked whether they share anything; the answer is that they
share the word and nothing else.

Nothing inside the chip changed. The wording is still the channel and the dot still seconds it
[[0056-sidebar-context-rail]]; three tones still cover five outcomes; "Not running" and "Stalled"
are still distinct; it is still not a live region; and it still renders the last
`portfolio:getOverview` result rather than polling anything.

### One new token, `--surface-raised`, and it is the only step in the app that goes up

`#161b2e` — the proposal's own `--surface-2`, and the one value in this milestone taken at face
value rather than re-derived. That is defensible here for a reason that did not hold in
[[0054-navy-indigo-palette-re-key]]: a surface carries no contrast of its own, so what had to be
measured is what lands *on* it, and all of that is measured below.

It is a `:root` token rather than a `color-mix()` at the call site, which is the same instinct
[[0054-navy-indigo-palette-re-key]] applied to the five rules that used to hard-code a tint: the
next re-key is a `:root` edit.

The direction is the part worth recording. **Every other surface relationship in this app
recedes.** `card-nested` drops to `--bg` so an inset well reads as a hole
[[0033-card-primitive-variants-and-sizes]]; the two lifts a row takes under the pointer are a
`color-mix` of `--text` [[0059-card-strip-and-table-density]], which is a transient state rather
than a surface. Reusing
`--bg` here was the obvious way to add no token at all, and it is wrong for one concrete reason:
**the content column beside the rail is `--bg`**, so a chip painted with it would match the page
next to the sidebar and read as a gap punched in the column rather than as a box standing on it.

`designTokens.test.ts` pins the token by its **ordering**, not only its value: lighter than
`--card`, dimmer than the `--border` that edges it, and within 1.2:1 of `--card` so it stays a chip
on a column rather than becoming a second ground. Invert either relationship and the chip stops
being a box while every contrast assertion carries on passing.

### The rule spans the column, which is why the padding moved

`.app-sidebar-head` was one padded column. A 1px line drawn inside that padding stops 12px short of
each edge, which is the one thing a delimiter must not do — so the head keeps only the rule that has
always closed it off from the tablist, and its padding moves down onto two children:
`.app-sidebar-head-row` (which gains the new `border-bottom`) and a new `.app-sidebar-status`
wrapping the chip. Two rules, at two boundaries, neither competing with the other — and the chip
stays inset from the column's edges while the rule above it does not.

### On the rail the chip squares off at 32px

Collapsed, `.gateway-badge` becomes `--space-8` on both axes with `margin-inline: auto` and no
padding, inside the 40px of content a 56px rail leaves. 32px is the brand tile's own box, so the two
things standing in the rail are one shape rather than a square above a rounded bar.

The padding has to go rather than shrink: the wording inside is **clipped, not removed**
[[0057-sidebar-collapse-and-the-frameless-corner]], and a clipped `<span>` is still a 1px flex item
— 8px around it would push the dot off centre. The dot keeps the shape channel `0057` gave it
(filled / hollow / haloed), which is what stops hue carrying a state alone where the words are
clipped.

### Every tone was re-measured on the new fill, and three old pairings were re-pointed

`lib/contrast.ts`'s three gateway-dot entries **moved** from `--card` to `--surface-raised` rather
than gaining three more beside them. A pairing that has stopped occurring is a measurement of
nothing, which is the mirror of the blind spot that module's own header describes.

| What renders it | Ratio on `--card` | Ratio on the chip | Bar |
| --- | --- | --- | --- |
| `.gateway-badge-label`, and the idle detail line | 5.80:1 | **5.35:1** | 4.5 |
| `.gateway-badge-detail`, live (`--pos`) | 7.30:1 | **6.73:1** | 4.5 |
| `.gateway-badge-detail`, stalled (`--neg-text`) | 6.88:1 | **6.34:1** | 4.5 |
| `.gateway-dot`, live (`--pos`) | 7.30:1 | **6.73:1** | 3 |
| `.gateway-dot`, idle (`--muted`) | 5.80:1 | **5.35:1** | 3 |
| `.gateway-dot`, stalled (`--neg`) | 3.94:1 | **3.63:1** | 3 |

Every tone loses headroom, which is what a lighter fill does and why the entries had to move. The
warn dot at 3.63:1 is now the tightest measurement anywhere in that list, and it is the first thing
a lighter chip would break.

The fill/text split survives intact: the dot takes `--neg`, the detail line takes `--neg-text`. So
does the balance constraint — the two tones are 0.39 apart on the chip against 0.42 on `--card`,
inside the 0.5 the guard enforces — and `contrast.test.ts` now runs that check over three surfaces
rather than two.

### `SURFACE_EDGE`: a threshold for a boundary that no standard governs

The chip's border against the sidebar is the pairing that says "there is a box here", and it is the
first entry in `lib/contrast.ts` that no WCAG bar covers. 1.4.11 governs a *control's* boundary
where the boundary identifies the control; this chip is not interactive and its box carries no
state, because the wording inside it does. Holding it to 3:1 would have been a fiction, and
`--border` on `--card` measures 1.251:1 — every card edge in the app would fail it.

So a third threshold, named so nobody reads it as an accessibility one, and calibrated on the app's
own numbers rather than picked: `--card` on `--bg` is 1.059:1 — two surfaces separated by fill
alone, the separation this app never relies on — and `--border` on `--card` is 1.251:1, the edge
every card, table rule and input already ships. **1.2** sits between them, so the guard fails the
day `--border` is dimmed toward the surfaces it separates.

A border's *inner* edge is deliberately unmeasured. It is a boundary between a box and its own
outline, which separates nothing a reader has to tell apart.

The entry is worth more than the chip that prompted it: `--border` on `--card` is every card's inner
edge and every table rule, and until now it was unmeasured.

## Consequences

- The head reads as two statements. The badge has an edge, which is what makes the app's one
  changing piece of ambient state findable at a glance.
- **The app has a raised surface for the first time**, and exactly one thing stands on it.
  `sidebarRail.test.ts` asserts that `var(--surface-raised)` appears once in `app.css` — not a style
  rule, but the mechanism that sends the second adopter here: every ink measured against that token
  is one the badge renders, and a new call site brings inks nobody has measured there.
- The head row is ~1px taller and the badge block ~8px, from the padding and the two borders.
  Nothing below moves that a reader would notice; the nav list has never come close to filling the
  column.
- The rail gains a second 32px box under the brand tile. Both fit inside 56px with the focus ring's
  gutter to spare, which `e2e/sidebar-collapse.spec.ts` measures.
- **Not done, deliberately:** the collapsed chip is *not* a click target that re-expands the column,
  as the prototype makes it. The toggle stays the one writer of the collapsed flag
  [[0057-sidebar-collapse-and-the-frameless-corner]], and a second, unlabelled control that changes
  the navigation's width is the failure `0057` and `0068` both refused.
- **Not done, deliberately:** the prototype's `Live · U18846869` stays out. An account number is a
  new figure, not a restyle.

## Alternatives Considered

### Paint the chip `--bg`, adding no token at all

Rejected above, and it was the tempting one: `--bg` is already the app's answer for "a surface
inside a surface" [[0033-card-primitive-variants-and-sizes]], and every ink the badge renders is
already measured on it. It fails on placement rather than on colour — the content column beside the
sidebar *is* `--bg`, so a recessed chip matches the page next to it and reads as a hole in the rail.

### Mix the fill at the call site, `color-mix(in srgb, --text 5%, --card)`

Rejected. It is the form the row lifts use, and that is the argument against it: a lift is a
*state*, and the whole point of the mix there is that it composites over whatever surface the row is
on. A chip's fill is a surface, it is the same in every state, and a surface expressed as an
expression cannot be re-keyed from `:root` — which is exactly what
[[0054-navy-indigo-palette-re-key]] moved five rules *away* from. The story rules it out by name.

### Make it a `Badge` with a fourth variant

Rejected above: three of `Badge`'s defining properties would have had to be negotiable to fit one
call site.

### Hold the chip's edge to 3:1, and darken `--border` until it clears

Rejected. `--border` is the app's single boundary token, so this is a palette-wide change to serve
one chip's outline — and it would fail its own justification, since the bar it is trying to clear
does not apply to a non-interactive box whose meaning is carried by text.

### Give the badge its own tinted fill per tone, as the prototype's data badges get

Rejected. It would put the state on a fourth channel and make the chip's *fill* one of them, which
is the thing [[0037-badge-primitive-variants-and-sizes]] declined for data chips and which
[[0021-allocation-map-gain-loss-scale]] governs generally: five outcomes over three tones only works
because the wording carries the distinction. Three fills would also mean three surfaces to measure
every ink against instead of one.

## References

- [[0056-sidebar-context-rail]] — the badge's tones, its wording, and why nothing polls
- [[0057-sidebar-collapse-and-the-frameless-corner]] — the collapsed rail, the clipped labels, and
  the dot's shape channel
- [[0068-sidebar-toggle-beside-the-app-name]] — the head row this record rules off
- [[0046-contrast-split-tone-tokens]] — the fill/text split, and the balance constraint
- [[0064-toned-badges-and-the-income-key]] — a tone rendered on a tinted surface is measured there
- [[0054-navy-indigo-palette-re-key]] — the palette, and why a tint is a token rather than a literal
- [[0037-badge-primitive-variants-and-sizes]] — the primitive this deliberately is not
- [[0033-card-primitive-variants-and-sizes]] — `card-nested`, the app's other
  surface-inside-a-surface
- [[0031-design-token-scales]] — the spacing, radius and type scales
- [[0042-token-adoption-ratchet]] — the adoption ratchet and its empty baseline
- [[0021-allocation-map-gain-loss-scale]] — colour is never the only channel
