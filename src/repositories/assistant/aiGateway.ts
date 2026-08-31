import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import { metaRepository } from '@repositories/meta/metaRepository'
import { APP_LOCALE } from '@shared/format'
import type {
  AiMessage,
  AiRequest,
  AiResult,
  AiToolCall,
  AiUsage,
  ApiKeySource,
} from '@shared/domain/assistant'

/**
 * The one place in the app that reaches OpenAI (Milestone M10, Story #282, DDR-0096).
 *
 * It is a **copy of `ibkrGateway`'s discipline, not of its code**, and the rules ADR-0004 and
 * DDR-0022 paid for transfer without argument: the repository layer is the only layer that speaks
 * HTTP, every response is validated with Zod at ingress, every request is bounded by a
 * **whole-request deadline** rather than a socket-inactivity timeout, and there is exactly **one
 * attempt, never a retry loop**. The last rule matters more here than there: a retry against a
 * metered endpoint compounds the cost of every stall.
 *
 * ### A question is now several requests, and none of them is a retry (Story #324, DDR-0111)
 *
 * The model may ask for a report before it answers, so one question runs a **bounded loop**: send,
 * read a tool call, run it through the caller's own executor, send again. DDR-0096's rule is
 * restated rather than bent, and the distinction is exact:
 *
 * > A retry re-sends **the same** request after a **failure**. Each round of a tool loop sends a
 * > **different, larger** message array after a **success**. A failed round is still not retried.
 *
 * DDR-0096's reason for the rule — cost, against a metered endpoint — applies to a loop as much as
 * to a retry, which is why the loop is **bounded rather than merely distinguished**, and bounded
 * three ways: {@link MAX_TOOL_ROUNDS} rounds, {@link MAX_PROMPT_CHARS} over the *whole*
 * conversation before every round, and {@link DEFAULT_QUESTION_TIMEOUT_MS} over the question as a
 * whole. Reaching any of them is `incomplete` — a named state, never a partial answer dressed as a
 * finished one.
 *
 * **The tool inventory is not here.** A repository that knew which service computes which report
 * would be one reaching the layer above it, so the caller declares the tools and passes the
 * executor. This file knows only that a call was made, that its name was declared, and what prose
 * came back.
 *
 * ### Plain HTTPS, not the `openai` SDK
 *
 * The story asked for this to be decided. The app's needs are one endpoint and no streaming;
 * `ibkrGateway` is plain HTTP plus Zod and has been for the app's whole life. What the SDK would
 * buy is retry, timeout handling and an error taxonomy — and the first must be *turned off* (one
 * attempt per round is the rule), the second is a socket-level bound this file deliberately does
 * not want, and the third has to be re-mapped onto the states below anyway. A dependency whose
 * three main features are disabled, replaced and re-mapped is not carrying its weight (ADR-0008's
 * standing rule, and CLAUDE.md's). Tool calling costs two small schemas and one wire mapping here,
 * which is less than the SDK costs to keep out of the way.
 *
 * ### It returns a result, not a thrown error
 *
 * `ibkrGateway` throws typed errors because several methods share them and the mapping happens at
 * one IPC handler. This gateway has **one operation**, and every outcome is already a named state,
 * so a discriminated union is the honest shape: it cannot be forgotten, it needs no mapping layer,
 * and the test can enumerate the states exhaustively. See `@shared/domain/assistant`.
 *
 * ### The key never leaves the main process
 *
 * `OPENAI_API_KEY` is unprefixed in `.env`, so electron-vite leaves it in `process.env` rather
 * than inlining it (ADR-0010). This file is imported only by main-process code; the renderer's
 * CSP admits `api.mapbox.com` and nothing else, so the renderer could not make this call even if
 * it held the key — the platform enforcing the design rather than a convention asking for it.
 *
 * ### It owns the key end to end, including the owner's own (Story #300, DDR-0105)
 *
 * A packaged build has no `.env` beside its binary, so before #300 an installed copy found a key
 * only if the operating system already carried one. The owner can now paste one into the app, and
 * it is stored the way the investor profile is — one overwritten `app_meta` value (DDR-0094).
 * Since ADR-0011 pasting that key is also the whole of the authorization: there is no consent
 * decision in front of a question any more, so this module's `keySource` *is* the gate.
 *
 * The store is read **and written here** rather than in a service, which makes this file a
 * repository over two sources. That is the shape `classificationRepository` already has (a SQLite
 * cache in front of `ibkrGateway`), and it buys the invariant this whole story is about: the key
 * exists in exactly one module. Split the read from the write and there are two places to forget
 * the trim, two places a fragment could be returned, and nothing left for a test to point at.
 *
 * **Precedence is stated, never discovered.** The environment wins over the stored key — see
 * {@link keySource}.
 */

const DEFAULT_BASE_URL = 'https://api.openai.com'
const COMPLETIONS_PATH = '/v1/chat/completions'

/** The model, when `OPENAI_MODEL` is unset. */
export const DEFAULT_MODEL = 'gpt-4.1-mini'

/**
 * The bounded wait for the whole exchange (ADR-0010).
 *
 * Longer than the IBKR gateway's 15s on purpose: a completion is slower than a quote, and this
 * one crosses the internet rather than going to localhost. Still a bound — an assistant that
 * never settles is a spinner, not a feature.
 */
export const DEFAULT_TIMEOUT_MS = 60_000

/**
 * The bounded wait for the **whole question**, however many rounds it takes (Story #324, DDR-0111).
 *
 * A second deadline rather than a bigger one, because the two measure different things and folding
 * them would lose the job of the first. {@link DEFAULT_TIMEOUT_MS} is a **transport** property: it
 * stops a socket that has gone quiet, and a question-level number cannot do that. But a question
 * that makes N requests would otherwise be bounded at N × the transport deadline — five minutes,
 * here — which is not a bound anyone chose.
 *
 * So the loop carries its own, and each round is issued with **whichever of the two is nearer**:
 * the transport bound cannot be exceeded, and neither can the total. Three minutes is longer than
 * any answer should take and short enough that an owner is not left watching a spinner decide.
 */
export const DEFAULT_QUESTION_TIMEOUT_MS = 180_000

/**
 * How many times the model may ask for reports before it has to answer (Story #324, DDR-0111).
 *
 * A **declared constant, not an environment variable**, for DDR-0096's reason verbatim: *a value
 * someone can raise in `.env` is one a stalled afternoon will raise.* Raising it means editing this
 * file, which means reading this paragraph — and `aiGateway.test.ts` asserts the number, so growth
 * is a decision rather than an edit (DDR-0104's mechanism, applied again).
 *
 * Four, because a round is not a tool: the provider may return **several calls in one round**, so
 * four rounds is four rounds of *reasoning* over as many reports as it takes — enough for a
 * question that reads a period, then a position inside it, then how far that position sits from the
 * owner's ceiling, and still has a round left to check its work. What it does not fund is a model
 * that has lost the thread, which is what the bound is for. Total requests per question are at most
 * `MAX_TOOL_ROUNDS + 1`: four tool rounds, then the answer.
 */
export const MAX_TOOL_ROUNDS = 4

/**
 * The ceiling on what may be **sent**, in characters of the whole conversation.
 *
 * A constant rather than an environment variable, and that is the point: the story asks that no
 * later story exceed it *by accident*, and a value someone can raise in `.env` is one a stalled
 * afternoon will raise. Changing it means editing this file, which means reading this paragraph.
 *
 * Characters rather than tokens because counting tokens needs a tokenizer, and a tokenizer is a
 * dependency taken to price a request exactly when the job here is only to stop runaway growth.
 * ~40k characters is roughly 10k tokens of English prose and figures — two orders of magnitude
 * below the model's own context window, and far below anything that would surprise the owner on a
 * bill.
 *
 * **Raised once, from 24,000, and the reason is the sentence this paragraph used to end on**
 * (Story #287, DDR-0103, amending DDR-0096). It read "several times the largest context this Epic
 * assembles", which was true when nothing filled the context and stopped being true when something
 * did: #287 puts every standard period and every drift-closing move in front of the model, and the
 * worst case the grounding's own caps allow came to ~30k. The ceiling's job is to stop **runaway
 * growth** — a bug, a loop, a thousand-position book — not to ration grounding, which is the
 * feature. Rationing it here would have meant a portfolio of sixty positions and thirty targets
 * getting `too_large` on every question, which is the failure the constant exists to make legible,
 * not one it should cause. `promptBudget.test.ts` measures the worst case against this number, so
 * the next story that grows a section finds out here rather than in an owner's transcript.
 *
 * **Re-pointed at the whole message array, and checked before every round** (Story #324, DDR-0111).
 * The number does not move; what it counts does. The array only ever grows — each round carries
 * everything sent before it plus the reports that came back — so a per-round check *is* the
 * per-question ceiling, and a loop cannot spend the budget one affordable round at a time. Crossing
 * it before the first round is `too_large` and **nothing was sent**; crossing it later is
 * `incomplete`, because by then things have.
 */
export const MAX_PROMPT_CHARS = 40_000

/** The default ceiling on the **answer**, in tokens; a caller may ask for less, never more. */
export const MAX_OUTPUT_TOKENS = 1_200

/**
 * Base URL from config, trailing slashes trimmed.
 *
 * `OPENAI_BASE_URL` exists as the same test seam `IBKR_GATEWAY_URL` is — the transport tests
 * below drive a real local HTTP server, because the behaviour under test *is* the transport and
 * mocking the socket would only prove the mock. It is main-process env, never renderer.
 */
function baseUrl(): string {
  return (process.env['OPENAI_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
}

function model(): string {
  const configured = process.env['OPENAI_MODEL']?.trim()
  return configured ? configured : DEFAULT_MODEL
}

/**
 * The request deadline, in one place so no call site can be added without it. A missing or
 * nonsensical value falls back to the default rather than disabling the bound — the same rule
 * `ibkrGateway`'s timeout carries.
 */
function timeoutMs(): number {
  const configured = Number(process.env['OPENAI_TIMEOUT_MS'])
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS
}

/**
 * The whole-question deadline, read the same way and falling back the same way.
 *
 * It has an environment seam where {@link MAX_TOOL_ROUNDS} deliberately does not, and the line
 * between them is what the value rations: a deadline rations **waiting**, which is the owner's own
 * patience and differs between a laptop on hotel wifi and a test suite that cannot afford three
 * minutes. A round cap rations **spend against a metered endpoint**, which is the thing DDR-0096
 * says must be hard to raise.
 */
function questionTimeoutMs(): number {
  const configured = Number(process.env['OPENAI_QUESTION_TIMEOUT_MS'])
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_QUESTION_TIMEOUT_MS
}

// ---- the key, and the two places it can come from ---------------------------

/**
 * Where the owner's own key is stored: one overwritten `app_meta` value (Story #300, DDR-0105).
 *
 * Exported so a test can name the row without copying the string, and so nothing else in the app
 * has a reason to spell it. **The value is stored unencrypted**, like every other row in this
 * database — that is a property of the store rather than a decision this file makes, and it is
 * written down in DDR-0105 and said on screen rather than left to be assumed.
 */
export const OPENAI_API_KEY_META_KEY = 'openai_api_key'

/**
 * The key from the process environment — an OS variable, or a line in `.env` that
 * `src/main/env.ts` merged into it at startup with the OS winning (DDR-0100).
 *
 * A blank value is **no key**, not an empty one. That rule predates the story and is what makes
 * `e2e/assistant-api-key.spec.ts`'s `OPENAI_API_KEY: ''` mean "this run has no environment key"
 * rather than "this run has an unusable one that shadows the store".
 */
function environmentKey(): string | undefined {
  const key = process.env['OPENAI_API_KEY']?.trim()
  return key ? key : undefined
}

/** The key the owner saved inside the app, or `undefined`. Read at call time, never cached. */
function storedKey(): string | undefined {
  const key = metaRepository.get(OPENAI_API_KEY_META_KEY)?.trim()
  return key ? key : undefined
}

/** The key actually used, resolved in the order {@link keySource} names. */
function apiKey(): string | undefined {
  return environmentKey() ?? storedKey()
}

/**
 * Which source supplies the key now in force.
 *
 * **The environment wins over the stored key**, which is the same direction DDR-0100 chose for the
 * environment over `.env`, and for the same two reasons. An environment variable is the deliberate,
 * per-session act of whoever launched the process, while a stored key is a default sitting in an
 * installation — so the more specific act should win. And the e2e suite supplies a key through
 * `electron.launch({ env })`: the opposite order would let whatever a run happened to have stored
 * replace the value a test is asserting about, which is a passing test that passes for the wrong
 * reason.
 *
 * The order is only defensible because it is **reported**. An owner who saves a key while the
 * environment carries one is told that theirs is stored and not in use; silently preferring one of
 * two keys the owner supplied is the failure this function exists to make impossible.
 */
function keySource(): ApiKeySource {
  if (environmentKey() !== undefined) return 'environment'
  if (storedKey() !== undefined) return 'stored'
  return 'none'
}

// ---- the response, validated at ingress -------------------------------------

/**
 * The shape OpenAI documents for a non-streaming chat completion, narrowed to what is read.
 *
 * `passthrough()` throughout, like every schema in `ibkrGateway`: a provider adding a field must
 * not break the app, while a provider *removing* one it documents must not pass silently.
 * `content` is nullable because a completion stopped by a content filter carries `null` there —
 * and because a turn that asks for a report carries its request in `tool_calls` and nothing in
 * `content`, which is the one case where a 200 with no text is not `invalid`.
 */
const toolCallSchema = z
  .object({
    id: z.string(),
    type: z.string().optional(),
    // The arguments arrive as a JSON *string* and stay one: what they mean is the tool's business,
    // and a gateway that parsed them would be ruling on a malformed request it cannot interpret.
    function: z.object({ name: z.string(), arguments: z.string() }).passthrough(),
  })
  .passthrough()

const completionSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullable(),
                tool_calls: z.array(toolCallSchema).optional(),
              })
              .passthrough(),
            finish_reason: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
        total_tokens: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

/** The error envelope OpenAI returns with a 4xx, so a refusal can say why in its own words. */
const errorSchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        type: z.string().optional(),
        code: z.string().nullable().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

// ---- transport --------------------------------------------------------------

/** What the transport managed to do, before anything is known about the body's shape. */
type Transport =
  | { kind: 'response'; status: number; body: string }
  | { kind: 'not_responding'; message: string }
  | { kind: 'error'; message: string }

/**
 * POST a JSON body and read the whole response, bounded end to end.
 *
 * Structurally identical to `ibkrGateway.rawGet` and for identical reasons. The one-shot `settle`
 * makes whichever of body, error or deadline lands first the winner and always clears the timer,
 * so it can neither fire late nor hold the event loop. The deadline is a **whole-request** bound,
 * not `req.setTimeout`: that one measures socket inactivity and is reset by every byte, so it
 * never fires against a provider that dribbles a response out forever.
 *
 * It resolves rather than rejects. Every failure here is already one of the gateway's states, and
 * a promise that cannot reject is one no caller can forget to catch.
 *
 * The deadline is **passed in** rather than read here (Story #324): a round is bounded by whichever
 * of the transport deadline and the question's remaining time is nearer, and only the loop knows
 * the second.
 */
function postJson(url: URL, key: string, payload: unknown, limit: number): Promise<Transport> {
  return new Promise<Transport>((resolve) => {
    const body = JSON.stringify(payload)
    const headers = {
      'Content-Type': 'application/json',
      // `Buffer.byteLength`, not `body.length`: a non-ASCII character is one string unit and
      // several bytes, and a short Content-Length truncates the request server-side.
      'Content-Length': String(Buffer.byteLength(body)),
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
      'User-Agent': 'stock-portfolio-viewer',
    }

    let settled = false
    const settle = (result: Transport): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      resolve(result)
    }

    const onResponse = (res: IncomingMessage): void => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () =>
        settle({
          kind: 'response',
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      )
    }

    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(url, { method: 'POST', headers }, onResponse)

    const deadline = setTimeout(() => {
      req.destroy()
      settle({
        kind: 'not_responding',
        message: `The model did not respond within ${Math.round(limit / 1000)}s.`,
      })
    }, limit)
    // Never let a pending request keep the process alive on quit.
    deadline.unref()

    req.on('error', (err: NodeJS.ErrnoException) => {
      // Everything that ends without an answer is one state, because the owner's move is the same
      // in each case: wait and ask again. A host that cannot be resolved, a refused connection and
      // an OS-level connect timeout differ in cause and not in recovery (DDR-0022 divides states
      // by recovery). `not_configured` is the one failure here the owner *can* act on, and it is
      // decided before any of this runs.
      const offline =
        err.code === 'ENOTFOUND' ||
        err.code === 'EAI_AGAIN' ||
        err.code === 'ECONNREFUSED' ||
        err.code === 'ENETUNREACH' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT'
      settle(
        offline
          ? { kind: 'not_responding', message: `Could not reach the model: ${err.message}` }
          : { kind: 'error', message: err.message },
      )
    })

    req.write(body)
    req.end()
  })
}

// ---- the gateway ------------------------------------------------------------

export const aiGateway = {
  /**
   * Which of the two sources supplies the key, or `none` (Stories #283, #300).
   *
   * No request, and **no key material returned** — just the name of a source, which is what the
   * assistant's status needs to say which of its two blockers applies and, when neither does,
   * which key it is about to spend. It replaces the story-#283 `isConfigured()` rather than
   * sitting beside it: two ways to ask one question is how the two drift apart.
   */
  keySource(): ApiKeySource {
    return keySource()
  },

  /** Whether a key is saved **in the app**, whether or not the environment is shadowing it. */
  hasStoredKey(): boolean {
    return storedKey() !== undefined
  },

  /**
   * Save the owner's own key, replacing any previously saved one.
   *
   * Trimmed here as well as at the service that validates it, because this is the value that
   * reaches the `Authorization` header and the trim is the gateway's own invariant — every other
   * read in this file trims, and a store that did not would be the one asymmetry.
   */
  storeKey(key: string): void {
    metaRepository.set(OPENAI_API_KEY_META_KEY, key.trim())
  },

  /**
   * Remove it, reporting whether there was one. The key is **removed, not blanked**, so "never set"
   * and "removed" are one state rather than two that behave alike — the rule the investor profile's
   * clear follows (DDR-0094).
   *
   * **Nothing calls this from inside the app** (Story #309, ADR-0011). The field is shown when
   * there is no working key and not shown once there is one, so there is no activate, deactivate or
   * rotate, and neither `apiKeyService` nor any IPC channel offers a way here. It stays because the
   * store's lifecycle belongs with the module that owns the key end to end, and because a future
   * rotate would build on it rather than re-derive it.
   */
  clearStoredKey(): boolean {
    return metaRepository.remove(OPENAI_API_KEY_META_KEY)
  },

  /**
   * Ask the model one question, in **at most `MAX_TOOL_ROUNDS + 1` requests** (Story #324).
   *
   * Every outcome is a value. Nothing here throws and nothing is retried: a round that fails or
   * stalls **ends the question**, because the failure of one round is the failure of the exchange
   * and re-issuing it is the retry DDR-0096 forbids.
   *
   * The three bounds are checked in the order they can be known — the conversation's size before
   * the round is built, the remaining time before it is sent, the round count by the loop itself —
   * and each ends in a state the caller can name to the owner.
   */
  async complete(request: AiRequest): Promise<AiResult> {
    const key = apiKey()
    if (key === undefined) {
      return {
        status: 'not_configured',
        message:
          'No OpenAI API key is set. Add one on the Assistant view, or set OPENAI_API_KEY in your environment.',
      }
    }

    const url = new URL(baseUrl() + COMPLETIONS_PATH)
    const messages: AiMessage[] = [...request.messages]
    const declared = new Set((request.tools ?? []).map((tool) => tool.name))
    const startedAt = Date.now()
    const questionLimit = questionTimeoutMs()
    const totals = new UsageTotals()

    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      // Checked before anything is sent, which is the whole point of `too_large`: the owner is told
      // the request was too large for *this app's* ceiling, not that the provider rejected it. From
      // the second round on, the same crossing is `incomplete` — data has already left the machine,
      // and saying otherwise would be the misattribution the two states exist to keep apart.
      const size = conversationSize(messages)
      if (size > MAX_PROMPT_CHARS) {
        return round === 0
          ? {
              status: 'too_large',
              message: `The question and its context came to ${size.toLocaleString(APP_LOCALE)} characters, over this app's ${MAX_PROMPT_CHARS.toLocaleString(APP_LOCALE)} limit. Nothing was sent.`,
            }
          : incomplete(
              round,
              `the reports it asked for came to ${size.toLocaleString(APP_LOCALE)} characters, over this app's ${MAX_PROMPT_CHARS.toLocaleString(APP_LOCALE)} limit`,
            )
      }

      const remaining = questionLimit - (Date.now() - startedAt)
      if (remaining <= 0) return incomplete(round, whenOutOfTime(questionLimit))

      const transport = await postJson(
        url,
        key,
        {
          model: model(),
          messages: messages.map(wireMessage),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: 'function',
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
              }
            : {}),
          // A caller may ask for a shorter answer, never a longer one — the ceiling is the
          // gateway's.
          max_completion_tokens: Math.min(
            request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
            MAX_OUTPUT_TOKENS,
          ),
        },
        // Whichever bound is nearer. The transport deadline still stops a quiet socket; the
        // question's remaining time stops the loop outliving its own bound in one long round.
        Math.min(timeoutMs(), remaining),
      )

      if (transport.kind !== 'response') {
        return transport.kind === 'not_responding'
          ? { status: 'not_responding', message: transport.message }
          : { status: 'error', message: transport.message }
      }

      const outcome = readRound(transport.status, transport.body)
      totals.add(outcome.usage)
      if (outcome.kind === 'state') {
        // The answer reports what the **question** cost, not what its last round did: a loop that
        // ran four rounds and reported the fourth's usage would understate the bill it just ran up.
        return outcome.result.status === 'ok'
          ? { status: 'ok', answer: { ...outcome.result.answer, usage: totals.resolved() } }
          : outcome.result
      }

      // A call for a report nobody declared is the loop's version of a 200 with no answer: the
      // exchange produced no usable turn, and running an undeclared name would be the general
      // query ADR-0009 forbids arriving by the back door.
      const undeclared = [...new Set(outcome.calls.map((call) => call.name))].filter(
        (name) => !declared.has(name),
      )
      if (undeclared.length > 0) {
        return {
          status: 'invalid',
          message: `The model asked for a report this app does not have: ${undeclared.join(', ')}.`,
        }
      }
      // Declared without an executor is the caller's own mistake rather than the model's, and it
      // is said as one: reporting it as a report that does not exist would send whoever reads it
      // looking for a missing tool instead of a missing wiring.
      if (request.runTool === undefined) {
        return {
          status: 'invalid',
          message: 'The model asked for a report, but this question offered no way to produce one.',
        }
      }

      messages.push({
        role: 'assistant',
        content: outcome.text ?? '',
        toolCalls: outcome.calls,
      })
      for (const call of outcome.calls) {
        let answered: string
        try {
          answered = await request.runTool(call)
        } catch (err) {
          // The executor is the caller's, and a throw from it is a bug rather than a state — but a
          // gateway that let one escape would be the one outcome this union could not name.
          return {
            status: 'error',
            message: `The ${call.name} report could not be produced: ${err instanceof Error ? err.message : String(err)}`,
          }
        }
        messages.push({ role: 'tool', toolCallId: call.id, content: answered })
      }
    }

    // Every round spent and the model is still asking. There is no answer, and a partial one
    // presented as complete is the failure this state exists to make impossible.
    return incomplete(
      MAX_TOOL_ROUNDS + 1,
      `it was still asking for reports after ${MAX_TOOL_ROUNDS} ${plural(MAX_TOOL_ROUNDS, 'round')} of them`,
    )
  },
}

/** What one round produced: a terminal state, or a request for reports. */
type Round =
  | { kind: 'state'; result: AiResult; usage: AiUsage | null }
  | { kind: 'tools'; calls: AiToolCall[]; text: string | null; usage: AiUsage | null }

/**
 * The one wording for every way the loop can end without an answer.
 *
 * It says **how many rounds ran** and what stopped it, because the two facts are what tell an owner
 * whether to ask a narrower question or simply to ask again — and because "the assistant gave up"
 * with no number in it is the shrug this app keeps refusing to ship.
 */
function incomplete(rounds: number, because: string): AiResult {
  return {
    status: 'incomplete',
    message: `The assistant ran ${rounds} ${plural(rounds, 'round')} gathering reports and stopped before answering: ${because}. Nothing here is a partial answer — try a narrower question.`,
  }
}

/** A count's noun. Widened from a ternary because a declared constant is not a literal to compare. */
function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`
}

/** The sentence the whole-question deadline ends on, stating the total wait it bounded. */
function whenOutOfTime(limit: number): string {
  return `the question reached this app's ${Math.round(limit / 1000)}s limit for a whole question`
}

/**
 * What the ceiling counts: every character that would go on the wire, tool calls included.
 *
 * Counting only `content` would leave the arguments the model wrote and the names it called
 * uncounted, which is precisely the material a loop adds — the growth the ceiling exists to bound
 * would be the growth it could not see.
 */
function conversationSize(messages: readonly AiMessage[]): number {
  return messages.reduce(
    (total, message) =>
      total +
      message.content.length +
      (message.toolCalls ?? []).reduce(
        (calls, call) => calls + call.name.length + call.argumentsJson.length,
        0,
      ),
    0,
  )
}

/** One message in the provider's own shape. The only place this app's roles meet OpenAI's. */
function wireMessage(message: AiMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
  if (message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.argumentsJson },
      })),
    }
  }
  return { role: message.role, content: message.content }
}

/**
 * The usage of a whole question, which is the sum of its rounds.
 *
 * `null` the moment any round reports a partial count, for the reason {@link toUsage} returns one:
 * a total that silently omitted a round is worse than no total, and a partial usage block is not a
 * count.
 */
class UsageTotals {
  private prompt = 0
  private completion = 0
  private total = 0
  private complete = true

  add(usage: AiUsage | null): void {
    if (usage === null) {
      this.complete = false
      return
    }
    this.prompt += usage.promptTokens
    this.completion += usage.completionTokens
    this.total += usage.totalTokens
  }

  resolved(): AiUsage | null {
    return this.complete
      ? { promptTokens: this.prompt, completionTokens: this.completion, totalTokens: this.total }
      : null
  }
}

/**
 * Turn a status and a body into a terminal state or a request for reports, validating at ingress.
 *
 * Every terminal state carries the round's own usage beside it, because a question that ends badly
 * on its third round still cost three rounds and the owner is entitled to the total.
 */
function readRound(status: number, body: string): Round {
  // A 5xx is the provider failing rather than declining, and its recovery is a stall's: wait and
  // ask again. It joins `not_responding` rather than becoming a fourth thing to explain.
  if (status >= 500) {
    return state({
      status: 'not_responding',
      message: `The model provider returned HTTP ${status}. Try again shortly.`,
    })
  }

  if (status < 200 || status >= 300) {
    // A 4xx is a refusal — a bad key, a quota, a content policy — and the provider's own wording
    // is more useful than anything this file could invent, so it is carried through when present.
    const parsed = parseJson(body).flatMap((json) => {
      const result = errorSchema.safeParse(json)
      return result.success ? [result.data] : []
    })
    const detail = parsed[0]?.error?.message
    return state({
      status: 'refused',
      message: redactKeys(detail ?? `The model provider refused the request (HTTP ${status}).`),
    })
  }

  const json = parseJson(body)
  if (json.length === 0) {
    return state({ status: 'invalid', message: 'The model returned a body that was not JSON.' })
  }

  const parsed = completionSchema.safeParse(json[0])
  if (!parsed.success) {
    return state({
      status: 'invalid',
      message: `The model returned an unexpected shape: ${parsed.error.message}`,
    })
  }

  const choice = parsed.data.choices[0]!
  const text = choice.message.content
  const usage = toUsage(parsed.data.usage)

  // A turn that asks for a report is not an answer and is not a failure either — it is the loop's
  // middle, and the one case where a 200 carrying no text is exactly right.
  const calls = choice.message.tool_calls ?? []
  if (calls.length > 0) {
    return {
      kind: 'tools',
      calls: calls.map((call) => ({
        id: call.id,
        name: call.function.name,
        argumentsJson: call.function.arguments,
      })),
      text,
      usage,
    }
  }

  if (text === null || text.trim() === '') {
    // A 200 that carries no answer is not an answer. It happens when a content filter stops the
    // completion, and reporting it as `ok` with an empty string would show the owner a blank reply.
    return state({ status: 'invalid', message: 'The model returned an empty answer.' }, usage)
  }

  return state(
    {
      status: 'ok',
      answer: {
        text,
        // What actually answered, as the provider reports it — not what was asked for. The two
        // differ whenever a model alias resolves to a dated snapshot.
        model: parsed.data.model ?? model(),
        truncated: choice.finish_reason === 'length',
        usage,
      },
    },
    usage,
  )
}

/** A terminal round, with whatever the provider said it cost. */
function state(result: AiResult, usage: AiUsage | null = null): Round {
  return { kind: 'state', result, usage }
}

/**
 * Strip anything key-shaped out of a message before it leaves this file.
 *
 * Found by making the call: a wrong key comes back as *"Incorrect API key provided:
 * `sk-defin****************-key`"*. OpenAI has already masked the middle, so this is a fragment
 * rather than a secret — but it is a fragment of the one value this whole story exists to keep in
 * the main process, and a refusal's `message` crosses IPC and can end up on screen. Redacting it
 * makes "the key never leaves the main process" exactly true instead of nearly true.
 *
 * The provider's wording is otherwise kept: *"Incorrect API key provided: `<redacted>`"* still
 * tells the owner precisely what to fix.
 */
function redactKeys(message: string): string {
  return message.replace(/\bsk-[A-Za-z0-9*_-]{4,}/g, '<redacted>')
}

/** `[value]` when the body is JSON, `[]` when it is not — so callers branch on length, not on a throw. */
function parseJson(body: string): unknown[] {
  try {
    return [JSON.parse(body)]
  } catch {
    return []
  }
}

/** Usage, when the provider reported all three figures; `null` rather than a partial count. */
function toUsage(usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined): AiUsage | null {
  if (!usage) return null
  const { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total } = usage
  if (prompt === undefined || completion === undefined || total === undefined) return null
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total }
}
