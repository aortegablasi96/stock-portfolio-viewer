/**
 * The `Collapsible` primitive's contract (Story #308, DDR-0106).
 *
 * Same split as the button's, the card's, the field's and the toggle group's (DDR-0032, DDR-0033,
 * DDR-0035, DDR-0036), for the same reason: Vitest runs Node-only with no jsdom, so nothing inside
 * a component is testable (DDR-0029). Keeping the union, the heading map, the aria pair and the
 * class composition here lets the test assert both halves of the contract — that a call composes
 * what a caller expects, and that `app.css` declares a rule behind every member of the union.
 *
 * **This is a disclosure, not an accordion.** #308 excludes sibling coordination on purpose:
 * #310 wants six surfaces that open independently. The WAI-ARIA disclosure pattern is exactly
 * that, and it is small — a button carrying `aria-expanded` and `aria-controls`, and a container
 * the id names. Everything else the accordion pattern adds (a heading wrapper is kept, but
 * `role="region"`, `aria-labelledby` and arrow-key navigation are not) exists to coordinate
 * panels that this primitive deliberately does not coordinate.
 *
 * The axis is **`level`, not `variant`/`size`**. What genuinely differs between #310's six call
 * sites is not colour and not padding — a collapsible paints no surface at all — but *what it
 * encloses*: the profile as a whole encloses five cards, and each section is one card's body. That
 * is a fact about depth, so it carries the head's type step **and the heading element** together
 * (see {@link headingFor}). A `size` axis was declined for DDR-0034's reason: it would ship with
 * one value in use.
 */

/**
 * How deep the collapsible sits. The only axis, and it carries two things that must agree: the
 * head's type step, and the heading element the trigger is wrapped in.
 *
 * `group` is a band above a stack of cards — #310's profile as a whole, drawn on the page ground.
 * `section` is one card's own head and body, and is the default because five of the six call
 * sites are one.
 *
 * Deriving the heading level from the visual level is the point rather than a shortcut: the two
 * values exist *because* one nests inside the other, so a `group` that rendered an `h3` beside a
 * `section`'s `h3` would be a document outline disagreeing with the picture. `Card` makes the same
 * call from the other side — `CardTitle` is always an `h2` (DDR-0033) — and a `section` collapsible
 * replaces that title, one level down from the band above it.
 */
export const COLLAPSIBLE_LEVELS = ['group', 'section'] as const

export type CollapsibleLevel = (typeof COLLAPSIBLE_LEVELS)[number]

export const DEFAULT_COLLAPSIBLE_LEVEL = 'section' satisfies CollapsibleLevel

/** The heading element each level wraps its trigger in. Not a prop: see {@link COLLAPSIBLE_LEVELS}. */
const HEADING_ELEMENTS = {
  group: 'h2',
  section: 'h3',
} as const satisfies Record<CollapsibleLevel, 'h2' | 'h3'>

export type CollapsibleHeading = (typeof HEADING_ELEMENTS)[CollapsibleLevel]

export function headingFor(level: CollapsibleLevel = DEFAULT_COLLAPSIBLE_LEVEL): CollapsibleHeading {
  return HEADING_ELEMENTS[level]
}

/**
 * The parts a collapsible draws, each of which has a rule and none of which varies by level.
 *
 * `action` is the one that needs saying. Four of #310's five sections carry a control in their card
 * head since Story #347 — the three "+ Add target"s and "+ Add limit" — and a control inside the
 * trigger would be a button inside a button, which is invalid markup that renders and then swallows
 * one of the two clicks. The slot puts it *beside* the trigger, so the primitive makes that mistake
 * unavailable rather than leaving it to a call site to remember.
 *
 * The profile's `ConfirmAction` was the fifth until #347 took the clear out of a disclosure
 * altogether: the five that fold each hold a form, and a fold over one button would have hidden a
 * control behind a click revealing nothing else (DDR-0115).
 */
export const COLLAPSIBLE_PARTS = ['head', 'heading', 'trigger', 'action', 'panel'] as const

export type CollapsiblePart = (typeof COLLAPSIBLE_PARTS)[number]

/** Append a call site's `className` for placement, never for restyling (ADR-0008). */
function compose(parts: string[], className?: string): string {
  return className ? [...parts, className].join(' ') : parts.join(' ')
}

/** Compose the class list for the wrapper, which is the one element carrying the level. */
export function collapsibleClassName(
  level: CollapsibleLevel = DEFAULT_COLLAPSIBLE_LEVEL,
  className?: string,
): string {
  return compose(['collapsible', `collapsible-${level}`], className)
}

/** Compose the class list for one part. Levelless: only the wrapper carries the axis. */
export function collapsiblePartClassName(part: CollapsiblePart, className?: string): string {
  return compose([`collapsible-${part}`], className)
}

/**
 * The marker's class list. `open` is a state rather than an axis, so it adds a modifier the way
 * `toggle-item-active` does (DDR-0036) rather than becoming a second axis value.
 *
 * The rotation lives on the *modifier*, which decides which way round the glyph is drawn: the
 * path points right at rest, and open turns it down. Rotating in the resting state instead would
 * put a transform on every collapsed section on the page to say nothing.
 */
export function collapsibleMarkerClassName(open: boolean, className?: string): string {
  const parts = ['collapsible-marker']
  if (open) parts.push('collapsible-marker-open')
  return compose(parts, className)
}

/**
 * The two attributes that make a trigger a disclosure, kept together because either one alone is
 * a lie: `aria-expanded` with nothing to control announces a state for a region the reader cannot
 * be sent to, and `aria-controls` without it names a panel whose state is unstated.
 *
 * The id is the caller's `useId()`, for DDR-0035's reason — six of these are in one document in
 * #310, and every analytics view stays mounted (DDR-0027), so any fixed or defaulted id would
 * name only whichever instance the document happens to hold first.
 */
export function triggerAria(
  open: boolean,
  panelId: string,
): { 'aria-expanded': boolean; 'aria-controls': string } {
  return { 'aria-expanded': open, 'aria-controls': panelId }
}
