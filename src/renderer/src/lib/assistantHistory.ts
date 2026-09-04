import { isStale, type Turn } from './assistantAsk'
import { trimHistory, type AssistantHistoryTurn } from '@shared/domain/assistantHistory'

/**
 * Which turns of the transcript the next question is asked in the light of (Story #320, DDR-0113).
 *
 * The transcript and the memory are **two different things over one list**, and keeping them apart
 * is most of this module. What is on screen is a *record*: every question the owner asked, every
 * answer and every failure, oldest at the bottom, each saying beside itself whether the store has
 * moved past it. What goes to the model is an *assertion made again*, so it is narrower on three
 * counts and each of them is a stated rule rather than a filter someone found convenient.
 *
 * It is here rather than in the component for the reason every other decision in this view is:
 * Vitest runs Node-only with no jsdom (DDR-0029), so a component cannot be rendered and anything
 * with a rule in it has to be reachable without one.
 *
 * The bounds themselves are `@shared/domain/assistantHistory`'s, and {@link trimHistory} is applied
 * **again** at the IPC boundary — this is the policy, that is the bound (DDR-0113, decision 8).
 */

/**
 * The remembered turns, oldest first, from a transcript held newest first.
 *
 * Three exclusions, in the order they matter:
 *
 * **Only an answered turn is remembered.** A `thinking` turn has no answer yet. A `failed` one has
 * *this app's* failure copy where an answer would be — carrying it as the model's own prose would
 * attribute the app's error wording to the model, and carrying the question alone would invite the
 * model to answer a question it was never asked.
 *
 * **A stale turn is forgotten, not re-asserted** (DDR-0113, decision 5). A turn records the Flex
 * version it was grounded at (DDR-0027) and the view stays mounted, so a transcript outlives the
 * import that invalidates it. On screen the answer stays with `STALE_NOTE` beside it — it was true
 * when it was given — but the model cannot see that note, so a remembered stale turn would be the
 * app asserting an out-of-date reading again as though it were current. `groundedAt` is
 * non-decreasing across a transcript, so the stale turns are always the oldest and dropping them
 * leaves a contiguous suffix.
 *
 * **What is left is capped**, by {@link trimHistory}, newest kept.
 *
 * The order is reversed on the way out: `turns` is newest-first because the answer to the question
 * just typed has to be adjacent to the box that typed it (DDR-0098), and a conversation is read by
 * the model in the order it happened.
 */
export function rememberedTurns(turns: readonly Turn[], version: number): AssistantHistoryTurn[] {
  const answered: AssistantHistoryTurn[] = []

  // Oldest first, which is both the order the model reads and the order staleness runs out in.
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]!
    if (turn.answer.kind !== 'answered') continue
    if (isStale(turn, version)) continue
    answered.push({ question: turn.question, answer: turn.answer.text })
  }

  return trimHistory(answered)
}

/**
 * **The control that discards a conversation is not here any more** (Story #346, DDR-0115
 * amendment 5).
 *
 * `NEW_CONVERSATION_LABEL` and its three companions — the confirm label, the busy label and the
 * warning — described a `ConfirmAction` (DDR-0012, DDR-0113 decision 7). The design draws a bare
 * **Clear chat** button in the chat header whose only guard is being disabled when there is
 * nothing to lose, and DDR-0115 takes the design's answer. The wording that survives is
 * `lib/assistantHeader.ts`'s, beside the rest of the header it now belongs to.
 *
 * Recorded as an absence rather than deleted silently, because the *reasoning* it carried is still
 * live and is what a later story would need before reinstating one: **nothing stored is touched**.
 * ADR-0006 governs rows in the database and this clears a React array, which is the line between
 * this control and *Clear the profile*, where `ConfirmAction` stays (#347). The half of the old
 * warning that was a real fact — the assistant stops remembering the turns — did not go with it:
 * it is on the button's `title` (`CLEAR_CHAT_TITLE`).
 */
