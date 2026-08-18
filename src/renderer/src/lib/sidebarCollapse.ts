/**
 * The sidebar's two widths, and what changes between them (Story #184, DDR-0057).
 *
 * Collapse is a property of the *shell*, not of the four things standing in it. So it is carried
 * by one class on the app's root element and everything else follows in CSS: the brand keeps its
 * name, the badge keeps its wording, the tabs keep their labels, and each of those is *clipped*
 * rather than removed. Nothing in the rail takes a `collapsed` prop, which is why this module is
 * three functions and a wording pair rather than a state machine.
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

/**
 * A nav row's tooltip: its own label, and only while the label is clipped.
 *
 * An addition, never the mechanism — the row's accessible name is still the label text itself,
 * which stays in the accessibility tree. A `title` on an expanded row would repeat what is
 * already legible beside it.
 */
export function collapsedTitle(collapsed: boolean, label: string): string | undefined {
  return collapsed ? label : undefined
}
