import { z } from 'zod'

/**
 * What the model was asked, and what came back (Milestone M10, Story #282, DDR-0096).
 *
 * The shapes live here rather than in the gateway for the reason every domain module exists: the
 * IPC contract composes them, the main process produces them, and the renderer imports the
 * inferred *types* only, so Zod never reaches that bundle (ADR-0002).
 *
 * **Nothing here knows what a portfolio is.** The gateway takes two strings and returns one; what
 * goes into them — the grounding, the figures, the question — is a later story's concern, and
 * keeping the boundary at "two strings" is what stops this module from becoming the place prompt
 * content accretes.
 */

/**
 * What a caller asks for. Two strings and an output ceiling — deliberately not a message list:
 * conversation memory is out of scope for this story, and a shape that could carry a transcript
 * would invite one before anyone decided whether it should be stored.
 */
export interface AiRequest {
  /** How the model should behave. */
  system: string
  /** The question, with whatever grounding a later story assembles into it. */
  user: string
  /** Ceiling on the answer's length, in tokens. Bounded again by the gateway. */
  maxOutputTokens?: number
}

/** How many tokens the exchange cost, when the provider says. */
export const aiUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
})
export type AiUsage = z.infer<typeof aiUsageSchema>

export const aiAnswerSchema = z.object({
  /** The model's reply. */
  text: z.string(),
  /** Which model actually answered, as the provider reports it — not what was asked for. */
  model: z.string(),
  /**
   * The answer hit the output ceiling and stops mid-thought.
   *
   * Carried rather than inferred later, because a truncated answer presented as a complete one is
   * exactly the "reads like being right" failure this Epic is built against. It costs one field
   * and one `finish_reason` check.
   */
  truncated: z.boolean(),
  usage: aiUsageSchema.nullable(),
})
export type AiAnswer = z.infer<typeof aiAnswerSchema>

/**
 * Every way the exchange can end, as data (DDR-0022, DDR-0096).
 *
 * Seven variants, and each pair that looks alike is kept apart because the owner's next move
 * differs:
 *
 * - **`not_configured`** — no `OPENAI_API_KEY`. This is the resting state of a fresh clone and
 *   the OpenAI analogue of the IBKR gateway's `not_connected`: the one failure the owner can fix
 *   directly, and it is reported as a calm, actionable fact rather than a failure (ADR-0010).
 * - **`too_large`** — the request exceeded the gateway's own ceiling and **nothing was sent**.
 *   Distinct from `refused` on purpose: conflating them would tell the owner the provider rejected
 *   their portfolio when in fact it never left the machine, which is the one distinction ADR-0010
 *   exists to keep clear.
 * - **`refused`** — the provider declined: a bad key, a quota, a content policy. The app is
 *   working; the request is not acceptable.
 * - **`not_responding`** — no answer was produced. A stall past the deadline, an unreachable host,
 *   a 5xx. Three causes, one recovery: wait and ask again. DDR-0022's rule is that states divide
 *   by *recovery*, not by cause.
 * - **`invalid`** — an answer arrived and was not the shape the provider documents. Distinct from
 *   `error` because it says where the fault is.
 * - **`error`** — anything else.
 */
export const aiResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), answer: aiAnswerSchema }),
  z.object({ status: z.literal('not_configured'), message: z.string() }),
  z.object({ status: z.literal('too_large'), message: z.string() }),
  z.object({ status: z.literal('refused'), message: z.string() }),
  z.object({ status: z.literal('not_responding'), message: z.string() }),
  z.object({ status: z.literal('invalid'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type AiResult = z.infer<typeof aiResultSchema>

/**
 * The gateway's states plus the one that comes **before** them (Story #283, DDR-0097).
 *
 * `needs_consent` is not a gateway state and must not be: it is decided before the key is read,
 * before a prompt is built and long before a socket is opened. It sits in the union because that
 * is where a caller has to handle it, and it is a state rather than an exception in the same
 * register as everything beside it (DDR-0022).
 */
export const assistantAskResultSchema = z.union([
  aiResultSchema,
  z.object({ status: z.literal('needs_consent'), message: z.string() }),
])
export type AssistantAskResult = z.infer<typeof assistantAskResultSchema>

/**
 * Whether the assistant can run, and which of the two blockers applies (Story #283).
 *
 * The acceptance criterion is that "no API key" and "consent not given" are **distinct states and
 * the owner is told which applies**. `state` is the one in the way; `consented` and `configured`
 * are both reported beside it so a view can also say what will be next once the first is cleared,
 * rather than revealing the second blocker only after the owner clears the first.
 */
export const assistantStatusSchema = z.object({
  state: z.enum(['ready', 'needs_consent', 'not_configured']),
  consented: z.boolean(),
  /** When consent was granted — epoch ms, UTC; `null` when there is none. */
  consentedAt: z.number().int().nullable(),
  /**
   * Consent exists but was given against a **different disclosure**, so it no longer holds.
   *
   * Distinct from never having consented: the owner is being asked to re-read a list that changed,
   * not to decide for the first time.
   */
  consentStale: z.boolean(),
  /** Whether an API key is present. Never the key, and never a fragment of it. */
  configured: z.boolean(),
})
export type AssistantStatus = z.infer<typeof assistantStatusSchema>
