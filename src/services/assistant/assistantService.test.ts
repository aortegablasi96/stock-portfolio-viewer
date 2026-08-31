import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assistantService, buildPrompt, SYSTEM_PROMPT, SYSTEM_PROMPT_RULES } from './assistantService'
import { aiGateway } from '@repositories/assistant/aiGateway'
import {
  DISCLOSURE_CATEGORIES,
  type AssistantContext,
} from '@shared/domain/assistantDisclosure'

/**
 * The assistant's one outbound path (Story #284; reshaped by Story #309, ADR-0011).
 *
 * The first block used to be this file's sharpest: **nothing is sent before consent — demonstrated,
 * not asserted**, with the gateway mocked and the assertion that it was never called. ADR-0011
 * removes consent as a concept, so what replaces it is the claim that now carries the boundary:
 * **the key is the authorization**, a question with one present goes with nothing in front of it,
 * and the service adds no check of its own to a gateway whose own `not_configured` is what a
 * missing key produces.
 *
 * The second block covers the half that did not move: a context may carry only sections
 * `DISCLOSURE_CATEGORIES` names, and the prompt is built from the declaration rather than from
 * whatever order a caller assembled its object in.
 */

vi.mock('@repositories/assistant/aiGateway', () => ({
  aiGateway: {
    complete: vi.fn(),
    keySource: vi.fn(),
    hasStoredKey: vi.fn(),
    storeKey: vi.fn(),
  },
}))

const mockGateway = vi.mocked(aiGateway)

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

// ---- the key is the authorization -------------------------------------------

describe('a question goes with nothing in front of it', () => {
  /**
   * ADR-0011's decision, as the assertion that used to say the opposite. One question, one call,
   * no decision consulted: there is no stored flag, no fingerprint and no check between the caller
   * and the gateway.
   */
  it('reaches the gateway exactly once, with no prior decision', async () => {
    expect((await assistantService.ask('How am I doing?')).status).toBe('ok')
    expect(mockGateway.complete).toHaveBeenCalledTimes(1)
  })

  /**
   * The gate is the key, and it is the *gateway's* gate rather than one this service keeps. A
   * missing key is `not_configured` — the resting state of a fresh clone (DDR-0096) — and it is the
   * gateway that says so, which is what makes "no socket is opened" a property of the module that
   * would have opened it.
   */
  it('does not second-guess a missing key: the gateway owns that state', async () => {
    mockGateway.keySource.mockReturnValue('none')
    mockGateway.complete.mockResolvedValue({ status: 'not_configured', message: 'No key.' })

    const result = await assistantService.ask('How am I doing?')

    expect(result.status).toBe('not_configured')
    expect(mockGateway.complete).toHaveBeenCalledTimes(1)
  })

  /**
   * Pinned as an **absence**, because it is the whole of what this story removed: `needs_consent`
   * is not a status the assistant can report any more, in either direction.
   */
  it('can no longer report a consent state', async () => {
    const result = await assistantService.ask('x', { weights: '...' })
    expect(result.status).not.toBe('needs_consent')
  })
})

// ---- whether the assistant can run ------------------------------------------

describe('the blocking state is named specifically', () => {
  it.each([
    ['no key anywhere', 'none', 'not_configured'],
    ['a key in the environment', 'environment', 'ready'],
    ['a key saved in the app', 'stored', 'ready'],
  ] as const)('reports %s as %s', (_case, source, expected) => {
    mockGateway.keySource.mockReturnValue(source)
    expect(assistantService.getStatus().state).toBe(expected)
  })

  /** Three fields, one blocker: the shape shrank with the concept (ADR-0011). */
  it('reports the key and nothing else', () => {
    mockGateway.keySource.mockReturnValue('environment')

    expect(assistantService.getStatus()).toEqual({
      state: 'ready',
      keySource: 'environment',
      keyStored: false,
    })
  })

  /** Whether a key exists, never the key — and never a fragment of one. */
  it('reports configuration as a state and nothing more', () => {
    expect(JSON.stringify(assistantService.getStatus())).not.toMatch(/sk-/)
  })

  /**
   * Which of the two sources is in force, and whether a key is saved in the app, are separate
   * facts (Story #300). A stored key the environment is shadowing has to stay visible: it is
   * still there and still not the one being used, and DDR-0105 requires that order to be reported
   * rather than silent — which is the one thing the view still says about a key that is present.
   */
  it.each([
    ['no key anywhere', 'none', false, 'not_configured'],
    ['a key only in the environment', 'environment', false, 'ready'],
    ['a key only in the app', 'stored', true, 'ready'],
    ['a stored key the environment shadows', 'environment', true, 'ready'],
  ] as const)('reports %s', (_case, source, stored, state) => {
    mockGateway.keySource.mockReturnValue(source)
    mockGateway.hasStoredKey.mockReturnValue(stored)

    expect(assistantService.getStatus()).toEqual({ state, keySource: source, keyStored: stored })
  })
})

// ---- the owner's own key (Story #300) ---------------------------------------

describe('setting the owner’s key', () => {
  it('stores the key and reports the status that follows', () => {
    mockGateway.keySource.mockReturnValue('stored')
    mockGateway.hasStoredKey.mockReturnValue(true)

    const result = assistantService.setApiKey('  sk-a-key-the-owner-pasted  ')

    expect(mockGateway.storeKey).toHaveBeenCalledWith('sk-a-key-the-owner-pasted')
    expect(result).toEqual({
      status: 'saved',
      assistant: { state: 'ready', keySource: 'stored', keyStored: true },
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

  /** Saving a key sends nothing. It is the setup, and it is the whole of it (ADR-0011). */
  it('opens no socket of its own', () => {
    mockGateway.keySource.mockReturnValue('stored')

    expect(assistantService.setApiKey('sk-mine').status).toBe('saved')
    expect(mockGateway.complete).not.toHaveBeenCalled()
  })

  /**
   * There is no `clearApiKey`, and its absence is the decision: the field is shown when there is no
   * working key and not shown once there is one, so there is no activate, deactivate or rotate
   * (ADR-0011). Asserted rather than left to be noticed, because a method re-added here is a
   * control reachable over IPC whether or not anything draws a button for it.
   */
  it('offers no way to remove a key', () => {
    expect('clearApiKey' in assistantService).toBe(false)
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
   * move, and with no profile there is no standard **of the owner's**. A model that invents either
   * is answering a question the owner did not ask.
   *
   * The second half was rewritten by Story #315 (ADR-0012), and what changed is narrow. *Do not
   * supply a standard of your own* still holds against the model - it invents nothing. What no
   * longer holds is that there is no standard at all: the app supplies one for what the profile
   * leaves silent, so the rule now points at the context's baseline rather than closing the
   * subject. It also names the Assistant view, the profile's home since #310 (DDR-0108).
   */
  it('makes nothing-to-propose and no-profile answers rather than gaps', () => {
    expect(SYSTEM_PROMPT).toContain('Nothing to propose is an answer')
    expect(SYSTEM_PROMPT).toContain('never manufacture one')
    expect(SYSTEM_PROMPT).toContain('the owner has set no profile')
    expect(SYSTEM_PROMPT).toContain('set one in the Assistant view’s profile section')
    expect(SYSTEM_PROMPT).toContain('never one of your own')
    // The Profile view has not existed since Story #310, and a rule naming it would send the owner
    // looking for a sidebar row that is not there.
    expect(SYSTEM_PROMPT).not.toContain('Profile view')
  })

  /**
   * The baseline's own three rules (Story #315, ADR-0012).
   *
   * The record's stated risk is that a default becomes a recommended profile - *"consider setting a
   * 10% ceiling"* is proposing the policy in the baseline's clothes - so the rule that forbids
   * proposing a profile is the one that had to grow, not a new eighteenth rule beside it. The
   * marking rule is the other half: two verdicts that read alike and only one of which carries the
   * owner's authority.
   */
  it('permits a baseline judgement, marks whose standard it is, and refuses to recommend one', () => {
    expect(SYSTEM_PROMPT).toContain('against the app’s baseline where the context supplies one')
    expect(SYSTEM_PROMPT).toContain('Say which of the two, beside the claim and never once at the end')
    expect(SYSTEM_PROMPT).toContain('never suggest a target for them to set')
    expect(SYSTEM_PROMPT).toContain('not a profile to adopt')
    expect(SYSTEM_PROMPT).toContain(
      'never on a dimension the context says the baseline does not cover',
    )
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
