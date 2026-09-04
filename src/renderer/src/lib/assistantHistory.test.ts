import { describe, expect, it } from 'vitest'
import { rememberedTurns } from './assistantHistory'
import { STALE_NOTE, type Turn } from './assistantAsk'
import { MAX_HISTORY_CHARS, MAX_REMEMBERED_TURNS } from '@shared/domain/assistantHistory'

/**
 * Which turns of the transcript the next question is asked in the light of (Story #320, DDR-0113).
 *
 * The transcript and the memory are two different things over one list, and every difference
 * between them is a rule with a reason rather than a filter someone found convenient. This file is
 * where each of them is pinned, because the component that calls this cannot be rendered — Vitest
 * is Node-only with no jsdom (DDR-0029).
 */

let nextId = 1

/**
 * A turn as the view holds one. `groundedAt` defaults to the current version: not stale.
 *
 * The two clock times are real values rather than zeroes, and that is deliberate: they exist so
 * the assertions below can look for them in what goes out. A fixture carrying `0` would let a
 * timestamp reach the wire and still pass, which is the failure this story has to make loud.
 */
const ASKED_AT = new Date(2026, 8, 3, 17, 31).getTime()
const ANSWERED_AT = new Date(2026, 8, 3, 17, 32).getTime()

const answered = (question: string, text: string, groundedAt = 5): Turn => ({
  id: nextId++,
  question,
  groundedAt,
  askedAt: ASKED_AT,
  answeredAt: ANSWERED_AT,
  answer: { kind: 'answered', text, truncated: false },
})

const thinking = (question: string, groundedAt = 5): Turn => ({
  id: nextId++,
  question,
  groundedAt,
  askedAt: ASKED_AT,
  answeredAt: null,
  answer: { kind: 'thinking' },
})

const failed = (question: string, groundedAt = 5): Turn => ({
  id: nextId++,
  question,
  groundedAt,
  askedAt: ASKED_AT,
  answeredAt: ANSWERED_AT,
  answer: { kind: 'failed', heading: 'No answer came back', text: 'The assistant did not reply.' },
})

/** The transcript is newest-first on screen; the model reads oldest-first. */
const transcript = (...oldestFirst: Turn[]): Turn[] => [...oldestFirst].reverse()

describe('what the model is told about the turns before this one', () => {
  it('remembers nothing from an empty transcript', () => {
    expect(rememberedTurns([], 5)).toEqual([])
  })

  it('carries the question and the answer, oldest first', () => {
    const turns = transcript(
      answered('What do I hold?', 'Eight positions.'),
      answered('And the second one?', 'Serabi Gold.'),
    )

    expect(rememberedTurns(turns, 5)).toEqual([
      { question: 'What do I hold?', answer: 'Eight positions.' },
      { question: 'And the second one?', answer: 'Serabi Gold.' },
    ])
  })

  /**
   * The pronoun this story is named after. Carrying only the *questions* — the alternative
   * DDR-0113 weighed and rejected — leaves "and the second one?" resolving against nothing, because
   * what enumerated the positions was the answer.
   */
  it('carries what the pronoun refers to, which is in the answer', () => {
    const turns = transcript(answered('What do I hold?', 'Rio Tinto, then Serabi Gold.'))

    expect(rememberedTurns(turns, 5)[0]?.answer).toContain('Serabi Gold')
  })
})

/**
 * **What the transcript gained in Story #344, and what the model may never see** (DDR-0115
 * decision 7).
 *
 * A turn now carries two clock times, drawn above its two bubbles. They are a render concern in
 * exactly the way formatting is (DDR-0114), and the failure if they leak is silent: a time in the
 * prompt is a fact the model may reason from, no absence block covers it, and nothing on screen
 * would look wrong. So it is asserted directly rather than inferred from the shape of the type —
 * `AssistantHistoryTurn` is Zod-free by design (DDR-0105's trap), so nothing strips a field at
 * this end.
 */
describe('a remembered turn carries two fields and no others', () => {
  it('emits exactly `question` and `answer`, with no timestamp among them', () => {
    const [remembered] = rememberedTurns(transcript(answered('What do I hold?', 'Eight.')), 5)

    expect(Object.keys(remembered!).sort()).toEqual(['answer', 'question'])
    expect(remembered).toEqual({ question: 'What do I hold?', answer: 'Eight.' })
  })

  /**
   * The same claim from the other side, over a whole conversation: the times the fixtures carry
   * are real and distinct, so a leak of either — under any key, at any depth — shows up here.
   */
  it('lets no clock time reach the wire, whatever the conversation', () => {
    const turns = transcript(
      answered('One', '1'),
      failed('Two'),
      answered('Three', '3'),
      thinking('Four'),
    )

    const wire = JSON.stringify(rememberedTurns(turns, 5))

    expect(wire).not.toContain(String(ASKED_AT))
    expect(wire).not.toContain(String(ANSWERED_AT))
    expect(wire).not.toContain('askedAt')
    expect(wire).not.toContain('answeredAt')
    // And the guard is looking at something: the conversation it measured is not empty.
    expect(wire).toContain('Three')
  })

  /**
   * **The array's order is the wire's; the transcript's order is the transcript's** (DDR-0115
   * decision 7). #344 draws the transcript oldest-first, and the trap it walks past is getting
   * that by reversing the *stored* array — which would make this function emit the conversation
   * backwards and `trimHistory` drop the **newest** turns, with nothing on screen looking wrong.
   * The reversal lives in `transcriptOrder`; this asserts that it did not move here.
   */
  it('still reads a newest-first array and emits oldest-first', () => {
    const newestFirst = [answered('Second', 'B'), answered('First', 'A')]

    expect(rememberedTurns(newestFirst, 5).map((one) => one.question)).toEqual(['First', 'Second'])
  })
})

describe('three kinds of turn are not remembered, each for its own reason', () => {
  /**
   * A `failed` turn carries *this app's* failure copy where an answer would be. Carried as the
   * model's own prose it would attribute the app's error wording to the model; carried as a
   * question alone it would invite the model to answer a question it was never asked.
   */
  it('forgets a turn that failed', () => {
    const turns = transcript(answered('First?', 'Yes.'), failed('Second?'))

    expect(rememberedTurns(turns, 5)).toEqual([{ question: 'First?', answer: 'Yes.' }])
  })

  it('forgets a turn still waiting for its answer', () => {
    const turns = transcript(answered('First?', 'Yes.'), thinking('Second?'))

    expect(rememberedTurns(turns, 5)).toEqual([{ question: 'First?', answer: 'Yes.' }])
  })

  /**
   * **The stated rule for a stale turn** (DDR-0113, decision 5). On screen the answer stays with
   * `STALE_NOTE` beside it — it was true when it was given. To the model it would be an assertion
   * made again, about a store that has moved past it, with no way to see the note the owner can.
   */
  it('forgets a turn the imported history has moved past', () => {
    const turns = transcript(answered('Before the import?', 'Yes.', 4), answered('After?', 'Yes.', 5))

    expect(rememberedTurns(turns, 5)).toEqual([{ question: 'After?', answer: 'Yes.' }])
  })

  it('tells the owner it has forgotten it, rather than leaving them to infer it', () => {
    expect(STALE_NOTE).toContain('no longer remembers this turn')
  })

  /**
   * `groundedAt` is non-decreasing across a transcript, so the stale turns are always the oldest.
   * Dropping them therefore leaves a contiguous suffix rather than a conversation with a hole in it.
   */
  it('leaves a contiguous conversation when the oldest turns go stale', () => {
    const turns = transcript(
      answered('One', '1', 3),
      answered('Two', '2', 3),
      answered('Three', '3', 7),
      answered('Four', '4', 7),
    )

    expect(rememberedTurns(turns, 7).map((one) => one.question)).toEqual(['Three', 'Four'])
  })

  it('remembers nothing at all once every turn is stale', () => {
    const turns = transcript(answered('One', '1', 1), answered('Two', '2', 2))

    expect(rememberedTurns(turns, 9)).toEqual([])
  })
})

describe('the caps bind, and the newest turns win', () => {
  it('keeps the last few turns of a long conversation', () => {
    const turns = transcript(
      ...Array.from({ length: MAX_REMEMBERED_TURNS + 3 }, (_, index) =>
        answered(`Q${index}`, `A${index}`),
      ),
    )
    const kept = rememberedTurns(turns, 5)

    expect(kept).toHaveLength(MAX_REMEMBERED_TURNS)
    expect(kept[kept.length - 1]?.question).toBe(`Q${MAX_REMEMBERED_TURNS + 2}`)
  })

  it('drops an older turn rather than exceed the character budget', () => {
    // Two of these fit the budget with the questions counted in; a third would not.
    const long = 'a'.repeat(Math.floor(MAX_HISTORY_CHARS / 2) - 10)
    const turns = transcript(answered('One', long), answered('Two', long), answered('Three', long))
    const kept = rememberedTurns(turns, 5)

    expect(kept.map((one) => one.question)).toEqual(['Two', 'Three'])
  })

  /**
   * The counting is over the turns that are actually carried, not over the transcript: a long
   * failed turn between two short answered ones must not cost the conversation its memory.
   */
  it('counts only what it carries', () => {
    const turns = transcript(
      answered('One', '1'),
      failed('a'.repeat(MAX_HISTORY_CHARS)),
      answered('Two', '2'),
    )

    expect(rememberedTurns(turns, 5).map((one) => one.question)).toEqual(['One', 'Two'])
  })
})

/**
 * The control that discards a conversation moved out of this module (Story #346, DDR-0115
 * amendment 5), and the four constants describing its `ConfirmAction` went with it.
 *
 * Pinned as an **absence** rather than deleted quietly, which is this suite's own idiom for a
 * removal that could be undone by accident (see `assistantAsk.test.ts` on `empty_period`). What
 * must not come back here is a second wording for a control the header now owns: two labels for
 * one button is how the app's two surfaces start disagreeing about what it does. The wording is
 * `assistantHeader.test.ts`'s, and the fact the warning carried — the assistant stops remembering
 * the turns — is asserted there, on the `title` that now carries it.
 */
describe('clearing a conversation is not this module’s wording any more', () => {
  it('exports no label, confirm, busy label or warning for it', async () => {
    const module: Record<string, unknown> = await import('./assistantHistory')
    expect(Object.keys(module).filter((name) => name.startsWith('NEW_CONVERSATION'))).toEqual([])
  })
})
