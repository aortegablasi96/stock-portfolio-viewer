# 0044. Two durations, two easings, and reduced motion honoured by redefining them

- **Status:** Accepted
- **Date:** 2026-08-09

## Context

[[0031-design-token-scales]] gave `app.css` a named scale for spacing, radius, type and focus, and
[[0042-token-adoption-ratchet]] gave that scale a test that fails when a new rule hard-codes a value
it could express. **Motion was in neither.** It is the smallest of the four dimensions — six
declarations in a 2,200-line stylesheet — and it drifted in exactly the way the Epic #125 audit
describes everywhere else:

| Rule | Declared |
| --- | --- |
| `.pie-slice` | `opacity 120ms ease, stroke 120ms ease` |
| `.country-mark-slice`, `.country-mark-dot` | `opacity 90ms ease-out` |
| `.map-popup-shell` | `map-popup-in 120ms ease-out` |
| `.classify-progress-bar` | `inline-size 120ms linear` |
| `.data-table-scroll-capped` | `table-rows-fade linear both` (scroll-driven) |

Four values, five call sites, no rule about which to use. The two donut/map rules are the same
interaction — hover emphasis on a mark the pointer is sweeping across — at two durations and two
near-identical curves (`ease` is `cubic-bezier(.25,.1,.25,1)`, `ease-out` is `(0,0,.58,1)`).

**The accessibility half is the reason this is a story rather than a tidy-up.** The stylesheet held
exactly one `prefers-reduced-motion: reduce` block, and it named `.pie-slice`. A viewer who had asked
the operating system for less motion still got the map popup's entry animation, the country marks'
opacity fade and the classification progress bar — three of the app's five animations. The block was
correct when it was written, and it was wrong within two stories, because a rule that lists what
moves has to be edited every time something new moves. That is the same failure the audit found in
nine button families: not a mistake, an accumulation.

## Decision

### The scale — two durations, two easings, each split by role

```css
--duration-fast: 90ms;
--duration-base: 120ms;
--ease-out: ease-out;
--ease-linear: linear;
```

The durations split by **what the reader is watching**:

- `fast` — feedback on something the pointer is already on. It has to keep up with a pointer
  sweeping across eight donut wedges or forty map marks, so it is the shorter of the two.
- `base` — something arriving, or a value moving under its own steam: the map popup's entry, the
  classification progress bar.

The easings split the same way, and this is why there are two rather than one:

- `--ease-out` is anything the reader watches settle.
- `--ease-linear` is for a width that **reports a number**. Easing `.classify-progress-bar` would say
  the classification sped up and slowed down, which is a claim about the data, not about the
  animation. Linear is not a duller choice there; it is the accurate one.

**The named change: `.pie-slice` moves from 120ms to 90ms.** Following [[0031-design-token-scales]]'s
method — collapse what is one decision made twice, keep what is genuinely two — the donut's hover
emphasis and the map's are one decision, and the tie breaks toward the shorter value. Both are read
by sweeping a pointer across neighbours to compare them, and [[0040-allocation-breakdown-linked-slice-emphasis]]
lights a table row and a wedge together, where a lag is a lag in a link the reader is trying to
trust. The change is 30ms and no test can see it; it is recorded because it is deliberate.

### Reduced motion redefines the scale rather than naming what moves

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration-base: 0ms;
  }
}
```

Every animated rule in the stylesheet draws its duration from a token, so zeroing the tokens stops
all of them at once — **including the ones added after this decision was written.** There is no
selector list to keep in step, no `!important`, and no blanket `*` reset.

This is the same move as [[0031-design-token-scales]]'s `:where()` focus ring, and the same instinct
as the ESLint layer boundaries and the CSP that blocks Mapbox telemetry by omission (ADR-0007):
**forgetting produces the correct result.** A new view that writes `transition: opacity var(--duration-fast) var(--ease-out)`
is covered without its author knowing this decision exists.

Two details that are load-bearing:

- **Source order is the whole mechanism.** `:root` and `@media (…) { :root { … } }` have the same
  specificity and a media query adds none, so the override wins only because it comes second.
  `designTokens.test.ts` asserts the ordering, because a later refactor that moved the block would
  break it silently and look like nothing.
- **Only durations are zeroed.** An easing with no time to run is already inert, so touching
  `--ease-*` would add a second axis of difference for no observable effect.

### One guard, because the two criteria are one criterion

The story asks for a test that fails when a rule declares a raw duration, *and* a test that fails
when an animation sits outside the reduced-motion rule's reach. Under this mechanism those are the
same test: drawing a duration from the scale is exactly what puts a rule inside the reach, so a raw
duration is the only way out. `lib/motionTokens.ts` scans the eight motion properties — the
longhands included, because a guard that only knows the shorthand invites the longhand as the way
around it — and `designTokens.test.ts` asserts the result is empty, that the reduced-motion block is
one block, that it zeroes every duration the scale declares, and that it comes second.

A `transition` or `animation` shorthand carrying **no** time is a violation too. It falls back to
`0s`, which reads as "no motion" but is a value nobody chose — and under this mechanism it is also a
rule the reader's preference cannot reach.

### The scroll-driven table fade is exempt, and structurally so

The capped table's bottom fade ([[0039-data-table-primitive-and-column-sorting]], originally Story
#67) is driven by `animation-timeline: scroll(self block)`. Its progress is the reader's own scroll
position, so it **has no duration** — there is nothing to draw from the scale and nothing for the
reduced-motion rule to zero. The acceptance criteria asked for a decision rather than a particular
answer; the decision is to leave it running, on three grounds:

- **It cannot play by itself.** Every frame it draws is one the reader asked for by scrolling, which
  is the property `prefers-reduced-motion` exists to restore.
- **It moves nothing.** It is an alpha mask on the container's bottom edge. Nothing translates,
  scales or parallaxes, and WCAG 2.3.3's concern is motion animation specifically.
- **It is information, not decoration.** The fade is the "more rows below" affordance on a scroller
  with no visible bottom border. Removing it for the reader who asked for less motion would take a
  cue away from them, which inverts the point of asking.

It is recorded in `EXEMPTIONS` in `lib/motionTokens.ts` with that reasoning, in the shape
[[0042-token-adoption-ratchet]] established — matched on its **value** as well as its key, so the
moment it grows a duration the exemption stops applying and it fails like any other rule.

### What this does not reach

Mapbox GL's own camera animation (`flyTo`, the zoom controls' eased zoom) is the library's, is not
styled by `app.css`, and is out of this story's scope. It is a real remaining gap for a
motion-sensitive reader on the Allocation map, and the honest place for it is a story against Epic
#98, not a token.

## Consequences

Benefits:

- **The accessibility gap closes for good, not for today.** Three of five animations were unguarded;
  the mechanism now covers five of five and every animation added later.
- Four hand-picked values become two named steps with a stated rule, so the next view has a decision
  to inherit rather than a call to make.
- The reduced-motion behaviour is testable in Node (the stylesheet contract) *and* observable in the
  running app (`e2e/reduced-motion.spec.ts` emulates the preference, walks all five views, and reads
  the computed durations back off the three rules that used to escape).
- One block replaces a list that would have needed editing in every future story that animates.

Tradeoffs:

- **A two-step duration scale is coarse**, and the next animation may genuinely want something
  slower than 120ms — a panel expanding, say. The scale gains a named step and a recorded reason,
  which is [[0031-design-token-scales]]'s own answer to the same risk; it does not gain a call-site
  value.
- **`--ease-out: ease-out` is a token that renames a keyword.** It earns its place because the guard
  needs something to check and because the *comment* carries the rule about when to use which — but
  read alone, it looks like ceremony.
- The reduced-motion rule is invisible at the call site: a reader of `.map-popup-shell` sees no
  mention of it. Mitigated by the comment on the block and by the tokens' own comment in `:root`.

Risks:

- **A future rule uses `var(--duration-*)` in something that is not motion** — an
  `animation-timeline` range, say — and reduced motion zeroes something structural. Judged unlikely
  and loud if it happens.
- **The scroll-driven fade's exemption ages badly** if browsers settle on a clear meaning for a time
  duration on a progress-based timeline, or if the fade grows real movement. The exemption is keyed
  to its exact declared value, so either change fails the guard rather than passing quietly.

## Alternatives Considered

### The blanket reset — `*, *::before, *::after { animation-duration: 0.01ms !important; … }`

The widely-copied version, and it does cover everything including Mapbox's own stylesheet. Rejected
on two grounds. It reaches the scroll-driven fade, whose behaviour under a forced time duration is
thinly specified and engine-dependent — changing a working affordance on a guess. And `!important`
on a universal selector is an escape hatch that outranks every rule in the file, in a stylesheet
whose whole Epic has been about making the cascade legible; the token override achieves the same
coverage with ordinary specificity.

### Listing the animated selectors inside the media query

What the stylesheet already did, extended to five rules. Rejected because it is the mechanism that
failed: the block was written for `.pie-slice`, three animations were added after it, and none of
them was added to it. Any solution whose correctness depends on remembering to edit a second place
was already disproved here.

### One duration instead of two

Tempting — 90ms and 120ms are 30ms apart and nobody would name the difference blind. Rejected
because the two do different jobs, and collapsing them would pick a single value that is either too
slow to track a sweeping pointer or too abrupt for a popup arriving from nowhere. Two steps with
stated roles is the smallest scale that still answers "which one".

### Honouring the preference in JavaScript, via `matchMedia`

Rejected: the app has no JS-driven animation to switch off (nothing listens for `transitionend`, and
no component sets a transition inline), so this would add a subscription and a re-render to solve a
problem CSS already owns. It is also the option that fails silently when a component forgets to
subscribe.

## References

- [[0031-design-token-scales]] — the scale this extends, and the `:where()` focus ring whose
  "forgetting produces the correct result" mechanism this copies
- [[0042-token-adoption-ratchet]] — the exemption shape, matched on value as well as key
- [[0030-allocation-map-country-donut-pairs]], [[0041-map-popup-return-tint-strength]] — the country
  marks and the map popup, two of the three animations that were unguarded
- [[0040-allocation-breakdown-linked-slice-emphasis]] — the linked hover emphasis whose duration
  moves 120ms → 90ms here
- [[0039-data-table-primitive-and-column-sorting]] — the capped table carrying the scroll-driven fade
- [[0023-classification-refresh-resumable-and-progress]] — the progress bar whose linear easing is a
  statement about the data
- `src/renderer/src/app.css` (the `:root` motion block and the reduced-motion media query),
  `src/renderer/src/lib/motionTokens.ts`, `src/renderer/src/lib/designTokens.test.ts`,
  `e2e/reduced-motion.spec.ts`
- GitHub Issues #125 (Epic), #154 (Story)
