import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  consentLine,
  disclosureRows,
  gateKind,
  granularitySummary,
  isDecision,
  GATE_ACTIONS,
  GATE_BODIES,
  GATE_HEADINGS,
  type GateKind,
} from './assistantGate'
import {
  DISCLOSURE_CATEGORIES,
  DISCLOSURE_CATEGORY_IDS,
  DISCLOSURE_DESTINATION,
  disclosureFingerprint,
  disclosedGranularities,
} from '@shared/domain/assistantDisclosure'
import type { AssistantStatus } from '@shared/domain/assistant'

/**
 * The consent gate's wording and its disclosure (Story #283, DDR-0097).
 *
 * This is the moment a local-first app stops being local-first, and the story's rule is that the
 * wording **states plainly that data leaves the machine and where it goes; it does not soften that
 * into a benefit.** A rule about prose is worth nothing unless something holds it, and Vitest runs
 * Node-only (DDR-0029), so the prose lives out of the component and this is what holds it.
 *
 * The second half is the disclosure's honesty: what the owner reads, what a context may carry, and
 * what their consent is recorded against all come from **one constant**, and the assertions below
 * are what fail if a later story separates them.
 */

const status = (over: Partial<AssistantStatus> = {}): AssistantStatus => ({
  state: 'needs_consent',
  consented: false,
  consentedAt: null,
  consentStale: false,
  configured: false,
  ...over,
})

const ALL_KINDS: GateKind[] = ['first_consent', 're_consent', 'not_configured', 'ready']

describe('which panel the owner sees', () => {
  it.each([
    ['nothing decided yet', status(), 'first_consent'],
    ['a key present but no decision', status({ configured: true }), 'first_consent'],
    [
      'consent given against an older list',
      status({ consented: false, consentStale: true, consentedAt: 1, configured: true }),
      're_consent',
    ],
    ['consent given but no key', status({ consented: true, consentedAt: 1 }), 'not_configured'],
    [
      'consent given and a key present',
      status({ consented: true, consentedAt: 1, configured: true }),
      'ready',
    ],
  ])('shows %s as %s', (_case, state, expected) => {
    expect(gateKind(state)).toBe(expected)
  })

  /**
   * Staleness outranks everything, including a missing key. An owner whose disclosure changed is
   * being asked to re-read a list; telling them about a key first would answer a question they
   * did not ask.
   */
  it('reports a changed list even when a key is also missing', () => {
    expect(gateKind(status({ consentStale: true, configured: false }))).toBe('re_consent')
  })

  /** Re-consent is not first consent — one asks, the other reports that the answer expired. */
  it('keeps re-consent distinct from first consent', () => {
    expect(GATE_HEADINGS.re_consent).not.toBe(GATE_HEADINGS.first_consent)
    expect(GATE_BODIES.re_consent).not.toBe(GATE_BODIES.first_consent)
    expect(GATE_ACTIONS.re_consent).not.toBe(GATE_ACTIONS.first_consent)
  })

  it('offers an action only where there is a decision to make', () => {
    expect(GATE_ACTIONS.first_consent).not.toBeNull()
    expect(GATE_ACTIONS.re_consent).not.toBeNull()
    expect(GATE_ACTIONS.not_configured).toBeNull()
    expect(GATE_ACTIONS.ready).toBeNull()
    expect(ALL_KINDS.filter(isDecision)).toEqual(['first_consent', 're_consent'])
  })

  it('has a heading and a body for every state, so none can render blank', () => {
    for (const kind of ALL_KINDS) {
      expect(GATE_HEADINGS[kind].length).toBeGreaterThan(0)
      expect(GATE_BODIES[kind].length).toBeGreaterThan(0)
    }
  })
})

/**
 * The wording rule, held rather than hoped for. "Your portfolio data may be sent to OpenAI" is a
 * shrug; what the owner needs is the fact, the destination, and no benefit offered in the same
 * breath to balance it out.
 */
describe('the wording does not soften what is happening', () => {
  it('says the data leaves the machine, in those terms', () => {
    expect(GATE_BODIES.first_consent).toMatch(/sends? .*to OpenAI/)
    expect(GATE_BODIES.first_consent).toContain('stays on your computer')
  })

  it('names the destination, rather than implying one', () => {
    expect(DISCLOSURE_DESTINATION).toContain('OpenAI')
    expect(DISCLOSURE_DESTINATION).toContain('United States')
  })

  /**
   * No benefit in the consent copy. The benefit is why the owner opened this view; the cost is
   * what this panel exists to state, and pairing them is how a disclosure becomes a sales pitch.
   */
  it.each(['first_consent', 're_consent'] as const)(
    'offers no benefit alongside the cost in the %s copy',
    (kind) => {
      expect(GATE_BODIES[kind]).not.toMatch(/better|smarter|powerful|insight|unlock|helps you/i)
    },
  )

  /** Refusable and revocable, said in the copy rather than only implemented. */
  it('tells the owner the decision is theirs and reversible', () => {
    expect(GATE_BODIES.first_consent).toContain('Nothing is sent until you allow it')
    expect(GATE_BODIES.first_consent).toContain('withdraw')
    expect(GATE_BODIES.re_consent).toContain('Nothing is being sent in the meantime')
  })

  /** A missing key is an instruction, not a question — and it names the variable to set. */
  it('tells the owner what to do about a missing key', () => {
    expect(GATE_BODIES.not_configured).toContain('OPENAI_API_KEY')
  })
})

describe('the disclosure is specific', () => {
  /** Every category names what is sent, not a category of feeling about it. */
  it('gives every category a title and a detail', () => {
    for (const category of DISCLOSURE_CATEGORIES) {
      expect(category.title.length).toBeGreaterThan(0)
      expect(category.detail.length).toBeGreaterThan(10)
    }
  })

  /**
   * The finding the story invited: **most of this Epic works on weights**, and a weight is
   * meaningfully less disclosing than a balance. Three of five categories send percentages or
   * text only, and the disclosure says which — see DDR-0097.
   */
  it('marks which categories involve amounts of money and which do not', () => {
    const byGranularity = DISCLOSURE_CATEGORIES.filter((c) => c.granularity === 'figures')

    expect(byGranularity.map((c) => c.id)).toEqual(['performance'])
    expect(DISCLOSURE_CATEGORIES.find((c) => c.id === 'weights')?.detail).toContain(
      'No amounts of money',
    )
  })

  it('summarises the granularities actually present, rather than a written-out list', () => {
    expect(granularitySummary()).toBe(
      disclosedGranularities()
        .map((g) => ({ names: 'names and text', weights: 'percentages only', figures: 'amounts of money' })[g])
        .join(' · '),
    )
  })

  /** Declaration order, never filtered — a category cannot be hidden from the panel. */
  it('renders every declared category', () => {
    expect(disclosureRows()).toHaveLength(DISCLOSURE_CATEGORIES.length)
    expect(disclosureRows().map((c) => c.id)).toEqual([...DISCLOSURE_CATEGORY_IDS])
  })
})

/**
 * Consent is to a **specific** disclosure. The fingerprint is what makes that true, so what it
 * covers is worth pinning: change what a category sends, and the owner is asked again.
 */
describe('the fingerprint tracks what is actually disclosed', () => {
  const CATEGORIES = [...DISCLOSURE_CATEGORIES]

  it('changes when a category is added', () => {
    const extra = [
      ...CATEGORIES,
      { id: 'trades', title: 'Your trades', detail: 'Every buy and sell.', granularity: 'figures' },
    ] as const
    expect(disclosureFingerprint(extra)).not.toBe(disclosureFingerprint())
  })

  it('changes when a category is removed', () => {
    expect(disclosureFingerprint(CATEGORIES.slice(1))).not.toBe(disclosureFingerprint())
  })

  /**
   * The detail is part of it, not just the id. Re-wording what a category *sends* is exactly the
   * change an owner would want to see again, and a fingerprint over ids alone would miss it.
   */
  it('changes when what a category sends is re-described', () => {
    const reworded = CATEGORIES.map((c) =>
      c.id === 'weights' ? { ...c, detail: 'Weights, and also every balance.' } : c,
    )
    expect(disclosureFingerprint(reworded)).not.toBe(disclosureFingerprint())
  })

  it('changes when a category becomes more disclosing', () => {
    const widened = CATEGORIES.map((c) =>
      c.id === 'weights' ? { ...c, granularity: 'figures' as const } : c,
    )
    expect(disclosureFingerprint(widened)).not.toBe(disclosureFingerprint())
  })

  it('is stable for an unchanged list', () => {
    expect(disclosureFingerprint(CATEGORIES)).toBe(disclosureFingerprint())
  })
})

describe('consentLine', () => {
  const on = (at: number): string => `date(${at})`

  it('says nothing before a decision has been made', () => {
    expect(consentLine(status(), on)).toBeNull()
  })

  it('reports when consent was given', () => {
    expect(consentLine(status({ consented: true, consentedAt: 5 }), on)).toBe(
      'You allowed this on date(5).',
    )
  })

  /** Stale consent is reported as being about an *earlier version*, not as current permission. */
  it('says a stale consent covered an earlier list', () => {
    expect(consentLine(status({ consentStale: true, consentedAt: 5 }), on)).toContain(
      'an earlier version',
    )
  })
})

/**
 * The composition half, the shape `analyticsShell.test.ts` and `profileView.test.ts` use: the view
 * must render the disclosure **from the constant** rather than writing it out, or the panel and
 * the fingerprint stop describing the same thing.
 */
describe('the view renders the disclosure rather than restating it', () => {
  const strip = (code: string): string =>
    code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const VIEW = strip(
    readFileSync(new URL('../components/AssistantView.tsx', import.meta.url), 'utf8'),
  )

  it('maps over the declared categories', () => {
    expect(VIEW).toContain('disclosureRows().map')
  })

  it('quotes none of the category text', () => {
    for (const category of DISCLOSURE_CATEGORIES) {
      expect(VIEW).not.toContain(category.title)
      expect(VIEW).not.toContain(category.detail)
    }
    expect(VIEW).not.toContain(DISCLOSURE_DESTINATION)
  })

  /** The gate's own copy is in `lib/` for the same reason, so a test can hold the wording rule. */
  it('quotes none of the gate copy', () => {
    for (const body of Object.values(GATE_BODIES)) expect(VIEW).not.toContain(body)
    for (const heading of Object.values(GATE_HEADINGS)) expect(VIEW).not.toContain(heading)
  })

  /** No question box, and nothing that could reach OpenAI: that is #284's story, not this one. */
  it('offers no way to ask anything yet', () => {
    expect(VIEW).not.toMatch(/<textarea/i)
    expect(VIEW).not.toContain('window.api.ask')
    expect(VIEW).not.toMatch(/\bfetch\(/)
    expect(VIEW.toLowerCase()).not.toContain('api.openai.com')
  })

  /** Withdrawing is the in-place confirm — no modal, no `window.confirm` (DDR-0012). */
  it('withdraws through the shared in-place confirm', () => {
    expect(VIEW).toContain('<ConfirmAction')
    expect(VIEW).not.toContain('window.confirm')
    expect(VIEW).not.toContain('<dialog')
  })
})
