/**
 * The Assistant's two columns, and what changes between them (Story #343, DDR-0115).
 *
 * The view stopped being a page that scrolls and became a **frame**: a fixed-width column holding
 * the standard the owner set, and the conversation filling what is left. Neither column scrolls
 * the page — each scrolls itself — which is the whole reason the widths are written down rather
 * than inferred from content.
 *
 * It is the same shape as `lib/sidebarCollapse.ts` and for the same reason: Vitest runs Node-only
 * with no jsdom (DDR-0029), so a width, a class name or a control's wording living inside a
 * component is a decision nothing can assert. What is here is exactly the part that decides class
 * names, words and numbers, and none of it needs a DOM. The cascade resolving and the measured
 * column are `e2e/assistant-layout.spec.ts`'s, which is the same division
 * `sidebar-collapse.spec.ts` already makes.
 *
 * **The two rails are two constants and may not be unified** (DDR-0115 amendment 2). The nav's
 * rail is 56px because a 32px brand tile plus the column's two `--space-3` gutters is 48px of
 * content with 8px left for the focus ring (DDR-0057). This one is 48px because that is what the
 * design draws around a 32px expander. They are different numbers for different reasons, and a
 * shared `--rail-width` would make either impossible to tune without moving the other and the
 * Performance breakpoints behind it (DDR-0068).
 *
 * **420 and 48 are the design's specification, not suggestions** (DDR-0115 amendment 8). Neither
 * is a `--space-*` step and neither is rounded to one: each is a named custom property in
 * `app.css` with a test, the way `--donut-column-width` already is (DDR-0063), and
 * `lib/tokenAdoption.ts`'s `BASELINE` stays empty.
 */

/**
 * The expanded column, in px — the design's own measure (`figma_design/src/App.tsx:1836`).
 *
 * Wide enough for the five target sections' two-column rows without either side wrapping, which
 * is what a narrower column would have cost: the profile's rows put a term beside a percentage,
 * and a wrapped row reads as two settings rather than one.
 */
export const PROFILE_COLUMN_WIDTH_PX = 420

/**
 * The collapsed rail, in px (`figma_design/src/App.tsx:1836`).
 *
 * It holds a 32px expander centred in it — 32 plus 8 on each side — and the completeness dot
 * below it. Deliberately **not** `--sidebar-width-collapsed`: see the module note.
 */
export const PROFILE_RAIL_WIDTH_PX = 48

/** The custom properties `app.css` declares the two widths as, asserted by test in both places. */
export const PROFILE_WIDTH_TOKENS = {
  expanded: '--assistant-profile-width',
  collapsed: '--assistant-profile-rail-width',
} as const

/** The column's base class, worn in both states so every rule below has one hook. */
export const PROFILE_COLUMN_CLASS = 'assistant-profile-column'

/** The flag every collapsed rule hangs off. One class on the column, as DDR-0057 does the shell. */
export const PROFILE_COLLAPSED_CLASS = 'assistant-profile-collapsed'

/**
 * The view's heading, drawn as the design's accent eyebrow (`figma_design/src/App.tsx:1880`).
 *
 * It is an `<h1>`, not decoration: this view has no `PageHeader` any more and no `AnalyticsShell`
 * to wear, so the eyebrow is the document's only heading for the panel (DDR-0115 amendment 1).
 * Uppercasing is `text-transform`, so the accessible name stays the sentence case written here.
 */
export const ASSISTANT_EYEBROW = 'AI Assistant'

/**
 * The toggle's accessible name, which states the action rather than the state.
 *
 * `aria-expanded` on the button already carries the state, so a name repeating it would say it
 * twice — `sidebarToggleLabel`'s argument, applied to the second collapsing edge. The design
 * titles the two halves asymmetrically (`Expand investor profile` / `Collapse profile`); the
 * expanding half is the one Story #343 pins, and the pair is made symmetric because the app's own
 * toggle already reads that way and a reader meets both names on one control.
 */
export const PROFILE_TOGGLE_LABELS = {
  collapse: 'Collapse investor profile',
  expand: 'Expand investor profile',
} as const

export function profileToggleLabel(collapsed: boolean): string {
  return collapsed ? PROFILE_TOGGLE_LABELS.expand : PROFILE_TOGGLE_LABELS.collapse
}

/** The column's classes: one flag, so no rule below needs to know how it got there. */
export function profileColumnClassName(collapsed: boolean): string {
  return collapsed ? `${PROFILE_COLUMN_CLASS} ${PROFILE_COLLAPSED_CLASS}` : PROFILE_COLUMN_CLASS
}

/**
 * Whether the rail's dot reads as a profile that says something.
 *
 * The style tags alone, which is the design's own reading (`figma_design/src/App.tsx:1830`) and
 * the right one: a tag is the only part of the profile that is never a *number*, so it is the
 * part that says a standard was stated at all rather than that one dimension was targeted.
 */
export function isProfileStated(styleTagCount: number): boolean {
  return styleTagCount > 0
}

/**
 * The dot's tooltip, which is where its state is actually readable.
 *
 * The mark itself is colour and a glow, and `--pos` may never be a mark's only channel
 * (DDR-0021) — so the count travels with it in both states, and the dot is `aria-hidden` with
 * this on the element that carries it. Singular at one, which is the design's own format.
 */
export function profileDotTitle(styleTagCount: number): string {
  return `Profile: ${styleTagCount} style tag${styleTagCount === 1 ? '' : 's'}`
}
