import {
  DISCLOSURE_CATEGORIES,
  GRANULARITY_LABELS,
  disclosedGranularities,
  type DisclosureCategory,
} from '@shared/domain/assistantDisclosure'
import type { AssistantStatus } from '@shared/domain/assistant'

/**
 * The wording of the consent gate (Story #283, DDR-0097).
 *
 * Here rather than in the component for the reason everything in `lib/` is here: Vitest runs
 * Node-only with no jsdom (DDR-0029), so a string inside a component is a string nothing can
 * assert — and these strings are the whole product. This is the moment a local-first app stops
 * being local-first, and the story's rule is that the wording **states plainly that data leaves
 * the machine and where it goes; it does not soften that into a benefit**. A test can hold that
 * rule; a component cannot.
 */

/** What the gate is showing: the blocker in the way, or the assistant being ready. */
export type GateKind = 'first_consent' | 're_consent' | 'not_configured' | 'ready'

/**
 * Which panel to draw.
 *
 * `re_consent` is separated from `first_consent` because the two say different things: one asks a
 * question for the first time, the other reports that the answer no longer covers what would be
 * sent. Telling someone to "decide" when they already did is the failure DDR-0022's pair exists to
 * avoid, in a different domain.
 */
export function gateKind(status: AssistantStatus): GateKind {
  if (status.consentStale) return 're_consent'
  if (!status.consented) return 'first_consent'
  if (!status.configured) return 'not_configured'
  return 'ready'
}

/** The heading each state carries. */
export const GATE_HEADINGS: Record<GateKind, string> = {
  first_consent: 'This is the one feature that sends your data off this machine',
  re_consent: 'What would be sent has changed',
  not_configured: 'No OpenAI API key',
  ready: 'The assistant is allowed to run',
}

/**
 * The body of each state.
 *
 * The first-consent copy names the destination and the fact in the same breath, and does not
 * mention a benefit at all — the benefit is why the owner is here; the cost is what they came to
 * this panel to read.
 */
export const GATE_BODIES: Record<GateKind, string> = {
  first_consent:
    'Everything else in this app stays on your computer. To answer questions about your portfolio, the assistant sends the figures below to OpenAI. Nothing is sent until you allow it, and you can withdraw that at any time.',
  re_consent:
    'You allowed the assistant to send a specific list of things. That list has changed, so your earlier answer no longer covers it. Read what is on it now and decide again. Nothing is being sent in the meantime.',
  not_configured:
    'You have allowed the assistant to send these figures, but there is no API key for it to send them with. Add one in the panel below. Setting OPENAI_API_KEY in your environment or your .env file works too, and takes precedence over a key saved here.',
  ready:
    'The assistant may send the figures below to OpenAI when you ask it something. Withdraw this at any time and it stops.',
}

/** The action each state offers, or `null` where there is nothing to press. */
export const GATE_ACTIONS: Record<GateKind, string | null> = {
  first_consent: 'Allow the assistant to send this',
  re_consent: 'Allow the updated list',
  not_configured: null,
  ready: null,
}

/**
 * Whether the panel is reporting a **decision** the owner has not made, as opposed to a
 * configuration fact or a settled state.
 *
 * The two want different registers: a decision is a question, and a missing key is an instruction.
 * Neither is an error, which is why nothing here is toned as one.
 */
export function isDecision(kind: GateKind): boolean {
  return kind === 'first_consent' || kind === 're_consent'
}

/** The disclosure, in declaration order — never filtered, so a category cannot be hidden. */
export function disclosureRows(): readonly DisclosureCategory[] {
  return DISCLOSURE_CATEGORIES
}

/**
 * A one-line summary of how disclosing the whole list is.
 *
 * The distinction is the story's own, and it is worth drawing: a weight says nothing about how
 * much money is involved. Built from the granularities actually present rather than written out,
 * so removing the last category that sends amounts changes this line by itself.
 */
export function granularitySummary(): string {
  const present = disclosedGranularities()
  if (present.length === 0) return 'Nothing is sent.'
  return present.map((granularity) => GRANULARITY_LABELS[granularity].toLowerCase()).join(' · ')
}

/** When consent was given, as a sentence, or `null` before it has been. */
export function consentLine(status: AssistantStatus, format: (at: number) => string): string | null {
  if (status.consentedAt === null) return null
  return status.consentStale
    ? `You allowed an earlier version of this list on ${format(status.consentedAt)}.`
    : `You allowed this on ${format(status.consentedAt)}.`
}
