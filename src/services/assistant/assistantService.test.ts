import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assistantService, buildPrompt, SYSTEM_PROMPT } from './assistantService'
import { consentService } from './consentService'
import { aiGateway } from '@repositories/assistant/aiGateway'
import {
  DISCLOSURE_CATEGORIES,
  type AssistantContext,
} from '@shared/domain/assistantDisclosure'

/**
 * The consent gate (Story #283, DDR-0097).
 *
 * The story's sharpest criterion is that **nothing is sent before consent — demonstrated, not
 * asserted**, and that is what the first block does: the gateway is mocked, and the assertion is
 * that it was never called. Every other guarantee in this Epic is downstream of that one holding.
 *
 * The second block covers the other half of keeping the disclosure honest: a context may carry
 * only sections the disclosure names, and the prompt is built from the declaration rather than
 * from whatever order a caller assembled its object in.
 */

vi.mock('@repositories/assistant/aiGateway', () => ({
  aiGateway: { complete: vi.fn(), isConfigured: vi.fn() },
}))
vi.mock('./consentService', () => ({
  consentService: { get: vi.fn(), grant: vi.fn(), revoke: vi.fn() },
}))

const mockGateway = vi.mocked(aiGateway)
const mockConsent = vi.mocked(consentService)

const GRANTED = { granted: true, grantedAt: 1_756_000_000_000, stale: false }
const NONE = { granted: false, grantedAt: null, stale: false }
const STALE = { granted: false, grantedAt: 1_700_000_000_000, stale: true }

const ANSWERED = {
  status: 'ok',
  answer: { text: 'Fine.', model: 'gpt-4.1-mini', truncated: false, usage: null },
} as const

beforeEach(() => {
  vi.clearAllMocks()
  mockGateway.isConfigured.mockReturnValue(true)
  mockGateway.complete.mockResolvedValue(ANSWERED)
})

// ---- nothing is sent before consent -----------------------------------------

describe('nothing leaves the machine before consent', () => {
  /**
   * The criterion the whole story turns on. Not "the service returns needs_consent" — that could
   * be true of a service that also fired the request — but that the one module able to reach
   * OpenAI was **never called**.
   */
  it('never reaches the gateway when consent was never given', async () => {
    mockConsent.get.mockReturnValue(NONE)

    const result = await assistantService.ask('How am I doing?', { weights: '...' })

    expect(result.status).toBe('needs_consent')
    expect(mockGateway.complete).not.toHaveBeenCalled()
  })

  it('never reaches the gateway when consent has gone stale', async () => {
    mockConsent.get.mockReturnValue(STALE)

    const result = await assistantService.ask('How am I doing?')

    expect(result.status).toBe('needs_consent')
    expect(mockGateway.complete).not.toHaveBeenCalled()
  })

  /**
   * Consent is checked **before** the key. "No API key" is a setup detail; "you have not agreed to
   * send anything" is a decision, and telling an owner to paste a key when they have not agreed to
   * use the feature answers a question they did not ask.
   */
  it('checks consent before configuration, so an unconfigured app still reports the decision', async () => {
    mockConsent.get.mockReturnValue(NONE)
    mockGateway.isConfigured.mockReturnValue(false)

    expect((await assistantService.ask('x')).status).toBe('needs_consent')
    expect(mockGateway.complete).not.toHaveBeenCalled()
  })

  /** Two blockers, two messages — the owner is told which one, and re-consent is not first-consent. */
  it('says the list changed when consent is stale, and not otherwise', async () => {
    mockConsent.get.mockReturnValue(STALE)
    const stale = await assistantService.ask('x')
    expect(stale.status === 'needs_consent' && stale.message).toContain('has changed')

    mockConsent.get.mockReturnValue(NONE)
    const never = await assistantService.ask('x')
    expect(never.status === 'needs_consent' && never.message).not.toContain('has changed')
  })

  it('reaches the gateway exactly once when consent is in force', async () => {
    mockConsent.get.mockReturnValue(GRANTED)

    expect((await assistantService.ask('How am I doing?')).status).toBe('ok')
    expect(mockGateway.complete).toHaveBeenCalledTimes(1)
  })

  /** After revocation no request is made — the criterion, exercised through the real sequence. */
  it('stops sending after consent is revoked', async () => {
    mockConsent.get.mockReturnValue(GRANTED)
    await assistantService.ask('first')
    expect(mockGateway.complete).toHaveBeenCalledTimes(1)

    mockConsent.revoke.mockReturnValue(NONE)
    mockConsent.get.mockReturnValue(NONE)
    assistantService.revokeConsent()

    expect((await assistantService.ask('second')).status).toBe('needs_consent')
    expect(mockGateway.complete).toHaveBeenCalledTimes(1)
  })
})

// ---- which blocker is in the way --------------------------------------------

describe('the blocking state is named specifically', () => {
  it.each([
    ['consent missing and no key', NONE, false, 'needs_consent'],
    ['consent missing but a key present', NONE, true, 'needs_consent'],
    ['consent given but no key', GRANTED, false, 'not_configured'],
    ['consent given and a key present', GRANTED, true, 'ready'],
  ])('reports %s as %s', (_case, consent, configured, expected) => {
    mockConsent.get.mockReturnValue(consent)
    mockGateway.isConfigured.mockReturnValue(configured)

    expect(assistantService.getStatus().state).toBe(expected)
  })

  /**
   * Both facts are reported beside the blocker, so a view can say what will be next rather than
   * revealing the second obstacle only after the owner clears the first.
   */
  it('reports both facts, not only the one in the way', () => {
    mockConsent.get.mockReturnValue(NONE)
    mockGateway.isConfigured.mockReturnValue(true)

    expect(assistantService.getStatus()).toEqual({
      state: 'needs_consent',
      consented: false,
      consentedAt: null,
      consentStale: false,
      configured: true,
    })
  })

  /** Whether a key exists, never the key — and never a fragment of one. */
  it('reports configuration as a boolean and nothing more', () => {
    mockConsent.get.mockReturnValue(GRANTED)
    const status = assistantService.getStatus()

    expect(typeof status.configured).toBe('boolean')
    expect(JSON.stringify(status)).not.toMatch(/sk-/)
  })

  it('carries staleness through, so the view can say the list changed', () => {
    mockConsent.get.mockReturnValue(STALE)
    expect(assistantService.getStatus()).toMatchObject({
      state: 'needs_consent',
      consented: false,
      consentStale: true,
      consentedAt: STALE.grantedAt,
    })
  })
})

// ---- the prompt can carry only what is disclosed -----------------------------

describe('the prompt is built from the disclosure', () => {
  const context: AssistantContext = {
    weights: 'USD 57%',
    holdings: 'AAA, BBB',
    profile: 'USD target 40-50%',
  }

  /**
   * Declaration order, not object order. A prompt whose shape depends on how a caller happened to
   * build its object is a prompt that changes when an unrelated story reorders an assignment.
   */
  it('emits sections in declaration order, whatever order the context was built in', () => {
    const prompt = buildPrompt('How am I doing?', context)
    const order = DISCLOSURE_CATEGORIES.filter((c) => c.id !== 'question')
      .map((c) => prompt.indexOf(`## ${c.title}`))
      .filter((index) => index >= 0)

    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(order).toHaveLength(3)
  })

  /**
   * The runtime agreeing with the type. `AssistantContext` already forbids an undisclosed key;
   * this is what holds if an object arrives from somewhere the type did not reach.
   */
  it('drops a section the disclosure does not name', () => {
    const prompt = buildPrompt('q', {
      ...context,
      // @ts-expect-error — exactly the key the type forbids, which is the point of the test.
      accountNumber: 'U1234567',
    })

    expect(prompt).not.toContain('U1234567')
    expect(prompt).not.toContain('accountNumber')
  })

  it('omits an absent or blank section rather than emitting an empty heading', () => {
    const prompt = buildPrompt('q', { weights: 'USD 57%', holdings: '   ' })

    expect(prompt).toContain('## How your portfolio is divided')
    expect(prompt).not.toContain('## What you hold')
  })

  /** The question is the ask, not context — it is never a section, and it goes last. */
  it('puts the question last, under its own heading', () => {
    const prompt = buildPrompt('How am I doing?', context)

    expect(prompt.trimEnd().endsWith('## Question\nHow am I doing?')).toBe(true)
    expect(prompt).not.toContain('## Your question')
  })

  it('says so plainly when no context was assembled', () => {
    expect(buildPrompt('q', {})).toContain('No portfolio context was assembled')
  })

  it('sends the system prompt and the built context through the gateway', async () => {
    mockConsent.get.mockReturnValue(GRANTED)
    await assistantService.ask('How am I doing?', context)

    expect(mockGateway.complete).toHaveBeenCalledWith({
      system: SYSTEM_PROMPT,
      user: buildPrompt('How am I doing?', context),
    })
  })
})

/**
 * The system prompt is where ADR-0009's boundary is restated to the model. It is asserted rather
 * than merely written because these four sentences are the difference between an assistant that
 * phrases computed figures and one that invents them.
 */
describe('the system prompt states the boundary the ADR set', () => {
  it('forbids the model from calculating anything', () => {
    expect(SYSTEM_PROMPT).toContain('Never calculate')
    expect(SYSTEM_PROMPT).toContain('verbatim in the context')
  })

  it('licenses naming positions while forbidding orders', () => {
    expect(SYSTEM_PROMPT).toContain('name positions')
    expect(SYSTEM_PROMPT).toContain('never place orders')
  })

  it('forbids proposing changes to the profile itself', () => {
    expect(SYSTEM_PROMPT).toContain('Never propose changes to the owner’s investor profile')
  })

  it('requires an unheld instrument to be marked as unverified', () => {
    expect(SYSTEM_PROMPT).toContain('training data')
    expect(SYSTEM_PROMPT).toContain('unverified')
  })
})
