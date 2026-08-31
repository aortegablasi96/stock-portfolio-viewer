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
 * One turn in the exchange (Story #324, DDR-0111).
 *
 * It was two strings — `system` and `user` — and the header above said why: a shape that could
 * carry a transcript would have invited one before anyone decided whether it should be stored. That
 * decision is made. A **tool loop is a conversation by construction**: the model asks for a report,
 * the app answers with one, and the next request carries both, so the array is the request rather
 * than a convenience laid on top of it.
 *
 * The four roles are OpenAI's, mapped at the gateway's wire boundary and nowhere else. `tool` is
 * the app answering a call it was asked to make; `assistant` with {@link toolCalls} is the model
 * making one.
 */
export interface AiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  /**
   * The turn's text. For a `tool` message this is **the app's own prose**, rendered through
   * `@shared/format` — never raw JSON, so a figure in an answer and the same figure on a dashboard
   * agree to the digit (DDR-0111).
   */
  content: string
  /** On an `assistant` turn: the reports the model asked for. */
  toolCalls?: readonly AiToolCall[]
  /** On a `tool` turn: which call it answers. */
  toolCallId?: string
}

/**
 * A report the model asked for, as it asked for it.
 *
 * The arguments stay a **string** all the way to the executor. Parsing them is the tool's own job
 * and its failure is the tool's own state; a gateway that parsed them would be deciding, on the
 * model's behalf, what a malformed request meant.
 */
export interface AiToolCall {
  /** The provider's id for this call — what a `tool` message answers with. */
  id: string
  name: string
  /** The arguments as the model wrote them: a JSON string, never parsed here. */
  argumentsJson: string
}

/**
 * A report the model may ask for. **Declared by the caller, never by the gateway** — a repository
 * that knew the tool inventory would be one that reached the services it is below.
 */
export interface AiToolDefinition {
  name: string
  /** What the report is, in the register the model reads. */
  description: string
  /** JSON Schema for {@link AiToolCall.argumentsJson}. */
  parameters: Record<string, unknown>
}

/**
 * How a call is answered: the app's own prose for the model to phrase (DDR-0111).
 *
 * Injected rather than imported, and that is the layering: `aiGateway` is a repository, so it may
 * not reach a service. The caller — `assistantService`, which is the only one — holds the mapping
 * from a tool name to the method that computes its report. Here it is a test double, because
 * #324 ships the loop and #326–#329 ship the reports.
 *
 * It **resolves, never rejects**, for the reason every state in this file is a value: a thrown
 * error mid-loop would be the one outcome the union could not name.
 */
export type AiToolRunner = (call: AiToolCall) => Promise<string>

/**
 * What a caller asks for: the conversation so far, and what the model may ask the app for.
 *
 * `tools` and `runTool` are two halves of one decision and are checked as a pair — a tool the model
 * names that is not declared here is `invalid`, never an improvised call.
 */
export interface AiRequest {
  /** The exchange so far, in the order the model reads it. */
  messages: readonly AiMessage[]
  /** The reports the model may ask for. Omitted or empty means it may ask for none. */
  tools?: readonly AiToolDefinition[]
  /** Runs one call and returns the prose the model sees. Required if `tools` is non-empty. */
  runTool?: AiToolRunner
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
 * Eight variants, and each pair that looks alike is kept apart because the owner's next move
 * differs:
 *
 * - **`not_configured`** — no `OPENAI_API_KEY`. This is the resting state of a fresh clone and
 *   the OpenAI analogue of the IBKR gateway's `not_connected`: the one failure the owner can fix
 *   directly, and it is reported as a calm, actionable fact rather than a failure (ADR-0010).
 * - **`too_large`** — the request exceeded the gateway's own ceiling and **nothing was sent**.
 *   Distinct from `refused` on purpose: conflating them would tell the owner the provider rejected
 *   their portfolio when in fact it never left the machine, which is the one distinction ADR-0010
 *   exists to keep clear.
 * - **`incomplete`** — the tool loop reached one of its bounds with the model still asking for
 *   reports, so there is no answer (Story #324, DDR-0111). **Not `too_large`**, and the difference
 *   is the whole reason it exists: `too_large` means nothing was sent, and by the time a loop can
 *   end this way things *have* been sent. Folding the two would repeat exactly the misattribution
 *   DDR-0096 refused when it declined to fold `too_large` into `refused`. The recovery is the
 *   owner's and it is a real one: ask a narrower question.
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
  z.object({ status: z.literal('incomplete'), message: z.string() }),
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
