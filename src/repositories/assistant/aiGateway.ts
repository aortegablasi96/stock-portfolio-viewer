import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { z } from 'zod'
import type { AiRequest, AiResult, AiUsage } from '@shared/domain/assistant'

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
 * ### Plain HTTPS, not the `openai` SDK
 *
 * The story asked for this to be decided. The app's needs are one endpoint, no streaming and no
 * tool calling; `ibkrGateway` is plain HTTP plus Zod and has been for the app's whole life. What
 * the SDK would buy is retry, timeout handling and an error taxonomy — and the first must be
 * *turned off* (one attempt is the rule), the second is a socket-level bound this file
 * deliberately does not want, and the third has to be re-mapped onto the states below anyway. A
 * dependency whose three main features are disabled, replaced and re-mapped is not carrying its
 * weight (ADR-0008's standing rule, and CLAUDE.md's).
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
 * The ceiling on what may be **sent**, in characters of `system` + `user`.
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

/** The key, or `undefined` when the owner has not pasted one. Read at call time, never cached. */
function apiKey(): string | undefined {
  const key = process.env['OPENAI_API_KEY']?.trim()
  return key ? key : undefined
}

// ---- the response, validated at ingress -------------------------------------

/**
 * The shape OpenAI documents for a non-streaming chat completion, narrowed to what is read.
 *
 * `passthrough()` throughout, like every schema in `ibkrGateway`: a provider adding a field must
 * not break the app, while a provider *removing* one it documents must not pass silently.
 * `content` is nullable because a completion stopped by a content filter carries `null` there.
 */
const completionSchema = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string().nullable() }).passthrough(),
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
 */
function postJson(url: URL, key: string, payload: unknown): Promise<Transport> {
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

    const limit = timeoutMs()
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
   * Whether a key is present (Story #283).
   *
   * A pure environment read — no request, no key material returned, just the boolean the
   * assistant's status needs to say *which* of its two blockers applies. It lives here because
   * this file is the only one that reads the variable, and a second reader would be a second
   * place to forget the trim.
   */
  isConfigured(): boolean {
    return apiKey() !== undefined
  },

  /**
   * Ask the model one question, once.
   *
   * Every outcome is a value. Nothing here throws, nothing retries, and nothing loops — the
   * per-item loop DDR-0022 forbids has no analogue here because there is exactly one request.
   */
  async complete(request: AiRequest): Promise<AiResult> {
    const key = apiKey()
    if (key === undefined) {
      return {
        status: 'not_configured',
        message:
          'No OpenAI API key is set. Add OPENAI_API_KEY to your .env file to use the assistant.',
      }
    }

    // Checked before anything is sent, which is the whole point of the state: the owner is told
    // the request was too large for *this app's* ceiling, not that the provider rejected it.
    const size = request.system.length + request.user.length
    if (size > MAX_PROMPT_CHARS) {
      return {
        status: 'too_large',
        message: `The question and its context came to ${size.toLocaleString()} characters, over this app's ${MAX_PROMPT_CHARS.toLocaleString()} limit. Nothing was sent.`,
      }
    }

    const transport = await postJson(new URL(baseUrl() + COMPLETIONS_PATH), key, {
      model: model(),
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.user },
      ],
      // A caller may ask for a shorter answer, never a longer one — the ceiling is the gateway's.
      max_completion_tokens: Math.min(
        request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        MAX_OUTPUT_TOKENS,
      ),
    })

    if (transport.kind !== 'response') {
      return transport.kind === 'not_responding'
        ? { status: 'not_responding', message: transport.message }
        : { status: 'error', message: transport.message }
    }
    return readResponse(transport.status, transport.body)
  },
}

/** Turn a status and a body into one of the states, validating at ingress. */
function readResponse(status: number, body: string): AiResult {
  // A 5xx is the provider failing rather than declining, and its recovery is a stall's: wait and
  // ask again. It joins `not_responding` rather than becoming a fourth thing to explain.
  if (status >= 500) {
    return {
      status: 'not_responding',
      message: `The model provider returned HTTP ${status}. Try again shortly.`,
    }
  }

  if (status < 200 || status >= 300) {
    // A 4xx is a refusal — a bad key, a quota, a content policy — and the provider's own wording
    // is more useful than anything this file could invent, so it is carried through when present.
    const parsed = parseJson(body).flatMap((json) => {
      const result = errorSchema.safeParse(json)
      return result.success ? [result.data] : []
    })
    const detail = parsed[0]?.error?.message
    return {
      status: 'refused',
      message: redactKeys(detail ?? `The model provider refused the request (HTTP ${status}).`),
    }
  }

  const json = parseJson(body)
  if (json.length === 0) {
    return { status: 'invalid', message: 'The model returned a body that was not JSON.' }
  }

  const parsed = completionSchema.safeParse(json[0])
  if (!parsed.success) {
    return {
      status: 'invalid',
      message: `The model returned an unexpected shape: ${parsed.error.message}`,
    }
  }

  const choice = parsed.data.choices[0]!
  const text = choice.message.content
  if (text === null || text.trim() === '') {
    // A 200 that carries no answer is not an answer. It happens when a content filter stops the
    // completion, and reporting it as `ok` with an empty string would show the owner a blank reply.
    return { status: 'invalid', message: 'The model returned an empty answer.' }
  }

  return {
    status: 'ok',
    answer: {
      text,
      // What actually answered, as the provider reports it — not what was asked for. The two
      // differ whenever a model alias resolves to a dated snapshot.
      model: parsed.data.model ?? model(),
      truncated: choice.finish_reason === 'length',
      usage: toUsage(parsed.data.usage),
    },
  }
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
