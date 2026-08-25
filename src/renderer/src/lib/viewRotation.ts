/**
 * The rotation that steps to the next and previous view (Story #259, DDR-0090).
 *
 * `viewShortcut.ts` beside this file answers "take me to Trades" — a destination the reader names
 * with its digit (DDR-0083). This answers the other gesture: "show me the next one", which needs no
 * destination in mind and is the one a reader reaches for while comparing two views over time. The
 * arithmetic is the tablist's own, so it is imported rather than restated: one implementation of
 * "next/previous, wrapping" serves the arrows and this.
 *
 * **Three rules differ from the digit accelerator's, and none of them could be borrowed.**
 *
 * `Ctrl` on every platform, with no `Meta` variant: `Cmd`+`Tab` is the macOS application switcher,
 * it never reaches the window, and accepting it would announce a binding the OS has already taken.
 * `Shift` is *meaningful* here rather than disqualifying — it is the reverse direction, where
 * `viewShortcutIndex` rejects any keystroke carrying it. And the key is read from `key` rather than
 * from `code`, because `Tab` produces no character: `code` is the physical position, which on a
 * remapped keyboard is not where the reader's Tab is, and the layout-independence argument that
 * makes `code` right for a digit says nothing here.
 *
 * That last one costs something and the cost is stated. DDR-0083 recorded that the tablist's
 * handler and the accelerator never negotiate *because they read different properties* — for a
 * digit, `'1'` and `'Digit1'`. For `Tab` the two strings are identical, so that separation is gone
 * and what keeps the two handlers apart is `nextTabIndex` **explicitly declining `'Tab'`**, which
 * `tabKeyboard.test.ts` has always asserted with the note that Tab must stay the browser's. That
 * assertion stops being a formality and becomes the guarantee, and it is cross-asserted from this
 * side too (`viewRotation.test.ts`).
 *
 * Pure and here rather than inside `App.tsx` for the usual reason: Vitest runs Node-only with no
 * jsdom, so nothing inside a component is testable. The event shape is structural, so a test states
 * a case as an object literal while a real `KeyboardEvent` still satisfies it.
 */
import { stepIndex } from './tabKeyboard'

/** The parts of a `keydown` the rotation reads. A real `KeyboardEvent` satisfies this. */
export interface RotationEvent {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

/**
 * The binding, as `aria-keyshortcuts` spells it: a space-separated list of combinations.
 *
 * Both directions, and **only** `Control` — unlike `viewShortcutKeys`, which lists `Meta` beside it
 * because both modifiers really are accepted there. Announcing `Meta+Tab` would name a keystroke
 * the operating system takes before the app sees it.
 */
export const ROTATION_KEYS = 'Control+Tab Control+Shift+Tab'

/**
 * The binding as a reader would say it — the one place it is written on screen.
 *
 * A constant rather than a function of the platform, which is the same asymmetry stated once more:
 * `shortcutLabel` picks between Ctrl and Cmd because a digit accepts either, and this binding is
 * `Ctrl` everywhere, so there is nothing to pick.
 */
export const ROTATION_HINT = 'Ctrl+Tab next view, Ctrl+Shift+Tab previous'

/**
 * The view the keystroke rotates to, or `null` when the keystroke is not the rotation.
 *
 * `Shift` chooses the direction; `Alt` and `Meta` disqualify. Wrapping is `stepIndex`'s, so the far
 * ends behave exactly as arrowing does — down from the last view lands on the first.
 */
export function rotatedTabIndex(
  event: RotationEvent,
  current: number,
  count: number,
): number | null {
  if (event.key !== 'Tab') return null
  if (!event.ctrlKey || event.metaKey || event.altKey) return null

  return stepIndex(current, event.shiftKey ? -1 : 1, count)
}
