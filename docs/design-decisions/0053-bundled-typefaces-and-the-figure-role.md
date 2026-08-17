# 0053. Two bundled typefaces, and a figure role that is one rule

- **Status:** Accepted
- **Date:** 2026-08-18

## Context

The app shipped no webfont at all. `app.css` set `font-family: system-ui, -apple-system,
'Segoe UI', Roboto, sans-serif` on `body` and every figure in the app — a KPI value, a table cell,
an axis label, a currency chip — rendered in whatever proportional face the operating system
handed over.

That is a correctness problem in a portfolio viewer, not a taste problem. A proportional face gives
`1` a narrower advance than `8`, so two figures of the same length occupy different widths and a
column of money does not line up. Measured in the running app, before this story, three
twelve-character figures at `--text-xl`:

| Figure | Width, system-ui | Width, JetBrains Mono |
| --- | --- | --- |
| `1,111,111.11` | 128.14px | 155.91px |
| `8,888,888.88` | 128.14px | 155.91px |
| `4,062,905.37` | 127.71px | 155.91px |

Under 0.5px of drift is invisible on one row and is exactly why it survived four refinement rounds:
it does not look wrong, it just makes the reader compare digits instead of shapes.

Epic #179 adopts a Figma Make proposal that answers this with **Inter** for prose and **JetBrains
Mono** for figures. It is the milestone's foundation story — nothing else can be restyled until the
faces exist and the figure treatment has a name.

Three constraints shaped the answer, and none of them is about typography.

**The proposal cannot ship as written.** Its stylesheet opens with two
`@import url('https://fonts.googleapis.com/…')` lines. The renderer's CSP admits exactly one
external origin and the *omission* of every other host is the enforcement mechanism, not an
oversight (ADR-0007). A reinstated `@import` fails in the worst possible
way: the request is blocked, the face falls back to system-ui, and the app looks like a font that
did not load rather than like a policy that was violated.

**A monospaced face alone does not clear the bar.** The proposal also asks for `letter-spacing:
-0.02em` on figures, and tabular digits are a separate opt-in again — a mono face is not required
to give its figures the same advance as its letters, and Inter's default tracking reads as gaps
between digits at a tile's `--text-xl`. The requirement is the *pairing*, which means the role is
three properties that only work together.

**Thirteen rules already knew where the figures were.** `app.css` declared
`font-variant-numeric: tabular-nums` at thirteen selectors, chosen one at a time over four
milestones. That set is not a mess to clean up; it is the answer to "what is a figure here",
already written down.

## Decision

**Bundle one variable `woff2` per family, latin subset, as repo assets.** `Inter`
(`wght` 100–900, 48,256 bytes) and `JetBrains Mono` (`wght` 100–800, 40,404 bytes) live in
`src/renderer/src/assets/fonts/` beside their OFL licences and a README recording provenance.
Nothing in `package.json` references them: they were extracted from the published Fontsource
tarballs with `npm pack`, never installed. `app.css` declares the two `@font-face` rules; Vite
emits them into `out/renderer/assets/` with relative `./` URLs, which is what makes them load
under `file://`.

**Two family tokens and a tracking token join the type scale.**

```css
--font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-figure: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', 'Consolas', monospace;
--tracking-figure: -0.02em;
```

`--font-sans` is applied once, on `body`. Its tail is the *exact* stack the app shipped before this
story, so a missing asset degrades to the old look rather than to an unfamiliar one — and both
stacks end in a generic family, so neither can land on a UA's serif default.

**The figure role is one rule, listing the selectors that render a figure**, and it applies all
three properties together:

```css
.stat-value,
.allocation-weight,
.data-table .data-table-num,
.snapshot-value,
.highlight-value,
.pie-legend-value,
.bar-list-value,
.map-popup-row dd,
.chart-axis-label,
.chart-tooltip-date,
.chart-tooltip-value {
  font-family: var(--font-figure);
  font-variant-numeric: tabular-nums;
  letter-spacing: var(--tracking-figure);
}
```

The membership list is the thirteen `tabular-nums` selectors, minus four and plus one.

**Plus `.chart-axis-label`**, whose numbers wanted tabular digits all along and never had them.

**Minus four that render prose *containing* a figure** rather than a figure: `.badge` ("Already
imported"), `.view-updated` ("Refreshing…"), `.map-popup-title` (at sector and country depth it
holds "Information Technology" or "Germany") and `.country-map-unknown` (a full sentence). Each
keeps its own `tabular-nums`, which costs a sentence nothing, and stays in `--font-sans`. Setting a
whole badge in mono to reach the currency chip inside it is a trade for a *variant*, not for a
selector; the badge belongs to Story #186's restyle.

**`font-display: block`,** which inverts the web's usual advice on purpose. There is no network
here — the file sits beside the stylesheet — so the block period costs a frame, while `swap` would
paint every table in system-ui and then reflow it under a face with different metrics. A local app
has no download to hide, only a repaint to avoid.

**No CSP change.** `default-src 'self'` already covers `font-src`, so the policy still names exactly
one external origin. A `font-src` directive was deliberately *not* added: every directive spelled
out is a directive that can later be widened.

## Consequences

Benefits:

- Figures line up. Three equal-length numbers now measure identically, and the reader compares
  magnitudes rather than reading digits.
- The pairing cannot drift. One rule carries all three properties, so nobody can adopt the family
  and forget the tabular digits — the failure mode that makes a mono face look like it worked.
- The faces cannot leak. Both are repo assets, and `lib/figureRole.test.ts` fails on any font host,
  any remote `url()`, any `@import`, and on a CSP that grows a second external origin.
- The bundle is smaller than the proposal's. Two variable files (86.6 KB) against nine static
  latin cuts (roughly 240 KB), and a later story can reach for a weight nobody has cut.
- Chart labels are untouched by DDR-0018's measure. The role gives four SVG `<text>` selectors a
  family and a tracking — both relative, both unchanged inside a `viewBox` — and declares no
  `font-size`, which the guard asserts as an absence.

Tradeoffs:

- **The role is a hand-maintained list.** A new figure class does not join it by being a figure; a
  reader has to add the selector. That is the same trade [[0042-token-adoption-ratchet]] made and
  for the same reason — two mechanical rules were tried there and both leaked, and a rule here
  ("anything with a number in it") would sweep in the four prose selectors this decision
  deliberately excludes.
- **`.badge` is inconsistent until #186.** The native-currency chip is a figure inside a rule that
  is mostly not, so it renders in Inter for now. This is stated rather than hidden.
- **Two primitive guard tests changed shape.** `statTileVariants.test.ts` and
  `dataTableVariants.test.ts` each asserted `font-variant-numeric` on their own rule; they now
  assert membership of the role instead, through `lib/figureRole.ts`. The guarantee is identical
  and the assertion follows where it lives.

Risks:

- **A blocked face is invisible for a frame and then correct**, so a genuinely corrupt asset would
  show as system-ui with no error. The guard tests check the file exists; the running-app check
  reads `document.fonts.check()`.
- **Mono is wider.** JetBrains Mono's advance is 0.6em against Inter's ~0.5em for digits, so every
  figure grew about 20% in width — 128px → 156px for a twelve-character value at `--text-xl`. It
  fits today (`.stat-row`'s `minmax(11rem, 1fr)` columns hold, and the chart tooltip's
  `length * 7 + 16` box has margin to spare up to ~40 characters), but a view story that adds a
  column should re-measure rather than assume.

## Alternatives Considered

### Option A — Add a font package as a dependency

`@fontsource-variable/inter` and `@fontsource-variable/jetbrains-mono` bundle exactly these files
with the `@font-face` rules written for you. Rejected: it is two runtime dependencies in a project
with seven, for two static files that never change, and the packages ship 24 files each to deliver
the two that are wanted. The `npm pack` extraction is recorded in the fonts README, so the
provenance the package would have carried is not lost.

### Option B — Declare the family at each call site

Add `font-family: var(--font-figure)` to each of the eleven rules that already declared
`tabular-nums`. Rejected: it makes the pairing the author's responsibility eleven times over, and
the twelfth rule is the one that gets the family without the tracking. This is the argument the
`:where()` focus ring and the reduced-motion block both make in this stylesheet — forgetting should
produce the correct result.

### Option C — A `.figure` utility class on the markup instead of a selector list

Cleaner in the abstract, and it would let a new figure opt in without touching CSS. Rejected for
now: it moves a styling decision into eleven components for no behaviour change, in a story whose
scope is explicitly "add the role, restyle nothing". If a later view story finds itself editing
this list repeatedly, adding `.figure` to the selector list is a one-line change that makes both
routes work.

### Option D — Keep `swap` and accept the reflow

The universally recommended `font-display` value. Rejected: the reasoning behind it — never hide
text behind a network request — has no force when the file is local. What `swap` actually buys
here is a guaranteed second layout of every table in the app.

## References

- Story #180, Epic #179 — the visual redesign's foundation
- `src/renderer/src/assets/fonts/README.md` — provenance, sizes, and what was deliberately not taken
- ADR-0007 — the Mapbox basemap and the renderer's one allowed origin
- ADR-0008 — an in-house design system; no component library
- [[0031-design-token-scales]] — the scale these families join
- [[0042-token-adoption-ratchet]] — the hand-enumerated-list precedent, and the comment-stripping trap
- [[0018-content-measure-and-chart-aspect]] — why the role declares no `font-size`
- [[0034-stat-tile-primitive-tone-axis]], [[0039-data-table-primitive-and-column-sorting]] — the two
  primitives whose tabular-digit assertions moved
