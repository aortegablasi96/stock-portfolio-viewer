import { describe, expect, it } from 'vitest'
import {
  MAX_HISTORY_CHARS,
  MAX_REMEMBERED_TURNS,
  historyTurnChars,
  trimHistory,
  type AssistantHistoryTurn,
} from './assistantHistory'
import { MAX_PROMPT_CHARS } from '@repositories/assistant/aiGateway'

/**
 * The two bounds on what a conversation remembers (Story #320, DDR-0113).
 *
 * The **numbers** are asserted here rather than inferred from behaviour, which is DDR-0104's
 * mechanism applied a third time: growth is a decision that fails a test, never an edit that passes
 * one. `promptBudget.test.ts` is the other half — it measures what these cost against the real
 * ceiling, over the real reports.
 */

const turn = (question: string, answer: string): AssistantHistoryTurn => ({ question, answer })

/** `n` turns, oldest first, each costing `cost` characters in total. */
const turns = (count: number, cost = 100): AssistantHistoryTurn[] =>
  Array.from({ length: count }, (_, index) => turn(`q${index}`, 'a'.repeat(cost - 2)))

describe('the caps are declared, so growing them is a decision', () => {
  it('remembers three turns', () => {
    expect(MAX_REMEMBERED_TURNS).toBe(3)
  })

  it('spends at most 8,000 characters of the prompt on them', () => {
    expect(MAX_HISTORY_CHARS).toBe(8_000)
  })

  /**
   * The budget is a *share* of the ceiling and has to stay one. At the time of writing it is 13.3%,
   * against a multi-part question measured at 61.8% and an exhaustive round at 79.6% — the rows
   * `promptBudget.test.ts` holds to DDR-0103's gate and to the ceiling respectively.
   */
  it('is a small share of what may be sent, not a competitor for it', () => {
    expect(MAX_HISTORY_CHARS).toBeLessThan(MAX_PROMPT_CHARS * 0.2)
  })
})

describe('trimming keeps the newest turns that fit', () => {
  it('keeps everything when both bounds hold', () => {
    const history = turns(MAX_REMEMBERED_TURNS)
    expect(trimHistory(history)).toEqual(history)
  })

  it('keeps nothing from an empty conversation', () => {
    expect(trimHistory([])).toEqual([])
  })

  it('drops the oldest turns beyond the count, keeping the order', () => {
    const history = turns(MAX_REMEMBERED_TURNS + 2)
    const kept = trimHistory(history)

    expect(kept).toHaveLength(MAX_REMEMBERED_TURNS)
    expect(kept).toEqual(history.slice(2))
  })

  it('drops the oldest turns beyond the character budget', () => {
    // Two of these fit; a third would not.
    const cost = Math.floor(MAX_HISTORY_CHARS / 2)
    const history = turns(3, cost)
    const kept = trimHistory(history)

    expect(kept).toHaveLength(2)
    expect(kept).toEqual(history.slice(1))
    expect(kept.reduce((total, one) => total + historyTurnChars(one), 0)).toBeLessThanOrEqual(
      MAX_HISTORY_CHARS,
    )
  })

  /**
   * **The unit of forgetting is a whole turn**, which is the decision rather than an implementation
   * detail: half an answer fed back to its author is a sentence that stops mid-clause with nothing
   * saying which part is missing (DDR-0113, decision 4).
   */
  it('drops a turn it cannot fit rather than carrying part of it', () => {
    const enormous = turn('q', 'a'.repeat(MAX_HISTORY_CHARS + 1))

    expect(trimHistory([enormous])).toEqual([])
    expect(trimHistory([turn('older', 'short'), enormous])).toEqual([])
  })

  /**
   * A conversation with a hole in it would have the model resolving a pronoun against a turn that
   * never happened, so the trim stops at the first turn that does not fit rather than skipping it
   * for an older one that would.
   */
  it('stops at the first turn that does not fit, leaving no hole', () => {
    const history = [
      turn('tiny', 'x'),
      turn('huge', 'a'.repeat(MAX_HISTORY_CHARS - 10)),
      turn('newest', 'y'),
    ]

    // The huge turn fits alone but not beside the newest, so it and everything older stop there.
    expect(trimHistory(history)).toEqual([history[2]])
  })

  it('never returns more than the caps allow, whatever it is given', () => {
    const kept = trimHistory(turns(50, 40))

    expect(kept.length).toBeLessThanOrEqual(MAX_REMEMBERED_TURNS)
    expect(kept.reduce((total, one) => total + historyTurnChars(one), 0)).toBeLessThanOrEqual(
      MAX_HISTORY_CHARS,
    )
  })

  it('counts both halves of a turn, since both go on the wire', () => {
    expect(historyTurnChars(turn('12345', '123'))).toBe(8)
  })
})
