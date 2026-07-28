/**
 * Keyboard movement inside the shell's tab bar (Story #111).
 *
 * The WAI-ARIA tabs pattern is mostly a set of DOM attributes, but the one part with real
 * logic in it is "which tab does this key go to" — wrapping at both ends, and the Home/End
 * jumps. That is pure arithmetic over an index, so it lives here rather than inside `App.tsx`:
 * Vitest runs in a Node environment with no jsdom, so nothing that only exists inside a
 * component can be tested at all (see the Testing section of CLAUDE.md).
 *
 * Horizontal only. The tablist is a single row, and the ARIA pattern reserves Up/Down for
 * vertical tablists — binding them here would announce a movement the layout doesn't have.
 */

/**
 * The index the given key should move focus to, or `null` when the key isn't one the tablist
 * handles (in which case the caller must leave the event alone — Tab, typing, and every
 * shortcut still has to work).
 *
 * Movement **wraps**: right from the last tab lands on the first, left from the first on the
 * last. That is the pattern's default and it is what makes a five-tab bar quick to cross.
 */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null

  switch (key) {
    case 'ArrowRight':
      return wrap(current + 1, count)
    case 'ArrowLeft':
      return wrap(current - 1, count)
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * Wrap an index into `[0, count)`, tolerating a `current` that is out of range — an unknown
 * active tab should still leave the arrow keys usable rather than throwing the focus nowhere.
 */
function wrap(index: number, count: number): number {
  return ((index % count) + count) % count
}
