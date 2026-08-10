# 0047. The Allocation map is a labelled group whose graphics are inert

- **Status:** Accepted (extends [[0030-allocation-map-country-donut-pairs]], [[0046-contrast-split-tone-tokens]])
- **Date:** 2026-08-10
- **Bug:** #164, found by the audit under Epic #162

## Context

The map container declared `role="img"` with an `aria-label` describing the mark set. That role is
a promise: *one atomic graphic, nothing inside worth exploring.* The container could not keep it.
Mapbox mounts inside it a canvas that is focusable and pans with the arrow keys, six markers it
would give `tabindex="0"`, and an attribution control — a button and four links.

axe reported it as `nested-interactive` (serious): a screen reader was told not to look inside a
subtree a keyboard could still walk into, landing on a canvas that announces nothing.

The obvious fix — keep the promise and make the subtree inert — was tried first and **does not
work**. `attributionControl: true` is not ours to switch off: Mapbox's terms require the
attribution, the existing code says so, and its links are genuinely interactive content that
should be reachable. A container that must contain real links cannot be an image.

## Decision

### The container is `role="group"`, keeping its `aria-label`

`group` permits focusable descendants, so the contradiction disappears without hiding anything.
The label still names the map, so entering the region is still announced with what it shows.

### The graphics inside it are made inert

What was never true is that the *marks* are operable, so they stop pretending to be:

- **`keyboard: false`** on the `Map`, and the canvas gets `tabindex="-1"`.
- **Every marker host gets `tabindex="-1"`**, set *before* the `Marker` is constructed — Mapbox
  assigns its own `tabindex="0"` only when the element does not already carry one
  (`this._originalTabIndex || setAttribute(...)`), so pre-setting it is how a custom marker opts
  out. Set afterwards, it would be silently undone.

This follows [[0030-allocation-map-country-donut-pairs]] rather than reversing it. That decision
already established the map is approximate, positioned by issuer country rather than by company,
and that **the Positions table is where one company is read**. A mark reveals its detail through a
hover popup that no keyboard can open, dismiss or read; six tab stops that announce a country name
and offer nothing would be an affordance in name only.

So what remains focusable inside the container is exactly what should be: the attribution.

### The zoom controls were already right, and stay outside

They are siblings of the container, in their own `role="group"` labelled *Map zoom*, as real
`Button`s ([[0032-button-primitive-variants-and-sizes]]). Making the map's graphics inert cannot
reach them, and the map stays keyboard-operable in the way that matters — zoom in, zoom out, reset.

### The guard is a text scan of the component

`lib/mapAccessibility.test.ts` reads `CountryMap.tsx` and pins the role, the label, both inert
paths, the marker ordering, and the two things whose *absence* would change the reasoning —
`attributionControl: true`, and the zoom controls being outside the container.

A text guard is not the first choice; it is the only one that runs. The decision lives in a
`.tsx`, Vitest is Node-only with no jsdom so the component cannot be rendered, and `e2e/` is
excluded from CI because it needs a display server.

**It strips comments before matching, and that is load-bearing.** The component explains these
decisions in prose, so `keyboard: false` and `role="img"` both appear in commentary as well as in
code. Measured during review: deleting the real `keyboard: false` declaration left the assertion
green, because the sentence describing it still matched. [[0042-token-adoption-ratchet]] records
the identical trap in `app.css`, which quotes lengths in prose. Only block comments and whole-line
`//` comments are stripped — a naive `//` rule would eat `mapbox://styles/…`.

## Consequences

### Benefits

- The map no longer lies to assistive technology, and axe reports no `nested-interactive`
  anywhere. Verified against the populated view.
- Attribution stays reachable, so Mapbox's terms are met by more than a visual.
- Six pointless tab stops and a dead canvas stop sitting between the reader and the zoom controls.

### Tradeoffs

- **Arrow-key panning is gone.** Nothing promised it, and it panned a graphic whose marks cannot
  be reached — but it was a capability and it is now absent. Scroll-to-zoom, drag-to-pan and the
  three zoom buttons are untouched.
- **A `group` is a weaker announcement than an `img`.** An image would have been read as one
  described thing; a group is a boundary with a name. That is the honest description of a
  container holding a graphic *and* attribution links.
- **The guard is textual**, so it pins the shape of the code rather than the behaviour of the DOM.
  It would not catch a future Mapbox version making something else focusable — only a real browser
  can, and that is `e2e/`, which CI does not run.

### Still open

The tab panels remain outside a landmark (axe `region`, moderate, best-practice rather than WCAG),
as recorded in [[0046-contrast-split-tone-tokens]]. `.tab-panel` wraps each view's `<main>`, so
clearing it means restructuring [[0029-tab-shell-aria-pattern-and-keyboard-navigation]] across
every view, and with tabs staying mounted
([[0027-analytics-views-persist-and-explicit-refresh]]) several `<main>` elements would coexist.
