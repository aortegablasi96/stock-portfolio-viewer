# 0008. An in-house design system; shadcn/ui declined

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

`src/renderer/src/app.css` has grown one view at a time to ~1,880 lines and ~250 selectors, and
the audit behind Epic #125 found the same control declared several times over with unintended
differences: nine button families for one control, seven card surfaces restating the same three
declarations, `.balance-label` and `.stat-label` byte-identical, and every focus ring `--accent`
except `.danger-button`, which used `--neg`. None of it is a bug. It is a tax on every new view,
which re-decides padding, radius, focus and heading case from scratch.

Consolidating is not in question. **Where the consolidated components come from is**, and it is
an architectural question rather than a design one, because the obvious answer — shadcn/ui — is a
build-system change, not a component import. The `shadcn` CLI is already in `devDependencies` and
its MCP server is enabled, so the option is live and a future contributor will reasonably ask why
it was not taken. `CLAUDE.md` requires that an accepted decision is never silently overridden;
without this ADR there is no decision to override.

The project's stated stance is dependency-minimal (`CLAUDE.md`, "Stack"): seven runtime
dependencies, hand-written inline SVG instead of a charting library, and one scoped exception for
`mapbox-gl` recorded in [[0007-mapbox-basemap-and-renderer-network-policy]]. That exception is the
precedent for how a large dependency gets in: a specific problem the codebase cannot solve for
itself, argued in an ADR.

## Decision

### Build the primitives in-house, under `src/renderer/src/components/ui/`

Epic #125's primitives — `Button`, `Card`, `StatTile`, `Field`, `ToggleGroup`, `Badge`,
`StatePanel`, `DataTable` — are written in this repository as ordinary React components styled by
CSS custom properties. No new runtime dependency enters the renderer.

### Adopt shadcn's component *API*, not its package

The parts of shadcn/ui worth having are its interface conventions, and those are free:

- a **`variant` / `size` prop contract** on controls, so a caller names intent (`variant="danger"`,
  `size="sm"`) rather than picking a class;
- **`Card` / `CardHeader` / `CardContent` composition**, so a surface is assembled from parts
  rather than configured through props;
- primitives that **forward their remaining props and `className`**, so a call site can extend one
  without forking it.

Copying the shape keeps the door open: if the tradeoffs below ever change, components written to
this API are far cheaper to swap than components written to an ad-hoc one.

### Drive everything from an explicit token scale

The primitives hard-code no value the token scale can express. The scale itself — spacing, radius,
type, focus — is a design decision and is recorded separately in DDR-0031.

### Do not run `shadcn add`

The CLI and MCP server stay, as a **reference** for the component API. They are not a route to
installing components. Re-proposing the package requires new reasons and a new ADR superseding
this one.

## Consequences

### Benefits

- The renderer keeps **one** styling system. Every rule is in `app.css`, driven by tokens the
  project owns, and a reader has one place to look.
- No change to the renderer build. No Tailwind, no PostCSS, no new toolchain step, no new CI
  surface, and the CSP ([[0007-mapbox-basemap-and-renderer-network-policy]]) is untouched.
- Everything remains testable under the project's Node-only Vitest setup, because the logic stays
  in pure modules under `renderer/src/lib/` where the project already puts it (DDR-0029).
- The primitives can be exactly as opinionated as this app needs. A `StatTile` that knows about
  `font-variant-numeric: tabular-nums` and a gain/loss sign is not a component any library ships.

### Tradeoffs

- **We own the accessibility work.** shadcn inherits Radix's focus management, ARIA wiring and
  keyboard behaviour; here each primitive must earn it, and the reviewer for each story is the only
  thing standing between a primitive and a missing `aria-*`. Partly mitigated: the app's one
  genuinely hard pattern, the tab shell, is already built and pinned by `e2e/tab-navigation.spec.ts`
  (DDR-0029).
- **No upstream.** Fixes and new patterns arrive when someone writes them. Acceptable for a
  single-user desktop app with five views.
- The primitives will be less general than a library's. Deliberate — see the last benefit.

### Risks

- **The consolidation stalls half-done**, leaving primitives beside the duplicate rules they were
  meant to replace, which is worse than either end state. Mitigated by Epic #125's acceptance
  criterion that each story *deletes* the rules it supersedes rather than orphaning them, and by
  DDR-0031's contract test failing if the token foundation erodes.
- **The API drifts from shadcn's** over time, quietly costing the escape hatch above. Accepted;
  the value of the escape hatch is modest and the cost of policing it is not.

## Alternatives Considered

### Option A — Adopt shadcn/ui

Rejected. Four independent reasons, any one of which would be arguable alone:

1. **It is a build-system change.** shadcn/ui v4 requires Tailwind v4 and PostCSS in the renderer
   build, plus `radix-ui`, `cva`, `clsx`, `tailwind-merge` and `lucide-react`.
2. **The app would run two styling systems.** Roughly 40% of `app.css` is chart, donut and map
   styling — `.pie-series-*`, `.country-mark-*`, `.map-diverge-*`, the Mapbox popup overrides —
   for which shadcn has no equivalent. Those rules stay in `app.css` under any scenario, so
   adopting Tailwind adds a second system rather than replacing the first.
3. **It would displace tested code with untestable code.** Radix Tabs would replace
   `lib/tabKeyboard.ts`, which exists precisely because Vitest runs Node-only here and nothing
   inside a component is testable (DDR-0029). Trading a unit-tested module for library internals
   is the wrong direction in a codebase whose test strategy is built around that constraint.
4. **Much of its value is already ruled out.** Dialog, AlertDialog, Sheet and Popover carry a large
   share of what makes shadcn worth its cost, and [[0012-in-place-destructive-confirm]]
   (DDR-0012) rules out modal dialogs for this app entirely.

The remaining value is the `variant`/`size` API and the composition shape, which the Decision above
takes for free.

### Option B — A smaller headless library (Radix primitives alone, or Ark UI)

Would buy the accessibility work — the one real tradeoff above — without Tailwind. Genuinely
tempting, and the closest call here. Not chosen: the primitives this Epic actually needs are a
button, a card, a tile, a label, a chip, a state panel and a sortable table. Six of the seven are
static markup with no interaction model to get wrong, the seventh (`ToggleGroup`) is a handful of
key handlers, and the app's one hard pattern is already built and e2e-pinned. A dependency that
solves the easy 90% of an easy problem is not worth its weight here. Recorded as the fallback if a
later view needs a combobox, a date picker, or a focus-trapped surface — components where the
calculus genuinely reverses.

### Option C — Keep going as-is, tidying opportunistically

Rejected: it is what produced the audit. Nine button families arrived one defensible decision at a
time, and nothing in "tidy as you go" stops the tenth.

### Option D — Copy shadcn's source files in and strip Tailwind out

Rejected as the worst of both: the maintenance burden of owning the code, plus components shaped
around utility classes and `cva` that would need rewriting to reach the same place the Decision
reaches directly. Reading the source as a reference — which the MCP server is retained for — gets
the same insight at no cost.

## References

- Companion DDR-0031 (the token scale this system is driven by)
- [[0007-mapbox-basemap-and-renderer-network-policy]] — the precedent for admitting a large
  renderer dependency, and the bar it had to clear
- [[0002-typed-ipc-contract]], [[0003-sqlite-drizzle-persistence]] — the ESLint-enforced layer
  boundaries this Epic does not touch (it is renderer-only)
- DDR-0012 (in-place destructive confirm), DDR-0029 (tab shell ARIA pattern and why its keyboard
  logic is a pure module), DDR-0018 (`--content-max` / `--content-pad`, the precedent for a shared
  measure token), DDR-0021 / DDR-0030 (the validated palettes left untouched)
- `src/renderer/src/app.css` at commit `797cb44` — the audit basis
- GitHub Issues #125 (Epic), #126 (Story)
