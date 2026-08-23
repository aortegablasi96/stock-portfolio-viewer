/**
 * The accelerator that switches view from anywhere (Story #254, DDR-0083).
 *
 * `tabKeyboard.ts` beside this file answers Up/Down/Home/End, and only ever while focus is already
 * inside the tablist — which is the WAI-ARIA pattern behaving correctly, and is also the reason the
 * app had no way to *reach* the tablist. From a sorted table header or a range filter, switching
 * view meant Shift-Tab back to the rail and then arrowing, and arrowing selects every row it
 * crosses (automatic activation, DDR-0029), mounting each one for the session (DDR-0027).
 *
 * So this is a second way in, never a replacement: `nextTabIndex` is untouched, still returns
 * `null` for every key it does not own, and the two cannot collide — a digit's `key` is `'1'`,
 * which it rejects. Nothing about the pattern changes.
 *
 * It lives here for the reason every other bit of renderer logic does: Vitest runs Node-only with
 * no jsdom, so nothing inside a component is testable. What is worth testing is exactly the two
 * predicates — which keystroke is the accelerator, and when it must keep its hands off — and
 * neither needs a DOM. Both take structural shapes rather than `KeyboardEvent` / `HTMLElement`, so
 * a test can state a case as an object literal while the real event still satisfies them.
 */

/** The parts of a `keydown` the accelerator reads. A real `KeyboardEvent` satisfies this. */
export interface ShortcutEvent {
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/** The parts of an event target that decide whether text is being entered. */
export interface ShortcutTarget {
  readonly tagName: string
  readonly isContentEditable: boolean
}

/**
 * The digit keys, by **physical position** rather than by the character they produce.
 *
 * `event.key` is the layout's answer and it is the wrong one for an accelerator: on AZERTY the
 * unshifted top row is `&`, `é`, `"`, `'`, `(`, so a binding read off `key` would simply not exist
 * on that keyboard. `code` is the position, which is what a reader who is told "Ctrl and the
 * number beside the view" actually presses. The numpad is the same digit under a different code.
 */
const DIGIT_CODE = /^(?:Digit|Numpad)([1-9])$/

/**
 * The accelerator's modifier, as the ARIA attribute spells it.
 *
 * Both are listed because both are accepted, and `aria-keyshortcuts` takes a space-separated list
 * of alternatives: `Control` is the binding on Windows and Linux, `Meta` the same gesture on macOS.
 */
export function viewShortcutKeys(index: number): string {
  const digit = viewShortcutHint(index)
  return `Control+${digit} Meta+${digit}`
}

/** The digit drawn beside a view's name, and pressed with the modifier. Rows are 1-based. */
export function viewShortcutHint(index: number): string {
  return String(index + 1)
}

/**
 * Whether the keystroke belongs to whatever has focus rather than to the app.
 *
 * The Epic's standing rule (#253): with focus in a `Field`, `Select` or `DateInput` (DDR-0035), or
 * in any editable element, the key is the control's. Today's binding carries a modifier and so
 * collides with none of them — this is deliberately the rule and not the collision, because the
 * rule is what survives a future story changing the binding, and a bare digit would collide with
 * all three at once.
 *
 * `isContentEditable` rather than the attribute: it is the *computed* answer, so an element inside
 * a `contenteditable` ancestor is caught as well as the host itself.
 */
export function isTextEntry(target: ShortcutTarget | null | undefined): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)
}

/**
 * The view the keystroke selects, or `null` when the keystroke is not the accelerator.
 *
 * Exactly one of Ctrl and Meta, and neither Alt nor Shift: the first keeps `Ctrl+Alt+1` (which is
 * AltGr on a Windows layout, and therefore a character on several) out, and the second keeps the
 * accelerator off `Ctrl+Shift+1`, which is nobody's yet and should stay free rather than become a
 * duplicate of this one.
 *
 * Out-of-range digits return `null` rather than clamping. `Ctrl+9` on a five-view list is a press
 * that meant something else, and selecting Trades because it is the nearest would be a guess.
 */
export function viewShortcutIndex(event: ShortcutEvent, count: number): number | null {
  if (count <= 0) return null
  if (event.ctrlKey === event.metaKey) return null
  if (event.altKey || event.shiftKey) return null

  const digit = DIGIT_CODE.exec(event.code)?.[1]
  if (digit === undefined) return null

  const index = Number(digit) - 1
  return index < count ? index : null
}
