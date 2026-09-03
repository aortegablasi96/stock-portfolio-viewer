/**
 * The composer's rules, wording and measurements (Story #345, DDR-0115).
 *
 * The band the owner types into is pinned to the foot of the chat column, and #343 put it there.
 * What this module holds is everything about it that is a *decision* rather than a DOM: when a
 * keystroke sends, what the controls are called, and the two lengths the design specifies.
 *
 * It is here for the reason every other Assistant decision is: Vitest runs Node-only with no jsdom
 * (DDR-0029), so a rule living inside a component is a rule nothing can assert. That matters more
 * than usual here — {@link sendsOnEnter} is a keyboard contract with three ways to be subtly
 * wrong, and none of them is visible on screen.
 */

/**
 * Whether a keystroke in the question box sends it.
 *
 * **Enter sends; Shift+Enter inserts a newline.** The design writes that as `key === 'Enter' &&
 * !shiftKey`, and two things are added here that a prototype has no reason to carry:
 *
 * **A composition is not a send.** An IME uses Enter to accept the candidate the owner is part-way
 * through choosing, and `isComposing` is true for exactly that keystroke. Without the check, typing
 * a question in Japanese, Chinese or Korean sends it mid-word — silently, and only for the people
 * who use one.
 *
 * **A modified Enter is not a send either.** Ctrl+Enter and Alt+Enter are nobody's binding in this
 * app today, and that is the argument for declining them rather than for treating them as plain
 * Enter: a keystroke carrying a modifier meant something, and guessing it meant "send" is what
 * makes a later binding impossible to add. `viewShortcut.ts` makes the same argument about an
 * out-of-range digit, from the other side.
 *
 * Meta is deliberately in the list. On macOS Cmd+Enter is a submit gesture in several apps, and
 * this story is not the place to decide whether it is one here.
 */
export function sendsOnEnter(event: {
  readonly key: string
  readonly shiftKey: boolean
  readonly ctrlKey?: boolean
  readonly altKey?: boolean
  readonly metaKey?: boolean
  readonly isComposing?: boolean
}): boolean {
  if (event.key !== 'Enter') return false
  if (event.isComposing === true) return false
  return !event.shiftKey && event.ctrlKey !== true && event.altKey !== true && event.metaKey !== true
}

/**
 * The box's placeholder, which is where the keyboard contract is disclosed.
 *
 * Enter-to-send is invisible otherwise, and this app's rule is that a binding is disclosed at the
 * scope of what it acts on (DDR-0083, DDR-0090): the accelerators say so on the nav row and the
 * tablist, and this one says so in the box it belongs to. It replaces #284's example question —
 * the design's own placeholder, and #348's suggestion chips are where an example belongs now.
 */
export const COMPOSER_PLACEHOLDER =
  'Ask about your portfolio… (Enter to send, Shift+Enter for new line)'

/**
 * The suggestions toggle's accessible name.
 *
 * `size="icon"` is a shape and not an exemption from being named (DDR-0032), and a glyph is not a
 * name. The control **ships inert** until #348 gives it chips to open, which the story leaves as a
 * choice between that and holding it back: `disabled` is the honest form of inert, because it is
 * the one state a control can be in that does not invite a click it will not answer.
 */
export const SUGGESTIONS_LABEL = 'Show suggested questions'

/**
 * What the waiting bubble says to a screen reader.
 *
 * Three pulsing dots say nothing without sight, and the `aria-live` region announces the turn as it
 * is inserted (DDR-0107) — so what it announces has to be a sentence. This is #284's own wording,
 * moved rather than rewritten: the dots replace how the wait *looks*, not what it means.
 */
export const THINKING_NOTE = 'Asking the assistant…'

/**
 * The two measurements the design specifies for the composer's controls (DDR-0115 amendment 8).
 *
 * 44px is the square the two icon buttons are drawn at — the app's `.btn-icon` is 30.4px, a shape
 * for a control tucked into a dense row, and these two stand beside a three-row box. 10px is the
 * corner both they and the box take, and it is neither `--radius-md` (8px) nor `--radius-lg`
 * (12px). Neither is rounded to a step: each lands as a named custom property with a test, the way
 * `--donut-column-width` and `--assistant-profile-width` already do, and
 * `lib/tokenAdoption.ts`'s `BASELINE` stays empty.
 */
export const COMPOSER_TOKENS = {
  button: '--assistant-composer-button',
  radius: '--assistant-composer-radius',
} as const

export const COMPOSER_BUTTON_PX = 44
export const COMPOSER_RADIUS_PX = 10
