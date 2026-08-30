# 0106. One `Collapsible`: a disclosure with `level` as its only axis, hidden and never unmounted

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

`components/ui/` held thirteen primitives (Epic #125, ADR-0008) and **none of them collapsed**.
The only `aria-expanded` anywhere in the renderer was `SidebarRail`'s own toggle, which is a
sidebar concern — one `app-collapsed` flag on the shell, deliberately *not* a `collapsed` prop
([[0068-sidebar-toggle-beside-the-app-name]]) — and reusable by nothing.

Epic #306 reduces the assistant to one view with the investor profile above the chat, and #310
therefore needs **six** collapsible surfaces on a single page: the profile as a whole, and each of
its five sections (investing style, and the currency, sector and asset-class targets, and the
single-position band). Six inline implementations of the same behaviour is precisely the
hand-picked-value failure the Epic #125 audit found nine times over and that this component
directory exists to prevent, so the primitive is built first and separately.

Three constraints shaped it before any design question was asked:

- **Vitest runs Node-only with no jsdom, so no test may render the component**
  ([[0029-tab-shell-aria-pattern-and-keyboard-navigation]]). Anything with logic has to sit in a
  pure module under `renderer/src/lib/`, and what a text scan cannot see is normally pinned by
  Playwright — which here has nothing to pin, because #308 deliberately adds no call site.
- **`Field` generates its id with `useId()` and takes no `id` prop**
  ([[0035-field-and-form-control-primitives]]), because views stay mounted
  ([[0027-analytics-views-persist-and-explicit-refresh]]) and a fixed id names only the first
  instance. Six collapsibles on one page have exactly that problem.
- The profile's sections carry a **form**. Whatever "closed" means, it cannot mean losing what the
  owner has typed.

## Decision

**One `Collapsible` primitive implementing the WAI-ARIA *disclosure* pattern, with `level`
(`group | section`) as its only axis, owning its own open state and hiding its panel rather than
unmounting it.**

### It is a disclosure, not an accordion

#308 excludes sibling coordination on purpose: #310 wants sections that open independently. The
disclosure pattern is exactly that and it is small — a `<button>` carrying `aria-expanded` and
`aria-controls`, and a container the id names. Everything the accordion pattern adds beyond it
exists to coordinate panels this primitive does not coordinate.

Two pieces of the accordion pattern were weighed individually rather than adopted or dropped as a
set:

- **The heading wrapper is kept.** The trigger sits inside an `h2` or an `h3`, so the profile is
  navigable by heading — which is how a screen-reader user finds a section on a page of six.
- **`role="region"` and its `aria-labelledby` are not.** APG's own caveat is landmark
  proliferation past roughly six panels, and #310 has six, five of them *nested inside* the sixth.
  A page whose landmark list is one profile repeated six times is worse than a page with none, and
  `aria-expanded` already states the thing the AC asks to be exposed.

### `level` is the only axis, and it carries the heading element

The button and the card take `variant` × `size`. A collapsible **paints nothing** — no background,
no border, no radius — so a `variant` axis carrying a surface colour would have nothing to carry:
the surface behind a collapsible is the `Card`'s, exactly as a `StatTile`'s is
([[0033-card-primitive-variants-and-sizes]], [[0034-stat-tile-primitive-tone-axis]]). And a `size`
axis would ship with one value in use, which is the call
[[0034-stat-tile-primitive-tone-axis]], [[0035-field-and-form-control-primitives]] and
[[0036-toggle-group-mode-axis-and-pressed-semantics]] each already made.

What genuinely differs across #310's six call sites is *what the collapsible encloses*:

| Level | Encloses | Head type | Heading | Call sites in #310 |
| --- | --- | --- | --- | --- |
| `group` | a stack of cards, on the page ground | `--text-md` | `h2` | the profile as a whole |
| `section` | one card's own body | `--text-sm` — `.card-title`'s own treatment | `h3` | the five profile sections |

That is a fact about **depth**, so it carries the head's type step and the heading element
*together*. Deriving the heading level from the visual level is the point rather than a shortcut:
the two values exist precisely because one nests inside the other, so a `group` rendering an `h3`
beside a `section`'s `h3` would be a document outline disagreeing with the picture. `Card` makes
the same call from the other side — `CardTitle` is always an `h2` — and a `section` collapsible
replaces that title, one level below the band above it.

`section` is the default, being five of the six.

### Closed means hidden, never unmounted

The panel is always rendered and carries the `hidden` attribute when closed. This is the same
decision the tab shell makes for a view ([[0027-analytics-views-persist-and-explicit-refresh]]) and
it is load-bearing here for two reasons:

- #310's sections hold a form, and unmounting one would discard whatever the owner had typed the
  moment they folded it away to read the section below — which the Epic's own acceptance criteria
  forbid.
- `hidden` removes the content from the tab order for free, so a closed panel's controls are not
  focusable stops the reader cannot see. A `display: none` written by hand would do the same; a
  `visibility` or a height animation would not, and that is the failure this records against.

The trap it creates is recorded in the stylesheet and pinned by the guard test: `.collapsible-panel`
declares a `display`, so **without `.collapsible-panel[hidden] { display: none }` the attribute is
silently defeated** and a "closed" section stays on screen, in the tab order, with every other
assertion still passing.

### Uncontrolled, unlike `ToggleGroup`

`ToggleGroup` is presentational because a selection *is* view state — it decides what a card draws,
and the owning view has to know ([[0036-toggle-group-mode-axis-and-pressed-semantics]]).
Open-and-closed decides nothing but its own visibility, and no other part of the app has a reason
to read or set it. `defaultOpen` seeds the first render and the primitive keeps it from there,
which is what stops #310 from carrying six `useState`s that nothing else reads. It defaults to
**open**: a section that hides its content unasked is a section the owner has to discover.

### The `action` slot exists to make one mistake unavailable

Two of #310's five sections carry a control in their card head today — "Add a limit", and the
profile's `ConfirmAction`. Placed inside the trigger, that control is a button inside a button:
invalid markup that renders anyway and then swallows one of the two clicks. The slot puts it
*beside* the trigger, so the primitive forecloses the mistake rather than leaving each call site to
remember it.

### Motion is one glyph turned

The marker is dependency-free inline SVG in the convention `TabIcons.tsx` established — a 16×16
viewBox that is geometry rather than a size, `currentColor`, `aria-hidden`. It is **one glyph
rotated, not two glyphs swapped**, the same call `SidebarToggle` makes for its chevron and for the
same reason: the thing being acted on stays recognisable and only its direction changes.

The rotation lives on the `collapsible-marker-open` modifier rather than in the resting state, so a
page of collapsed sections carries no transform saying nothing. The turn draws `--duration-fast`
and `--ease-out` from the scale, which is the only thing that puts it inside the one
`prefers-reduced-motion` block that zeroes the durations
([[0044-motion-scale-and-reduced-motion]]).

### What the guard test fails on

`lib/collapsibleVariants.test.ts` fails the three ways every primitive's guard test does, and the
first of them needed re-reading because this primitive supersedes no existing rule:

1. **A rejected selector reappears** — `<details>`/`<summary>` in any component, or a `details` or
   `summary` rule in the stylesheet. See *Alternatives* below; the app's focus ring already names
   `summary`, so the cheaper answer is one keystroke away from any later section that wants to fold.
2. **An axis value or a part has no rule in `app.css`** — a level with no rule renders as an
   unstyled row and nothing else in the toolchain notices.
3. **The primitive re-declares something the shared rules own** — an `outline`, a `:disabled`
   state, or a surface token (`--card`, `--bg`, `--surface-raised`) or `border-radius` of its own.

It also asserts what only the component can carry: the generated id, the `aria-expanded` /
`aria-controls` pair through the one helper, `hidden={!open}` rather than a conditional render, and
`type="button"`.

## Consequences

Benefits:

- #310 composes six collapsible surfaces without writing behaviour, and cannot ship one without a
  focus ring, an `aria-controls` target, or a per-instance id.
- A folded section keeps its unsaved edits, which is #306's acceptance criterion satisfied by the
  primitive rather than by every call site.
- The primitive paints nothing, so wrapping the five existing profile sections changes none of
  their shapes.

Tradeoffs:

- **No Playwright coverage yet.** A cascade resolving, a real keyboard press and the `hidden`
  attribute actually removing a tab stop are what a text scan cannot see, and there is nothing
  rendering this until #310. That story carries the e2e spec; until it lands the primitive is
  guarded by unit tests alone, and this is the known gap.
- A `section` collapsible does not draw `.card-header`'s ruled strip, because reproducing that
  bleed here would mean re-declaring what `Card` owns and reading `--card-pad` back out of a
  primitive that knows nothing about cards. #310 decides how its sections wear the strip, through
  `className` for placement.
- Uncontrolled state means the open/closed arrangement does not survive a restart. Nothing asks for
  it to; a later story that wants it would be adding a stored setting, not changing this axis.

Risks:

- **The `hidden` trap is one deleted rule away.** Recorded above and pinned, because every other
  assertion passes without it.
- Six panels is APG's stated boundary for the region role. Should #310's profile grow a seventh
  section, the decision to omit `role="region"` gets more right rather than less — but the count is
  worth re-reading if a later view puts two of these groups on one page.

## Alternatives Considered

### `<details>` / `<summary>`, the native disclosure

The obvious cheaper answer, and the app's focus ring already anticipates it — `summary` is one of
the six selectors in the zero-specificity base rule. Rejected on two counts, and pinned so it stays
rejected: the open state is a DOM property the user agent toggles *before* React hears about it, so
nothing in the app can be the source of truth for it; and `summary` cannot hold a control beside its
label without nesting one interactive element inside another, which is exactly what the `action`
slot exists to prevent. Left unpinned, the next section that wants to fold would reach for it and
the page would carry two disclosures behaving differently.

### An accordion that closes its siblings

Explicitly out of scope in #308, and wrong for the content: the profile's five sections are
independent policies, and reading one while editing another is an ordinary thing to want.

### A `variant` axis carrying a surface

Rejected because there is no surface to carry. It would have made the primitive re-declare what
`Card` owns and put a second answer beside `CardVariant` for the same question.

### A `size` axis beside `level`

Rejected for [[0034-stat-tile-primitive-tone-axis]]'s reason: it would ship with one value in use.
The one thing that genuinely varies with depth is already the axis.

### Animating the panel's height

Rejected in #308's own scope, and it would have cost more than motion: a height transition needs a
measured height, which needs a rendered element, which is the one thing no test here can produce.

### A `defaultOpen` per level rather than a prop

Considered — a `group` closed and `section`s open would suit #310 exactly — and rejected because it
makes the axis carry a *behaviour* on top of a depth. The call site says which of its six starts
folded, in one word, where a reader of #310 can see it.

## References

- Epic #306, Story #308 — the surface this primitive is built for.
- Epic #125, ADR-0008 — the in-house primitive shape and its guard-test pattern.
- ADR-0009 — the advisory boundary, untouched: this is chrome around the grounding.
- [[0027-analytics-views-persist-and-explicit-refresh]] — hidden rather than unmounted, and why.
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the app's real tabs pattern, and the
  Node-only test constraint that shapes every primitive's split.
- [[0031-design-token-scales]] — every length here is a step.
- [[0033-card-primitive-variants-and-sizes]], [[0034-stat-tile-primitive-tone-axis]] — the surface a
  collapsible does not paint.
- [[0035-field-and-form-control-primitives]] — `useId()`, and why a primitive takes no `id` prop.
- [[0036-toggle-group-mode-axis-and-pressed-semantics]] — the single-axis precedent, the state
  modifier, and the controlled/uncontrolled line.
- [[0042-token-adoption-ratchet]] — `BASELINE` stays empty.
- [[0044-motion-scale-and-reduced-motion]] — the marker's turn, reached without being named.
- [[0068-sidebar-toggle-beside-the-app-name]] — the sidebar's collapse flag, which this is not.
