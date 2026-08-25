/**
 * Keyboard movement inside the shell's tab bar (Story #111).
 *
 * The WAI-ARIA tabs pattern is mostly a set of DOM attributes, but the one part with real
 * logic in it is "which tab does this key go to" — wrapping at both ends, and the Home/End
 * jumps. That is pure arithmetic over an index, so it lives here rather than inside `App.tsx`:
 * Vitest runs in a Node environment with no jsdom, so nothing that only exists inside a
 * component can be tested at all (see the Testing section of CLAUDE.md).
 *
 * Vertical only since Story #182 (DDR-0055). The tablist moved from a row under the title bar
 * into the sidebar, and the ARIA pattern's axis is the layout's axis: a vertical tablist owns
 * Up/Down, and Left/Right are not its keys. They are deliberately *not* accepted as a second
 * way to move — a tablist that answers to both announces `aria-orientation="vertical"` and then
 * behaves like neither orientation, and Left/Right belong to whatever the row of controls
 * inside the focused panel does with them.
 *
 * Story #259 splits the wrapping step out of the key mapping as {@link stepIndex}, because
 * `Ctrl`+`Tab` moves along the same list by the same rule from outside the tablist entirely
 * (DDR-0090). The mapping below is unchanged and still declines every key it does not own —
 * `'Tab'` above all, which is now load-bearing rather than incidental: see `viewRotation.ts`.
 */

/**
 * The index the given key should move focus to, or `null` when the key isn't one the tablist
 * handles (in which case the caller must leave the event alone — Tab, typing, and every
 * shortcut still has to work).
 *
 * Movement **wraps**: down from the last tab lands on the first, up from the first on the
 * last. That is the pattern's default and it is what makes a five-view list quick to cross.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null

  switch (key) {
    case 'ArrowDown':
      return stepIndex(current, 1, count)
    case 'ArrowUp':
      return stepIndex(current, -1, count)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * Step `delta` places along the list, **wrapping** at both ends (Story #259).
 *
 * "Next or previous, wrapping" is the same movement whether an arrow key asks for it from inside
 * the tablist or `Ctrl`+`Tab` asks for it from anywhere in the app (DDR-0090), so it is stated
 * once here and both callers reach for it. `nextTabIndex` above is the tablist's *key* mapping and
 * the rotation deliberately does not go through it — a rotation that asked for `'ArrowDown'` would
 * be naming a key it does not use, and would break the moment the tablist changed its own.
 *
 * `null` for an empty list, like every other answer in this module, so a caller never has to
 * decide what index zero of nothing means.
 */
export function stepIndex(current: number, delta: number, count: number): number | null {
  if (count <= 0) return null
  return wrap(current + delta, count)
}

/**
 * Wrap an index into `[0, count)`, tolerating a `current` that is out of range — an unknown
 * active tab should still leave the arrow keys usable rather than throwing the focus nowhere.
 */
function wrap(index: number, count: number): number {
  return ((index % count) + count) % count
}
