import { aiGateway } from '@repositories/assistant/aiGateway'
import { consentService } from '@services/assistant/consentService'
import {
  DISCLOSURE_CATEGORIES,
  type AssistantContext,
  type DisclosureCategoryId,
} from '@shared/domain/assistantDisclosure'
import type { AssistantAskResult, AssistantStatus } from '@shared/domain/assistant'

/**
 * The gate every model request passes through (Story #283, DDR-0097).
 *
 * **It exists so that "nothing is sent without consent" is a property of the code rather than a
 * promise in a document.** `aiGateway` is the only module that can reach OpenAI; this is the only
 * module that calls it, and the first thing it does is ask whether the owner said yes. A test
 * asserts the gateway is never reached while consent is absent — demonstrated, not asserted, as
 * the story puts it.
 *
 * It also **serialises the context**, and that is the second half of keeping the disclosure
 * honest. A context is keyed by the disclosure's own category ids, so a later story cannot send a
 * section that is not on the list the owner read: the type says so at compile time, and
 * {@link buildPrompt} drops anything unknown at runtime, in declaration order, under the same
 * headings the disclosure uses. What goes *inside* each section is #285–#289's concern; that each
 * one is disclosed is this story's.
 */

/**
 * How the model is told to behave.
 *
 * Every rule here is one ADR-0009 already made, restated in the register the model reads. The
 * grounding rule is the load-bearing one: **the model never produces a figure.** Every number in
 * an answer is computed by a service and handed to it — the whole of Story #281 exists for this
 * sentence to be true — so the instruction is to phrase what it is given and never to derive.
 */
export const SYSTEM_PROMPT = [
  'You are a portfolio assistant inside a desktop app the owner runs on their own machine.',
  '',
  'Rules you must follow:',
  '- Never calculate. Every figure you state must appear verbatim in the context below. If a figure you need is not there, say it is not available rather than deriving it.',
  '- Keep return and value apart. A time-weighted return is not a change in value: money paid in or taken out moves value and does not move return. Never attribute a change in value to performance, and never attribute a return to a deposit or a withdrawal.',
  '- Never say why the market, a sector or an instrument moved. You have no news, no fundamentals and no market data beyond this portfolio’s own history, and your training data has a cutoff. State what changed; where the cause is not in the context below, say the change happened and that its cause is not something this app can see.',
  '- Never forecast. What changed, not what will.',
  '- You may explain, summarise, compare periods, and judge balance against the owner’s stated profile.',
  '- You may suggest rebalancing and name positions to trim or add. You never place orders; the owner acts at their broker or not at all.',
  '- Never propose changes to the owner’s investor profile. That is their decision, not yours.',
  '- If you mention an instrument the owner does not hold, say plainly that it comes from your training data, is unverified and is not price-checked.',
  '- Be brief and concrete. No preamble, no disclaimers beyond the one above.',
].join('\n')

export const assistantService = {
  /**
   * Whether the assistant can run, and if not, **which** of the two blockers applies.
   *
   * Consent is checked before configuration on purpose. "No API key" is a setup detail; "you have
   * not agreed to send anything" is a decision, and telling an owner to paste a key when they have
   * not agreed to use the feature answers a question they did not ask. Both facts are reported
   * together anyway, so the view can say what is in the way and what will be next.
   */
  getStatus(): AssistantStatus {
    const consent = consentService.get()
    return {
      state: !consent.granted ? 'needs_consent' : aiGateway.isConfigured() ? 'ready' : 'not_configured',
      consented: consent.granted,
      consentedAt: consent.grantedAt,
      consentStale: consent.stale,
      configured: aiGateway.isConfigured(),
    }
  },

  /** Record consent against the disclosure now in force, and report the state that follows. */
  grantConsent(now: number = Date.now()): AssistantStatus {
    consentService.grant(now)
    return assistantService.getStatus()
  },

  /** Withdraw consent. After this, {@link ask} reaches nothing. */
  revokeConsent(): AssistantStatus {
    consentService.revoke()
    return assistantService.getStatus()
  },

  /**
   * Ask the model a question, with context the caller has already assembled.
   *
   * **The consent check comes before anything else** — before the key is read, before a prompt is
   * built, and long before a socket is opened. `needs_consent` is a state in the same register as
   * the gateway's own, never an exception (DDR-0022).
   */
  async ask(question: string, context: AssistantContext = {}): Promise<AssistantAskResult> {
    const consent = consentService.get()
    if (!consent.granted) {
      return {
        status: 'needs_consent',
        message: consent.stale
          ? 'What the assistant would send has changed since you agreed to it. Read the list again to continue.'
          : 'The assistant has not been allowed to send anything from this machine yet.',
      }
    }

    return aiGateway.complete({
      system: SYSTEM_PROMPT,
      user: buildPrompt(question, context),
    })
  },
}

/**
 * The context and the question, as one string, under the disclosure's own headings.
 *
 * Two properties matter more than the formatting. Sections appear in **declaration order**, so the
 * prompt's shape does not depend on the order a caller happened to build its object in. And a key
 * that is not a disclosed category is **dropped**, which makes the runtime agree with the type:
 * `AssistantContext` already forbids one, and this is what holds if the object arrived from
 * somewhere the type did not reach.
 *
 * The question goes **last**, after everything it might refer to, and the `question` category is
 * skipped as a section because the question is not context — it is the ask.
 */
export function buildPrompt(question: string, context: AssistantContext): string {
  const sections: string[] = []
  for (const category of DISCLOSURE_CATEGORIES) {
    if (category.id === 'question') continue
    const body = context[category.id as DisclosureCategoryId]
    if (body === undefined || body.trim() === '') continue
    sections.push(`## ${category.title}\n${body.trim()}`)
  }

  const preamble =
    sections.length === 0
      ? 'No portfolio context was assembled for this question.'
      : sections.join('\n\n')

  return `${preamble}\n\n## Question\n${question.trim()}`
}
