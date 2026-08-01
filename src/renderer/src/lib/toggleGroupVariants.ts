/**
 * The `ToggleGroup` primitive's mode contract (Story #131, DDR-0036).
 *
 * Same split as the button's, the card's and the field's (DDR-0032, DDR-0033, DDR-0035), for
 * the same reason: Vitest runs Node-only, so nothing inside a component is testable (DDR-0029).
 * Keeping the union and the class composition in a pure module lets the test assert both halves
 * of the contract — that a call composes the class list a caller expects, and that `app.css`
 * actually declares a rule behind every member of the union.
 *
 * The axis here is **`mode`, not `variant`/`size`**. Every group in the app is the same dense
 * strip sitting in a card header or a toolbar, so a size scale would ship with one value in use
 * — the call DDR-0034 and DDR-0035 already made. What genuinely differs between two groups is
 * how many of their items can be on at once, and that is a fact about the control's *meaning*
 * that a reader has to be able to see before clicking.
 */

/**
 * How many items can be selected at once. This is the only axis, and it carries the item's
 * **corner only**: a single-select segment keeps the control radius every other box in the app
 * uses, while a multi-select item is a pill.
 *
 * The distinction is not decoration. The Dividends and Trade history views stack both kinds one
 * above the other — a period strip that picks exactly one, a type filter that picks any number —
 * and until this story they were rendered by the same class and were indistinguishable. Pills
 * for "any number of these" is the convention those views were already missing, and it survives
 * wrapping, which a joined segmented track does not: five presets on a narrow window break onto
 * a second row, and a joined track breaks with them.
 */
export const TOGGLE_MODES = ['single', 'multiple'] as const

export type ToggleMode = (typeof TOGGLE_MODES)[number]

export const DEFAULT_TOGGLE_MODE = 'single' satisfies ToggleMode

/** Append a call site's `className` for placement, never for restyling (ADR-0008). */
function compose(parts: string[], className?: string): string {
  return className ? [...parts, className].join(' ') : parts.join(' ')
}

/**
 * Compose the class list for the group wrapper. It takes **no mode class**: the group is the
 * same flex row either way, and the mode is worn by its items, where the difference actually
 * is. A class with no rule behind it is the thing this module's test exists to catch.
 */
export function toggleGroupClassName(className?: string): string {
  return compose(['toggle-group'], className)
}

/**
 * Compose the class list for one item. `selected` adds `toggle-item-active`, which carries the
 * accent *and* a doubled stroke — the active item must be distinguishable by more than colour,
 * the rule DDR-0029 fixed for the tab shell.
 */
export function toggleItemClassName(
  mode: ToggleMode = DEFAULT_TOGGLE_MODE,
  selected = false,
  className?: string,
): string {
  const parts = ['toggle-item', `toggle-item-${mode}`]
  if (selected) parts.push('toggle-item-active')
  return compose(parts, className)
}
