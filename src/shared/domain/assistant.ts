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
 * Every way an ask can end — **exactly the gateway's own states** (Story #309, ADR-0011, DDR-0107).
 *
 * It was a union of one more: `needs_consent`, decided before the key was read and long before a
 * socket was opened (DDR-0097). ADR-0011 removes consent as a concept, so there is nothing in front
 * of the gateway left to report and the union collapses onto `aiResultSchema`. The alias is kept
 * rather than the callers being repointed at `AiResult`: what a caller handles is *the assistant's*
 * answer, and a later story putting something back in front of the gateway should widen this name
 * rather than re-open every call site.
 */
export const assistantAskResultSchema = aiResultSchema
export type AssistantAskResult = AiResult

/**
 * Where the key now in force came from (Story #300, DDR-0105).
 *
 * Three sources collapse to two names. `environment` covers both an operating-system variable and
 * a line in `.env`, because by the time anything reads the key those are one thing: `src/main/env.ts`
 * merges the file into `process.env` at startup with the real environment winning, so nothing
 * downstream can tell them apart and inventing a third name here would be a distinction the app
 * cannot actually make (DDR-0100). `stored` is the key the owner typed into the app itself, which
 * is the source a packaged build has and the other two do not.
 *
 * It is reported so the precedence is **said out loud**. An owner who saves a key while an
 * environment variable is set would otherwise watch their key be silently ignored, which is the
 * failure a stated order exists to prevent.
 */
export const apiKeySourceSchema = z.enum(['environment', 'stored', 'none'])
export type ApiKeySource = z.infer<typeof apiKeySourceSchema>

/**
 * `MAX_API_KEY_CHARS` deliberately does **not** live here (Story #300, DDR-0105). The renderer
 * needs it at runtime to cap the key field, and one runtime import from this module would pull
 * Zod into that bundle — see `@shared/domain/assistantKey`.
 */

/**
 * Whether the assistant can run — **one fact, because there is only one blocker left** (Story #309,
 * ADR-0011, DDR-0107).
 *
 * It carried five fields for two blockers: consent (given, when, and whether the list had moved
 * under it) and the key. ADR-0011 removes the first, so `state` is now a restatement of *is there a
 * key*, and `configured` went with the pair it was one half of — two fields for one fact is what
 * this codebase keeps refusing. `state` is the field the view branches on and is named rather than
 * inferred from `keySource !== 'none'`, which is the shape of a fact the view would have to
 * re-derive.
 *
 * **Nothing here is derived from the key's value** (Story #300). `state`, `keySource` and
 * `keyStored` are three facts about a secret, and not one of them is a fragment of it: the gateway
 * already redacts even the masked fragment OpenAI quotes back in a refusal, so a "last four
 * characters" hint here would be the one place the key's material crossed IPC after that trouble
 * was taken (ADR-0010, DDR-0105).
 */
export const assistantStatusSchema = z.object({
  /** `ready` exactly when a key is in force. Never the key, and never a fragment of it. */
  state: z.enum(['ready', 'not_configured']),
  /** Which source supplies the key now in force; `none` when there is none (Story #300). */
  keySource: apiKeySourceSchema,
  /**
   * Whether a key is saved **in the app**, whether or not it is the one being used.
   *
   * Separate from `keySource` on purpose, and still earning its place after #309 removed the key
   * card's Remove control: a saved key the environment shadows is reported as kept and unused,
   * which is DDR-0105's "the order is reported, never silent" and the one thing the view says
   * about a key it is not offering to change (ADR-0011).
   */
  keyStored: z.boolean(),
})
export type AssistantStatus = z.infer<typeof assistantStatusSchema>

/**
 * Saving the owner's own key (Story #300, DDR-0105).
 *
 * Success is `saved`, not `ok` — the app's convention for a write that is not a read
 * (`captured`, `imported`, `cleared`). Both variants carry the status that follows, so a view
 * re-seats on what actually landed rather than assuming: saving a key while the environment
 * supplies one leaves `keySource` at `environment`, and the panel has to be able to say so.
 *
 * `invalid` is the profile save's variant, for the same reason: a key with a space in it is the
 * owner's paste to fix, not an error the app failed at.
 */
export const saveApiKeyResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), assistant: assistantStatusSchema }),
  z.object({
    status: z.literal('invalid'),
    message: z.string(),
    assistant: assistantStatusSchema,
  }),
])
export type SaveApiKeyResult = z.infer<typeof saveApiKeyResultSchema>

/**
 * There is no `clearApiKeyResultSchema`, and its absence is the decision (Story #309, ADR-0011).
 *
 * #300 shipped a Remove control beside the field, and #309 took it out: the field is shown when
 * there is no working key and not shown once there is one, so there is no activate, deactivate or
 * rotate. A channel that removed the key would be exactly the control the story says the app does
 * not have, reachable from `window.api` whether or not anything drew a button for it — so the shape
 * goes with the button rather than being left behind as an unused variant.
 */
