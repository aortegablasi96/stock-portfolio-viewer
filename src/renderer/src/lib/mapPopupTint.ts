/**
 * The Allocation map popup's return tint (Story #122, strengthened in Story #149).
 *
 * The popup is the one place on the map that wears the app's `--pos` / `--neg` green and red.
 * That is not a hole in DDR-0021: that decision governs *fill colour as the only channel* — a
 * donut slice carries no number beside it, so its scale has to clear CVD contrast unaided, which
 * is why the marks use the diverging red ↔ gray ↔ blue. Here the tone sits two rows above a
 * printed Return figure, which is exactly the case DDR-0021 carves out.
 *
 * Extracted from `CountryMap` because Vitest runs Node-only (DDR-0029). The class choice is three
 * lines, but the *strength* of the tint those classes carry is the part that has already been
 * wrong once — see the test, which checks the mix against the popup's own body text.
 */

/**
 * The two tint classes, and the whole set the popup has to be able to shed: one Mapbox `Popup` is
 * reused for every mark, so moving from a losing country to a winning one has to remove the old
 * class as well as add the new one.
 */
export const MAP_POPUP_TINTS = ['map-popup-pos', 'map-popup-neg'] as const

export type MapPopupTint = (typeof MAP_POPUP_TINTS)[number]

/**
 * The tint for a return, or `null` when there is no direction to state.
 *
 * `null` covers two different things on purpose — a return of exactly zero, and one that cannot be
 * computed because there is no cost basis to measure against — and they share the untinted
 * surface because colour alone cannot tell them apart. The popup prints the figure (`—` for the
 * second) rather than asking the tint to carry a distinction it has no way to express.
 */
export function mapPopupTintClassName(returnPercent: number | null): MapPopupTint | null {
  if (returnPercent === null || returnPercent === 0) return null
  return returnPercent > 0 ? 'map-popup-pos' : 'map-popup-neg'
}
