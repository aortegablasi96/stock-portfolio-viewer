import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMPOSER_BUTTON_PX,
  COMPOSER_PLACEHOLDER,
  COMPOSER_RADIUS_PX,
  COMPOSER_TOKENS,
  sendsOnEnter,
  SUGGESTIONS_LABEL,
  THINKING_NOTE,
} from './assistantComposer'
import { EXEMPTIONS } from './motionTokens'
import { stripComments } from './cssDeclarations'
import { isTextEntry } from './viewShortcut'

/**
 * The composer, and the wait (Story #345, DDR-0115).
 *
 * The keyboard contract is the part worth most of this file: Enter-to-send is a new binding in a
 * text field, in an app whose two window accelerators exist by declining exactly there, and none
 * of the ways it can be wrong is visible on screen. The rest is the usual division — a Node-only
 * suite reads the stylesheet and the component as text (DDR-0029), and `e2e/assistant-ask.spec.ts`
 * owns the key actually reaching the form.
 */

const CSS = stripComments(readFileSync(new URL('../app.css', import.meta.url), 'utf8'))
const RAW = readFileSync(new URL('../components/AssistantConversation.tsx', import.meta.url), 'utf8')

/** The component with its prose removed — DDR-0075's trap, which bites both ways. */
const CODE = RAW.replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n')

/** The body of the first rule whose selector list contains `selector`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(^|,)\\s*${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, 'm').exec(CSS)
  expect(match, `${selector} has no rule in app.css`).not.toBeNull()
  return match![3]!
}

const press = (key: string, modifiers: Record<string, boolean> = {}) => ({
  key,
  shiftKey: false,
  ...modifiers,
})

describe('Enter sends and Shift+Enter newlines', () => {
  it('sends on a bare Enter', () => {
    expect(sendsOnEnter(press('Enter'))).toBe(true)
  })

  it('leaves Shift+Enter to insert a newline', () => {
    expect(sendsOnEnter(press('Enter', { shiftKey: true }))).toBe(false)
  })

  it('declines every other key', () => {
    for (const key of ['a', 'Tab', 'Escape', ' ', 'NumpadEnter', 'ArrowDown']) {
      expect(sendsOnEnter(press(key)), key).toBe(false)
    }
  })

  /**
   * An IME uses Enter to accept the candidate the owner is part-way through choosing, and
   * `isComposing` is true for exactly that keystroke. Without this the box sends mid-word when a
   * question is typed in Japanese, Chinese or Korean — silently, and only for those who use one.
   */
  it('is not a send while an input method is composing', () => {
    expect(sendsOnEnter({ ...press('Enter'), isComposing: true })).toBe(false)
  })

  /**
   * A keystroke carrying a modifier meant something, and guessing it meant "send" is what makes a
   * later binding impossible to add — `viewShortcut.ts` makes the same argument about an
   * out-of-range digit, from the other side.
   */
  it.each(['ctrlKey', 'altKey', 'metaKey'])('declines a modified Enter (%s)', (modifier) => {
    expect(sendsOnEnter(press('Enter', { [modifier]: true }))).toBe(false)
  })
})

describe('the binding does not disturb the two window accelerators', () => {
  /**
   * `Ctrl`/`Cmd`+digit (DDR-0083) and `Ctrl`(+`Shift`)+`Tab` (DDR-0090) are one `window` listener
   * in `App.tsx`, and both decline while text is being entered. The composer is a `<textarea>`, so
   * that contract already covers it — this asserts the premise rather than trusting it, and the
   * component half below asserts the composer added no second listener.
   */
  it('is a textarea, which the accelerators already decline in', () => {
    expect(isTextEntry({ tagName: 'TEXTAREA', isContentEditable: false })).toBe(true)
  })

  it('keeps the handler local to the control rather than on the window', () => {
    expect(CODE).toContain('onKeyDown={(event) =>')
    expect(CODE).not.toContain('window.addEventListener')
  })
})

describe('the key press and the button are one path', () => {
  /**
   * Enter goes through the form's `onSubmit`, not straight to `ask()`. Two entry points would be
   * two sets of guards, and a later story adding a check to one would leave the other behind.
   * `preventDefault` is load-bearing: without it the newline lands as well as the question.
   */
  it('submits the form rather than calling ask directly', () => {
    expect(CODE).toContain('event.currentTarget.form?.requestSubmit()')
    expect(CODE).toContain('event.preventDefault()')
    // The one `ask()` call site is still the form's own submit handler.
    expect([...CODE.matchAll(/void ask\(\)/g)]).toHaveLength(1)
  })

  /** Both the button and the key are gated by the same two conditions. */
  it('disables the send control and the box together while a question is in flight', () => {
    expect(CODE).toContain('disabled={pending || !isAskable(question)}')
    expect(CODE).toContain('disabled={pending}')
  })
})

describe('the two icon buttons', () => {
  it('name themselves, since a glyph is not a name (DDR-0032)', () => {
    expect(CODE).toContain('aria-label={askLabel(pending)}')
    expect(CODE).toContain('aria-label={SUGGESTIONS_LABEL}')
    expect(SUGGESTIONS_LABEL).toBe('Show suggested questions')
  })

  /**
   * Inert until #348 gives it chips to open. `disabled` is the honest form of that — the one state
   * a control can be in that does not invite a click it will not answer.
   */
  it('ships the suggestions toggle disabled, pending #348', () => {
    const toggle = CODE.slice(CODE.indexOf('aria-label={SUGGESTIONS_LABEL}'))
    expect(toggle.slice(0, 200)).toContain('disabled')
  })

  /**
   * The box is overridden at the call site rather than parameterised on the primitive, which is
   * the shape `.titlebar-controls .btn` already uses: 44px is this band's geometry and `Button`
   * has no business knowing it. Colour, `:disabled` and the focus ring stay the shared rules'.
   */
  it('sizes them from the call site, touching none of the shared rules', () => {
    const body = rule('.assistant-composer-actions .btn')

    expect(body).toContain(`inline-size: var(${COMPOSER_TOKENS.button})`)
    expect(body).toContain(`block-size: var(${COMPOSER_TOKENS.button})`)
    expect(body).toContain(`border-radius: var(${COMPOSER_TOKENS.radius})`)
    for (const owned of ['outline', ':disabled', 'background', 'color']) {
      expect(body, owned).not.toContain(owned)
    }
  })
})

describe('the design’s measurements land as tokens', () => {
  it.each([
    [COMPOSER_TOKENS.button, COMPOSER_BUTTON_PX],
    [COMPOSER_TOKENS.radius, COMPOSER_RADIUS_PX],
  ])('declares %s in :root', (token, px) => {
    expect(CSS).toContain(`${token}: ${px}px;`)
  })

  /** The box takes the same 10px corner as the buttons, scoped to this call site. */
  it('gives the question box the composer’s own corner, not the app’s control radius', () => {
    expect(rule('.assistant-ask-field .control-prose')).toContain(
      `border-radius: var(${COMPOSER_TOKENS.radius})`,
    )
  })
})

describe('the label is kept and clipped, not dropped', () => {
  /**
   * The design draws no label and lets the placeholder name the box — a *visible* naming, not an
   * accessible one. `Field` still owns the id through `useId()` (DDR-0035); only the text is
   * hidden, and it joins `.sr-only`'s own rule rather than copying its nine declarations.
   */
  it('puts the label in the visually-hidden rule rather than writing a second clip', () => {
    expect(CSS).toMatch(/\.sr-only,\s*\.assistant-ask-field > \.field-label \{/)
    // It appears in that one selector list and nowhere else. A rule of its own would be the
    // second copy of the clip that joining the list exists to avoid — which is the same thing
    // `tokenAdoption.ts`'s widened `-1px` key is now watching from the other side.
    expect([...CSS.matchAll(/\.assistant-ask-field > \.field-label/g)]).toHaveLength(1)
    expect(CODE).toContain('<Field label="Your question" className="assistant-ask-field">')
  })

  it('discloses the keyboard contract in the placeholder', () => {
    expect(COMPOSER_PLACEHOLDER).toContain('Enter to send')
    expect(COMPOSER_PLACEHOLDER).toContain('Shift+Enter')
    expect(CODE).toContain('placeholder={COMPOSER_PLACEHOLDER}')
  })
})

describe('the wait is a turn, not a banner', () => {
  /**
   * The dots replace the answer's body **in place**, inside the model's bubble. A separate element
   * outside the list would collapse the live region's two announcements — the turn's insertion and
   * then its answer — into one (DDR-0107, Story #344).
   */
  it('draws the dots inside the model’s bubble', () => {
    const bubble = CODE.indexOf("bubbleClassName('model')")
    expect(bubble).toBeGreaterThan(-1)
    expect(CODE.slice(bubble)).toContain('assistant-thinking-dots')
    expect(CODE.slice(0, bubble)).not.toContain('assistant-thinking')
  })

  /** Three circles say nothing without sight, so the sentence travels with them. */
  it('carries a text equivalent, with the dots hidden from the tree', () => {
    expect(THINKING_NOTE).toBe('Asking the assistant…')
    expect(CODE).toContain('<span className="sr-only">{THINKING_NOTE}</span>')
    expect(CODE).toContain('<span className="assistant-thinking-dots" aria-hidden="true">')
    expect([...CODE.matchAll(/className="assistant-thinking-dot"/g)]).toHaveLength(3)
  })

  it('sizes the dot from the scale, even though its timing cannot be', () => {
    const body = rule('.assistant-thinking-dot')

    expect(body).toContain('inline-size: var(--space-2)')
    expect(body).toContain('block-size: var(--space-2)')
  })
})

describe('the pulse is raw, and is stopped by name', () => {
  /**
   * 1.2s, `ease-in-out` and the two delays are all off DDR-0044's budget of two durations and two
   * easings, and its one documented way out is a raw value declared with its reason (DDR-0115
   * amendment 4). All four declarations are exempted **as a set** — the three that animate and the
   * one that stops them.
   */
  it.each([
    '.assistant-thinking-dot | animation',
    '.assistant-thinking-dot:nth-child(2) | animation-delay',
    '.assistant-thinking-dot:nth-child(3) | animation-delay',
    '@media (prefers-reduced-motion: reduce) >> .assistant-thinking-dot.assistant-thinking-dot | animation',
  ])('records %s as an exemption with a reason', (key) => {
    const entry = EXEMPTIONS.find((one) => one.key === key)

    expect(entry, `${key} is not exempted`).toBeDefined()
    expect(entry!.reason.length).toBeGreaterThan(40)
  })

  /**
   * **Settled, not frozen.** A zeroed duration would hold the 0% keyframe, resting the dots at 0.3
   * opacity and 0.85 scale — three faint, shrunken circles a reader who asked for less motion
   * cannot tell from a rendering fault. `animation: none` lets the element's own values apply.
   */
  it('stops the dots with `none` rather than a zeroed duration', () => {
    const stopped = EXEMPTIONS.find((one) => one.key.includes('.assistant-thinking-dot.assistant'))

    expect(stopped?.value).toBe('none')
    expect(rule('.assistant-thinking-dot.assistant-thinking-dot')).toContain('animation: none')
  })

  /** The keyframe is the design's, both ends, so the reduced-motion argument above stays true. */
  it('keeps the design’s own keyframe', () => {
    const frames = CSS.slice(CSS.indexOf('@keyframes assistant-thinking-pulse'))

    expect(frames).toContain('opacity: 0.3')
    expect(frames).toContain('transform: scale(0.85)')
  })
})
