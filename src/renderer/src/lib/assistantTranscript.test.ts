import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  blockClassName,
  bubbleClassName,
  EMPTY_TRANSCRIPT_DETAIL,
  EMPTY_TRANSCRIPT_HEADING,
  roleLabel,
  ROLE_LABELS,
  transcriptOrder,
} from './assistantTranscript'
import { stripComments } from './cssDeclarations'
import { rememberedTurns } from './assistantHistory'
import type { Turn } from './assistantAsk'

/**
 * How the transcript is drawn (Story #344, DDR-0115 decision 7).
 *
 * The order, the marking and the class names are here because a component cannot be rendered —
 * Vitest is Node-only with no jsdom (DDR-0029) — and the stylesheet half is read as text, which is
 * the same division `assistantLayout.test.ts` makes. DDR-0075's trap applies to every scan below:
 * `app.css` quotes its own class names in prose, so comments are stripped first.
 */

const CSS = stripComments(readFileSync(new URL('../app.css', import.meta.url), 'utf8'))
const CONVERSATION = readFileSync(
  new URL('../components/AssistantConversation.tsx', import.meta.url),
  'utf8',
)

/**
 * The same source with its prose removed, for the **negative** assertions below.
 *
 * DDR-0075's trap bites both ways, and this is the direction `assistantAnswerRendering.test.ts`
 * records: a positive scan can pass off a comment quoting the string it wants, and a negative one
 * fails because the component explains *in prose* what it deliberately does not do — this file's
 * `scrollIntoView` note is exactly that. Stripping first is what makes either about the code.
 */
const CODE = CONVERSATION.replace(/\/\*[\s\S]*?\*\//g, '')
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

let nextId = 1

const turn = (question: string, askedAt = 0): Turn => ({
  id: nextId++,
  question,
  groundedAt: 5,
  askedAt,
  answeredAt: askedAt,
  answer: { kind: 'answered', text: `re: ${question}`, truncated: false },
})

describe('the transcript reads oldest-first, and the array does not', () => {
  it('reverses a newest-first array for drawing', () => {
    const newestFirst = [turn('Third'), turn('Second'), turn('First')]

    expect(transcriptOrder(newestFirst).map((one) => one.question)).toEqual([
      'First',
      'Second',
      'Third',
    ])
  })

  /**
   * **The trap DDR-0115 decision 7 was written for.** `rememberedTurns` walks the array backwards
   * and `trimHistory` drops from the oldest end, so a `reverse()` in place would invert the model's
   * memory as a side effect of drawing the screen — a conversation read backwards, with the
   * *newest* turns discarded, and nothing on screen looking wrong.
   */
  it('leaves the array it was given alone', () => {
    const newestFirst = [turn('Second'), turn('First')]
    const before = newestFirst.map((one) => one.question)

    transcriptOrder(newestFirst)

    expect(newestFirst.map((one) => one.question)).toEqual(before)
  })

  /** The two orders, side by side: what is drawn and what is sent disagree, deliberately. */
  it('draws the reverse of what the model reads is drawn from', () => {
    const newestFirst = [turn('Second'), turn('First')]

    expect(transcriptOrder(newestFirst).map((one) => one.question)).toEqual(['First', 'Second'])
    expect(rememberedTurns(newestFirst, 5).map((one) => one.question)).toEqual(['First', 'Second'])
  })

  it('has nothing to draw from an empty transcript', () => {
    expect(transcriptOrder([])).toEqual([])
  })
})

describe('the marking above a bubble', () => {
  /**
   * The same two roles the message array is marked with (DDR-0113), now visible. Sentence case,
   * because the capitals are `text-transform` and the accessible name is what is written here.
   */
  it('names the two speakers the way the message array does', () => {
    expect(ROLE_LABELS).toEqual({ you: 'You', model: 'Assistant' })
  })

  it('puts the clock time after the role', () => {
    const at = new Date(2026, 8, 3, 17, 31).getTime()

    expect(roleLabel('you', at)).toBe('You · 17:31')
    expect(roleLabel('model', at)).toBe('Assistant · 17:31')
  })

  /** Nothing has come back, so there is no moment to state — which is what the design draws. */
  it('states the role alone while a turn is still waiting', () => {
    expect(roleLabel('model', null)).toBe('Assistant')
  })

  /**
   * Formatted through `@shared/format`, never `toLocaleTimeString` at the call site: two processes
   * resolve an undefined locale differently and in silence (DDR-0111).
   */
  it('formats through the shared formatter rather than in the component', () => {
    const source = readFileSync(new URL('./assistantTranscript.ts', import.meta.url), 'utf8')

    expect(source).toContain("import { formatTimeOfDay } from '@shared/format'")
    expect(source).not.toContain('toLocaleTimeString')
    expect(CODE).not.toContain('toLocaleTimeString')
  })
})

describe('every class the transcript emits has a rule', () => {
  it('gives a block and a bubble one hook per role', () => {
    expect(blockClassName('you')).toBe('assistant-block assistant-block-you')
    expect(bubbleClassName('model')).toBe('assistant-bubble assistant-bubble-model')
  })

  it.each([
    '.assistant-block',
    '.assistant-block-you',
    '.assistant-block-model',
    '.assistant-bubble',
    '.assistant-bubble-you',
    '.assistant-bubble-model',
    '.assistant-turn-role',
    '.assistant-transcript-empty',
    '.assistant-transcript-empty-glyph',
    '.assistant-transcript-empty-heading',
    '.assistant-transcript-empty-detail',
  ])('declares a rule for %s', (selector) => {
    expect(rule(selector)).not.toBe('')
  })

  /** The superseded rule, gone rather than left orphaned — the first way every guard here fails. */
  it('retires the paragraph the question used to be', () => {
    expect(CSS).not.toContain('.assistant-question')
    expect(CODE).not.toContain('assistant-question')
  })
})

describe('the two bubbles are the design’s', () => {
  it('aligns the owner right and the model left', () => {
    expect(rule('.assistant-block-you')).toContain('align-items: flex-end')
    expect(rule('.assistant-block-model')).toContain('align-items: flex-start')
  })

  /**
   * **The accent split, and the half that is silent to get wrong** (DDR-0046, DDR-0054). The
   * design fills this bubble with its own `--accent`; this app's `--accent` is the *text* indigo,
   * white on which is 4.47:1 — below AA. `--accent-strong` is the fill half. `contrast.ts`
   * measures the pairing; this asserts the token, because a bubble filled with the wrong half
   * looks entirely deliberate on screen.
   */
  it('fills the owner’s bubble with the accent’s fill half, not its text half', () => {
    const body = rule('.assistant-bubble-you')

    expect(body).toContain('background: var(--accent-strong)')
    expect(body).toContain('color: #ffffff')
    expect(body).not.toContain('background: var(--accent)')
  })

  /**
   * The model's bubble is the app's card surface, and deliberately **not** `--surface-raised`:
   * that surface has exactly three adopters, `sidebarRail.test.ts` counts them, and a fourth owes
   * its own measured inks (DDR-0069, DDR-0070). The count is asserted there; this is the half that
   * says why it did not have to move.
   */
  it('puts the model’s bubble on the card surface, adding no raised adopter', () => {
    const body = rule('.assistant-bubble-model')

    expect(body).toContain('background: var(--card)')
    expect(body).toContain('border: 1px solid var(--border)')
    expect(body).not.toContain('--surface-raised')
  })

  /**
   * The asymmetric corner points at the speaker: three round, the fourth flat, mirrored between
   * the two. Both are drawn from tokens — `--radius-lg` is 12px, which is the design's own number,
   * and the 2px is a named token rather than a raw length (DDR-0031, DDR-0115 amendment 8).
   */
  it('mirrors the flat corner between the two bubbles', () => {
    expect(rule('.assistant-bubble-you')).toContain(
      'border-radius: var(--radius-lg) var(--radius-lg) var(--assistant-bubble-corner) var(--radius-lg)',
    )
    expect(rule('.assistant-bubble-model')).toContain(
      'border-radius: var(--assistant-bubble-corner) var(--radius-lg) var(--radius-lg) var(--radius-lg)',
    )
  })

  it('caps both at the design’s share of the column', () => {
    expect(rule('.assistant-bubble')).toContain('max-width: var(--assistant-bubble-max)')
    expect(CSS).toContain('--assistant-bubble-max: 82%')
    expect(CSS).toContain('--assistant-bubble-corner: 2px')
  })

  /** A question typed across three lines is three lines, which is what the paragraph carried. */
  it('keeps the owner’s own line breaks', () => {
    expect(rule('.assistant-bubble')).toContain('white-space: pre-wrap')
  })
})

describe('the states all render inside the model’s bubble', () => {
  /**
   * `thinking`, `answered`, `truncated`, `failed` and stale each moved into the bubble and none of
   * them went away (DDR-0022, DDR-0027, DDR-0038). The component is scanned rather than rendered,
   * for DDR-0029's reason.
   */
  it.each([
    '<p className="assistant-thinking">',
    '<AssistantAnswer text={turn.answer.text} />',
    '{TRUNCATED_NOTE}',
    '<StatePanel variant="error"',
    '{STALE_NOTE}',
  ])('still draws %s', (fragment) => {
    expect(CODE).toContain(fragment)
  })

  /**
   * All of them are inside the model's bubble, which is the half the list above cannot see. The
   * slice starts where the bubble opens — the imports at the top of the file name three of these
   * too, so an `indexOf` over the whole source would find the import and prove nothing.
   */
  it('puts every one of them inside the model’s bubble', () => {
    const opens = CODE.indexOf("bubbleClassName('model')")
    expect(opens).toBeGreaterThan(-1)
    const inside = CODE.slice(opens)

    for (const fragment of [
      'assistant-thinking',
      'AssistantAnswer',
      'TRUNCATED_NOTE',
      'variant="error"',
      'STALE_NOTE',
    ]) {
      expect(inside, fragment).toContain(fragment)
    }
    // And the owner's bubble holds the question alone: none of the five is above it.
    expect(CODE.slice(0, opens)).not.toContain('assistant-thinking')
  })
})

describe('an empty transcript', () => {
  it('says what is missing and what fixes it', () => {
    expect(EMPTY_TRANSCRIPT_HEADING).toBe('No questions yet')
    expect(EMPTY_TRANSCRIPT_DETAIL).toBe('Ask anything about your portfolio below.')
  })

  /**
   * Beside the list rather than inside it. The `<ol>` is the `aria-live` region and is in the
   * document from mount, so a placeholder `<li>` would be announced as though it were a turn —
   * and the region is what a new turn's insertion announces (DDR-0107, DDR-0115 decision 9).
   */
  it('draws the state outside the live region', () => {
    expect(CODE.indexOf('assistant-transcript-empty')).toBeLessThan(
      CODE.indexOf('className="assistant-turns"'),
    )
    expect(CODE).toContain('{turns.length === 0 && (')
  })
})

describe('a new turn is scrolled to, and the reader can stop that', () => {
  /**
   * The scroll is CSS, not an option (DDR-0044). A `behavior: 'smooth'` argument would put the
   * answer to `prefers-reduced-motion` in a place the media query cannot reach; leaving the
   * behavior at `auto` resolves the scroller's own `scroll-behavior`, which the block under
   * `:root` overrides by name. `e2e/reduced-motion.spec.ts` proves that cascade resolves.
   */
  it('scrolls without naming a behavior', () => {
    expect(CODE).toContain('band.scrollTop = band.scrollHeight')
    expect(CODE).not.toContain('behavior:')
  })

  /**
   * The band is scrolled to its own end rather than a sentinel scrolled into view, which is what
   * the design does. `scrollIntoView` lands the sentinel's bottom on the scrollport's bottom edge
   * and leaves the band's own bottom padding below it unscrolled — measured at 24px short of the
   * end in the running app — so the newest bubble ends flush against the composer's rule. Setting
   * `scrollTop` past the maximum is clamped to the true end, padding included.
   */
  it('scrolls the band rather than an empty sentinel', () => {
    expect(CODE).not.toContain('scrollIntoView')
    expect(CODE).toContain('ref={transcript} className="assistant-transcript"')
  })

  it('declares the smooth scroll and its reduced-motion answer', () => {
    expect(rule('.assistant-transcript')).toContain('scroll-behavior: smooth')
    expect(rule('.assistant-transcript.assistant-transcript')).toContain('scroll-behavior: auto')
  })

  /**
   * The effect depends on `turns` rather than `turns.length`: an answer replacing a waiting bubble
   * grows the block by several lines without changing the count, which is exactly the moment the
   * question that prompted it would otherwise scroll off the bottom.
   */
  it('re-scrolls when an answer lands, not only when a turn is added', () => {
    expect(CODE).toContain('}, [turns])')
  })
})
