import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  boxAfterAsking,
  SUGGESTED_QUESTIONS,
  SUGGESTION_CHIP_CLASS,
  SUGGESTION_FIELD,
  SUGGESTIONS_ROW_LABEL,
  SUGGESTIONS_TOGGLE_CLASS,
  submittedQuestion,
} from './assistantSuggestions'
import { PAIRINGS } from './contrast'
import { stripComments } from './cssDeclarations'

/**
 * The four suggested questions (Story #348, DDR-0115).
 *
 * Most of this file is one guard wearing four hats: **a suggestion must not teach the owner to
 * expect an answer the app is right to refuse.** `BASE_CONTEXT` says on every question that no
 * annualised figure, benchmark, risk statistic or cause exists (DDR-0101, DDR-0111), and tax is a
 * milestone that has not been built — so a chip naming any of them would be the app inviting a
 * question and then declining it, which is worse than offering nothing at all.
 *
 * The other half is the property the story turns on: clicking a chip is the *same* submission a
 * typed question is. That is markup rather than a promise — `type="submit"` on a button owned by
 * the composer's form — and what a Node-only suite can hold is the resolver and the wiring, read
 * off the component as text (DDR-0029). `e2e/assistant-memory.spec.ts` proves the click reaches the
 * wire.
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

const ALL = SUGGESTED_QUESTIONS.join('\n').toLowerCase()

describe('the list itself', () => {
  it('is the design’s four, in the design’s order', () => {
    expect(SUGGESTED_QUESTIONS).toEqual([
      'What is my largest position, and how does it sit against my profile?',
      'Which holdings are furthest from my target sector weights?',
      'Summarise my dividend income vs. growth balance.',
      'Am I over-concentrated in any single currency?',
    ])
  })

  it('holds no duplicates, since each is a key as well as a question', () => {
    expect(new Set(SUGGESTED_QUESTIONS).size).toBe(SUGGESTED_QUESTIONS.length)
  })
})

/**
 * The five things `assistantAbsences.ts` says the app does not compute, plus the one it has never
 * had. Each vocabulary is the one a *question* would use, not the one the prompt uses to forbid it:
 * an owner asks "how volatile", not "what is the standard deviation".
 */
describe('no suggestion asks for something the app cannot answer', () => {
  it.each([
    ['an annualised figure', /annualis|annualiz|per year|a year\b|p\.a\.|compound|cagr/],
    ['a benchmark', /benchmark|index\b|s&p|market\b|peers?\b|beat|outperform|underperform/],
    ['a risk statistic', /volatil|risk-adjusted|sharpe|beta\b|deviation|drawdown/],
    ['a cause', /\bwhy\b|because|caused|due to|driven by|explain why/],
    ['tax', /\btax|withhold/],
  ])('names %s nowhere', (_subject, pattern) => {
    expect(ALL).not.toMatch(pattern)
  })

  /**
   * ADR-0009's line, from the side a suggestion could cross it: the app may judge the portfolio
   * against the owner's stated targets and against its own baseline, and it may never propose what
   * a target should be. *"Which holdings are furthest from my target sector weights?"* asks about a
   * standard the owner wrote; *"what sector targets should I set?"* would ask the app to write one.
   */
  it('asks about the owner’s policy and never proposes one', () => {
    expect(ALL).not.toMatch(/should i|do you recommend|recommend (a|that|setting)|what target/)
    expect(ALL).not.toMatch(/set a (target|limit)|worth (buying|adding|selling)|should i buy/)
  })

  /**
   * DDR-0102 removed the period picker because a question already names its own period. The row
   * must not grow back into one — a chip naming a period would be the menu of periods this app
   * deliberately does not draw.
   */
  it('names no period, so the row cannot become the picker DDR-0102 removed', () => {
    expect(ALL).not.toMatch(/last (month|quarter|year|12)|ytd|year to date|20\d\d/)
  })
})

describe('which question a submission carries', () => {
  const typed = 'What did I buy in March?'

  it('reads the box when nothing submitted it — the Enter key’s path', () => {
    expect(submittedQuestion(null, typed)).toBe(typed)
  })

  it('reads the box when the send button submitted it, which carries no name', () => {
    expect(submittedQuestion({ name: '', value: '' }, typed)).toBe(typed)
  })

  it('reads the chip’s own text when a chip submitted it', () => {
    const chip = SUGGESTED_QUESTIONS[2]!
    expect(submittedQuestion({ name: SUGGESTION_FIELD, value: chip }, typed)).toBe(chip)
  })

  /**
   * The failure this guards is a rename: the component writes the name onto four buttons and this
   * function reads it back, and a mismatch would silently send the typed question instead — which
   * on screen is indistinguishable from the click not having registered.
   */
  it('ignores a submitter under any other name', () => {
    expect(submittedQuestion({ name: 'something-else', value: 'ignored' }, typed)).toBe(typed)
  })
})

describe('what the box is left holding', () => {
  it('empties when the box is what was asked', () => {
    expect(boxAfterAsking('Am I balanced?', 'Am I balanced?')).toBe('')
  })

  it('empties on the whitespace the trim removed, rather than leaving it behind', () => {
    expect(boxAfterAsking('  Am I balanced?  ', 'Am I balanced?')).toBe('')
  })

  /** The row opens on focus, so a half-written question is what is on screen when a chip is hit. */
  it('keeps a draft when a suggestion was asked instead', () => {
    expect(boxAfterAsking('Half a quest', SUGGESTED_QUESTIONS[0]!)).toBe('Half a quest')
  })
})

describe('a chip is a submit control of the composer’s own form', () => {
  it('is a button that submits, associated by `form` since it sits outside one', () => {
    expect(CODE).toContain('type="submit"')
    expect(CODE).toContain('form={formId}')
    expect(CODE).toContain('name={SUGGESTION_FIELD}')
    expect(CODE).toContain('value={suggestion}')
    expect(CODE).toContain('<form\n            id={formId}')
  })

  /** The same guard the box and the send button meet, so a click cannot outrun a question. */
  it('is disabled while a question is in flight', () => {
    const chip = CODE.slice(CODE.indexOf('name={SUGGESTION_FIELD}'))
    expect(chip.slice(0, 200)).toContain('disabled={pending}')
  })

  it('resolves the submitted question through the module rather than in the handler', () => {
    expect(CODE).toContain('submittedQuestion(')
    expect(CODE).toContain('(event.nativeEvent as SubmitEvent).submitter')
  })

  it('is not a ToggleGroup and not a Badge — these are one-shot actions (DDR-0036, DDR-0037)', () => {
    const row = CODE.slice(CODE.indexOf('assistant-suggestions'))
    expect(row.slice(0, 900)).not.toMatch(/aria-pressed|<Badge|ToggleGroup/)
  })
})

describe('opening and closing the row', () => {
  it('opens when the box takes focus, and never closes on blur', () => {
    expect(CODE).toContain('onFocus={() => setShowSuggestions(true)}')
    expect(CODE).not.toContain('onBlur')
  })

  it('flips on the toggle, and the toggle says which state it is in', () => {
    expect(CODE).toContain('onClick={() => setShowSuggestions((open) => !open)}')
    expect(CODE).toContain('aria-expanded={showSuggestions}')
    expect(CODE).toContain('aria-controls={suggestionsId}')
  })

  it('closes when a question is asked', () => {
    const ask = CODE.slice(CODE.indexOf('const ask = useCallback'))
    expect(ask).toContain('setShowSuggestions(false)')
  })

  /**
   * `hidden`, never unmounted: the toggle's `aria-controls` has to name an element that is in the
   * document in both states, and the attribute is what takes four buttons out of the tab order.
   */
  it('hides the row rather than dropping it, and gives `[hidden]` its own rule', () => {
    expect(CODE).toContain('hidden={!showSuggestions}')
    // The trap, met a third time after `.collapsible-panel` (DDR-0106) and `.profile-column-body`
    // (#347): the row's own `display: flex` defeats the attribute without this rule.
    expect(rule('.assistant-suggestions')).toContain('display: flex')
    expect(rule('.assistant-suggestions[hidden]')).toContain('display: none')
  })

  /** Nothing to submit to where a blocker stands in the box's place (`askGate`'s two states). */
  it('is absent entirely while a blocker replaces the form', () => {
    expect(CODE).toContain('{gate.blocker === null && (')
  })
})

describe('the row on screen', () => {
  it('wears #346’s chip rather than a second rule, which is why it adopts no new surface', () => {
    expect(SUGGESTION_CHIP_CLASS).toContain('assistant-chip')
    expect(SUGGESTION_CHIP_CLASS).toContain('assistant-chip-action')
    // The one thing the shared rule cannot give it: a whole question has to wrap, and
    // `.assistant-chip` is `nowrap` for a two-word state.
    expect(rule('.assistant-chip')).toContain('white-space: nowrap')
    expect(rule('.assistant-suggestion')).toContain('white-space: normal')
    expect(rule('.assistant-suggestion')).toContain('text-align: left')
    // No fill of its own, so `sidebarRail.test.ts`'s count of that token stays right.
    expect(rule('.assistant-suggestion')).not.toContain('--surface-raised')
  })

  it('sits above the composer’s rule, on the transcript’s own inline edge', () => {
    const row = rule('.assistant-suggestions')
    expect(row).toContain('flex-wrap: wrap')
    expect(row).toContain('padding: 0 var(--space-8) var(--space-4)')
    expect(row).not.toContain('border-top')
    // Drawn before the composer's band, which is what puts it above that band's rule.
    expect(CSS.indexOf('.assistant-suggestions {')).toBeLessThan(CSS.indexOf('.assistant-composer {'))
  })

  it('names itself for a reader, since four questions do not say what they are', () => {
    expect(SUGGESTIONS_ROW_LABEL).toBe('Suggested questions')
    expect(CODE).toContain('role="group"')
    expect(CODE).toContain('aria-label={SUGGESTIONS_ROW_LABEL}')
  })

  /** The `:where(...)` base rings all four and the toggle; a rule here would be the bug (DDR-0026). */
  it('writes no focus rule of its own', () => {
    for (const selector of ['.assistant-suggestions', '.assistant-suggestion']) {
      expect(rule(selector)).not.toContain('outline')
    }
  })
})

describe('the two accent tones, measured where they render', () => {
  it('moves the chip to the accent on hover, edge and ink together', () => {
    const hover = rule('.assistant-suggestion:hover:not(:disabled)')
    expect(hover).toContain('border-color: var(--accent)')
    expect(hover).toContain('color: var(--accent)')
    expect(PAIRINGS.some((pairing) => pairing.where.includes('.assistant-suggestion:hover'))).toBe(
      true,
    )
  })

  /**
   * The wash the open toggle takes, pinned against the pairing that measures it. A composite
   * measured from a percentage the stylesheet does not use is a measurement of nothing — the trap
   * the ink ramp and the band tint are both pinned for (`contrast.test.ts`).
   */
  it('tints the open toggle with the accent wash the pairing measures', () => {
    const open = rule(`.btn.${SUGGESTIONS_TOGGLE_CLASS}[aria-expanded='true']`)
    expect(open).toContain('color: var(--accent)')
    expect(open).toContain('background: color-mix(in srgb, var(--accent) 16%, var(--bg))')

    const pairing = PAIRINGS.find((one) => one.where.includes(SUGGESTIONS_TOGGLE_CLASS))
    expect(pairing, 'the open toggle’s wash is not measured').toBeDefined()
    expect(pairing!.background).toEqual({
      mix: { token: '--accent', percent: 16, over: '--bg' },
    })
  })

  /**
   * `.btn-secondary:hover:not(:disabled)` is (0,3,0) and would otherwise pull an *open* toggle back
   * to `--text` under the pointer. The compound selector ties with it, so source order settles it —
   * which means the rule has to stay below the button family, and this is what says so.
   */
  it('out-orders the secondary button’s hover rather than tying and losing', () => {
    expect(CSS.indexOf('.btn-secondary:hover')).toBeLessThan(
      CSS.indexOf(`.btn.${SUGGESTIONS_TOGGLE_CLASS}`),
    )
  })
})
