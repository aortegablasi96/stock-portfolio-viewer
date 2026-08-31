import { describe, expect, it } from 'vitest'
import {
  ASK_BLOCKERS,
  FAILURE_HEADINGS,
  STALE_NOTE,
  TRUNCATED_NOTE,
  answerFromResult,
  askGate,
  askLabel,
  groundingNotices,
  hasAnyGrounding,
  isAskable,
  isStale,
  type Turn,
} from './assistantAsk'
import type { GroundingReports } from './assistantContext'
import type { PerformanceReport } from '@shared/domain/performance'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import { aiResultSchema, type AssistantStatus } from '@shared/domain/assistant'

/**
 * The question box's states (Story #284, DDR-0098; narrowed by Story #309, ADR-0011).
 *
 * The story's criterion is that **every blocking state is named specifically and calmly, and none
 * is presented as an error**. That is wording, and wording is what drifts, so this is where it is
 * pinned — the component it is rendered in is unreachable from Vitest (DDR-0029).
 *
 * The distinction the file exists to hold is *blocking* versus *missing*. The key stops a question;
 * an empty Flex store and an unset profile do not — they narrow what an answer can be grounded in,
 * and the owner is told which before reading an answer shaped by the gap. The two consent blockers
 * that used to come before the key are gone with the concept.
 */

const PROFILE: InvestorProfile = {
  ...EMPTY_INVESTOR_PROFILE,
  currencyTargets: [{ key: 'USD', low: 30, high: 50 }],
}

const status = (over: Partial<AssistantStatus> = {}): AssistantStatus => ({
  state: 'ready',
  keySource: 'environment',
  keyStored: false,
  ...over,
})

const grounding = (over: Partial<GroundingReports> = {}): GroundingReports => ({
  allocation: { status: 'needs_import' },
  profile: PROFILE,
  drift: { status: 'no_data' },
  performance: { status: 'needs_import' },
  ...over,
})

/** A minimal performance report whose history is one week of two days (Story #285). */
const performanceReport = (over: Partial<PerformanceReport> = {}): PerformanceReport => ({
  baseCurrency: 'EUR',
  valueSeries: [
    { date: Date.UTC(2026, 0, 5), value: 100_000 },
    { date: Date.UTC(2026, 0, 6), value: 101_000 },
  ],
  compositionSeries: { bands: [], points: [] },
  returnSeries: [
    { date: Date.UTC(2026, 0, 5), value: 0 },
    { date: Date.UTC(2026, 0, 6), value: 1 },
  ],
  periods: [],
  startingValue: 100_000,
  endingValue: 101_000,
  cumulativeTwr: 1,
  totalDepositsWithdrawals: 0,
  totalRealizedPnl: 0,
  totalUnrealizedPnl: 0,
  ...over,
})

describe('askGate', () => {
  /**
   * The one blocker left in front of a question (ADR-0011). The two consent states that used to
   * precede it are gone, and the key is what a question cannot go without.
   */
  it('names the missing key, and points at the field above', () => {
    const gate = askGate(status({ state: 'not_configured', keySource: 'none' }), grounding())
    expect(gate.kind).toBe('not_configured')
    expect(gate.ready).toBe(false)
    expect(gate.blocker).toBe(ASK_BLOCKERS.not_configured)
    expect(gate.blocker).toContain('no API key')
  })

  /**
   * Order is the criterion, over the two facts that are left: a key the owner has not pasted comes
   * before data they have not imported, because telling someone to import a statement while nothing
   * can be sent at all answers a question they did not ask.
   */
  it('reports the missing key before the missing grounding', () => {
    const gate = askGate(
      status({ state: 'not_configured', keySource: 'none' }),
      grounding({ profile: EMPTY_INVESTOR_PROFILE }),
    )
    expect(gate.kind).toBe('not_configured')
  })

  /** No consent state survives — asserted as an absence so one cannot quietly return. */
  it('has a blocker sentence for every kind it can report, and only those kinds', () => {
    expect(Object.keys(ASK_BLOCKERS).sort()).toEqual(['no_grounding', 'not_configured', 'ready'])
  })

  it('is a wait, not a blocker, while the grounding is still being read', () => {
    const gate = askGate(status(), null)
    expect(gate.ready).toBe(false)
    expect(gate.blocker).toBeNull()
  })

  /**
   * The one gap that does block: nothing imported, nothing live, no profile. There is then no
   * context at all, and an answer would come from training data alone — the one thing ADR-0009
   * says an answer must never quietly be.
   */
  it('blocks when there is nothing at all to ground an answer in', () => {
    const gate = askGate(status(), grounding({ profile: EMPTY_INVESTOR_PROFILE }))
    expect(gate.kind).toBe('no_grounding')
    expect(gate.ready).toBe(false)
    expect(gate.blocker).toContain('nothing for an answer to be grounded in')
  })

  it.each([
    ['imported history', { allocation: { status: 'ok' } as never }],
    ['a stated profile', {}],
  ])('allows the question once there is %s', (_name, over) => {
    const gate = askGate(status(), grounding(over))
    expect(gate.ready).toBe(true)
    expect(gate.blocker).toBeNull()
  })

  it('never returns a blocker sentence for a gate that is ready', () => {
    expect(ASK_BLOCKERS.ready).toBeNull()
  })
})

describe('hasAnyGrounding', () => {
  it('counts a live drift report on its own', () => {
    expect(
      hasAnyGrounding(grounding({ profile: EMPTY_INVESTOR_PROFILE, drift: { status: 'ok' } as never })),
    ).toBe(true)
  })

  /** An imported history is grounding in its own right: it is what an explanation is made of. */
  it('counts an imported performance history on its own', () => {
    expect(
      hasAnyGrounding(
        grounding({
          profile: EMPTY_INVESTOR_PROFILE,
          performance: { status: 'ok', report: performanceReport() },
        }),
      ),
    ).toBe(true)
  })

  it('is false only when every source is absent', () => {
    expect(hasAnyGrounding(grounding({ profile: EMPTY_INVESTOR_PROFILE }))).toBe(false)
  })
})

describe('groundingNotices', () => {
  it('says the assistant cannot see holdings when nothing is imported, and where to fix it', () => {
    const notice = groundingNotices(grounding()).find((n) => n.id === 'no_import')
    expect(notice?.text).toContain('No Flex statements are imported')
    expect(notice?.text).toContain('Portfolio view')
  })

  it('says there is no standard to judge balance against when no profile is set', () => {
    const notices = groundingNotices(grounding({ profile: EMPTY_INVESTOR_PROFILE }))
    expect(notices.map((n) => n.id)).toContain('no_profile')
  })

  it('drops the import notice once a report has arrived', () => {
    const notices = groundingNotices(grounding({ allocation: { status: 'ok' } as never }))
    expect(notices.map((n) => n.id)).not.toContain('no_import')
  })

  /**
   * DDR-0022 keeps `not_connected` and `not_responding` apart because their *recovery* differs.
   * Here it does not: either way the drift section is simply not in front of the model, so one
   * sentence covers both, and the Portfolio view remains where the gateway states are reported in
   * their own right.
   */
  it.each(['not_connected', 'not_responding'] as const)(
    'reports a %s gateway as one missing section rather than two states',
    (gatewayStatus) => {
      const notices = groundingNotices(
        grounding({ drift: { status: gatewayStatus, message: 'x' } }),
      )
      const live = notices.find((n) => n.id === 'no_live')
      expect(live?.text).toContain('not answering')
    },
  )

  /** A missing profile and an unreachable gateway are not two notices about the same hole. */
  it('does not report an unreachable gateway when there is no profile to measure against anyway', () => {
    const notices = groundingNotices(
      grounding({ profile: EMPTY_INVESTOR_PROFILE, drift: { status: 'not_connected', message: 'x' } }),
    )
    expect(notices.map((n) => n.id)).toEqual(['no_import', 'no_profile'])
  })

  it('says nothing at all once every source is readable', () => {
    expect(
      groundingNotices(
        grounding({ allocation: { status: 'ok' } as never, drift: { status: 'ok' } as never }),
      ),
    ).toEqual([])
  })

  /**
   * #285's `empty_period` notice went with the control it was about (DDR-0102).
   *
   * It said "the period selected above holds no day of imported history", and nothing is selected
   * above any more: the grounding is the whole history, which cannot be empty while the report
   * resolves at all. Pinned as an **absence** rather than deleted silently, because the underlying
   * state is not gone — `periodChange` still reports a window with no day in it, and #287 windows
   * this report again — so a notice for it may come back, and it should come back deliberately.
   */
  it('raises no period notice, the control it belonged to having gone', () => {
    const notices = groundingNotices(
      grounding({
        allocation: { status: 'ok' } as never,
        drift: { status: 'ok' } as never,
        performance: { status: 'ok', report: performanceReport() },
      }),
    )
    expect(notices.map((n) => n.id)).not.toContain('empty_period')
  })

  it('says nothing about the period when the history holds data', () => {
    const notices = groundingNotices(
      grounding({
        allocation: { status: 'ok' } as never,
        drift: { status: 'ok' } as never,
        performance: { status: 'ok', report: performanceReport() },
      }),
    )
    expect(notices).toEqual([])
  })

  /** One absence, one notice: with nothing imported there is no period to be empty. */
  it('does not add a period notice on top of the import notice', () => {
    const notices = groundingNotices(grounding({ profile: EMPTY_INVESTOR_PROFILE }))
    expect(notices.map((n) => n.id)).toEqual(['no_import', 'no_profile'])
  })
})

describe('answerFromResult', () => {
  it('carries the answer through, trimmed', () => {
    const answer = answerFromResult({
      status: 'ok',
      answer: { text: '  Your largest position is AAPL.  ', model: 'gpt-4.1-mini', truncated: false, usage: null },
    })
    expect(answer).toEqual({ kind: 'answered', text: 'Your largest position is AAPL.', truncated: false })
  })

  it('reports a truncated answer as truncated, rather than as a complete one', () => {
    const answer = answerFromResult({
      status: 'ok',
      answer: { text: 'It begins', model: 'gpt-4.1-mini', truncated: true, usage: null },
    })
    expect(answer).toEqual({ kind: 'answered', text: 'It begins', truncated: true })
    expect(TRUNCATED_NOTE).toContain('stops mid-thought')
  })

  /**
   * A 200 with nothing in it is `invalid` at the gateway (DDR-0096); this is the second guard on
   * the same claim. An empty bubble under a question reads as the assistant having nothing to say
   * rather than as a failure.
   */
  it('refuses to present an empty answer as an answer', () => {
    const answer = answerFromResult({
      status: 'ok',
      answer: { text: '   ', model: 'gpt-4.1-mini', truncated: false, usage: null },
    })
    expect(answer.kind).toBe('failed')
  })

  it('carries the gateway’s own message through rather than replacing it', () => {
    const answer = answerFromResult({ status: 'not_responding', message: 'It went quiet.' })
    expect(answer).toEqual({
      kind: 'failed',
      heading: FAILURE_HEADINGS.not_responding,
      text: 'It went quiet.',
    })
  })

  /**
   * The distinction ADR-0010 exists to keep clear. `too_large` means **nothing was sent**, and
   * presenting it as a refusal would tell the owner OpenAI rejected their portfolio when in fact
   * it never left the machine.
   */
  it('says nothing left the machine when the request was too large', () => {
    expect(FAILURE_HEADINGS.too_large).toContain('nothing left this machine')
    expect(FAILURE_HEADINGS.too_large).not.toBe(FAILURE_HEADINGS.refused)
  })

  /**
   * The other half of that distinction, and the reason `incomplete` is its own state rather than a
   * second use of `too_large` (Story #324, DDR-0111). By the time a tool loop can run out of room,
   * rounds have gone out — so this heading must not repeat the claim that nothing was sent, and it
   * must not read as an answer either.
   */
  it('says an answer is missing when the loop ran out of room, not that nothing was sent', () => {
    expect(FAILURE_HEADINGS.incomplete).toContain('No answer')
    expect(FAILURE_HEADINGS.incomplete).not.toContain('nothing left this machine')
    expect(FAILURE_HEADINGS.incomplete).not.toBe(FAILURE_HEADINGS.too_large)
  })

  /**
   * The failure headings and the gateway's own variants are one list — and after ADR-0011 they are
   * the *same* list, with nothing decided in front of the gateway. A status added to the gateway
   * without a heading here would render an answer under `undefined`; a heading left behind for a
   * status the gateway cannot produce is the other half, and `needs_consent` is the one this story
   * removed.
   */
  it('has exactly one heading per way the exchange can end', () => {
    const statuses = aiResultSchema.options
      .map((option) => option.shape.status.value)
      .filter((value) => value !== 'ok')
    expect(Object.keys(FAILURE_HEADINGS).sort()).toEqual([...statuses].sort())
  })

  it('names no failure as an error except the one that is one', () => {
    expect(FAILURE_HEADINGS.not_configured).toBe('No API key')
    expect(FAILURE_HEADINGS.not_configured.toLowerCase()).not.toContain('error')
  })
})

describe('isStale', () => {
  const turn = (groundedAt: number): Turn => ({
    id: 1,
    question: 'q',
    groundedAt,
    answer: { kind: 'answered', text: 'a', truncated: false },
  })

  /**
   * DDR-0027's consequence, reaching a transcript. The view stays mounted, so an answer outlives
   * the import that replaces the figures under it. It is labelled rather than deleted: it was true
   * when it was given.
   */
  it('marks a turn grounded before the store moved', () => {
    expect(isStale(turn(0), 1)).toBe(true)
    expect(isStale(turn(1), 1)).toBe(false)
  })

  it('says the figures are no longer current, and what to do about it', () => {
    expect(STALE_NOTE).toContain('no longer current')
    expect(STALE_NOTE).toContain('Ask again')
  })
})

describe('the question itself', () => {
  it('does not treat whitespace as a question', () => {
    expect(isAskable('   \n ')).toBe(false)
    expect(isAskable('Am I balanced?')).toBe(true)
  })

  it('reports the request the button started', () => {
    expect(askLabel(false)).toBe('Ask')
    expect(askLabel(true)).toBe('Asking…')
    expect(askLabel(true)).not.toContain('...')
  })
})
