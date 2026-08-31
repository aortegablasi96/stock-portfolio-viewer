import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  aiGateway,
  DEFAULT_MODEL,
  MAX_OUTPUT_TOKENS,
  MAX_PROMPT_CHARS,
  MAX_TOOL_ROUNDS,
  OPENAI_API_KEY_META_KEY,
} from './aiGateway'
import { metaRepository } from '@repositories/meta/metaRepository'
import type { AiRequest, AiResult } from '@shared/domain/assistant'

/**
 * The assistant's gateway (Story #282, DDR-0096).
 *
 * These drive a **real local HTTP server** rather than mocking `node:https`, for the reason
 * `ibkrGateway.test.ts` gives: the behaviour under test *is* the transport — a request whose
 * connection is accepted and then stalls must still settle — and mocking the socket would only
 * prove the mock. The server binds `127.0.0.1:0` and speaks plain HTTP, so **nothing leaves the
 * machine and no request is ever made to OpenAI**. The deadline is shortened through the same
 * `OPENAI_TIMEOUT_MS` override the gateway reads in production.
 *
 * Two things are worth stating about what is asserted. The **single-attempt guarantee** is
 * checked by counting requests the server actually received, not by inspecting the code — a retry
 * against a metered endpoint is the failure that would cost real money, so it is checked at the
 * wire. And every state is enumerated, because the whole design is that a slow, missing or
 * misbehaving model is a state the app *reports* rather than a hang or a crash.
 */

/**
 * The store the owner's own key lives in (Story #300, DDR-0105).
 *
 * Mocked, for the reason every repository test mocks its store: `better-sqlite3` is a native
 * module built for Electron and cannot be loaded by Vitest at all. What is being tested here is
 * the **precedence** between two sources, which is arithmetic over two reads and needs no database
 * to be true — the round trip through SQLite is `e2e/assistant-api-key.spec.ts`'s to prove.
 */
vi.mock('@repositories/meta/metaRepository', () => ({
  metaRepository: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}))

const mockStore = vi.mocked(metaRepository)

let server: Server | undefined
/** Every request the stand-in received, so a retry loop cannot hide. */
let received: { body: string; headers: IncomingMessage['headers'] }[] = []

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void

/** Start a local stand-in on a short deadline and point the gateway at it. */
async function startProvider(handler: Handler, timeoutMs = 120): Promise<void> {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      received.push({ body, headers: req.headers })
      handler(req, res, body)
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port assigned')
  process.env['OPENAI_BASE_URL'] = `http://127.0.0.1:${address.port}`
  process.env['OPENAI_TIMEOUT_MS'] = String(timeoutMs)
}

/**
 * The transport deadline the **loop** cases run under, which is not the stall cases' 120ms.
 *
 * A loop test issues up to five requests and runs a test double between them, so a 120ms
 * per-request bound is close enough to a loaded CI machine's jitter to turn "the loop stopped at
 * its round cap" into "a round timed out" — a green suite that fails once a week and teaches the
 * next reader to re-run it. The cases that are *about* a stall keep the short bound; these are
 * about counting rounds, so their transport deadline should never be the thing that fires.
 */
const LOOP_TIMEOUT_MS = 2_000

/** Reply with a well-formed completion carrying `text`. */
const answering =
  (text: string, extra: Record<string, unknown> = {}): Handler =>
  (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        model: 'gpt-4.1-mini-2025-04-14',
        choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        ...extra,
      }),
    )
  }

/**
 * One question, in the shape the loop takes (Story #324): a system turn and a user turn.
 *
 * `system` and `user` survive as *test* conveniences because almost every case here is about one
 * bounded request and reads better without an array literal in it. The tool cases below build the
 * request directly.
 */
const ask = (over: Partial<AiRequest> & { system?: string; user?: string } = {}): Promise<AiResult> => {
  const { system = 'Be brief.', user = 'How am I doing?', ...rest } = over
  return aiGateway.complete({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    ...rest,
  })
}

beforeEach(() => {
  received = []
  vi.clearAllMocks()
  // No stored key by default, so every test written before Story #300 still describes exactly the
  // environment it sets.
  mockStore.get.mockReturnValue(undefined)
  process.env['OPENAI_API_KEY'] = 'sk-test-key'
  delete process.env['OPENAI_MODEL']
})

afterEach(async () => {
  delete process.env['OPENAI_BASE_URL']
  delete process.env['OPENAI_TIMEOUT_MS']
  delete process.env['OPENAI_QUESTION_TIMEOUT_MS']
  delete process.env['OPENAI_API_KEY']
  delete process.env['OPENAI_MODEL']
  if (!server) return
  const closing = server
  server = undefined
  // Destroy in-flight sockets too: a stalled request is deliberately never answered, so
  // `close()` alone would wait on it forever and hang the suite.
  closing.closeAllConnections()
  await new Promise<void>((resolve) => closing.close(() => resolve()))
})

// ---- the happy path ---------------------------------------------------------

describe('a completed exchange', () => {
  it('returns the model’s answer', async () => {
    await startProvider(answering('You are doing fine.'))

    const result = await ask()
    expect(result).toEqual({
      status: 'ok',
      answer: {
        text: 'You are doing fine.',
        model: 'gpt-4.1-mini-2025-04-14',
        truncated: false,
        usage: { promptTokens: 11, completionTokens: 7, totalTokens: 18 },
      },
    })
  })

  /** What answered, not what was asked for: an alias resolves to a dated snapshot. */
  it('reports the model the provider says answered', async () => {
    await startProvider(answering('ok'))
    const result = await ask()

    expect(result.status === 'ok' && result.answer.model).toBe('gpt-4.1-mini-2025-04-14')
    expect(JSON.parse(received[0]!.body).model).toBe(DEFAULT_MODEL)
  })

  it('sends the configured model when one is set', async () => {
    process.env['OPENAI_MODEL'] = 'gpt-4.1'
    await startProvider(answering('ok'))
    await ask()

    expect(JSON.parse(received[0]!.body).model).toBe('gpt-4.1')
  })

  it('falls back to the default model when the variable is blank', async () => {
    process.env['OPENAI_MODEL'] = '   '
    await startProvider(answering('ok'))
    await ask()

    expect(JSON.parse(received[0]!.body).model).toBe(DEFAULT_MODEL)
  })

  it('sends the system and user messages in that order, and nothing else', async () => {
    await startProvider(answering('ok'))
    await ask({ system: 'S', user: 'U' })

    expect(JSON.parse(received[0]!.body).messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'U' },
    ])
  })

  it('carries the key as a bearer token', async () => {
    await startProvider(answering('ok'))
    await ask()

    expect(received[0]!.headers.authorization).toBe('Bearer sk-test-key')
  })

  /**
   * A truncated answer presented as a complete one is exactly the "reads like being right"
   * failure this Epic is built against, so the flag is carried rather than inferred later.
   */
  it('reports an answer that hit the output ceiling as truncated', async () => {
    await startProvider((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model: 'gpt-4.1-mini',
          choices: [{ message: { content: 'It was going we' }, finish_reason: 'length' }],
        }),
      )
    })

    const result = await ask()
    expect(result.status === 'ok' && result.answer.truncated).toBe(true)
  })

  /** A partial usage block is not a count. `null` says so rather than reporting zeros. */
  it('reports usage as null when the provider does not give all three figures', async () => {
    await startProvider(answering('ok', { usage: { prompt_tokens: 11 } }))

    const result = await ask()
    expect(result.status === 'ok' && result.answer.usage).toBeNull()
  })

  /** A provider adding a field must not break the app — every schema here is passthrough. */
  it('tolerates fields the provider adds', async () => {
    await startProvider(answering('ok', { system_fingerprint: 'fp_1', service_tier: 'default' }))

    expect((await ask()).status).toBe('ok')
  })
})

// ---- the bound on the answer ------------------------------------------------

describe('the output ceiling', () => {
  it('sends the gateway’s ceiling by default', async () => {
    await startProvider(answering('ok'))
    await ask()

    expect(JSON.parse(received[0]!.body).max_completion_tokens).toBe(MAX_OUTPUT_TOKENS)
  })

  it('honours a caller asking for a shorter answer', async () => {
    await startProvider(answering('ok'))
    await ask({ maxOutputTokens: 50 })

    expect(JSON.parse(received[0]!.body).max_completion_tokens).toBe(50)
  })

  /** A caller may ask for less, never more — the ceiling is the gateway's, not the caller's. */
  it('refuses to let a caller raise it', async () => {
    await startProvider(answering('ok'))
    await ask({ maxOutputTokens: MAX_OUTPUT_TOKENS * 10 })

    expect(JSON.parse(received[0]!.body).max_completion_tokens).toBe(MAX_OUTPUT_TOKENS)
  })
})

// ---- not_configured ---------------------------------------------------------

describe('no API key', () => {
  /**
   * The resting state of a fresh clone, and the OpenAI analogue of the IBKR gateway's
   * `not_connected`: the one failure the owner can fix directly. It is a calm, actionable fact.
   *
   * It now names **both** fixes, in precedence order (Story #300): the in-app field is the one a
   * packaged build has, and the environment variable is the one that wins.
   */
  it('reports not_configured, naming what to do about it', async () => {
    delete process.env['OPENAI_API_KEY']
    await startProvider(answering('ok'))

    const result = await ask()
    expect(result.status).toBe('not_configured')
    expect(result.status === 'not_configured' && result.message).toContain('Assistant view')
    expect(result.status === 'not_configured' && result.message).toContain('OPENAI_API_KEY')
  })

  it('treats a blank key as no key', async () => {
    process.env['OPENAI_API_KEY'] = '   '
    await startProvider(answering('ok'))

    expect((await ask()).status).toBe('not_configured')
  })

  /** Nothing is sent, which is the point: no key means no request, not a rejected one. */
  it('makes no request at all', async () => {
    delete process.env['OPENAI_API_KEY']
    await startProvider(answering('ok'))
    await ask()

    expect(received).toHaveLength(0)
  })
})

// ---- two sources, one stated order (Story #300, DDR-0105) -------------------

describe('where the key comes from', () => {
  /**
   * The precedence rule, at the wire rather than in the abstract: the request that goes out
   * carries the environment's key while both are present.
   *
   * This is the assertion the story asks for. `keySource` reporting `'environment'` would be
   * satisfied by a gateway that reported one source and spent the other, and the failure that
   * causes — an owner's key silently charged when they thought the environment's was in use — is
   * invisible until a bill arrives.
   */
  it('spends the environment’s key when both are present', async () => {
    process.env['OPENAI_API_KEY'] = 'sk-from-the-environment'
    mockStore.get.mockReturnValue('sk-from-the-app')
    await startProvider(answering('ok'))

    await ask()

    expect(received[0]!.headers.authorization).toBe('Bearer sk-from-the-environment')
    expect(aiGateway.keySource()).toBe('environment')
  })

  /** The packaged build's case: nothing in the environment, so the owner's own key is spent. */
  it('spends the stored key when the environment has none', async () => {
    delete process.env['OPENAI_API_KEY']
    mockStore.get.mockReturnValue('sk-from-the-app')
    await startProvider(answering('ok'))

    const result = await ask()

    expect(result.status).toBe('ok')
    expect(received[0]!.headers.authorization).toBe('Bearer sk-from-the-app')
    expect(mockStore.get).toHaveBeenCalledWith(OPENAI_API_KEY_META_KEY)
  })

  /**
   * A blank environment variable is *not* a key, and must not shadow a stored one.
   *
   * `e2e/assistant-api-key.spec.ts` launches the app with `OPENAI_API_KEY: ''` to mean "this run
   * has no key". Were an empty string to count as set, that would silently become "this run has an
   * unusable key that hides the owner's", and the suite would be asserting something else.
   */
  it('treats a blank environment variable as absent, not as a shadow', async () => {
    process.env['OPENAI_API_KEY'] = '   '
    mockStore.get.mockReturnValue('sk-from-the-app')
    await startProvider(answering('ok'))

    await ask()

    expect(aiGateway.keySource()).toBe('stored')
    expect(received[0]!.headers.authorization).toBe('Bearer sk-from-the-app')
  })

  it('reports none when neither source has one', () => {
    delete process.env['OPENAI_API_KEY']
    mockStore.get.mockReturnValue(undefined)

    expect(aiGateway.keySource()).toBe('none')
    expect(aiGateway.hasStoredKey()).toBe(false)
  })

  /** A stored key the environment is shadowing is still stored — and still removable. */
  it('reports a stored key even while the environment outranks it', () => {
    process.env['OPENAI_API_KEY'] = 'sk-from-the-environment'
    mockStore.get.mockReturnValue('sk-from-the-app')

    expect(aiGateway.keySource()).toBe('environment')
    expect(aiGateway.hasStoredKey()).toBe(true)
  })

  /** A blank row is no key: the store cannot produce a state the environment could not. */
  it('treats a blank stored value as no stored key', () => {
    delete process.env['OPENAI_API_KEY']
    mockStore.get.mockReturnValue('  ')

    expect(aiGateway.keySource()).toBe('none')
    expect(aiGateway.hasStoredKey()).toBe(false)
  })

  it('writes the key trimmed, under the one key the app spells in one place', () => {
    aiGateway.storeKey('  sk-pasted-with-a-stray-space  ')

    expect(mockStore.set).toHaveBeenCalledWith(
      OPENAI_API_KEY_META_KEY,
      'sk-pasted-with-a-stray-space',
    )
  })

  /**
   * Removed, never blanked, so "never set" and "removed" are one state
   * rather than two that behave alike (DDR-0097).
   */
  it('removes the row rather than storing an empty one', () => {
    mockStore.remove.mockReturnValue(true)

    expect(aiGateway.clearStoredKey()).toBe(true)
    expect(mockStore.remove).toHaveBeenCalledWith(OPENAI_API_KEY_META_KEY)
    expect(mockStore.set).not.toHaveBeenCalled()
  })
})

// ---- too_large --------------------------------------------------------------

describe('a request over the gateway’s own ceiling', () => {
  const oversized = { system: 'x'.repeat(MAX_PROMPT_CHARS), user: 'y'.repeat(10) }

  /**
   * Distinct from `refused` on purpose. Conflating them would tell the owner the *provider*
   * rejected their portfolio when in fact it never left the machine — the one distinction
   * ADR-0010 exists to keep clear.
   */
  it('reports too_large and says nothing was sent', async () => {
    await startProvider(answering('ok'))

    const result = await ask(oversized)
    expect(result.status).toBe('too_large')
    expect(result.status === 'too_large' && result.message).toContain('Nothing was sent')
  })

  it('sends nothing, so no portfolio data leaves the machine', async () => {
    await startProvider(answering('ok'))
    await ask(oversized)

    expect(received).toHaveLength(0)
  })

  /** The ceiling is on the pair, not on either string — otherwise two halves would slip past. */
  it('measures the system and user text together', async () => {
    await startProvider(answering('ok'))
    const half = 'x'.repeat(MAX_PROMPT_CHARS / 2 + 1)

    expect((await ask({ system: half, user: half })).status).toBe('too_large')
  })

  it('lets a request at exactly the ceiling through', async () => {
    await startProvider(answering('ok'))

    const result = await ask({ system: 'x'.repeat(MAX_PROMPT_CHARS - 1), user: 'y' })
    expect(result.status).toBe('ok')
  })
})

// ---- refused ----------------------------------------------------------------

describe('a provider that declines', () => {
  const declining = (status: number, message?: string): Handler =>
    (_req, res) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(message ? { error: { message, type: 'invalid_request_error' } } : {}))
    }

  /** A bad key, a quota, a content policy — the app is working, the request is not acceptable. */
  it.each([
    ['a rejected key', 401],
    ['a forbidden request', 403],
    ['a quota or rate limit', 429],
    ['a malformed request', 400],
  ])('reports %s as refused', async (_case, status) => {
    await startProvider(declining(status, 'Nope.'))

    expect((await ask()).status).toBe('refused')
  })

  /** The provider's own wording is more useful than anything this file could invent. */
  it('carries the provider’s explanation through', async () => {
    await startProvider(declining(429, 'You exceeded your current quota.'))

    const result = await ask()
    expect(result.status === 'refused' && result.message).toBe(
      'You exceeded your current quota.',
    )
  })

  it('falls back to naming the status when there is no explanation', async () => {
    await startProvider(declining(400))

    const result = await ask()
    expect(result.status === 'refused' && result.message).toContain('400')
  })

  /**
   * The real refusal from a wrong key is *"Incorrect API key provided: sk-defin****-key"* —
   * verified against the live API while building this. OpenAI masks the middle, so what comes
   * back is a fragment rather than a secret; it is still a fragment of the one value this story
   * exists to keep in the main process, and a refusal's message crosses IPC and can reach the
   * screen. The provider's wording survives; the fragment does not.
   */
  it('redacts anything key-shaped out of the provider’s wording', async () => {
    await startProvider(
      declining(401, 'Incorrect API key provided: sk-defin****************-key. Find it at ...'),
    )

    const result = await ask()
    expect(result.status === 'refused' && result.message).toBe(
      'Incorrect API key provided: <redacted>. Find it at ...',
    )
  })

  it('does not choke on an error body that is not JSON', async () => {
    await startProvider((_req, res) => {
      res.writeHead(403, { 'Content-Type': 'text/html' })
      res.end('<html>go away</html>')
    })

    expect((await ask()).status).toBe('refused')
  })
})

// ---- not_responding ---------------------------------------------------------

describe('a provider that produces no answer', () => {
  /** The exact failure the deadline exists for: connection accepted, then silence. */
  it('gives up on a connection that is accepted and then never answers', async () => {
    await startProvider(() => {
      /* accept the request, write nothing, never end the response */
    })

    const result = await ask()
    expect(result.status).toBe('not_responding')
    expect(result.status === 'not_responding' && result.message).toContain('did not respond')
  })

  /**
   * A socket-inactivity timeout would be reset by these bytes and never fire. The bound is a
   * whole-request deadline precisely so a trickling response is still bounded.
   */
  it('gives up on a response whose body starts and then stalls mid-stream', async () => {
    await startProvider((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '512' })
      res.write('{"choices":[{"message":{"content":"')
      // deliberately never completed
    })

    expect((await ask()).status).toBe('not_responding')
  })

  /**
   * A 5xx is the provider failing rather than declining, and its recovery is a stall's: wait and
   * ask again. DDR-0022 divides states by recovery, not by cause.
   */
  it.each([500, 502, 503])('reports HTTP %i as not responding', async (status) => {
    await startProvider((_req, res) => {
      res.writeHead(status)
      res.end('{"error":{"message":"overloaded"}}')
    })

    expect((await ask()).status).toBe('not_responding')
  })

  /** A host that is simply not there. Nothing is listening on this port. */
  it('reports an unreachable provider as not responding', async () => {
    process.env['OPENAI_BASE_URL'] = 'http://127.0.0.1:1'
    process.env['OPENAI_TIMEOUT_MS'] = '2000'

    const result = await ask()
    expect(result.status).toBe('not_responding')
  })
})

// ---- invalid ----------------------------------------------------------------

describe('an answer that is not the documented shape', () => {
  it('reports a non-JSON body as invalid, not as an error', async () => {
    await startProvider((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('not json at all')
    })

    const result = await ask()
    expect(result.status).toBe('invalid')
  })

  it.each([
    ['no choices at all', { model: 'm', choices: [] }],
    ['a choice with no message', { model: 'm', choices: [{ finish_reason: 'stop' }] }],
    ['a message whose content is a number', { model: 'm', choices: [{ message: { content: 7 } }] }],
  ])('reports %s as invalid', async (_case, payload) => {
    await startProvider((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    })

    expect((await ask()).status).toBe('invalid')
  })

  /**
   * A 200 carrying no answer is not an answer — it is what a content filter leaves behind.
   * Reporting it as `ok` would show the owner a blank reply and call it a response.
   */
  it.each([
    ['null content', null],
    ['an empty string', ''],
    ['nothing but whitespace', '   \n '],
  ])('reports %s as invalid rather than an empty answer', async (_case, content) => {
    await startProvider((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ model: 'm', choices: [{ message: { content } }] }))
    })

    expect((await ask()).status).toBe('invalid')
  })
})

// ---- one attempt ------------------------------------------------------------

/**
 * The guarantee checked **at the wire** rather than by reading the code: a retry against a
 * metered endpoint compounds the cost of every stall, and counting requests the stand-in actually
 * received is the only assertion a future refactor cannot talk its way past.
 */
describe('one bounded attempt, never a retry loop', () => {
  it('makes exactly one request when the provider stalls', async () => {
    await startProvider(() => {
      /* stall */
    })
    await ask()

    expect(received).toHaveLength(1)
  })

  it.each([
    ['a refusal', 429],
    ['a server error', 503],
  ])('makes exactly one request on %s', async (_case, status) => {
    await startProvider((_req, res) => {
      res.writeHead(status)
      res.end('{}')
    })
    await ask()

    expect(received).toHaveLength(1)
  })

  it('makes exactly one request on an unparseable answer', async () => {
    await startProvider((_req, res) => {
      res.writeHead(200)
      res.end('nope')
    })
    await ask()

    expect(received).toHaveLength(1)
  })

  it('makes exactly one request on success', async () => {
    await startProvider(answering('ok'))
    await ask()

    expect(received).toHaveLength(1)
  })
})

// ---- the bound cannot be disabled -------------------------------------------

describe('the deadline', () => {
  /** A missing or nonsensical value falls back to the default rather than disabling the bound. */
  it.each([
    ['unset', undefined],
    ['not a number', 'soon'],
    ['zero', '0'],
    ['negative', '-1'],
  ])('still bounds the request when OPENAI_TIMEOUT_MS is %s', async (_case, value) => {
    await startProvider(() => {
      /* stall */
    })
    if (value === undefined) delete process.env['OPENAI_TIMEOUT_MS']
    else process.env['OPENAI_TIMEOUT_MS'] = value

    // The default is 60s, which is far too long to wait for in a test — so what is asserted is
    // that the request is still *pending* rather than settled instantly, i.e. the bound did not
    // become "no bound" and did not become "zero". The stalling paths above prove it fires.
    const pending = ask()
    const raced = await Promise.race([
      pending,
      new Promise<'still waiting'>((resolve) => setTimeout(() => resolve('still waiting'), 150)),
    ])
    expect(raced).toBe('still waiting')
  })
})

// ---- the bounded tool loop (Story #324, DDR-0111) ---------------------------

/**
 * The loop, with a **test double where the reports will be** (Story #324).
 *
 * #324 ships the mechanism and #326-#329 ship the tools, which is the order the Epic asks for: the
 * bound, the states and the accounting are proven before a single report is wired up, so a tool
 * story that finds one of them wrong finds it in *its* diff rather than in this one.
 *
 * Everything here is asserted **at the wire**, for the reason the single-attempt guarantee already
 * was: what a loop against a metered endpoint costs is the number of requests it made, and only the
 * stand-in knows that. A future refactor can talk its way past a mock. It cannot talk its way past
 * a request count.
 */
describe('a question the model asks for reports before answering', () => {
  const TOOLS = [
    {
      name: 'get_performance',
      description: 'Return for one standard period.',
      parameters: { type: 'object', properties: { period: { type: 'string' } } },
    },
  ]

  /** One call, as OpenAI writes it: the arguments arrive as a JSON *string*. */
  const callFor = (name: string, args = '{"period":"2025"}', id = 'call_1'): unknown => ({
    id,
    type: 'function',
    function: { name, arguments: args },
  })

  /** A round asking for reports: no content, `tool_calls`, `finish_reason: 'tool_calls'`. */
  const asking =
    (...calls: unknown[]): Handler =>
    (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model: 'gpt-4.1-mini-2025-04-14',
          choices: [
            {
              message: { role: 'assistant', content: null, tool_calls: calls },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      )
    }

  /** Asks on the first round, answers on the second - the shape of every real tool question. */
  const asksThenAnswers =
    (text = 'Your 2025 return was 7.12%.'): Handler =>
    (req, res, body) =>
      received.length === 1
        ? asking(callFor('get_performance'))(req, res, body)
        : answering(text)(req, res, body)

  /** The executor the caller injects. Returns the app's own prose, never JSON (DDR-0111). */
  const runTool = vi.fn(async () => '2025 return: 7.12%. Value and return are separate figures.')

  const askWithTools = (over: Partial<AiRequest> = {}): Promise<AiResult> =>
    aiGateway.complete({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'How did 2025 go?' },
      ],
      tools: TOOLS,
      runTool,
      ...over,
    })

  beforeEach(() => {
    runTool.mockClear()
  })

  it('runs the call, sends the answer back, and returns what the model then said', async () => {
    await startProvider(asksThenAnswers(), LOOP_TIMEOUT_MS)

    const result = await askWithTools()

    expect(result.status).toBe('ok')
    expect(result.status === 'ok' && result.answer.text).toBe('Your 2025 return was 7.12%.')
    expect(runTool).toHaveBeenCalledWith({
      id: 'call_1',
      name: 'get_performance',
      argumentsJson: '{"period":"2025"}',
    })
    expect(received).toHaveLength(2)
  })

  /**
   * The second round carries the whole exchange: the model's own turn *with its call on it*, then
   * the app's prose answering that call by id. A provider handed either without the other rejects
   * the request, and the failure reads as a malformed round rather than as the missing pairing.
   */
  it('sends the call and its answer back as two turns, paired by id', async () => {
    await startProvider(asksThenAnswers(), LOOP_TIMEOUT_MS)
    await askWithTools()

    const second = JSON.parse(received[1]!.body).messages
    expect(second).toHaveLength(4)
    expect(second[2]).toEqual({
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_performance', arguments: '{"period":"2025"}' },
        },
      ],
    })
    expect(second[3]).toEqual({
      role: 'tool',
      tool_call_id: 'call_1',
      content: '2025 return: 7.12%. Value and return are separate figures.',
    })
  })

  /** Declared by the caller and passed through untouched - the gateway holds no inventory. */
  it('declares the caller’s tools on the wire, and none when there are none', async () => {
    await startProvider(asksThenAnswers(), LOOP_TIMEOUT_MS)
    await askWithTools()

    expect(JSON.parse(received[0]!.body).tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_performance',
          description: TOOLS[0]!.description,
          parameters: TOOLS[0]!.parameters,
        },
      },
    ])

    received.length = 0
    await ask()
    expect(JSON.parse(received[0]!.body).tools).toBeUndefined()
  })

  /** Several reports in one round is the whole reason a *round* is not a *tool*. */
  it('runs every call in a round before sending the next one', async () => {
    await startProvider((req, res, body) =>
      received.length === 1
        ? asking(
            callFor('get_performance', '{"period":"2025"}', 'call_a'),
            callFor('get_performance', '{"period":"2024"}', 'call_b'),
          )(req, res, body)
        : answering('Both years are in.')(req, res, body),
      LOOP_TIMEOUT_MS,
    )

    const result = await askWithTools()

    expect(result.status).toBe('ok')
    expect(runTool).toHaveBeenCalledTimes(2)
    expect(received).toHaveLength(2)
    expect(JSON.parse(received[1]!.body).messages.map((m: { role: string }) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'tool',
    ])
  })

  /**
   * The loop's version of *a 200 with no answer is `invalid`, never an empty `ok`*.
   *
   * A name nobody declared is not a report this app can produce, and running it would be the
   * general query ADR-0009 forbids arriving by the back door. The executor is never reached, which
   * is the half of this that matters: the check is before the call, not after it.
   */
  it('reports a call for a tool that does not exist as invalid, and runs nothing', async () => {
    await startProvider(asking(callFor('execute_query')), LOOP_TIMEOUT_MS)

    const result = await askWithTools()

    expect(result.status).toBe('invalid')
    expect(result.status === 'invalid' && result.message).toContain('execute_query')
    expect(runTool).not.toHaveBeenCalled()
    expect(received).toHaveLength(1)
  })

  it('reports a call as invalid when the caller declared no tools at all', async () => {
    await startProvider(asking(callFor('get_performance')), LOOP_TIMEOUT_MS)

    const result = await aiGateway.complete({
      messages: [{ role: 'user', content: 'How did 2025 go?' }],
    })

    expect(result.status).toBe('invalid')
  })

  /**
   * A throw from the caller's executor is a bug rather than a state - and a gateway that let one
   * escape would be the one outcome this union could not name.
   */
  it('turns a failing executor into a state rather than a rejection', async () => {
    await startProvider(asksThenAnswers(), LOOP_TIMEOUT_MS)
    runTool.mockRejectedValueOnce(new Error('the repository is closed'))

    const result = await askWithTools()

    expect(result.status).toBe('error')
    expect(result.status === 'error' && result.message).toContain('the repository is closed')
  })
})

// ---- the loop is bounded, three ways ----------------------------------------

describe('the bounds on a question', () => {
  const alwaysAsking: Handler = (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify({
        model: 'm',
        choices: [
          {
            message: {
              content: 'Let me look that up.',
              tool_calls: [
                { id: 'call_1', type: 'function', function: { name: 'peek', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      }),
    )
  }

  const looping = (runTool: AiRequest['runTool']): Promise<AiResult> =>
    aiGateway.complete({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'How am I doing?' },
      ],
      tools: [{ name: 'peek', description: 'A report.', parameters: { type: 'object' } }],
      runTool,
    })

  /** Growth is a decision, not an edit - DDR-0104's mechanism, applied to a cost this time. */
  it('declares its round cap as a constant', () => {
    expect(MAX_TOOL_ROUNDS).toBe(4)
  })

  /**
   * A model that never stops asking stops anyway, at a number this file declares - and the cost is
   * asserted at the wire, because rounds are what a metered endpoint bills for.
   */
  it('stops after the declared number of rounds, in a named state', async () => {
    await startProvider(alwaysAsking, LOOP_TIMEOUT_MS)

    const result = await looping(async () => 'a report')

    expect(result.status).toBe('incomplete')
    expect(received).toHaveLength(MAX_TOOL_ROUNDS + 1)
    expect(result.status === 'incomplete' && result.message).toContain(String(MAX_TOOL_ROUNDS))
  })

  /**
   * The distinction DDR-0111 added the state for. `too_large` means **nothing was sent**; by the
   * time a conversation can outgrow the ceiling, rounds have already gone. Folding the two would
   * tell the owner their portfolio never left the machine when it had.
   */
  it('reports a conversation that outgrows the ceiling mid-loop as incomplete, not too_large', async () => {
    await startProvider(alwaysAsking, LOOP_TIMEOUT_MS)

    const result = await looping(async () => 'x'.repeat(MAX_PROMPT_CHARS))

    expect(result.status).toBe('incomplete')
    expect(result.status === 'incomplete' && result.message).toContain('characters')
    // One round went out, and its answer came back too big for a second - so the loop stopped
    // before sending it, having already sent something.
    expect(received).toHaveLength(1)
  })

  /** And the first round is still the other state, with nothing sent at all. */
  it('still reports a question that is too large before the first round as too_large', async () => {
    await startProvider(alwaysAsking, LOOP_TIMEOUT_MS)

    const result = await aiGateway.complete({
      messages: [{ role: 'user', content: 'x'.repeat(MAX_PROMPT_CHARS + 1) }],
    })

    expect(result.status).toBe('too_large')
    expect(received).toHaveLength(0)
  })

  /**
   * The second deadline (DDR-0111). The transport deadline stops a socket that has gone quiet and
   * cannot bound a question that makes N requests; this one can, and says the total it bounded.
   */
  it('stops a loop that outlives the whole-question deadline, naming the wait', async () => {
    await startProvider(alwaysAsking, 5_000)
    process.env['OPENAI_QUESTION_TIMEOUT_MS'] = '120'

    const result = await looping(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return 'a report'
    })

    expect(result.status).toBe('incomplete')
    expect(result.status === 'incomplete' && result.message).toContain('whole question')
    expect(received.length).toBeLessThan(MAX_TOOL_ROUNDS + 1)
  })

  /**
   * **Still no retry** (DDR-0096). A round that fails ends the question: the loop is N requests
   * because each carries new information, not because a failed one is worth sending again.
   */
  it('ends the question on a round that fails, without re-issuing it', async () => {
    await startProvider((req, res, body) => {
      if (received.length === 1) return alwaysAsking(req, res, body)
      res.writeHead(429)
      res.end('{"error":{"message":"slow down"}}')
    }, LOOP_TIMEOUT_MS)

    const result = await looping(async () => 'a report')

    expect(result.status).toBe('refused')
    expect(received).toHaveLength(2)
  })

  it('ends the question on a round that stalls, without re-issuing it', async () => {
    await startProvider((req, res, body) => {
      if (received.length === 1) return alwaysAsking(req, res, body)
      /* accept the second round and never answer it */
    })

    const result = await looping(async () => 'a report')

    expect(result.status).toBe('not_responding')
    expect(received).toHaveLength(2)
  })

  /** A bound reached is never an answer. There is no partial text to mistake for one. */
  it('presents no partial answer when it stops', async () => {
    await startProvider(alwaysAsking, LOOP_TIMEOUT_MS)

    const result = await looping(async () => 'a report')

    expect(result.status).not.toBe('ok')
    expect(JSON.stringify(result)).not.toContain('Let me look that up.')
  })
})

// ---- what a question cost ---------------------------------------------------

describe('the usage a loop reports', () => {
  /** A round that asks for one report, carrying whatever usage it is given. */
  const askingWith = (usage: Record<string, number>): Handler =>
    (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          model: 'm',
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  { id: 'c1', type: 'function', function: { name: 'peek', arguments: '{}' } },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage,
        }),
      )
    }

  const twoRounds = (): Promise<AiResult> =>
    aiGateway.complete({
      messages: [{ role: 'user', content: 'How am I doing?' }],
      tools: [{ name: 'peek', description: 'A report.', parameters: { type: 'object' } }],
      runTool: async () => 'a report',
    })

  /**
   * The **question's** cost, not the last round's. A loop that ran three rounds and reported the
   * third's usage would understate the bill it had just run up - and usage is the one figure here
   * an owner reconciles against a statement written by someone else.
   */
  it('sums every round', async () => {
    await startProvider((req, res, body) =>
      received.length === 1
        ? askingWith({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 })(req, res, body)
        : answering('Done.')(req, res, body),
      LOOP_TIMEOUT_MS,
    )

    // 100/20/120 from the asking round, 11/7/18 from the answering one.
    const result = await twoRounds()
    expect(result.status === 'ok' && result.answer.usage).toEqual({
      promptTokens: 111,
      completionTokens: 27,
      totalTokens: 138,
    })
  })

  /** One round without a full count makes the total unknowable, and `null` says so. */
  it('reports null when any round did not report all three figures', async () => {
    await startProvider((req, res, body) =>
      received.length === 1
        ? askingWith({ prompt_tokens: 100 })(req, res, body)
        : answering('Done.')(req, res, body),
      LOOP_TIMEOUT_MS,
    )

    const result = await twoRounds()
    expect(result.status === 'ok' && result.answer.usage).toBeNull()
  })
})
