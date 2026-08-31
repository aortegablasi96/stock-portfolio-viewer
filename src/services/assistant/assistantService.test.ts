import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  assistantService,
  buildPrompt,
  BASE_CONTEXT_HEADING,
  SECTION_HEADINGS,
  SYSTEM_PROMPT,
  SYSTEM_PROMPT_PREAMBLE,
  SYSTEM_PROMPT_SECTIONS,
} from './assistantService'
import { aiGateway } from '@repositories/assistant/aiGateway'
import {
  DISCLOSURE_CATEGORIES,
  type AssistantContext,
} from '@shared/domain/assistantDisclosure'
import {
  ABSENCE_DISCLOSURES,
  BASELINE_SILENCE_NOTE,
  BASE_CONTEXT,
  CURRENCY_EXPOSURE_NOTE,
  NO_ANNUALISED_NOTE,
  NO_BENCHMARK_NOTE,
  NO_RISK_STATISTIC_NOTE,
  STORE_AND_CLOCK_NOTE,
} from '@shared/domain/assistantAbsences'
import {
  BASELINE_UNCOVERED_NOTE,
  NO_SECTOR_UNIVERSE_NOTE,
} from '@shared/domain/portfolioBaseline'

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

  /** The base context is above the first disclosed section, whatever sections there are. */
  it('opens with the base context, above every section', () => {
    const prompt = buildPrompt('How am I doing?', context)

    expect(prompt.startsWith(`## ${BASE_CONTEXT_HEADING}\n${BASE_CONTEXT}`)).toBe(true)
    expect(prompt.indexOf(BASE_CONTEXT)).toBeLessThan(prompt.indexOf('## What you hold'))
  })

  /**
   * Two turns, in that order — the same exchange the two strings carried, in the shape a tool loop
   * needs (Story #324, DDR-0111).
   */
  it('sends the system prompt and the built context through the gateway', async () => {
    await assistantService.ask('How am I doing?', context)

    expect(mockGateway.complete).toHaveBeenCalledWith({
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt('How am I doing?', context) },
      ],
    })
  })

  /**
   * **No tool is declared yet**, and the assertion is the story's rather than the shape's: #324
   * ships the loop, and #326–#329 ship the reports. A tool named here before a service computed one
   * would be an invitation for the model to ask for a report that does not exist — which the
   * gateway would report as `invalid`, correctly and uselessly.
   */
  it('declares no tools, because none is backed by a report yet', async () => {
    await assistantService.ask('How am I doing?', context)

    const sent = mockGateway.complete.mock.calls[0]![0]
    expect(sent.tools).toBeUndefined()
    expect(sent.runTool).toBeUndefined()
  })
})

/**
 * The absences reach the model on **every** question (Story #325, DDR-0110, DDR-0111).
 *
 * **This is the story's central assertion and it is deliberately a negative one.** Under Epic #322
 * a report arrives because the model asked for it, so the interesting conversation is the one where
 * it asked for nothing — and that is exactly the conversation in which the three conditional
 * prohibitions would have nothing behind them. Before this story the absences were part of
 * `performanceSection`, so a question asked with no Flex history, or with a model that never
 * reached for performance, carried *"unless explicitly supplied"* with nothing left asserting that
 * nothing was.
 *
 * The mechanism is structural rather than dutiful: `buildPrompt` emits {@link BASE_CONTEXT}
 * unconditionally, so there is no branch to forget. A tool result, a section or an empty object
 * changes what comes *after* it and never whether it is there.
 */
describe('the absences ride with every question, whatever else does', () => {
  /** The whole outbound message, as the gateway receives it — not the string a helper returned. */
  const sentUser = (): string => {
    const sent = mockGateway.complete.mock.calls[0]![0]
    return sent.messages.find((message) => message.role === 'user')!.content
  }

  /**
   * No context, no tools, no report — and all seven statements still there. This is the "no tool is
   * called" conversation the story asks for, at the only boundary where it can be observed: what
   * actually left for the gateway.
   */
  it('carries every one of them when no context was assembled and no tool was called', async () => {
    await assistantService.ask('How volatile has the ride been?')

    const sent = mockGateway.complete.mock.calls[0]![0]
    expect(sent.tools).toBeUndefined()
    expect(sent.runTool).toBeUndefined()

    const user = sentUser()
    expect(user).toContain('No portfolio context was assembled')
    for (const disclosure of ABSENCE_DISCLOSURES) {
      expect(user).toContain(disclosure.text)
    }
  })

  /**
   * All four sets, named individually rather than only counted, so a set that stopped being
   * assembled fails with the name of what went missing.
   */
  it.each([
    ['no annualised figure (DDR-0101)', NO_ANNUALISED_NOTE],
    ['no benchmark (DDR-0101)', NO_BENCHMARK_NOTE],
    ['no risk statistic (DDR-0101)', NO_RISK_STATISTIC_NOTE],
    ['no baseline where the owner set a target (ADR-0012)', BASELINE_SILENCE_NOTE],
    ['no currency baseline (DDR-0109)', BASELINE_UNCOVERED_NOTE],
    ['no sector universe (DDR-0109)', NO_SECTOR_UNIVERSE_NOTE],
    ['what a currency weight is', CURRENCY_EXPOSURE_NOTE],
    ['which store and which clock (DDR-0098)', STORE_AND_CLOCK_NOTE],
  ])('states %s', async (_case, text) => {
    await assistantService.ask('q')
    expect(sentUser()).toContain(text)
  })

  /**
   * DDR-0101's ordering, at the level of the whole prompt: a model that has already read a figure
   * has, by the time it reaches a caveat, largely written the sentence the caveat was meant to
   * prevent. Every section and the question itself come after.
   */
  it('states them before any section and before the question', async () => {
    await assistantService.ask('How am I doing?', { weights: 'USD 57%', holdings: 'AAA' })

    const user = sentUser()
    const last = Math.max(...ABSENCE_DISCLOSURES.map((d) => user.indexOf(d.text) + d.text.length))
    expect(last).toBeLessThan(user.indexOf('## How your portfolio is divided'))
    expect(last).toBeLessThan(user.indexOf('## Question'))
  })

  /**
   * The base context is **not** a disclosure category and must not become one. It carries no owner
   * data — it is a statement about the app — so `pickDisclosedSections` has nothing to bound, and a
   * category invented for it would be a disclosure of nothing that could then be dropped at the IPC
   * boundary, which is the one thing that must not happen to it (DDR-0098, DDR-0111).
   */
  it('is not a disclosure category, and cannot be dropped by one', () => {
    expect(DISCLOSURE_CATEGORIES.map((category) => category.id)).not.toContain('absences')
    // The runtime half: an assembled context that tried to smuggle it in is dropped, and the base
    // context is there anyway.
    const prompt = buildPrompt('q', {
      // @ts-expect-error — the key the type forbids, used here to prove the base is not it.
      absences: 'something else entirely',
    })
    expect(prompt).not.toContain('something else entirely')
    expect(prompt).toContain(BASE_CONTEXT)
  })
})

/**
 * The coupling DDR-0110 wrote down, asserted so trimming either end fails (Story #325).
 *
 * Each case names a prompt rule that is **conditional** and the sentence that makes the condition
 * false. The prompt half is the model's instruction; the context half is the fact that makes the
 * instruction obeyable. Neither is worth anything alone: a rule with no fact behind it is a rule the
 * model must guess at, and a fact with no rule is a fact it may ignore. DDR-0110 said so in as many
 * words — *"a later story that trims the absence blocks would silently unbind three prohibitions"* —
 * and this is what makes the silence impossible.
 */
describe('the three conditional prohibitions stay bound to the fact behind them', () => {
  it.each([
    [
      'a risk statistic — "unless explicitly supplied"',
      'Do not report derived risk statistics such as volatility, standard deviation, Sharpe ratio, beta, or drawdown unless explicitly supplied by the application or a tool.',
      NO_RISK_STATISTIC_NOTE,
    ],
    [
      'a benchmark — "unless comparison data is explicitly available"',
      'Do not compare the portfolio with benchmarks, indices, markets, or peers unless comparison data is explicitly available.',
      NO_BENCHMARK_NOTE,
    ],
    [
      'a cause — "unless the available data supports the explanation"',
      'Do not claim why a market, sector, company, instrument, or portfolio position moved unless the available data supports the explanation.',
      STORE_AND_CLOCK_NOTE,
    ],
  ])('%s', (_case, rule, supporting) => {
    expect(SYSTEM_PROMPT).toContain(rule)
    expect(BASE_CONTEXT).toContain(supporting)
  })

  /**
   * The fourth is pinned as **not** one of them: annualisation is forbidden outright, in the prompt
   * and in the context both, and a later story making it conditional has to come here to do it.
   */
  it('keeps annualisation absolute in the prompt and stated in the context', () => {
    expect(SYSTEM_PROMPT).toContain(
      'Do not derive, add, subtract, average, compound, annualise, estimate, or transform figures',
    )
    expect(SYSTEM_PROMPT).not.toContain('annualise, unless')
    expect(BASE_CONTEXT).toContain(NO_ANNUALISED_NOTE)
  })
})

/**
 * The system prompt, section by section (Story #288 → DDR-0104; reshaped by DDR-0110).
 *
 * **These tests assert presence and can never assert obedience**, which is the seam DDR-0104 exists
 * to state out loud. A figure has two lines of defence — computed by a service, then asserted
 * character by character in the assembled context — and a *sentence* built around a correct figure
 * has only this one. That is acceptable for wording and unacceptable for arithmetic, which is
 * exactly why the arithmetic is #287's and only the wording is here.
 *
 * What each block below pins is a guarantee some record makes: ADR-0009's grounding rule and
 * advisory boundary, ADR-0012's two-standards marking, DDR-0101's three named absences. The prose
 * is the owner's; the guarantees are not, so a rewrite that dropped one has to fail here.
 */
describe('the system prompt states the boundary the records set', () => {
  it('forbids the model from calculating anything', () => {
    expect(SYSTEM_PROMPT).toContain('Do not perform calculations yourself')
    expect(SYSTEM_PROMPT).toContain('Only state numerical results explicitly supplied')
    expect(SYSTEM_PROMPT).toContain(
      'Do not derive, add, subtract, average, compound, annualise, estimate, or transform figures',
    )
  })

  it('licenses naming positions while forbidding orders', () => {
    expect(SYSTEM_PROMPT).toContain('You may suggest positions to consider trimming, increasing')
    expect(SYSTEM_PROMPT).toContain('Recommendations are suggestions, not orders')
    expect(SYSTEM_PROMPT).toContain('You never execute trades')
  })

  it('forbids proposing changes to the profile itself', () => {
    expect(SYSTEM_PROMPT).toContain('Never recommend that the owner change their investor profile')
    expect(SYSTEM_PROMPT).toContain('suggest a profile they should adopt')
  })

  it('requires an unheld instrument to be marked as unverified', () => {
    expect(SYSTEM_PROMPT).toContain('identify it as unverified')
    expect(SYSTEM_PROMPT).toContain("availability at the owner's broker")
    expect(SYSTEM_PROMPT).toContain("subject to the model's knowledge cutoff")
  })

  /**
   * DDR-0013's distinction, which is the failure this Epic is least likely to catch: the wrong
   * answer is the flattering one. A deposit moves value and does not move return.
   */
  it('keeps return and value apart', () => {
    expect(SYSTEM_PROMPT).toContain('Keep portfolio **value** and **return** separate')
    expect(SYSTEM_PROMPT).toContain('Do not attribute changes in value to performance')
  })

  /** The app has no news and no fundamentals, so a cause is a claim it cannot ground. */
  it('forbids attributing a cause the data does not carry', () => {
    expect(SYSTEM_PROMPT).toContain('Do not claim why a market, sector, company, instrument')
    expect(SYSTEM_PROMPT).toContain('unless the available data supports the explanation')
  })

  /**
   * Forecasting, and the shape of the rule matters more than its presence (DDR-0110).
   *
   * A **numeric** forecast was already blocked — *Numerical integrity* forbids the model to
   * `estimate` a figure, and an estimated future figure is an estimate. What was open is the
   * **qualitative** claim: *"well-positioned for the year ahead"* carries no number, so nothing
   * caught it, and it is the one claim the marking discipline cannot reach. An unheld instrument
   * gets labelled as repeated from training data; a forecast has no source to name.
   *
   * So the rule is **not** the old flat "Never forecast". It forbids the model to *produce* one
   * while leaving room for a projection the app computes — the same shape as everything else here,
   * the model phrasing what a service derived (ADR-0009). A blanket prohibition would have
   * foreclosed that feature, which is the owner's reason for wanting this wording rather than the
   * rule it replaces.
   */
  it('forbids the model producing a forecast, without foreclosing a computed projection', () => {
    expect(SYSTEM_PROMPT).toContain('Do not state what will happen')
    expect(SYSTEM_PROMPT).toContain('never produce one of your own')
    // The permitted half, which is what makes this narrower than "Never forecast".
    expect(SYSTEM_PROMPT).toContain('Where the application supplies a projection')
    expect(SYSTEM_PROMPT).toContain('name the assumption it rests on')
    // The numeric half, which was never the gap: an estimated future figure is an estimate.
    expect(SYSTEM_PROMPT).toContain('estimate')
  })

  /**
   * DDR-0101's three named absences, each written out because a summary reaches for it and a model
   * does not experience any of the three as a calculation.
   */
  it('names annualisation, a benchmark and a risk statistic as their own prohibitions', () => {
    expect(SYSTEM_PROMPT).toContain('annualise')
    expect(SYSTEM_PROMPT).toContain(
      'Do not report derived risk statistics such as volatility, standard deviation, Sharpe ratio, beta, or drawdown',
    )
    expect(SYSTEM_PROMPT).toContain(
      'Do not compare the portfolio with benchmarks, indices, markets, or peers',
    )
  })

  /** DDR-0072's rebasing, and DDR-0103's rule that a period the set does not hold is a state. */
  it('states the rebasing and refuses to construct a period the context does not hold', () => {
    expect(SYSTEM_PROMPT).toContain('Returns from different periods are independently rebased')
    expect(SYSTEM_PROMPT).toContain("state each period's length")
    expect(SYSTEM_PROMPT).toContain(
      'If the requested period is unavailable, say so rather than constructing it from other periods',
    )
  })

  it('says what a currency weight is, and is not', () => {
    expect(SYSTEM_PROMPT).toContain(
      'A currency weight describes the currency in which a position is held and priced',
    )
    expect(SYSTEM_PROMPT).toContain('It is not geographic, economic, or revenue exposure')
  })

  /**
   * Tax has no context half and never has (DDR-0104): it is not a section of the grounding but a
   * category of claim about every one of them, so attaching it to one heading would imply the
   * others were exempt. #315 added the costs half beside it.
   */
  it('forbids a tax claim and a net-of-costs claim alike', () => {
    expect(SYSTEM_PROMPT).toContain('Do not claim tax effects, tax efficiency, or tax outcomes')
    expect(SYSTEM_PROMPT).toContain('Do not claim a net benefit after commissions, spreads, taxes')
  })

  /** Both halves of the same refusal: no gap to close, and no standard to close it against. */
  it('makes nothing-to-propose and no-profile answers rather than gaps', () => {
    expect(SYSTEM_PROMPT).toContain('If all supplied targets are within their permitted ranges')
    expect(SYSTEM_PROMPT).toContain('do not manufacture a rebalancing recommendation')
    expect(SYSTEM_PROMPT).toContain('If no profile is configured, say so')
    expect(SYSTEM_PROMPT).toContain('Assistant profile section')
    // The Profile view has not existed since Story #310, and a prompt naming it would send the
    // owner looking for a sidebar row that is not there (DDR-0108).
    expect(SYSTEM_PROMPT).not.toContain('Profile view')
  })

  /**
   * ADR-0012's central line. The app may hold a standard for what the owner left silent, and it may
   * never invent one beyond that — the two halves have to appear together or the section licenses
   * more than the record does.
   */
  it('permits a baseline judgement and refuses any standard of the model’s own', () => {
    expect(SYSTEM_PROMPT).toContain("the owner's configured investor profile")
    expect(SYSTEM_PROMPT).toContain(
      "the application's stated baseline, and only on dimensions that baseline covers",
    )
    expect(SYSTEM_PROMPT).toContain('Never invent your own investment standard')
  })

  /**
   * ADR-0009 names *the marking becoming decoration* as this mitigation's own failure mode, so the
   * basis goes **beside** the claim rather than once at the end. It is the one sentence that keeps
   * a computed verdict, a baseline verdict and a repeated claim from arriving in the same voice.
   */
  it('requires the basis of a claim beside the claim', () => {
    expect(SYSTEM_PROMPT).toContain(
      'When a claim depends on a particular source or standard, make that basis clear beside the claim',
    )
    expect(SYSTEM_PROMPT).toContain('Distinguish between')
    expect(SYSTEM_PROMPT).toContain('application-computed facts')
    expect(SYSTEM_PROMPT).toContain('model knowledge')
  })

  it('refuses to invent what is missing', () => {
    expect(SYSTEM_PROMPT).toContain('Never invent missing information')
    expect(SYSTEM_PROMPT).toContain('If required information is unavailable, say so')
    expect(SYSTEM_PROMPT).toContain('Never pretend to know more than the available data supports')
  })
})

describe('the prompt is a declared structure, not a template string', () => {
  /**
   * The count, stated here and in DDR-0110 and CLAUDE.md.
   *
   * DDR-0104's mechanism, carried across the change of shape. Its point was never the flatness of
   * the list — it was that the literal is **declared**, so growing the prompt is a decision rather
   * than an edit. A ninth section has to come here, find this number and change it, exactly as an
   * eighteenth rule did.
   *
   * Both halves are counted. The array is the declaration; the headings are what actually reaches
   * the model, and a section appended around the array would otherwise be invisible.
   */
  it('is eight sections, in the array and in the text the model reads', () => {
    expect(SYSTEM_PROMPT_SECTIONS).toHaveLength(8)
    expect(SECTION_HEADINGS).toHaveLength(8)
    expect(SYSTEM_PROMPT.split('\n').filter((line) => line.startsWith('## '))).toHaveLength(8)
  })

  /** The declaration and the rendered text name the same sections, in the same order. */
  it('renders exactly the headings it declares, in order', () => {
    expect(SYSTEM_PROMPT_SECTIONS.map((section) => section.heading)).toEqual([...SECTION_HEADINGS])
    expect(
      SYSTEM_PROMPT.split('\n')
        .filter((line) => line.startsWith('## '))
        .map((line) => line.slice(3)),
    ).toEqual([...SECTION_HEADINGS])
  })

  /** No section is empty, and none carries the `##` the renderer adds — a `## ## ` would show. */
  it('gives every declared section a heading and a body of its own', () => {
    for (const section of SYSTEM_PROMPT_SECTIONS) {
      expect(section.heading.trim()).not.toBe('')
      expect(section.body.trim()).not.toBe('')
      expect(section.heading.startsWith('#')).toBe(false)
      expect(SYSTEM_PROMPT).toContain(`\n## ${section.heading}\n\n${section.body}`)
    }
  })

  /** The preamble is outside every section, and opens the prompt. */
  it('opens with the preamble, above the first heading', () => {
    expect(SYSTEM_PROMPT.startsWith(SYSTEM_PROMPT_PREAMBLE)).toBe(true)
    expect(SYSTEM_PROMPT.indexOf('## Source of truth')).toBeGreaterThan(
      SYSTEM_PROMPT_PREAMBLE.length,
    )
  })
})
