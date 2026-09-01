import { aiGateway } from '@repositories/assistant/aiGateway'
import { apiKeyService } from '@services/assistant/apiKeyService'
import { assistantToolDefinitions, runAssistantTool } from '@services/assistant/assistantTools'
import { BASE_CONTEXT } from '@shared/domain/assistantAbsences'
import {
  DISCLOSURE_CATEGORIES,
  type AssistantContext,
  type DisclosureCategoryId,
} from '@shared/domain/assistantDisclosure'
import type {
  AssistantAskResult,
  AssistantStatus,
  SaveApiKeyResult,
} from '@shared/domain/assistant'

/**
 * The only caller of `aiGateway`, and what it puts in front of one (Story #309, ADR-0011).
 *
 * **There is nothing in front of it any more, and that is the decision.** This module used to check
 * consent before the key, before a prompt and before a socket, so that "nothing is sent without
 * consent" was a property of the code rather than a promise in a document (DDR-0097). ADR-0011
 * removes consent as a concept: **the key is the authorization**. With one present a question goes
 * with nothing before it; without one the gateway's own `not_configured` is the answer, and no
 * socket is opened. Deleting the key is the only "no".
 *
 * What did **not** move is the second half of the boundary: this module **serialises the context**,
 * keyed by the disclosure's own category ids, so a later story cannot send a section that is not on
 * the list — the type says so at compile time, and {@link buildPrompt} drops anything unknown at
 * runtime, in declaration order. `DISCLOSURE_CATEGORIES` stopped being *rendered* and did not stop
 * being the bound (DDR-0098).
 *
 * **It is also where the tool inventory meets the gateway** (Story #326, DDR-0111). The reports
 * themselves are `assistantTools.ts`'s; what happens here is that they are declared *and* executed
 * as a pair, which is the shape `aiGateway` requires — a repository holding the inventory would be
 * one reaching the services above it. The same boundary applies to a tool result as to a section,
 * and it applies **here** rather than at IPC: a report is assembled in main and never crosses that
 * bound, so each tool declares its disclosure category and a test holds the registry to the list
 * (DDR-0111, decision 6).
 */

/**
 * How the model is told to behave — **eight sections**, and the count is part of the record.
 *
 * Every section restates a decision ADR-0009 or ADR-0012 already made, in the register the model
 * reads. The grounding rule is the load-bearing one: **the model never produces a figure.** Every
 * number in an answer is computed by a service and handed to it — the whole of Story #281 exists
 * for that sentence to be true — so the instruction is to phrase what it is given and never to
 * derive. Annualisation, a benchmark and a risk statistic are named as their own prohibitions
 * because a summary reaches for them and a model does not experience any of the three as a
 * calculation (DDR-0101). Like everything here they are the *second* line of defence; the first is
 * that the context names each absence before it names a figure.
 *
 * **For phrasing there is no first line, and that seam is the point** (DDR-0104). A figure is
 * guarded by computation and by tests over the assembled text; a *sentence* built around a correct
 * figure is guarded by this prompt and by nothing else. A test can assert a passage is present; it
 * cannot assert the model obeyed it. That is an acceptable guarantee for wording and an
 * unacceptable one for arithmetic, which is why the arithmetic is #287's and only the wording is
 * here.
 *
 * ## Why sections, when DDR-0104 rejected them
 *
 * That record weighed headings and declined them: *"it restructures the prompt to fix a problem no
 * answer has yet shown, and untestably."* The owner reversed that on 2026-08-31, and DDR-0110 is
 * the record. What was rejected as premature arrived as the owner's own draft.
 *
 * **The mechanism DDR-0104 built survives the change of shape.** Its point was never the flatness
 * of the list — it was that the literal is *declared*, so its length is assertable, because growth
 * must be a decision rather than an edit. So this is a declared array of sections rather than one
 * long template string, {@link SECTION_HEADINGS} is asserted against it, and
 * `assistantService.test.ts` counts both the array and the headings that reach
 * {@link SYSTEM_PROMPT}. A ninth section fails a test exactly as an eighteenth rule did.
 */
export interface PromptSection {
  /** The `##` heading the model reads, and the name the count is asserted against. */
  readonly heading: string
  /** The section's prose, wrapped as it should reach the model. */
  readonly body: string
}

/**
 * The opening line, which sits outside every section.
 *
 * It states where the model is and who it is for — the one thing no section is about.
 */
export const SYSTEM_PROMPT_PREAMBLE =
  'You are the portfolio assistant inside a private desktop application. Help the owner understand their portfolio and, when supported by the available data, assess it against their investor profile and consider possible rebalancing actions.'

/**
 * The eight sections, in the order the model reads them.
 *
 * Ordered by what a wrong answer costs: where a fact may come from, then the arithmetic over it,
 * then how a claim is attributed, then the standard it is judged against — and only after those
 * four, what may be recommended. Communication is last because it governs the shape of an answer
 * the earlier sections have already made true.
 */
export const SYSTEM_PROMPT_SECTIONS: readonly PromptSection[] = [
  {
    heading: 'Source of truth',
    body: `Use information according to this priority:

1. **Portfolio context** — authoritative for holdings, transactions, values, returns, allocations, targets, and application-computed metrics.
2. **Investor profile** — authoritative for the owner's stated preferences and objectives.
3. **Market-data tools** — authoritative for current external market information when available.
4. **Model knowledge** — background knowledge only; never use it as a substitute for current or verified financial data.

Never invent missing information. If required information is unavailable, say so.`,
  },
  {
    heading: 'Numerical integrity',
    body: `Do not perform calculations yourself.

Only state numerical results explicitly supplied by the application or a tool. Do not derive, add, subtract, average, compound, annualise, estimate, or transform figures.

Keep portfolio **value** and **return** separate. Do not attribute changes in value to performance, or returns to deposits/withdrawals, unless the supplied context explicitly supports that conclusion.

Returns from different periods are independently rebased. When comparing them, state each period's length and do not combine or transform the returns.

If the requested period is unavailable, say so rather than constructing it from other periods.`,
  },
  {
    heading: 'Evidence and causality',
    body: `Distinguish between:

* application-computed facts;
* externally retrieved facts;
* model knowledge;
* conclusions or recommendations based on those facts.

Do not present model knowledge as current or verified data.

Do not claim why a market, sector, company, instrument, or portfolio position moved unless the available data supports the explanation.

Do not state what will happen. Where the application supplies a projection, phrase it and name the assumption it rests on; never produce one of your own.

Do not report derived risk statistics such as volatility, standard deviation, Sharpe ratio, beta, or drawdown unless explicitly supplied by the application or a tool.

Do not compare the portfolio with benchmarks, indices, markets, or peers unless comparison data is explicitly available.`,
  },
  {
    heading: 'Portfolio standards',
    body: `Judge the portfolio only against:

1. the owner's configured investor profile; or
2. the application's stated baseline, and only on dimensions that baseline covers.

Never invent your own investment standard.

Never recommend that the owner change their investor profile or suggest a profile they should adopt.

If no profile is configured, say so and point the owner to the Assistant profile section.

If all supplied targets are within their permitted ranges, say so plainly and do not manufacture a rebalancing recommendation.`,
  },
  {
    heading: 'Recommendations',
    body: `You may suggest positions to consider trimming, increasing, or otherwise changing when supported by the available portfolio data, investor profile, targets, and relevant market data.

Recommendations are suggestions, not orders. You never execute trades.

Do not manufacture a recommendation simply because the owner asks for one.`,
  },
  {
    heading: 'Currency, tax, and trading costs',
    body: `A currency weight describes the currency in which a position is held and priced. It is not geographic, economic, or revenue exposure.

Do not claim tax effects, tax efficiency, or tax outcomes.

Do not claim a net benefit after commissions, spreads, taxes, or other trading costs unless those costs are explicitly supplied.`,
  },
  {
    heading: 'External instruments',
    body: `If an instrument is not present in the portfolio and is mentioned from model knowledge rather than retrieved market data, identify it as unverified. Do not claim its current price, fundamentals, existence, or availability at the owner's broker. It is subject to the model's knowledge cutoff.`,
  },
  {
    heading: 'Communication',
    body: `Be brief, concrete, and evidence-based.

Start directly with the answer. Avoid generic financial disclaimers.

When a claim depends on a particular source or standard, make that basis clear beside the claim.

Never pretend to know more than the available data supports.`,
  },
]

/**
 * The headings, declared separately so the count is asserted against a list a reader can scan.
 *
 * DDR-0104's mechanism carried across DDR-0110's change of shape: growing the prompt has to fail a
 * test rather than pass unnoticed as an edit buried in a template string.
 */
export const SECTION_HEADINGS: readonly string[] = [
  'Source of truth',
  'Numerical integrity',
  'Evidence and causality',
  'Portfolio standards',
  'Recommendations',
  'Currency, tax, and trading costs',
  'External instruments',
  'Communication',
]

export const SYSTEM_PROMPT = [
  SYSTEM_PROMPT_PREAMBLE,
  ...SYSTEM_PROMPT_SECTIONS.map((section) => `\n## ${section.heading}\n\n${section.body}`),
].join('\n')

/**
 * The display currency a question falls back to when its caller names none (Story #326).
 *
 * The renderer always names one: it is the shell's own selection, and every live weight a tool
 * returns is a share of a total in it (DDR-0007). This is the fallback for a caller with no view —
 * today only a test — and it is `EUR` because that is the account's base currency, the value
 * `App.tsx` opens on, and what `performanceService`, `dividendService` and `realizedGainsService`
 * each fall back to already. A fourth spelling of the same default, rather than a fourth default.
 */
const FALLBACK_DISPLAY_CURRENCY = 'EUR'

export const assistantService = {
  /**
   * Whether the assistant can run, which after ADR-0011 is one question: is there a key.
   *
   * `keySource` and `keyStored` come back beside it because the *order* between the two sources is
   * reported rather than silent (DDR-0105): a key the owner saved while the environment supplies
   * one is kept and unused, and the view has to be able to say so even though it no longer offers
   * anything to do about it from in here.
   */
  getStatus(): AssistantStatus {
    const keySource = aiGateway.keySource()
    return {
      state: keySource === 'none' ? 'not_configured' : 'ready',
      keySource,
      keyStored: aiGateway.hasStoredKey(),
    }
  },

  /**
   * Store the owner's own API key (Story #300, DDR-0105).
   *
   * **This is now the whole of the setup** (ADR-0011). It was already ungated under #283 — saving a
   * key sends nothing, so requiring consent first would have made the setup step wait on a decision
   * the owner may reasonably take second — and with the gate gone it is the single act that
   * authorizes sending at all.
   *
   * The status comes back with the result rather than being fetched afterwards, so a view learns
   * in one round trip that the key was saved *and* whether it is the one now in force.
   */
  setApiKey(key: string): SaveApiKeyResult {
    const outcome = apiKeyService.save(key)
    const assistant = assistantService.getStatus()
    return outcome.status === 'saved'
      ? { status: 'saved', assistant }
      : { status: 'invalid', message: outcome.message, assistant }
  },

  /**
   * Ask the model a question, and let it ask the app for the reports it needs.
   *
   * Nothing is checked before the gateway, because there is nothing left to check: the key **is**
   * the authorization, and a missing one is the gateway's own `not_configured` — a state in the
   * same register as everything beside it, never an exception (DDR-0022, DDR-0096).
   *
   * **The four tools are declared here, and this is the only place they are** (Story #326,
   * DDR-0111). The gateway takes them and the executor together and checks them as a pair: a name
   * the model asks for that is not in this list is `invalid`, and `runAssistantTool` never runs. The
   * repository could not hold the inventory itself — a repository that knew which service computes
   * which report would be one reaching the layer above it — so the mapping lives with the only
   * caller the gateway has.
   *
   * `displayCurrency` rides with the question because a live weight is a share of a total in *some*
   * currency, and the one the owner is looking at is the shell's selection (DDR-0007). A tool that
   * resolved its own would answer in a currency that is on no page.
   *
   * The caller's context is optional and the default is `{}` — which is the case Story #325 makes
   * safe rather than merely legal. A question asked with nothing assembled still carries the base
   * context {@link buildPrompt} puts in front of it, so the prompt's three conditional prohibitions
   * are supported on **every** question, including the ones no report reached.
   */
  async ask(
    question: string,
    context: AssistantContext = {},
    displayCurrency: string = FALLBACK_DISPLAY_CURRENCY,
  ): Promise<AssistantAskResult> {
    return aiGateway.complete({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(question, context) },
      ],
      tools: assistantToolDefinitions(),
      runTool: (call) => runAssistantTool(call, { displayCurrency }),
    })
  },
}

/**
 * The heading the base context arrives under, naming the property that puts it first.
 *
 * DDR-0101's rule is *before any figure*, and here that is literal: everything under this heading
 * precedes every section, every report and the question itself.
 */
export const BASE_CONTEXT_HEADING = 'Before any figure'

/**
 * The context and the question, as one string, under the disclosure's own headings.
 *
 * Three properties matter more than the formatting.
 *
 * **The base context opens it, unconditionally** (Story #325, DDR-0111). {@link BASE_CONTEXT} is
 * emitted whether or not a single section was assembled, whether or not any report was fetched, and
 * whether or not this app has anything imported at all — because DDR-0110 made three prohibitions
 * conditional on those statements being present, and a statement that arrives only when a section
 * does is not present. It goes **first** for DDR-0101's reason: a model that has already read a
 * figure has, by the time it reaches a caveat, largely written the sentence the caveat was meant to
 * prevent. It is not a `DISCLOSURE_CATEGORIES` section and cannot become one — there is no owner
 * data in it to disclose.
 *
 * Sections then appear in **declaration order**, so the prompt's shape does not depend on the order
 * a caller happened to build its object in. And a key that is not a disclosed category is
 * **dropped**, which makes the runtime agree with the type: `AssistantContext` already forbids one,
 * and this is what holds if the object arrived from somewhere the type did not reach.
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

  const assembled =
    sections.length === 0
      ? 'No portfolio context was assembled for this question.'
      : sections.join('\n\n')

  return [
    `## ${BASE_CONTEXT_HEADING}\n${BASE_CONTEXT}`,
    assembled,
    `## Question\n${question.trim()}`,
  ].join('\n\n')
}
