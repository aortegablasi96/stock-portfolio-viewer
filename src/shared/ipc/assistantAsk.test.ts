import { describe, expect, it } from 'vitest'
import {
  MAX_CONTEXT_SECTION_CHARS,
  MAX_QUESTION_CHARS,
  assistantAskRequestSchema,
} from './contract'
import {
  DISCLOSURE_CATEGORY_IDS,
  pickDisclosedSections,
} from '@shared/domain/assistantDisclosure'

/**
 * The boundary the one outbound channel crosses (Story #284, DDR-0098).
 *
 * The context is assembled in the renderer, so this schema is where "an undisclosed section cannot
 * be sent" stops being a type and becomes a fact. `AssistantContext`'s key type says it at compile
 * time; a payload arriving over IPC has been through no compiler at all, and this is what holds
 * there.
 *
 * **It is the whole of the bound now** (Story #309, ADR-0011). It used to be one of two: adding a
 * category also moved the consent fingerprint and re-asked the owner, so a section reaching the
 * model without being added would have been sent under a consent that never covered it (DDR-0097).
 * The fingerprint is gone with the decision it protected, and what is left is stronger than the
 * half that went — it fails a build rather than informing a reader.
 */

const parse = (input: unknown) => assistantAskRequestSchema.safeParse(input)

describe('assistantAskRequestSchema', () => {
  it('accepts a question with the sections the disclosure declares', () => {
    const result = parse({
      question: 'Am I balanced?',
      context: { holdings: 'AAPL', weights: 'USD: 60.00%' },
    })
    expect(result.success).toBe(true)
    expect(result.success && result.data.context).toEqual({
      holdings: 'AAPL',
      weights: 'USD: 60.00%',
    })
  })

  /**
   * The assertion this file exists for. A key nobody disclosed is **dropped**, not rejected — the
   * request still goes, carrying only what the owner read — because a rejection would make an
   * unrelated bug in the renderer look to the owner like the assistant being broken.
   */
  it('drops a section the disclosure does not declare', () => {
    const result = parse({
      question: 'Am I balanced?',
      context: { holdings: 'AAPL', secrets: 'the account number', __proto__: 'x' },
    })
    expect(result.success).toBe(true)
    expect(result.success && Object.keys(result.data.context)).toEqual(['holdings'])
  })

  it('drops an empty section rather than sending a heading with nothing under it', () => {
    const result = parse({ question: 'q', context: { holdings: '   ', weights: 'x' } })
    expect(result.success && Object.keys(result.data.context)).toEqual(['weights'])
  })

  it('accepts a question with no context at all', () => {
    const result = parse({ question: 'What can you see?' })
    expect(result.success).toBe(true)
    expect(result.success && result.data.context).toEqual({})
  })

  it('rejects a question that is only whitespace', () => {
    expect(parse({ question: '   ' }).success).toBe(false)
    expect(parse({ question: '' }).success).toBe(false)
  })

  it('trims the question, so the prompt does not carry the box’s stray newlines', () => {
    const result = parse({ question: '  Am I balanced?\n ' })
    expect(result.success && result.data.question).toBe('Am I balanced?')
  })

  it('rejects a question past the ceiling', () => {
    expect(parse({ question: 'a'.repeat(MAX_QUESTION_CHARS) }).success).toBe(true)
    expect(parse({ question: 'a'.repeat(MAX_QUESTION_CHARS + 1) }).success).toBe(false)
  })

  /**
   * A ceiling per section rather than one over the whole context. The gateway already holds the
   * total (`MAX_PROMPT_CHARS`); what this stops is one runaway section — a thousand-position
   * holdings list — eating the whole budget and starving every other section of its place.
   */
  it('rejects a single section past its own ceiling', () => {
    const under = { question: 'q', context: { holdings: 'a'.repeat(MAX_CONTEXT_SECTION_CHARS) } }
    const over = { question: 'q', context: { holdings: 'a'.repeat(MAX_CONTEXT_SECTION_CHARS + 1) } }
    expect(parse(under).success).toBe(true)
    expect(parse(over).success).toBe(false)
  })

  it('rejects a context whose values are not text', () => {
    expect(parse({ question: 'q', context: { holdings: 42 } }).success).toBe(false)
  })
})

describe('pickDisclosedSections', () => {
  it('keeps only ids the disclosure carries, in declaration order', () => {
    const picked = pickDisclosedSections({
      weights: 'w',
      holdings: 'h',
      nothing: 'n',
    })
    expect(Object.keys(picked)).toEqual(['holdings', 'weights'])
  })

  it('accepts every id the disclosure declares, so none is unreachable', () => {
    const all = Object.fromEntries(DISCLOSURE_CATEGORY_IDS.map((id) => [id, 'x']))
    expect(Object.keys(pickDisclosedSections(all))).toEqual([...DISCLOSURE_CATEGORY_IDS])
  })

  it('drops an absent or blank section', () => {
    expect(pickDisclosedSections({ holdings: undefined, weights: '' })).toEqual({})
  })
})
