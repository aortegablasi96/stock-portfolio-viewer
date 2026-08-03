/**
 * The `StatePanel` primitive's variant/surface contract (Story #133, DDR-0038).
 *
 * Same split as the button's, the card's, the tile's, the field's, the toggle group's and the
 * badge's (DDR-0032 – DDR-0037), for the same reason: Vitest runs Node-only, so nothing inside a
 * component is testable (DDR-0029). Keeping the unions, the class composition and the two
 * derivations — which element the panel is, and how it is announced — in a pure module lets the
 * test assert all of it, `app.css` included.
 *
 * The axes are *not* the button's. A state panel has no size worth choosing (it fills the region
 * whose state it is reporting) and no colour worth choosing (it inherits muted prose). What
 * genuinely varies is which state it presents and whether it brings a surface with it.
 */

/**
 * Which of the four states the panel presents. The app models failure as first-class result
 * variants rather than exceptions (DDR-0002, DDR-0022), and this is the union the renderer
 * presents them with — one name per shape of "there is nothing here to show yet".
 *
 * Only `error` paints anything. That is deliberate and is the same move as the tile's neutral
 * tone (DDR-0034): the axis exists because the *copy* and the *announcement* differ, and a call
 * site naming its state is what keeps the four consistent. A quiet variant that decorated itself
 * would be inventing a distinction the app does not have.
 */
export const STATE_PANEL_VARIANTS = [
  /** A first load in flight. One line of prose, no heading — there is nothing to explain yet. */
  'loading',
  /**
   * There is genuinely nothing to show, and that is not a fault: no open positions, no dividend
   * income, no imported statements, no rows matching a filter. It may still carry the action
   * that would fill it — importing a statement is what `needs_import` offers.
   */
  'empty',
  /**
   * Something outside the app is in the way and the owner can act on it: the gateway isn't
   * running, or accepted the request and went quiet, or the map has no token. The view is
   * reporting a condition, not a failure of its own.
   */
  'notice',
  /** The read failed. The one variant with a boundary of its own, and the one announced live. */
  'error',
] as const

/**
 * Whether the panel brings its own surface. `panel` is the full-width form that replaces a
 * view's content — a `Card` at `lg`, the DDR-0033 size reserved for exactly this. `inline` is
 * the form that sits *inside* a surface that already exists: an empty chart under its card
 * title, an empty history list, the map's degraded frame. Nesting a card in a card there would
 * draw a box with nothing behind it, which is the case DDR-0033 already called out.
 *
 * There is deliberately no `.state-panel-panel` rule: the panel surface *is* the card's, so the
 * class would have nothing to declare. `statePanelSurfaceClassName` returns `''` for it, the
 * same shape as `toneClassName('neutral')` (DDR-0034).
 */
export const STATE_PANEL_SURFACES = ['panel', 'inline'] as const

export type StatePanelVariant = (typeof STATE_PANEL_VARIANTS)[number]
export type StatePanelSurface = (typeof STATE_PANEL_SURFACES)[number]

export const DEFAULT_STATE_PANEL_VARIANT = 'empty' satisfies StatePanelVariant
export const DEFAULT_STATE_PANEL_SURFACE = 'panel' satisfies StatePanelSurface

/** The class carrying the surface, or `''` where the surface is the card's. */
export function statePanelSurfaceClassName(surface: StatePanelSurface): string {
  return surface === 'inline' ? 'state-panel-inline' : ''
}

/**
 * Compose the class list for a state panel. `className` is appended rather than merged, so a
 * call site extends the primitive with its own placement rule — `.country-map-unavailable` is the
 * frame the degraded map draws in, not a restyling of the panel (ADR-0008).
 */
export function statePanelClassName(
  variant: StatePanelVariant = DEFAULT_STATE_PANEL_VARIANT,
  surface: StatePanelSurface = DEFAULT_STATE_PANEL_SURFACE,
  className?: string,
): string {
  const parts = ['state-panel', `state-panel-${variant}`]
  const surfaceClass = statePanelSurfaceClassName(surface)
  if (surfaceClass) parts.push(surfaceClass)
  if (className) parts.push(className)
  return parts.join(' ')
}

/**
 * How the state is announced. An error is the one state that interrupts: it reports that
 * something the owner asked for did not happen, and it carries the action that retries it.
 * Everything else is a polite `status` — a view arriving, or a region that is simply empty.
 *
 * A caller may still override it; nothing in the app currently needs to.
 */
export function statePanelRole(variant: StatePanelVariant): 'alert' | 'status' {
  return variant === 'error' ? 'alert' : 'status'
}

/**
 * Which element the panel is. A panel with a heading is a section of prose; a panel without one
 * *is* its paragraph, which is what the superseded call sites already rendered (`Card as="p"`)
 * and what keeps their margins — the UA margins on that `<p>` are part of how `.dashboard`'s
 * flex column spaces the dashboard (DDR-0033). Rebuilding a one-line loading state as a section
 * wrapping a paragraph would move the page for no reason.
 */
export function statePanelElement(
  surface: StatePanelSurface,
  hasHeading: boolean,
): 'section' | 'div' | 'p' {
  if (!hasHeading) return 'p'
  return surface === 'panel' ? 'section' : 'div'
}
