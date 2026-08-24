# 0033. One card surface: two variants, three paddings, and a body that is a scope

- **Status:** Accepted — one stated exception in
  [[0084-the-chart-card-drops-the-strip]] (the chart card's header, scoped by class rather than by a
  third axis)
- **Date:** 2026-07-31

## Context

The Epic #125 audit found **seven card surfaces in `app.css`**, each restating the same three
declarations —

```css
background: var(--card);
border: 1px solid var(--border);
border-radius: 12px;
```

— and then disagreeing about everything after them:

| Rule | Padding | Surface |
| --- | --- | --- |
| `.state-panel` | `2rem` | `--card` |
| `.panel`, `.allocation`, `.snapshot-history` | `1.25rem` | `--card` |
| `.stat-tile`, `.balance-tile` | `1.1rem 1.25rem` | `--card` |
| `.highlight-card` | `1rem 1.1rem` | `--bg` |

Four paddings and no rule saying which to use where. Their headings disagreed too: `.panel-title`
was sentence case, `.snapshot-history h2` uppercase and letter-spaced — the same job, two answers.

This DDR covers the five panel surfaces. `.stat-tile` and `.balance-tile` are Story #129, which
builds on this card.

[[0031-design-token-scales]] declared `--surface-pad-sm|md|lg` for exactly this, and
[[0032-button-primitive-variants-and-sizes]] established the shape a primitive takes here. ADR-0008
decided the primitives are built in-house with shadcn's API rather than shadcn's package.

## Decision

**One `Card` component, on the same two axes as the button.**

`src/renderer/src/components/ui/Card.tsx` exports `Card` / `CardHeader` / `CardTitle` /
`CardContent`, the composition shape ADR-0008 adopts from shadcn.

### Variants carry the surface colour. Nothing else.

| Variant | Surface | Replaces |
| --- | --- | --- |
| `default` | `--card` | `.state-panel`, `.panel`, `.allocation`, `.snapshot-history` |
| `nested` | `--bg` | `.highlight-card` |

`.highlight-card`'s odd `--bg` is **kept**, and named. It is not drift: that card sits *inside* a
panel, and a `--card` surface on a `--card` surface is a border with nothing behind it. A nested
card recedes to the page background and reads as an inset well. Normalising it to `--card` would
have been the tidier-looking change and the wrong one.

### Sizes carry the padding. Nothing else.

`sm | md | lg` **are** the `--surface-pad-*` steps, so the component API and the stylesheet share
one vocabulary and cannot drift apart — a test asserts each `.card-<size>` rule resolves to
`var(--surface-pad-<size>)` and nothing else. `sm` is a nested card, `md` a panel, `lg` a
full-width state panel.

### One heading treatment: sentence case wins

`.card-title` is sentence case at `--text-sm`, muted — the old `.panel-title`. It was already
fourteen of the fifteen call sites, and the alternative is not free: uppercase-with-tracking is
this app's treatment for a **label naming one figure** (`.balance-label`, `.stat-label`,
`.highlight-label`). Using it for section headings too would spend the distinction. The three
headings that changed are on the Portfolio tab — *History*, *Flex Query import*, *Stored
statements* — which now match the eleven analytics panels rather than disagreeing with them.

### `as` is a prop, because the surfaces were not all the same element

Most are a `<section>`; the realized-gains highlight is a `<div>`; the one-line loading states are
a `<p>`, and a `<p>`'s UA margins are part of how `.dashboard`'s flex column spaces them. Changing
the element would move the page, so the element stays the caller's decision.

### `CardContent` looks like an empty wrapper and is not — it is a scope

`.panel` declared two rules on its descendants: a `.table-scroll` filling the body drops its own
border, and a `.source-note` lede under the title sits tighter. Those now hang off **the body**
rather than the surface:

```css
.card-content .table-scroll { border: none; background: transparent; }
.card-content .source-note  { margin: calc(-1 * var(--space-3)) 0 var(--space-5); }
```

That distinction is load-bearing. A state panel is a card whose content is prose, and it writes
that prose directly into the card — so it never enters either rule's reach. Had these been scoped
to `.card`, the *not responding* panel's `.source-note` would have picked up a negative top margin
it was never written for. `CardContent` is also where Story #134's `DataTable` lands.

### `CardHeader` takes an `align`, because that is the one thing the old headers disagreed about

`.panel-header` centred (a one-line title beside a filter toolbar); `.snapshot-history-head` and
`.flex-import-head` started (a title with a lede, beside a stacked pair of buttons). Both are
right for their case, so it is a typed prop rather than a second class. A header that is the whole
card — the import panel before anything is imported — drops its own bottom margin via
`.card-header:last-child`, so an absent body costs no space.

## Consequences

- **Adding a panel means naming a variant and a size**, not writing three declarations and
  guessing at a fourth. `.panel-toolbar` / `.panel-count` are renamed `.card-toolbar` /
  `.card-count`, so no `.panel*` selector outlives `.panel`.
- **No card declares a focus ring**, same as the button: `.tab-panel` and every control inside a
  card fall through to the zero-specificity base rule (DDR-0031). `lib/cardVariants.test.ts`
  fails if one tries, if a union member has no rule in `app.css`, if a size stops resolving to its
  `--surface-pad-*` step, or if any of the five superseded surfaces reappears.
- **`.state-panel` survives, shrunken to `color: var(--muted)`.** Only the surface half moved
  here; the notice/error variants and the louder heading belong to the `StatePanel` story, #133,
  which folds the rest away. Passing `className="state-panel state-error"` is the transitional
  state, not the pattern.
- **Four deliberate visual corrections**, each confirmed by pixel-diffing all five views against
  `main` — nothing else on any page moved:
  1. Three Portfolio-tab headings lose uppercase and letter-spacing (above).
  2. `.highlight-card`'s horizontal padding rounds `1.1rem → 1rem` onto the scale (1.6px a side).
  3. The two tables inside the Flex import cards lose a redundant 1px outline. They were the only
     in-card tables in the app still drawing their own box on top of the card's; the other eight
     already didn't.
  4. The Flex import lede sits at the `0.35rem` its own rule asks for, instead of the `1rem` the
     heading's bottom margin was silently imposing over it — the lede now groups with its title.
- **Charts keep their own containers.** `.chart-figure`, `.pie-figure` and `.country-map-frame`
  are out of scope and unchanged (DDR-0018, DDR-0030).
