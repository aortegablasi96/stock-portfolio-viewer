/**
 * The sidebar's two widths, and what changes between them (Story #184, DDR-0057).
 *
 * Collapse is a property of the *shell*, not of the four things standing in it. So it is carried
 * by one class on the app's root element and everything else follows in CSS: the brand keeps its
 * name, the badge keeps its wording, the tabs keep their labels, and each of those is *clipped*
 * rather than removed. Nothing in the rail takes a `collapsed` prop, which is why this module is
 * two functions and a wording pair rather than a state machine.
 *
 * A nav row's tooltip used to live here too, as `collapsedTitle` — a `title` carrying the row's own
 * label, and only while that label was clipped, because a tooltip repeating text legible beside it
 * says nothing. Story #254 gave the tooltip something the sidebar cannot otherwise state (the
 * accelerator that reaches the row), so it is a row's title in *both* states now and it moved to
 * `lib/viewShortcut.ts`, which owns the binding it discloses (DDR-0083 amends DDR-0057).
 *
 * It lives here for the reason every other bit of renderer logic does: Vitest runs Node-only, so
 * nothing inside a component is testable (DDR-0029). What is worth testing is exactly the part
 * that decides class names and words, and none of it needs a DOM.
 */

/** The flag every collapsed rule hangs off, set on the app's root element. */
export const COLLAPSED_CLASS = 'app-collapsed'

/**
 * The class that lets the width animate, applied a frame *after* the stored state arrives.
 *
 * The state is read over IPC, so the first paint is always the expanded column. Without this the
 * rail a reader deliberately left collapsed would slide shut in front of them on every launch —
 * an animation reporting a decision they made yesterday. Applied late, the stored width is simply
 * where the sidebar already is, and every later toggle animates.
 */
export const ANIMATED_CLASS = 'app-sidebar-animated'

/**
 * The toggle's accessible name, which states the action rather than the state.
 *
 * `aria-expanded` on the button already carries the state, so a name like "Sidebar" would leave a
 * reader to infer the verb, and a name that repeated the state would say it twice.
 */
export const SIDEBAR_TOGGLE_LABELS = {
  collapse: 'Collapse sidebar',
  expand: 'Expand sidebar',
} as const

export function sidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? SIDEBAR_TOGGLE_LABELS.expand : SIDEBAR_TOGGLE_LABELS.collapse
}

/** The app root's classes: one flag, so no rule below needs to know how it got there. */
export function shellClassName(collapsed: boolean): string {
  return collapsed ? `app ${COLLAPSED_CLASS}` : 'app'
}

/** The sidebar's own classes. See {@link ANIMATED_CLASS} for why the transition arrives late. */
export function sidebarClassName(animated: boolean): string {
  return animated ? `app-sidebar ${ANIMATED_CLASS}` : 'app-sidebar'
}
