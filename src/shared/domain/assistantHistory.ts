/**
 * What a conversation remembers, and the two numbers that bound it (Story #320, DDR-0113).
 *
 * Every question the assistant had ever been asked was single-shot: `assistantService.ask` built
 * `[system, user]`, the model asked for the reports it needed, it answered, and the array was
 * discarded. The transcript on screen was a record for the **owner** — the model had never seen it,
 * so *"and the second one?"* resolved against nothing.
 *
 * ## The decision this module carries is what is **not** in a remembered turn
 *
 * A turn is a question and an **answer**, and nothing else. It carries no tool call and no tool
 * result, which is DDR-0113's second decision and the one with teeth: the reports that produced the
 * figures in a remembered answer are gone from the array, so a figure survives into the next turn
 * only inside a sentence the model is told it wrote. If it needs that figure as a **fact** it has to
 * call the tool again, and the tool answers from the services as it always did. That is ADR-0009's
 * seam kept open by the shape of the array rather than by a rule the prompt asks the model to
 * honour — and DDR-0104's finding is exactly why the difference matters: a passage can be asserted
 * present, never obeyed.
 *
 * The *marking* is the message role, which `assistantService` applies: a remembered answer crosses
 * as `role: 'assistant'`, the provider's own vocabulary for text the model wrote, beside `tool` for
 * a computed report and `user` for the app's grounding and the owner's question.
 *
 * ## Why it is here rather than beside the schema that validates it
 *
 * The renderer needs both caps at **runtime** — it selects the turns — and `contract.ts` imports
 * Zod. A constant the renderer needs at runtime may not live in a module that imports Zod, or one
 * value import pulls the whole package into that bundle with every gate still passing
 * (DDR-0105; `zodIsolation.test.ts` is what fails on it). `assistantKey.ts` is the same shape.
 */

/** One remembered exchange: what was asked, and what the model said back. */
export interface AssistantHistoryTurn {
  /** The question as the owner typed it — **not** wrapped in the grounding block (DDR-0113). */
  question: string
  /** The model's answer, as prose. Never a report, and never a tool result. */
  answer: string
}

/**
 * How many previous turns reach the model.
 *
 * **A declared constant, and `assistantHistory.test.ts` asserts the number** — DDR-0104's mechanism,
 * applied a third time (after `MAX_TOOL_ROUNDS` and the prompt's eight sections). Growth is a
 * decision that fails a test, never an edit that passes one.
 *
 * Three, because that is the depth at which the pronouns this story is named after actually resolve
 * — *what do I hold* → *and the second one?* → *is that one over my ceiling?* — and because a
 * typical exchange here is a ~150-character question and a ~1,500-character answer, so three turns
 * is ~5,000 characters. That leaves {@link MAX_HISTORY_CHARS} as the backstop rather than the
 * binding constraint in ordinary use, which is the right way round: the owner should be able to ask
 * how many turns are remembered and get a number.
 */
export const MAX_REMEMBERED_TURNS = 3

/**
 * The share of the prompt ceiling a history may spend, in characters.
 *
 * **A count alone does not bound the cost, and the cost is the whole difficulty** (DDR-0113). A
 * question may be `MAX_QUESTION_CHARS` long and an answer runs to `MAX_OUTPUT_TOKENS`, so three
 * turns at the caps is ~24,000 characters — 40% of `MAX_PROMPT_CHARS`, and 101.8% of it once a
 * six-report question is added underneath. The count is what the story asks to be a declared
 * decision; this is what keeps the decision from being a promise.
 *
 * 8,000 was chosen against measurement rather than taste. The multi-part question DDR-0112 says
 * decides the ceiling stood at 61.8%, leaving 13,918 characters under DDR-0103's 85% gate, and the
 * exhaustive round left 12,225 under the ceiling itself. 8,000 fits inside the smaller of those with
 * 4,225 to spare, and `promptBudget.test.ts` measures every row again with a full history in it — a
 * history that fits only just is one the next story breaks.
 */
export const MAX_HISTORY_CHARS = 8_000

/** What one remembered turn costs the prompt: both halves, since both go on the wire. */
export function historyTurnChars(turn: AssistantHistoryTurn): number {
  return turn.question.length + turn.answer.length
}

/**
 * Keep the newest turns that fit both bounds, in the order they happened.
 *
 * **The unit of forgetting is a whole turn.** A turn that alone exceeds {@link MAX_HISTORY_CHARS} is
 * dropped rather than truncated: half an answer fed back to its author is a worse artefact than no
 * answer, since the model would read a sentence of its own that stops mid-clause with nothing saying
 * which part is missing.
 *
 * Newest-first is the priority and oldest-first is the output. Dropping from the old end is what
 * keeps the result **contiguous** — a remembered conversation with a hole in it would have the model
 * resolving a pronoun against a turn that never happened.
 *
 * It runs in **two places on purpose** (DDR-0113, decision 8): the renderer applies it as policy
 * when it selects, and `assistantAskRequestSchema` applies it again as the bound at the IPC
 * boundary. That is the shape `context` already has, where `pickDisclosedSections` reduces at the
 * boundary rather than trusting the renderer to have done it.
 */
export function trimHistory(turns: readonly AssistantHistoryTurn[]): AssistantHistoryTurn[] {
  const kept: AssistantHistoryTurn[] = []
  let chars = 0

  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!
    if (kept.length === MAX_REMEMBERED_TURNS) break
    const cost = historyTurnChars(turn)
    // `break`, not `continue`: an older turn that happens to fit would leave a hole where the one
    // that did not fit was, and a conversation is only a conversation while it is contiguous.
    if (chars + cost > MAX_HISTORY_CHARS) break
    kept.push(turn)
    chars += cost
  }

  return kept.reverse()
}
