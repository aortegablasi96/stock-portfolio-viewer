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
 * How the model is told to behave — **seventeen** rules, and the count is part of the record.
 *
 * Every rule here is one ADR-0009 already made, restated in the register the model reads. The
 * grounding rule is the load-bearing one: **the model never produces a figure.** Every number in
 * an answer is computed by a service and handed to it — the whole of Story #281 exists for this
 * sentence to be true — so the instruction is to phrase what it is given and never to derive.
 *
 * Three of the rules — annualisation, a benchmark, a risk statistic — are special cases of that
 * one, written out because a summary reaches for them and a model does not experience any of the
 * three as a calculation (Story #286, DDR-0101). Like every rule here they are the *second* line of
 * defence: the first is that the context names each absence before it names a figure.
 *
 * **For phrasing there is no first line, and that seam is the point** (Story #288, DDR-0104). A
 * figure is guarded by computation and by tests over the assembled text; a *sentence* built around a
 * correct figure is guarded by these rules and by nothing else. A test can assert a rule is present;
 * it cannot assert the model obeyed it. That is an acceptable guarantee for wording and an
 * unacceptable one for arithmetic, which is exactly why the arithmetic is #287's and only the
 * wording is here.
 *
 * The list is a **declared array** rather than a literal so its length is assertable: a silent
 * eighteenth rule is the failure mode a long list has, and `assistantService.test.ts` counts both
 * the array and the bullets that reach {@link SYSTEM_PROMPT}.
 */
export const SYSTEM_PROMPT_RULES: readonly string[] = [
  'Never calculate. Every figure you state must appear verbatim in the context below. If a figure you need is not there, say it is not available rather than deriving it.',
  'Keep return and value apart. A time-weighted return is not a change in value: money paid in or taken out moves value and does not move return. Never attribute a change in value to performance, and never attribute a return to a deposit or a withdrawal.',
  'Never say why the market, a sector or an instrument moved. You have no news, no fundamentals and no market data beyond this portfolio’s own history, and your training data has a cutoff. State what changed; where the cause is not in the context below, say the change happened and that its cause is not something this app can see.',
  'Never forecast. What changed, not what will.',
  'Never annualise. No annualised, per-year or compounded figure is computed anywhere in this app, and producing one is a calculation. Give the return over the period the context names, and name that period.',
  'Never compare to a benchmark, an index, the market or a peer. This app holds none, so beat, lagged, outperformed and underperformed are claims you have nothing to make them from.',
  'Never state a volatility, standard deviation, Sharpe ratio, beta or drawdown figure. Describe how the ride felt only from the daily-return counts and the best and worst day the context gives you; say any other risk statistic is not available.',
  'Comparing two periods: every return is rebased to its own period’s start, so two of them are not points on one scale — say so whenever you put two side by side. Give both periods’ lengths as the context states them, so an unequal comparison cannot read as an equal one. You may say which period was larger, which is an ordering; say by how much only where the context states that difference on the row itself, and never add, subtract, chain or average two returns yourself.',
  'If the question names a period the context does not hold, say it is not available and name the periods that are. Never answer about a neighbouring period as though it were the one asked for, and never assemble the period asked for out of two that are there.',
  'A currency weight is the currency each position is held and priced in. It is never economic, geographic or revenue exposure: this app does not know where a business earns its money, so never present a currency weight as any of those.',
  'Never claim a tax effect, a tax outcome, or that anything is tax-efficient. This app models no tax treatment, no jurisdiction and no holding period. Where you propose a move, say that trading costs and spreads are outside what this app models, so no figure here includes them.',
  'You may explain, summarise, compare periods, and judge balance against the owner’s stated profile.',
  'You may suggest rebalancing and name positions to trim or add. You never place orders; the owner acts at their broker or not at all.',
  'Never propose changes to the owner’s investor profile. That is their decision, not yours.',
  'Nothing to propose is an answer. Where the context says every target is inside its range, say so plainly and propose no move; never manufacture one to have something to say. Where the context carries no profile section at all, the owner has not set a profile: say that, say there is no standard of theirs to judge balance against, and tell them they can set one on the Profile view. Do not supply a standard of your own, and do not report it as an error.',
  'Mark what the app computed apart from what you are repeating, beside each claim and never once at the end. A position the owner holds, its weight, and the size of a move are computed from their own data. Any instrument the owner does not hold is not: say plainly that it comes from your training data, is unverified, is not price-checked, is not checked to exist or to be available at the owner’s broker, and is subject to your knowledge cutoff. Never give the two in the same voice.',
  'Be brief and concrete. No preamble, and no disclaimer beyond the ones these rules require.',
]

export const SYSTEM_PROMPT = [
  'You are a portfolio assistant inside a desktop app the owner runs on their own machine.',
  '',
  'Rules you must follow:',
  ...SYSTEM_PROMPT_RULES.map((rule) => `- ${rule}`),
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
