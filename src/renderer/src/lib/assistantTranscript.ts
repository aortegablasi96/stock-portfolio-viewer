import { formatTimeOfDay } from '@shared/format'
import type { Turn } from './assistantAsk'

/**
 * How the transcript is drawn: the order, the marking, and what stands where there is nothing
 * (Story #344, DDR-0115 decision 7).
 *
 * It is here rather than in the component for the reason every other decision in this view is:
 * Vitest runs Node-only with no jsdom (DDR-0029), so an order, a label or a class name living
 * inside a component is a decision nothing can assert. What is left in `AssistantConversation` is
 * the part that needs a DOM — state, an effect and JSX.
 *
 * ## The order is two orders, and confusing them is silent
 *
 * `turns` is held **newest-first**, and that is the *wire's* order: `rememberedTurns` walks the
 * array backwards to emit oldest-first, and `trimHistory` then drops whole turns from the oldest
 * end. The design renders **oldest-first**, newest at the bottom, which is the order a
 * conversation reads in.
 *
 * The trap DDR-0115 records is getting the second by reversing the first. Storing the array
 * oldest-first would invert `rememberedTurns` in silence: the model would read the conversation
 * backwards and the trim would discard the **newest** turns — three turns of memory all wrong,
 * with nothing on screen looking wrong and no test failing unless one is written for it. So the
 * rule is stated as a rule: **the array's order is the wire's; the transcript's order is the
 * transcript's**, and {@link transcriptOrder} is the only place the second is produced.
 */

/**
 * The turns in reading order — oldest first, newest last.
 *
 * A copy, never `turns.reverse()`: that mutates the array React is holding as state, which would
 * reverse the *stored* order as a side effect of drawing it — the exact failure above, arrived at
 * by accident instead of by design.
 */
export function transcriptOrder(turns: readonly Turn[]): Turn[] {
  return [...turns].reverse()
}

/** Who said a block. The same two roles the message array is marked with (DDR-0113). */
export type TranscriptRole = 'you' | 'model'

/**
 * What each role is called above its bubble.
 *
 * The design draws `YOU` and `ASSISTANT` in capitals; the capitals are `text-transform`, so the
 * accessible name stays the sentence case written here. `Assistant` is the same word the sidebar
 * row uses for this view, which is deliberate — a reader meets one name for one thing.
 */
export const ROLE_LABELS: Record<TranscriptRole, string> = {
  you: 'You',
  model: 'Assistant',
}

/** The separator between the role and the time, and the app's existing one (`Live · 14:32`). */
const ROLE_SEPARATOR = ' · '

/**
 * The marking above a bubble: who said it, and when.
 *
 * `at` is `null` while a turn is still waiting, and the label is then the role alone — which is
 * what the design draws on its typing indicator, and the honest reading: there is no time to state
 * because nothing has arrived yet.
 */
export function roleLabel(role: TranscriptRole, at: number | null): string {
  const name = ROLE_LABELS[role]
  return at === null ? name : `${name}${ROLE_SEPARATOR}${formatTimeOfDay(at)}`
}

/** The classes a block and its bubble wear, so a rule has one hook per role. */
export const TRANSCRIPT_CLASSES = {
  block: 'assistant-block',
  bubble: 'assistant-bubble',
} as const

export function blockClassName(role: TranscriptRole): string {
  return `${TRANSCRIPT_CLASSES.block} ${TRANSCRIPT_CLASSES.block}-${role}`
}

export function bubbleClassName(role: TranscriptRole): string {
  return `${TRANSCRIPT_CLASSES.bubble} ${TRANSCRIPT_CLASSES.bubble}-${role}`
}

/**
 * What a transcript with nothing in it says (`figma_design/src/App.tsx:2245-2252`).
 *
 * It is drawn *beside* the list rather than inside it: the `<ol>` is the `aria-live` region and is
 * in the document from mount, so putting a placeholder `<li>` in it would announce the placeholder
 * as though it were a turn. Two sentences, and the second names the control that fixes it — the
 * shape every named state in this app takes (DDR-0038).
 */
export const EMPTY_TRANSCRIPT_HEADING = 'No questions yet'
export const EMPTY_TRANSCRIPT_DETAIL = 'Ask anything about your portfolio below.'
