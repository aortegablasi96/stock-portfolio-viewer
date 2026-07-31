# 0032. One button, named by role: seven variants and four sizes

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

The Epic #125 audit found **eight button families in `app.css` for what is one control**:
`.capture-button`, `.danger-button`, `.ghost-button`, `.retry-button`, `.view-refresh`,
`.type-filter-clear`, `.titlebar-button` and `.map-zoom-btn`.

The first three were byte-identical apart from `color` — 33 lines to say "muted instead of white".
`.retry-button` diverged for no recorded reason: the app's only filled button, with its own padding,
`border: none`, and **no disabled rule at all**, so a disabled Retry looked exactly like a live one.
`.map-zoom-btn` used `opacity: 0.4` where everything else used `0.6`, and until Story #126 it had no
focus ring whatsoever.

None of it was a bug, which is why it accumulated: each family was written when its view was, and
each was defensible alone. The cost is paid on the *next* view, which has eight things to copy from
and no rule saying which.

[[0031-design-token-scales]] laid the foundation — spacing, radius, type, focus — and ADR-0008
decided the primitives are built in-house with shadcn's API rather than shadcn's package. This is the
first primitive built on both.

## Decision

**One `Button` component. Adding a button means naming its role, not writing CSS.**

`src/renderer/src/components/ui/Button.tsx` renders a real `<button>` and forwards every native
prop. Two axes, following shadcn's `variant`/`size` contract (ADR-0008):

### Variants carry colour and border. Nothing else.

| Variant | Look | Replaces |
| --- | --- | --- |
| `outline` *(default)* | bordered, `--text`, hover → accent | `.capture-button` |
| `primary` | filled `--accent`, white | `.retry-button` |
| `secondary` | bordered, `--muted`, hover → `--text` | `.ghost-button`, `.view-refresh` |
| `danger` | bordered, `--neg` label, red fill on hover | `.danger-button` |
| `ghost` | **borderless**, hover-tinted | `.titlebar-button` |
| `link` | underlined text, normal weight | `.type-filter-clear` |
| `surface` | own `--card` background + shadow | `.map-zoom-btn` |

Seven, not the five the story sketched, because seven roles are genuinely in use — and seven
variants of one component is a different thing from eight independent families: they share a base
rule, one disabled treatment, one focus treatment, and one source for every length.

Two of the names correct a misnomer. `.ghost-button` was **not** ghost in shadcn's sense — it had a
border, and it is the *secondary* action beside a louder Confirm. The genuinely borderless control in
this app is the window chrome, so `ghost` now means what it means everywhere else.

`surface` has no shadcn equivalent, and earns its place on a constraint no other button has: it
floats over the **Mapbox basemap**, a canvas the app does not own. A transparent button against
arbitrary map tiles is unreadable, so the surface is load-bearing rather than decorative.

### Sizes carry padding and type. Nothing else.

`sm | md | lg` map to `--control-pad-sm|md|lg` — deliberately the same vocabulary as the tokens
(DDR-0031), so the component API and the CSS agree by construction. `size="sm"` uses `--text-xs`,
not `--text-sm`: the two controls that take it (the analytics Refresh, the filter's Clear) are dense
controls, which is exactly what DDR-0031 scopes `xs` to.

`icon` is a **shape rather than a step on that scale** — a 1.9rem square with no text box, the small
corner radius, and no label of its own, so every icon call site must pass `aria-label`.

### Three things the primitive guarantees rather than asks for

- **`type` defaults to `"button"`.** Every call site in the app wrote `type="button"` by hand; one
  that forgets ships a submit button.
- **No variant declares a focus ring.** It falls through to the zero-specificity base rule
  (DDR-0031), destructive actions included. A variant *cannot* ring differently, and the unit test
  fails if one tries.
- **One disabled treatment** — `opacity: 0.6; cursor: default` — for all seven. This is a real
  behaviour change for `primary` (which had none) and `surface` (which used `0.4`).

### A call site extends the primitive; it does not fork it

`className` is appended, which is how the two buttons with genuinely local geometry work: the title
bar's controls fill the bar's height and square off against its edges
(`.titlebar-controls .btn`), and the map's reset glyph steps down a size. That geometry belongs to
the title bar and the map — not to a button.

### `line-height` is deliberately absent from `.btn`

The one non-obvious rule, and it cost a round to find. `font: inherit` leaves `line-height: normal`,
which is what all eight superseded families used. Setting it to `--leading-tight` instead — which
looks like exactly the kind of token adoption this Epic is for — takes **~3px off every button in the
app** and lifts the entire Portfolio page with it, because `.dashboard-header` is `align-items:
flex-end` over the actions column. The type scale's line heights are for prose and headings; a
one-line label in a box is neither. `.btn-icon` is the exception and sets `line-height: 1` itself.

## Consequences

Benefits:

- Eight families collapse to one component: **101 declarations become 59**, across a similar number
  of rules (27 → 26). The rule count barely moves and that is the point — the saving is not in
  selectors but in *repetition*, since three of those families said nothing to each other except
  `color`, and the box they shared is now declared once.
- Two real defects close as a side effect of consolidating: a filled button that ignored `disabled`,
  and a disabled opacity that disagreed with the rest of the app.
- A new view picks a variant name. It cannot invent a ninth family without deleting a rule someone
  wrote on purpose.
- `buttonVariants.test.ts` pins both halves of the contract — composition, *and* that `app.css`
  declares a rule for every union member, that no variant declares an `outline`, that no variant
  declares its own `:disabled`, and that all eight superseded selectors are **gone from the
  stylesheet** rather than orphaned beside the primitive. That last one is Epic #125's stated risk,
  pinned.

Tradeoffs:

- **Seven variants is more than "a button has three states".** Each is a role in use today and none
  is speculative, but the set is wide enough that a future contributor could reasonably add an eighth
  instead of reusing one. The table above is the defence: a new variant has to name a role that isn't
  in it.
- **`lg` ships unused.** No current button takes it. Included because `--control-pad-lg` already
  exists and DDR-0031's claim — that the API and the CSS share one vocabulary — is only true if the
  three sizes are all there. One CSS rule.
- The `primary` variant keeps `.retry-button`'s filled treatment, which Story #127 questioned as
  arbitrary. Kept, and now deliberate: every call site (Retry, Import statements…, Classify from
  IBKR) *is* the single action its panel offers, which is what a filled accent is for.

Risks:

- **A call site reaches for `className` to restyle rather than to place.** The two that use it today
  set geometry only. A `className` carrying colour would rebuild the problem this DDR solves, one
  view at a time — the same way the original eight arrived.

## Alternatives Considered

### Five variants, as Story #127 sketched, with icon-only as a variant

Rejected on both halves. Collapsing `secondary` into `outline` would have made Cancel and Refresh
white instead of muted — a real change to the visual hierarchy of the confirm flow, unasked for. And
icon-only is not a colour: the two icon buttons in the app are a *ghost* one (window chrome) and a
*surface* one (map). Making "icon" a variant would have forced them to share a colour they don't,
which is precisely the mistake the eight families made. shadcn puts `icon` on `size` for the same
reason.

### One variant with a `tone` prop, or `variant` + `color` as separate axes

Rejected: ADR-0008 adopts a two-axis `variant`/`size` contract, and a third axis multiplies the
combinations without naming any of them. `variant="danger"` says what the button *is*;
`variant="outline" tone="red"` says what it looks like, and the call site has to know that red means
destructive here.

### Keep `.titlebar-button` and `.map-zoom-btn` as separate families

Tempting, since both carry geometry a general button shouldn't know. Rejected: geometry was never the
duplication — colour, border, radius, cursor, disabled and focus were, and those are ~90% of both
rules. Splitting geometry out to a scoped rule at the call site keeps the shared 90% shared and
leaves the title bar owning three declarations instead of ten.

### Adopt the token scale's `line-height` on the base rule

Rejected on evidence, not principle: measured, it shortens every button by ~3px and shifts the whole
Portfolio page. See the Decision. Recorded because it is the obvious move and will be proposed again.

## References

- [[0031-design-token-scales]] — the spacing, radius, type and focus scales this primitive is built
  from, and the base focus rule it deliberately declares nothing against
- ADR-0008 (`docs/decisions/0008-in-house-design-system.md`) — in-house primitives with shadcn's
  `variant`/`size` API and `className` forwarding
- [[0012-in-place-destructive-confirm]] — the confirm flow whose trigger, Confirm and Cancel are now
  `danger` / `danger` / `secondary`
- [[0011-frameless-window-shell]] — the window controls, now `ghost` + `icon`
- [[0030-allocation-map-country-donut-pairs]] — the map whose floating zoom stack is `surface` + `icon`
- [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] — the Node-only test constraint that puts
  the variant unions in `lib/` rather than in the component
- `src/renderer/src/components/ui/Button.tsx`, `src/renderer/src/lib/buttonVariants.ts`,
  `src/renderer/src/lib/buttonVariants.test.ts`, the `.btn` block in `src/renderer/src/app.css`
- GitHub Issues #125 (Epic), #127 (Story)
