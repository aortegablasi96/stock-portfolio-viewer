import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assistantService, buildPrompt, SYSTEM_PROMPT, SYSTEM_PROMPT_RULES } from './assistantService'
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
  aiGateway: {
    complete: vi.fn(),
    keySource: vi.fn(),
    hasStoredKey: vi.fn(),
    storeKey: vi.fn(),
    clearStoredKey: vi.fn(),
  },
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
  mockGateway.keySource.mockReturnValue('environment')
  mockGateway.hasStoredKey.mockReturnValue(false)
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
    mockGateway.keySource.mockReturnValue('none')

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
    mockGateway.keySource.mockReturnValue(configured ? 'environment' : 'none')

    expect(assistantService.getStatus().state).toBe(expected)
  })

  /**
   * Both facts are reported beside the blocker, so a view can say what will be next rather than
   * revealing the second obstacle only after the owner clears the first.
   */
  it('reports both facts, not only the one in the way', () => {
    mockConsent.get.mockReturnValue(NONE)
    mockGateway.keySource.mockReturnValue('environment')

    expect(assistantService.getStatus()).toEqual({
      state: 'needs_consent',
      consented: false,
      consentedAt: null,
      consentStale: false,
      configured: true,
      keySource: 'environment',
      keyStored: false,
    })
  })

  /** Whether a key exists, never the key — and never a fragment of one. */
  it('reports configuration as a boolean and nothing more', () => {
    mockConsent.get.mockReturnValue(GRANTED)
    const status = assistantService.getStatus()

    expect(typeof status.configured).toBe('boolean')
    expect(JSON.stringify(status)).not.toMatch(/sk-/)
  })

  /**
   * Which of the two sources is in force, and whether a key is saved in the app, are separate
   * facts (Story #300). A stored key the environment is shadowing has to stay visible: it is
   * still there, still removable, and still not the one being used.
   */
  it.each([
    ['no key anywhere', 'none', false, false],
    ['a key only in the environment', 'environment', false, true],
    ['a key only in the app', 'stored', true, true],
    ['a stored key the environment shadows', 'environment', true, true],
  ] as const)('reports %s', (_case, source, stored, configured) => {
    mockConsent.get.mockReturnValue(GRANTED)
    mockGateway.keySource.mockReturnValue(source)
    mockGateway.hasStoredKey.mockReturnValue(stored)

    expect(assistantService.getStatus()).toMatchObject({
      keySource: source,
      keyStored: stored,
      configured,
    })
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

// ---- the owner's own key (Story #300) ---------------------------------------

describe('setting and removing the owner’s key', () => {
  beforeEach(() => {
    mockConsent.get.mockReturnValue(GRANTED)
  })

  it('stores the key and reports the status that follows', () => {
    mockGateway.keySource.mockReturnValue('stored')
    mockGateway.hasStoredKey.mockReturnValue(true)

    const result = assistantService.setApiKey('  sk-a-key-the-owner-pasted  ')

    expect(mockGateway.storeKey).toHaveBeenCalledWith('sk-a-key-the-owner-pasted')
    expect(result).toEqual({
      status: 'saved',
      assistant: expect.objectContaining({ state: 'ready', keySource: 'stored', keyStored: true }),
    })
  })

  /**
   * The precedence rule, seen from the service: saving while the environment supplies a key
   * **stores it and does not use it**, and the status says so in the same round trip. A view that
   * had to assume would report the owner's key as in force when it is not.
   */
  it('stores a key the environment is shadowing, and says the environment still wins', () => {
    mockGateway.keySource.mockReturnValue('environment')
    mockGateway.hasStoredKey.mockReturnValue(true)

    const result = assistantService.setApiKey('sk-mine')

    expect(result.status).toBe('saved')
    expect(result.assistant).toMatchObject({ keySource: 'environment', keyStored: true })
  })

  /** A bad paste is the owner's to fix, so nothing is stored and nothing throws. */
  it('refuses a blank key without storing anything', () => {
    mockGateway.keySource.mockReturnValue('none')
    mockGateway.hasStoredKey.mockReturnValue(false)

    const result = assistantService.setApiKey('   ')

    expect(result.status).toBe('invalid')
    expect(mockGateway.storeKey).not.toHaveBeenCalled()
  })

  /** Nothing about the value comes back — not the key, not its length, not a fragment. */
  it('echoes nothing of the key it was given, in either outcome', () => {
    mockGateway.keySource.mockReturnValue('stored')
    mockGateway.hasStoredKey.mockReturnValue(true)
    const saved = JSON.stringify(assistantService.setApiKey('sk-secret-value'))

    mockGateway.keySource.mockReturnValue('none')
    mockGateway.hasStoredKey.mockReturnValue(false)
    const refused = JSON.stringify(assistantService.setApiKey('sk secret value'))

    expect(saved).not.toContain('secret')
    expect(refused).not.toContain('secret')
  })

  /** Removing the only key returns the assistant to `not_configured`, consent untouched. */
  it('returns to not_configured when the removed key was the only one', () => {
    mockGateway.keySource.mockReturnValue('none')
    mockGateway.hasStoredKey.mockReturnValue(false)

    const result = assistantService.clearApiKey()

    expect(mockGateway.clearStoredKey).toHaveBeenCalled()
    expect(result).toEqual({
      status: 'cleared',
      assistant: expect.objectContaining({
        state: 'not_configured',
        consented: true,
        keySource: 'none',
        keyStored: false,
      }),
    })
  })

  /**
   * Setting a key sends nothing, so it is not gated on consent. The gate stays exactly where it
   * was — `ask` — and this is the assertion that says so rather than leaving it to be inferred.
   */
  it('does not require consent, and reaches the model either way', () => {
    mockConsent.get.mockReturnValue(NONE)
    mockGateway.keySource.mockReturnValue('stored')
    mockGateway.hasStoredKey.mockReturnValue(true)

    expect(assistantService.setApiKey('sk-mine').status).toBe('saved')
    expect(mockGateway.complete).not.toHaveBeenCalled()
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

  /**
   * Story #285's two prompt-level rules, pinned here because the story asks for them to be held by
   * a test rather than by the model's disposition.
   *
   * The first is the trap that defines the story: **a change in value and a return are different
   * sentences**, and the app's curve only answers the second (DDR-0013). An answer that attributes
   * a 24% rise in value to performance when a deposit caused it is wrong in the flattering
   * direction, which is the direction an owner is least likely to check.
   *
   * The second is the story's main guardrail. "Energy fell 8% over the period" is grounded;
   * "energy fell because of the OPEC decision" is invented, and invented in a register that sounds
   * authoritative. The app holds no news, no fundamentals and no market data beyond the
   * portfolio's own history, so a cause is never something it can offer.
   */
  it('forbids conflating a change in value with a return', () => {
    expect(SYSTEM_PROMPT).toContain('Keep return and value apart')
    expect(SYSTEM_PROMPT).toContain('moves value and does not move return')
    expect(SYSTEM_PROMPT).toContain('never attribute a return to a deposit')
  })

  it('forbids attributing a cause the app cannot observe', () => {
    expect(SYSTEM_PROMPT).toContain('Never say why the market, a sector or an instrument moved')
    expect(SYSTEM_PROMPT).toContain('no news, no fundamentals and no market data')
    expect(SYSTEM_PROMPT).toContain('not something this app can see')
  })

  it('forbids forecasting', () => {
    expect(SYSTEM_PROMPT).toContain('Never forecast')
  })

  /**
   * Story #286's three rules, each a special case of "never calculate" written out (DDR-0101).
   *
   * They are worth their own lines rather than being left to the general rule because a summary is
   * where a model reaches for them, and none of the three *feels* like a derivation: "roughly 30%
   * a year" reads as a restatement of "+5% over two months", "in line with the market" reads as
   * context, and a Sharpe ratio reads as a figure someone computed. The context names each absence
   * before it names a figure; these are the second line of defence over the same three claims.
   */
  it('forbids annualising a return the app never annualised', () => {
    expect(SYSTEM_PROMPT).toContain('Never annualise')
    expect(SYSTEM_PROMPT).toContain('producing one is a calculation')
    expect(SYSTEM_PROMPT).toContain('name that period')
  })

  it('forbids a benchmark the app does not hold', () => {
    expect(SYSTEM_PROMPT).toContain('Never compare to a benchmark, an index, the market or a peer')
    expect(SYSTEM_PROMPT).toContain('This app holds none')
  })

  it('forbids a risk statistic the app does not compute', () => {
    expect(SYSTEM_PROMPT).toContain('Never state a volatility, standard deviation, Sharpe ratio')
    expect(SYSTEM_PROMPT).toContain('daily-return counts and the best and worst day')
    expect(SYSTEM_PROMPT).toContain('not available')
  })
})

/**
 * Story #288's rules, and the seam they sit on (DDR-0104).
 *
 * **Every assertion below is a presence-of-rule assertion, and that is the whole guarantee.** A
 * figure is guarded twice — computed by a service, then asserted in the assembled text — but a
 * *sentence* built around a correct figure is guarded here and nowhere else. A test can hold that a
 * rule is in front of the model; it cannot hold that the model obeyed it. That is why the arithmetic
 * these rules talk about lives in #287's `periodSet` and `driftMoves` rather than in a rule, and why
 * this block is deliberately thin: it pins what is *said*, which is the only thing it can pin.
 *
 * Each rule is obeyable from the context #287 assembles. Where one is not, the fault is in the
 * grounding rather than in a missing sentence here — the story's own division.
 */
describe('the system prompt bounds the sentences around the figures', () => {
  /**
   * Rebasing, both lengths, and the line between an ordering and a subtraction — one rule, because
   * they are one act. `periodSet` computes each consecutive same-kind difference precisely so that
   * "by how much" has somewhere to come from; every other pairing has none (DDR-0103).
   */
  it('bounds a comparison of two periods', () => {
    expect(SYSTEM_PROMPT).toContain('rebased to its own period’s start')
    expect(SYSTEM_PROMPT).toContain('not points on one scale')
    expect(SYSTEM_PROMPT).toContain('Give both periods’ lengths')
    expect(SYSTEM_PROMPT).toContain('which is an ordering')
    expect(SYSTEM_PROMPT).toContain('never add, subtract, chain or average two returns')
  })

  /**
   * The failure this is against is not a refusal — it is the adjacent row answered as though it were
   * the one asked for, which is a right-looking figure under the wrong heading (DDR-0103).
   */
  it('makes an unavailable period a named state with alternatives', () => {
    expect(SYSTEM_PROMPT).toContain('names a period the context does not hold')
    expect(SYSTEM_PROMPT).toContain('name the periods that are')
    expect(SYSTEM_PROMPT).toContain('neighbouring period')
  })

  /** Held-and-priced-in, which is the only currency exposure this app computes. */
  it('names which currency exposure the app holds, and which it does not', () => {
    expect(SYSTEM_PROMPT).toContain('the currency each position is held and priced in')
    expect(SYSTEM_PROMPT).toContain('never economic, geographic or revenue exposure')
  })

  /**
   * Tax is Epic #8 and costs are modelled nowhere. This is the one rule with no context half: there
   * is no section to name the absence in, because tax is not a section — it is a category of claim
   * about every one of them (DDR-0104).
   */
  it('forbids a tax claim and requires costs to be disclaimed beside a move', () => {
    expect(SYSTEM_PROMPT).toContain('Never claim a tax effect, a tax outcome, or that anything is tax-efficient')
    expect(SYSTEM_PROMPT).toContain('no tax treatment, no jurisdiction and no holding period')
    expect(SYSTEM_PROMPT).toContain('trading costs and spreads are outside what this app models')
  })

  /**
   * Two states in one rule because both are the same refusal: with nothing out of range there is no
   * move, and with no profile there is no standard. A model that invents either is answering a
   * question the owner did not ask.
   */
  it('makes nothing-to-propose and no-profile answers rather than gaps', () => {
    expect(SYSTEM_PROMPT).toContain('Nothing to propose is an answer')
    expect(SYSTEM_PROMPT).toContain('never manufacture one')
    expect(SYSTEM_PROMPT).toContain('carries no profile section at all')
    expect(SYSTEM_PROMPT).toContain('set one on the Profile view')
    expect(SYSTEM_PROMPT).toContain('Do not supply a standard of your own')
  })

  /**
   * The largest risk in the Epic, sharpened rather than duplicated. ADR-0009's own words: a trim is
   * grounded end to end and an add is not, so the two may not be delivered in one voice — and the
   * marking goes **beside** each claim, because a blanket caveat at the end is the decoration the
   * ADR names as the way this mitigation fails.
   */
  it('sharpens the marking rule for a proposal, and puts it beside the claim', () => {
    expect(SYSTEM_PROMPT).toContain('Mark what the app computed apart from what you are repeating')
    expect(SYSTEM_PROMPT).toContain('beside each claim and never once at the end')
    expect(SYSTEM_PROMPT).toContain('the size of a move are computed from their own data')
    expect(SYSTEM_PROMPT).toContain('is not checked to exist or to be available at the owner’s broker')
    expect(SYSTEM_PROMPT).toContain('subject to your knowledge cutoff')
    expect(SYSTEM_PROMPT).toContain('Never give the two in the same voice')
  })

  /**
   * The count, stated here and in DDR-0104 and CLAUDE.md.
   *
   * **A long list is a list a model weights less**, so growing it is a decision rather than an edit.
   * The literal is what makes an eighteenth rule visible: a story that adds one has to come here,
   * find this number, and choose to change it — which is the whole mechanism, and the reason the
   * rules are a declared array instead of a string literal.
   *
   * Both halves are counted. The array is the declaration; the bullets are what actually reaches the
   * model, and a rule appended to `SYSTEM_PROMPT` around the array would otherwise be invisible.
   */
  it('is seventeen rules, in the array and in the text the model reads', () => {
    expect(SYSTEM_PROMPT_RULES).toHaveLength(17)
    expect(SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(17)
  })

  /** No rule is empty, and none carries the bullet the renderer adds — a `- - ` would be visible. */
  it('renders every declared rule as exactly one bullet', () => {
    for (const rule of SYSTEM_PROMPT_RULES) {
      expect(rule.trim()).not.toBe('')
      expect(rule.startsWith('- ')).toBe(false)
      expect(SYSTEM_PROMPT).toContain(`\n- ${rule}`)
    }
  })
})
