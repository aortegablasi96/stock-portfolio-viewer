import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_MOVES,
  MAX_LISTED_POSITIONS,
  buildAssistantContext,
  hasProfile,
  holdingsSection,
  measuredDrift,
  performanceSection,
  profileSection,
  weightsSection,
  wholeHistory,
  type GroundingReports,
} from './assistantContext'
import { periodChange, type PeriodChange, type PeriodSelection } from './periodChange'
import type { PerformanceReport } from '@shared/domain/performance'
import { DISCLOSURE_CATEGORY_IDS } from '@shared/domain/assistantDisclosure'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import type { AllocationPosition, AllocationReport } from '@shared/domain/allocation'
import type {
  BalanceDriftReport,
  BaselineReview,
  DriftBand,
  DriftMove,
} from '@shared/domain/balanceDrift'
import { BASELINE_CHECKS, BASELINE_VERSION } from '@shared/domain/portfolioBaseline'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'

/**
 * The grounding (Story #284, DDR-0098).
 *
 * **This file is the Epic's largest correctness risk written down as assertions.** ADR-0009 says
 * the model never produces a figure, and that sentence is only true if something else produces
 * every one of them. Here is that something, and the tests below are less about formatting than
 * about four properties the feature is unsafe without:
 *
 * 1. A section carries **no more than its disclosure allows** — no money in `holdings`, `weights`
 *    or `profile`, whatever the reports contain.
 * 2. **Absent is absent, never zero** — a report that could not be read produces no section, and
 *    an unconvertible holding is never given a weight (DDR-0007).
 * 3. Every figure goes through the **app's own formatters**, so prose and dashboard agree.
 * 4. A section **says which store and which clock it came from**, because the composition sections
 *    read imported Flex history and drift reads the live portfolio.
 */

function position(over: Partial<AllocationPosition> = {}): AllocationPosition {
  return {
    conid: 1,
    symbol: 'AAPL',
    description: 'APPLE INC',
    assetCategory: 'STK',
    currency: 'USD',
    issuerCountry: 'US',
    sector: 'Technology',
    industry: 'Computers',
    marketValueBase: 12_345.67,
    costBasisBase: 10_000,
    unrealizedPnlBase: 2_345.67,
    percentOfNav: 24.5,
    ...over,
  }
}

function report(over: Partial<AllocationReport> = {}): AllocationReport {
  return {
    baseCurrency: 'EUR',
    reportDate: Date.UTC(2026, 6, 31),
    totalMarketValueBase: 50_000,
    positions: [position()],
    byAssetClass: [{ key: 'STK', label: 'Stocks', marketValueBase: 40_000, percentOfNav: 80 }],
    byCurrency: [{ key: 'USD', label: 'USD', marketValueBase: 30_000, percentOfNav: 60 }],
    byCountry: [{ key: 'US', label: 'United States', marketValueBase: 30_000, percentOfNav: 60 }],
    bySector: [{ key: 'Technology', label: 'Technology', marketValueBase: 20_000, percentOfNav: 40 }],
    unclassifiedCount: 0,
    ...over,
  }
}

/**
 * The baseline `PROFILE` would actually produce (Story #315, ADR-0012).
 *
 * `PROFILE` states currency targets and a position ceiling and nothing about sectors or asset
 * classes, which is the shape almost every real profile has - so `position` defers to the owner and
 * the other three run. The fixture is that state rather than a convenient one, because "the profile
 * wins where it speaks" is the property most of these assertions are about.
 */
function baseline(over: Partial<BaselineReview> = {}): BaselineReview {
  return {
    version: BASELINE_VERSION,
    applied: ['sector', 'cash', 'coverage'],
    deferred: ['position'],
    ceilings: [
      {
        check: 'sector',
        key: 'Technology',
        label: 'Technology',
        name: null,
        actual: 41.5,
        limit: 30,
        status: 'above',
        distance: 11.5,
        bounded: false,
      },
      {
        check: 'cash',
        key: CASH_ASSET_KEY,
        label: 'Cash',
        name: null,
        actual: 5,
        limit: 15,
        status: 'inside',
        distance: 0,
        bounded: false,
      },
    ],
    absentAssetClasses: [{ key: 'BOND', label: 'Bonds' }],
    sectorsHeld: 3,
    withinBaseline: false,
    ...over,
  }
}

function drift(over: Partial<BalanceDriftReport> = {}): BalanceDriftReport {
  return {
    displayCurrency: 'EUR',
    readAt: Date.UTC(2026, 7, 28, 9, 15),
    placedValue: 50_000,
    dimensions: [
      {
        dimension: 'currency',
        bands: [
          {
            key: 'USD',
            label: 'USD',
            actual: 60,
            low: 30,
            high: 50,
            status: 'above',
            distance: 10,
            // Sized by `driftMoves` in the service; here it is the shape the section renders
            // (Story #287). Ten points out of two positions, and the band lands on its edge.
            move: {
              direction: 'trim',
              points: 10,
              contributors: [
                {
                  symbol: 'AAPL',
                  name: 'Apple Inc',
                  weight: 40,
                  points: 8,
                  resultingWeight: 32,
                },
                { symbol: 'MSFT', name: null, weight: 10, points: 2, resultingWeight: 8 },
              ],
              uncovered: 0,
              ceilingLimited: false,
              candidates: 4,
            },
          },
        ],
        residuals: [{ kind: 'cash', label: 'Cash', weight: 5 }],
        untargeted: 35,
      },
    ],
    position: null,
    unplaced: { positions: 0, cashBalances: 0, currencies: [], nativeTotals: [] },
    baseline: baseline(),
    balanced: false,
    ...over,
  }
}

/** One currency band and its move, for the cases that are about the move alone. */
function bandOf(band: Partial<DriftBand>, move: DriftMove | null): BalanceDriftReport {
  return drift({
    dimensions: [
      {
        dimension: 'currency',
        bands: [
          {
            key: 'USD',
            label: 'USD',
            actual: 60,
            low: 30,
            high: 50,
            status: 'above',
            distance: 10,
            ...band,
            move,
          },
        ],
        residuals: [],
        untargeted: 0,
      },
    ],
  })
}

const PROFILE: InvestorProfile = {
  styleTags: ['dividend_income'],
  currencyTargets: [{ key: 'USD', low: 30, high: 50 }],
  sectorTargets: [],
  assetClassTargets: [],
  positionSize: { low: 0, high: 15 },
  updatedAt: Date.UTC(2026, 7, 1),
}

/**
 * A history of four days across two statement periods, with a deposit that moves value and not
 * return (Story #285). Every figure below is chosen so the two can be told apart in an assertion:
 * value rises 24.5% while the return curve rises 2%.
 */
const DAY = [
  Date.UTC(2026, 4, 29),
  Date.UTC(2026, 5, 1),
  Date.UTC(2026, 5, 2),
  Date.UTC(2026, 5, 3),
] as const

function performance(over: Partial<PerformanceReport> = {}): PerformanceReport {
  return {
    baseCurrency: 'EUR',
    valueSeries: [
      { date: DAY[0], value: 100_000 },
      { date: DAY[1], value: 101_000 },
      { date: DAY[2], value: 121_000 },
      { date: DAY[3], value: 124_500 },
    ],
    returnSeries: [
      { date: DAY[0], value: 0 },
      { date: DAY[1], value: 1 },
      { date: DAY[2], value: 0.5 },
      { date: DAY[3], value: 2 },
    ],
    compositionSeries: {
      bands: [
        { key: 'stock', label: 'Stocks' },
        { key: 'cash', label: 'Cash' },
      ],
      points: [
        { date: DAY[0], total: 100_000, values: [90_000, 10_000] },
        { date: DAY[3], total: 124_500, values: [110_000, 14_500] },
      ],
    },
    periods: [
      {
        fromDate: Date.UTC(2026, 4, 1),
        toDate: Date.UTC(2026, 4, 31),
        startingValue: 95_000,
        endingValue: 100_000,
        mtm: 5_000,
        depositsWithdrawals: 0,
        dividends: 300,
        withholdingTax: -45,
        interest: 5,
        commissions: 12,
        twr: 5,
      },
      {
        fromDate: Date.UTC(2026, 5, 1),
        toDate: Date.UTC(2026, 5, 30),
        startingValue: 100_000,
        endingValue: 124_500,
        mtm: 4_500,
        depositsWithdrawals: 20_000,
        dividends: 900,
        withholdingTax: -135,
        interest: 5,
        commissions: 33,
        twr: 2,
      },
    ],
    startingValue: 100_000,
    endingValue: 124_500,
    cumulativeTwr: 2,
    totalDepositsWithdrawals: 20_000,
    totalRealizedPnl: 4_300,
    totalUnrealizedPnl: 12_000,
    ...over,
  }
}

const inputs = (over: Partial<GroundingReports> = {}): GroundingReports => ({
  allocation: { status: 'ok', report: report() },
  profile: PROFILE,
  drift: { status: 'ok', report: drift() },
  performance: { status: 'ok', report: performance() },
  ...over,
})

/**
 * A `PeriodChange` over the fixture, for the section tests below.
 *
 * It resolves through `periodChange` directly rather than through the grounding, because the
 * grounding no longer carries a window: DDR-0102 removed the control that chose one, so
 * `wholeHistory` is the only window the assembled context has. `performanceSection` is still a
 * function of *any* period — that is what #287 windows this report with — so the section tests keep
 * naming their own, and the two that pass a narrower one are testing the section, not the view.
 */
const change = (
  over: { period?: PeriodSelection; report?: PerformanceReport } = {},
): PeriodChange => {
  const resolved = periodChange(
    over.report ?? performance(),
    over.period ?? { range: 'all', custom: null },
  )
  if (resolved === null) throw new Error('fixture resolves to no period')
  return resolved
}

describe('buildAssistantContext', () => {
  it('keys every section by a category the owner actually read', () => {
    const context = buildAssistantContext(inputs())
    for (const key of Object.keys(context)) {
      expect(DISCLOSURE_CATEGORY_IDS).toContain(key)
    }
  })

  it('assembles the four sections an answer is grounded in', () => {
    expect(Object.keys(buildAssistantContext(inputs())).sort()).toEqual([
      'holdings',
      'performance',
      'profile',
      'weights',
    ])
  })

  /**
   * Absent, never empty. With nothing imported there is no history to window, so the section is
   * missing rather than present-and-blank — a heading with nothing under it tells the model one
   * exists, which is an invitation to fill it in.
   */
  it('sends no performance section when there is no history to window', () => {
    expect(
      buildAssistantContext(inputs({ performance: { status: 'needs_import' } })),
    ).not.toHaveProperty('performance')
  })

  /** Absent is absent. A store that has never been imported produces no composition sections. */
  it('omits both composition sections when nothing has been imported', () => {
    const context = buildAssistantContext(inputs({ allocation: { status: 'needs_import' } }))
    expect(context).not.toHaveProperty('holdings')
    expect(context).not.toHaveProperty('weights')
    expect(context).toHaveProperty('profile')
  })

  /**
   * The inverse of what this asserted before Story #315, and the reversal is the story.
   *
   * An owner with no policy used to produce no profile section at all - there was nothing to say,
   * and a heading over nothing invites a model to fill it in. There is something to say now, and it
   * is the most important sentence in the section: *they have not written one*. Without it the
   * app's baseline below is a standard with no owner named, which is exactly how a default becomes
   * a policy the model attributes to them.
   */
  it('still carries a profile section for an owner who has stated no policy, saying so', () => {
    const context = buildAssistantContext(
      inputs({ profile: EMPTY_INVESTOR_PROFILE, drift: { status: 'no_data' } }),
    )
    expect(context.profile).toContain('has not set an investor profile at all')
    expect(context.profile).toContain('Assistant view’s profile section')
  })

  /**
   * The disclosure's own promise, enforced. `holdings` is declared as names and `weights` and
   * `profile` as percentages only, so **no amount of money may appear in any of them** — however
   * useful one would be to an answer. A currency symbol or a grouped thousands figure in these
   * sections is the disclosure becoming a lie.
   */
  it('puts no amount of money in a section disclosed as names or percentages', () => {
    const context = buildAssistantContext(inputs())
    for (const key of ['holdings', 'weights', 'profile'] as const) {
      const section = context[key] ?? ''
      expect(section, key).not.toMatch(/[€$£¥]/)
      // The market values in the fixtures — 12,345.67 and 50,000 — must not have survived.
      expect(section, key).not.toContain('12,345')
      expect(section, key).not.toContain('50,000')
    }
  })
})

describe('holdingsSection', () => {
  it('names the store and the date it is as of, so two clocks are never mixed', () => {
    expect(holdingsSection(report())).toContain('From imported Flex history, as of 2026-07-31')
  })

  it('carries the ticker, the name, the currency, the sector and the asset class', () => {
    const text = holdingsSection(report())
    expect(text).toContain('AAPL (Apple)')
    expect(text).toContain('currency USD')
    expect(text).toContain('sector Technology')
    expect(text).toContain('asset class STK')
  })

  /**
   * DDR-0066's trap, which reaches here like it reaches every view: IBKR writes the identifier
   * again where an instrument has no name, so a description that only repeats the symbol is not a
   * name. `instrumentName` is what every view uses, and using it here is what keeps an answer
   * saying `CAD` rather than `Cad`.
   */
  it('drops a description that only repeats the ticker', () => {
    const text = holdingsSection(report({ positions: [position({ symbol: 'CAD', description: 'CAD' })] }))
    expect(text).toContain('- CAD · currency')
    expect(text).not.toContain('Cad')
  })

  it('says a position is unclassified rather than leaving the field blank', () => {
    const text = holdingsSection(report({ positions: [position({ sector: '', assetCategory: '' })] }))
    expect(text).toContain('sector unclassified')
    expect(text).toContain('asset class unknown')
  })

  it('reports how many of the book it is holding, and cuts largest-first', () => {
    const many = Array.from({ length: MAX_LISTED_POSITIONS + 5 }, (_, index) =>
      position({ symbol: `S${index}`, percentOfNav: index }),
    )
    const text = holdingsSection(report({ positions: many }))
    expect(text).toContain(`The ${MAX_LISTED_POSITIONS} of ${many.length} open positions`.replace(' of ', ' largest of '))
    // The five smallest are the ones cut.
    expect(text).toContain('- S44 (Apple) ·')
    expect(text).not.toContain('- S0 (Apple) ·')
  })

  it('says so when the whole book is in front of the model', () => {
    expect(holdingsSection(report())).toContain('All 1 open position(s).')
  })

  it('reports the classification gap rather than leaving it to be inferred', () => {
    expect(holdingsSection(report({ unclassifiedCount: 3 }))).toContain(
      '3 of these have no sector',
    )
  })
})

describe('weightsSection', () => {
  it('quotes every weight in the app’s own percent format', () => {
    const text = weightsSection(report())
    expect(text).toContain('- AAPL: 24.50%')
    expect(text).toContain('- Stocks: 80.00%')
    expect(text).toContain('- USD: 60.00%')
    expect(text).toContain('- Technology: 40.00%')
    expect(text).toContain('- United States: 60.00%')
  })

  /** A breakdown the report does not carry is absent, not a heading with nothing under it. */
  it('omits a breakdown the report has no slices for', () => {
    const text = weightsSection(report({ bySector: [], byCountry: [] }))
    expect(text).not.toContain('By sector:')
    expect(text).not.toContain('By issuer country:')
    expect(text).toContain('By currency:')
  })

  /**
   * A currency weight has two readings and this app computes one (Story #287). Beside the
   * breakdown rather than once at the top of the section: a breakdown gets quoted on its own, and a
   * qualification three headings away is one that will not travel with it.
   */
  it('says which kind of currency exposure the weights are, beside the weights', () => {
    const text = weightsSection(report())
    const noteAt = text.indexOf('currency each position is held and priced in')
    const currencyAt = text.indexOf('By currency:')
    expect(noteAt).toBeGreaterThan(currencyAt)
    expect(text).toContain('not the currency the underlying business earns its revenue in')
  })
})

describe('profileSection', () => {
  it('states the style tags in the words the app shows them in', () => {
    const text = profileSection(PROFILE, { status: 'no_data' }) ?? ''
    expect(text).toContain('Investing style the owner states: Dividend income.')
  })

  it('writes every target as a range, both ends formatted', () => {
    const text = profileSection(PROFILE, { status: 'no_data' }) ?? ''
    expect(text).toContain('- Currency USD: 30.00%–50.00%')
    expect(text).toContain('- Any single position: 0.00%–15.00%')
  })

  /**
   * A gateway that is not running produces no weights at all, and none is invented to fill the
   * gap. The targets still go — the owner's policy is a local fact — but nothing is measured
   * against them (DDR-0022).
   */
  it.each(['no_data', 'not_connected', 'not_responding', 'error'] as const)(
    'measures nothing when drift came back %s',
    (status) => {
      const text = profileSection(PROFILE, { status, message: 'x' } as never) ?? ''
      expect(text).toContain('- Currency USD:')
      expect(text).not.toContain('Measured against the live portfolio')
    },
  )

  it('says the owner has written nothing, rather than being absent, when they have', () => {
    const text = profileSection(EMPTY_INVESTOR_PROFILE, { status: 'no_data' })
    expect(text).toContain('has not set an investor profile at all')
    // And never as an error: an unwritten profile is a state, not a failure.
    expect(text).not.toContain('could not')
  })

  it('does not open with a blank line when the owner set targets but no style', () => {
    const text = profileSection({ ...PROFILE, styleTags: [] }, { status: 'no_data' })
    expect(text.startsWith('\n')).toBe(false)
    expect(text.startsWith('Targets the owner set:')).toBe(true)
  })

  /**
   * A dimension with no target is absent from the drift report on purpose — a profile stating
   * nothing about sectors is not a profile stating that sectors do not matter. That absence is
   * right in the report and wrong in front of a model, which reads a missing heading as a question
   * that came back clean (Story #287).
   */
  describe('an untargeted dimension is named as untargeted, never as balanced', () => {
    it('names the dimensions the owner set no target in', () => {
      const text = profileSection(PROFILE, { status: 'no_data' }) ?? ''
      expect(text).toContain('the owner has set no target for sector and asset class')
      expect(text).toContain('neither balanced nor unbalanced')
      expect(text).toContain('Never report them as balanced')
      // The line hands the dimension on rather than closing the subject (Story #315): the model may
      // still invent nothing, and there is now somewhere for it to look instead.
      expect(text).toContain('invent no standard of your own')
    })

    it('says so about a missing concentration ceiling too', () => {
      const text = profileSection({ ...PROFILE, positionSize: null }, { status: 'no_data' }) ?? ''
      expect(text).toContain('no single-position concentration ceiling')
    })

    it('says nothing about untargeted dimensions once all three carry a target', () => {
      const text =
        profileSection(
          {
            ...PROFILE,
            sectorTargets: [{ key: 'Technology', low: 10, high: 30 }],
            assetClassTargets: [{ key: 'STK', low: 50, high: 90 }],
          },
          { status: 'no_data' },
        ) ?? ''
      expect(text).not.toContain('Untargeted: the owner has set no target for')
    })
  })
})

describe('measuredDrift', () => {
  it('names the live reading and the moment it was taken', () => {
    expect(measuredDrift(drift())).toContain(
      'Measured against the live portfolio, read 2026-08-28 09:15 UTC',
    )
  })

  it('states the verdict the service computed, rather than leaving it to be derived', () => {
    expect(measuredDrift(drift())).toContain(
      'At least one target the owner set is currently outside its range.',
    )
    expect(measuredDrift(drift({ balanced: true }))).toContain(
      'Every target the owner set is currently inside its range.',
    )
  })

  /**
   * `balanced: null` is the state Story #315 created and the one a model would most like to
   * mis-phrase: no targets is not every target met, and "your portfolio is balanced" is the
   * sentence a bare `true` would have produced. The service stopped emitting that `true`; this is
   * the assertion that the section stopped writing it too.
   */
  it('refuses to call a portfolio balanced when the owner set nothing to be balanced against', () => {
    const text = measuredDrift(drift({ balanced: null, dimensions: [] }))
    expect(text).toContain('The owner has set no targets')
    expect(text).not.toContain('inside its range')
  })

  it('writes a band as actual, range, and the signed distance out of it', () => {
    expect(measuredDrift(drift())).toContain(
      '- USD: 60.00% against 30.00%–50.00% — above the range by +10.00%',
    )
  })

  /**
   * Surfaced, never redistributed (DDR-0095). A dimension whose bands sum to 60% has to account
   * for the rest, or the model reads the gap as rounding and explains it away.
   */
  it('reports residuals and untargeted weight as their own lines', () => {
    const text = measuredDrift(drift())
    expect(text).toContain('- Cash (no target applies): 5.00%')
    expect(text).toContain('- Held in categories with no target: 35.00%')
  })

  /**
   * DDR-0007, at its sharpest. An unconvertible holding has **no percentage** — there is no rate
   * with which to compute one — so it is reported as a count and a currency, and the text says
   * outright that no percentage exists for it.
   */
  it('reports unplaced holdings as counts and currencies, never as a weight', () => {
    const text = measuredDrift(
      drift({
        unplaced: {
          positions: 2,
          cashBalances: 1,
          currencies: ['CHF', 'JPY'],
          nativeTotals: [
            { currency: 'CHF', amount: 1_234 },
            { currency: 'JPY', amount: 90_000 },
          ],
        },
      }),
    )
    expect(text).toContain('2 holding(s) and 1 cash balance(s) could not be valued in EUR (CHF, JPY)')
    expect(text).toContain('no percentage exists for them')
    // Never as an amount, either: the native totals are money and this section is percentages.
    expect(text).not.toContain('1,234')
    expect(text).not.toContain('90,000')
  })

  /** The ceiling is a lower bound where something could not be valued, and says so. */
  it('marks a bounded concentration figure as the lower bound it is', () => {
    const text = measuredDrift(
      drift({
        position: {
          symbol: 'AAPL',
          name: 'Apple Inc',
          actual: 24.5,
          low: 0,
          high: 15,
          status: 'above',
          distance: 9.5,
          bounded: true,
        },
      }),
    )
    expect(text).toContain('Largest single position: AAPL (Apple Inc) at 24.50%')
    expect(text).toContain('This is a lower bound')
  })

  /**
   * The arithmetic that closes a drift (Story #287, DDR-0103).
   *
   * **Sized by the app so that a proposal narrates arithmetic rather than generating one.** #281
   * gave the model the gap; a model asked to close a gap will size the move itself, and spreading
   * percentage points across positions is exactly the calculation that reads as prose. Computing it
   * first is also what retires #289's post-hoc check on the model's answer: there is nothing
   * produced by the model to verify.
   */
  describe('the move that closes a band', () => {
    it('states the size of the move, its direction and the edge it reaches', () => {
      const text = measuredDrift(drift())
      expect(text).toContain('Move: trim 10.00 percentage points out of USD to reach 50.00%')
      expect(text).toContain('the nearer edge of its range')
    })

    it('names the positions that carry it, and how many of how many they are', () => {
      const text = measuredDrift(drift())
      expect(text).toContain('Positions carrying it (the 2 largest of 4 held in USD)')
      expect(text).toContain(
        '· AAPL (Apple Inc): 40.00% of the portfolio now, giving up 8.00 percentage points, leaving it at 32.00%',
      )
      // A position the live reading has no name for is still nameable by its ticker (DDR-0088).
      expect(text).toContain('· MSFT: 10.00% of the portfolio now')
    })

    it('states the end state, which is why nothing has to check the answer afterwards', () => {
      expect(measuredDrift(drift())).toContain('After this move USD sits at 50.00%, inside its range')
    })

    it('says the moves are the app’s own and assume the portfolio keeps its total', () => {
      const text = measuredDrift(drift())
      expect(text).toContain('never size a move of your own')
      expect(text).toContain('assumes the portfolio keeps its current total')
      expect(text).toContain('No amount of money is available for any of them')
    })

    it('offers no move for a band already inside its range', () => {
      const text = measuredDrift(
        drift({
          balanced: true,
          dimensions: [
            {
              dimension: 'currency',
              bands: [
                {
                  key: 'USD',
                  label: 'USD',
                  actual: 40,
                  low: 30,
                  high: 50,
                  status: 'inside',
                  distance: 0,
                  move: null,
                },
              ],
              residuals: [],
              untargeted: 60,
            },
          ],
        }),
      )
      expect(text).not.toContain('Move:')
      expect(text).not.toContain('HOW TO CLOSE THE GAPS')
    })

    /**
     * "I want 10% in utilities and hold none" is not a smaller move; it is a different action, and
     * one only the owner can take. The section says so rather than naming a position from the list
     * above, which is exactly what a model with a gap in front of it will do.
     */
    it('says a band the owner holds nothing in cannot be closed by anything held', () => {
      const text = measuredDrift(bandOf({ actual: 0, status: 'below', distance: -10 }, {
        direction: 'add',
        points: 10,
        contributors: [],
        uncovered: 10,
        ceilingLimited: false,
        candidates: 0,
      }))
      expect(text).toContain('No position currently held sits in USD')
      expect(text).toContain('buying an instrument the owner does not hold')
      expect(text).toContain('do not name one from the positions above')
    })

    /**
     * The one interaction between two targets this app models: closing a sector gap must not push
     * a position through the owner's own concentration ceiling. The remainder is surfaced, never
     * spread over the positions that had no room for it (DDR-0052).
     */
    it('names the ceiling as what stopped a move, and leaves the rest uncovered', () => {
      const text = measuredDrift(bandOf({ actual: 20, status: 'below', distance: -15 }, {
        direction: 'add',
        points: 15,
        contributors: [{ symbol: 'AAPL', name: null, weight: 12, points: 3, resultingWeight: 15 }],
        uncovered: 12,
        ceilingLimited: true,
        candidates: 1,
      }))
      expect(text).toContain('12.00 percentage points of this move is still not carried')
      expect(text).toContain('single-position ceiling is what stops it')
      expect(text).toContain('do not place it on a position yourself')
      expect(text).toContain('still outside its range')
    })

    /** The cap states itself, so a target whose move is not sized still carries its verdict. */
    it('sizes the largest gaps and says how many bands went without one', () => {
      const bands = Array.from({ length: MAX_LISTED_MOVES + 3 }, (_, index) => ({
        key: `C${index}`,
        label: `C${index}`,
        actual: 10 + index,
        low: 0,
        high: 5,
        status: 'above' as const,
        distance: 5 + index,
        move: {
          direction: 'trim' as const,
          points: 5 + index,
          contributors: [
            { symbol: `S${index}`, name: null, weight: 20, points: 5 + index, resultingWeight: 15 },
          ],
          uncovered: 0,
          ceilingLimited: false,
          candidates: 1,
        },
      }))
      const text = measuredDrift(
        drift({ dimensions: [{ dimension: 'currency', bands, residuals: [], untargeted: 0 }] }),
      )

      expect(text).toContain(`${bands.length} band(s) are outside their range; the ${MAX_LISTED_MOVES} with the largest gaps`)
      // Every band still has its verdict; only the smallest gaps go without a sized move.
      expect(text).toContain('- C0: 10.00% against')
      expect(text).toContain('- C8: 18.00% against')
      expect(text.match(/ {2}Move: /g)).toHaveLength(MAX_LISTED_MOVES)
      expect(text).toContain('trim 13.00 percentage points out of C8')
      expect(text).not.toContain('out of C0 ')
    })
  })

  /** The same qualification the weights section carries, beside the same kind of breakdown. */
  it('says which kind of currency exposure the drift measured', () => {
    expect(measuredDrift(drift())).toContain('currency each position is held and priced in')
  })

  it('says nothing about a lower bound when everything could be valued', () => {
    const text = measuredDrift(
      drift({
        position: {
          symbol: 'AAPL',
          name: null,
          actual: 10,
          low: 0,
          high: 15,
          status: 'inside',
          distance: 0,
          bounded: false,
        },
      }),
    )
    expect(text).toContain('AAPL at 10.00%')
    expect(text).toContain('inside the range')
    expect(text).not.toContain('lower bound')
  })
})

/**
 * The explanation of a period (Story #285).
 *
 * **The trap that defines the story is that "my portfolio went up" and "my portfolio returned" are
 * different sentences.** The fixture is built so they disagree loudly — value rises 24.5% on a
 * €20,000 deposit while the return curve rises 2% — and what is asserted below is that the section
 * never lets the two be confused: they sit under headings that name which is which, in that order,
 * and the text says in words that a flow moves one and not the other.
 */
describe('performanceSection', () => {
  it('names the store, the period, and the anchor the period was resolved against', () => {
    const text = performanceSection(change())
    expect(text).toContain('From imported Flex history, in EUR.')
    expect(text).toContain('Period the owner chose: Full history — 2026-05-29 to 2026-06-03.')
    // DDR-0085's anchor, stated rather than assumed: a reader dating the period from their own
    // calendar would be reading a different period.
    expect(text).toContain('anchored to the last day the imported history holds (2026-06-03)')
    expect(text).toContain("never to today's date")
  })

  /** Return first, value second: whichever is met first is what a sentence reaches for. */
  it('states the return before the value, each labelled as what it is', () => {
    const text = performanceSection(change())
    const returnAt = text.indexOf('RETURN over this period (a return, not a change in value)')
    const valueAt = text.indexOf('VALUE over this period (a change in value, not a return)')
    expect(returnAt).toBeGreaterThan(-1)
    expect(valueAt).toBeGreaterThan(returnAt)
  })

  /**
   * The story's central figure pair. A 2% return beside a 24.5% rise in value is the case an
   * explanation gets wrong by flattering, so both must be present, both must be labelled, and the
   * text must say what separates them.
   */
  it('keeps the return and the value change apart as two figures', () => {
    const text = performanceSection(change())
    expect(text).toContain('Time-weighted return: +2.00%')
    expect(text).toContain('Change in value: +€24,500.00 (+24.50%)')
    expect(text).toContain('Money paid in or taken out does not move this figure')
    expect(text).toContain('Never call it performance')
  })

  /** Flows are named where they moved value, and named as not having moved the return. */
  it('names the deposit that moved the value', () => {
    const text = performanceSection(change())
    expect(text).toContain('Net deposits and withdrawals: +€20,000.00')
    expect(text).toContain('these move value; none of them moves the return above')
  })

  /**
   * Statement rows are summed whole, never pro-rated (there is no pro-rated figure in any report),
   * so a window that cuts one gets the totals of the rows it touched and is told which span those
   * rows really cover.
   */
  it('says which span the flow totals really cover when the statements overrun the period', () => {
    const text = performanceSection(
      change({ period: { range: 'custom', custom: { from: DAY[1], to: DAY[3] } } }),
    )
    expect(text).toContain('are not cut to the chosen period')
    expect(text).toContain('2026-06-01 to 2026-06-30')
  })

  it('reports the daily returns as chain-linked from the return curve', () => {
    const text = performanceSection(change())
    expect(text).toContain('chain-linked from the return curve')
    expect(text).toContain('3 trading day(s)')
    expect(text).toContain('Best day: +1.49% on 2026-06-03')
    expect(text).toContain('Worst day: -0.50% on 2026-06-02')
  })

  it('reports composition as amounts at each end of the period, with net asset value', () => {
    const text = performanceSection(change())
    expect(text).toContain('Stocks: €90,000.00 → €110,000.00 (+€20,000.00)')
    expect(text).toContain('Cash: €10,000.00 → €14,500.00 (+€4,500.00)')
    expect(text).toContain('Net asset value: €100,000.00 → €124,500.00 (+€24,500.00)')
  })

  /**
   * Story #285's "record a finding rather than compute one". Realised and unrealised profit and
   * loss come off the FIFO summaries as whole-history rollups; there is no windowed figure for
   * either, so both are put under their own heading and the absence is stated. Left under the
   * period's heading a model would read them as the period's own.
   */
  it('puts the whole-history figures under their own heading and says they are not the period', () => {
    const text = performanceSection(change())
    expect(text).toContain('WHOLE IMPORTED HISTORY, not the period above')
    expect(text).toContain('Realised profit and loss: +€4,300.00')
    expect(text).toContain('not available for a chosen period')
  })

  /**
   * A period with no data is a state, not an empty explanation. `valueAt` carries a value forward,
   * so this window would otherwise be described as a calm, flat, 0% period that never happened.
   */
  it('reports an empty period as empty rather than as flat', () => {
    const text = performanceSection(
      change({
        period: {
          range: 'custom',
          custom: { from: Date.UTC(2020, 0, 1), to: Date.UTC(2020, 0, 2) },
        },
      }),
    )
    expect(text).toContain('No day in the imported history falls inside this period')
    expect(text).toContain('do not describe it as flat or unchanged')
    // Nothing else may be there to quote: an empty period has no return and no value change.
    expect(text).not.toContain('Time-weighted return:')
    expect(text).not.toContain('Change in value:')
  })

  /** The optional NAV-in-base Flex section degrades, never fails (DDR-0050). */
  it('says composition is unavailable rather than drawing a shape out of nothing', () => {
    const text = performanceSection(
      change({ report: performance({ compositionSeries: { bands: [], points: [] } }) }),
    )
    expect(text).toContain('do not include the daily net-asset-value breakdown')
    expect(text).not.toContain('Net asset value:')
  })

  /**
   * Every figure goes through `lib/format`, so a figure in an answer and the same figure on a page
   * are one number. The formatters group thousands; a raw JavaScript number would not.
   */
  it('formats every figure through the app’s own formatters', () => {
    const text = performanceSection(change())
    expect(text).not.toContain('124500')
    expect(text).not.toContain('24500')
    expect(text).toMatch(/€124,500\.00/)
  })

  /**
   * The story's main guardrail, at the level this file can hold it: the context states what
   * changed and never why. Refusing a cause is the model's job and the system prompt carries that
   * rule — but it must not be handed one to repeat either.
   */
  it('offers no cause for anything it reports', () => {
    const text = performanceSection(change())
    expect(text).not.toMatch(/\bbecause\b/i)
    expect(text).not.toMatch(/\bdue to\b/i)
    expect(text).not.toMatch(/\bdriven by\b/i)
  })
})

/**
 * The three overclaims a summary reaches for (Story #286).
 *
 * **A summary is compression, and compression is where a model reaches for the conventional
 * phrasing of finance.** Each of the three below sounds like a summary and is grounded in nothing
 * this app holds: an annualised return (no report carries one), a benchmark (Epic #7, a different
 * data source in a different milestone) and a risk statistic (no volatility, no Sharpe, no beta,
 * no drawdown is computed anywhere).
 *
 * They are asserted here rather than left to the system prompt for the same reason every other
 * property in this file is: the prompt is the second line of defence, and the first is that the
 * context itself names each absence — ahead of the figures, on DDR-0099's ordering argument.
 */
describe('performanceSection: the three overclaims', () => {
  /**
   * Ahead of every figure, deliberately. A model that has already read `+2.00%` and a six-day
   * period has, by the time it reaches a caveat, largely written the sentence the caveat was
   * meant to prevent.
   */
  it('names what the app does not compute before it names a single figure', () => {
    const text = performanceSection(change())
    const limitsAt = text.indexOf('WHAT THIS APP DOES NOT COMPUTE')
    const returnAt = text.indexOf('RETURN over this period')
    expect(limitsAt).toBeGreaterThan(-1)
    expect(returnAt).toBeGreaterThan(limitsAt)
  })

  /**
   * The most common way a summary becomes misleading: six days of history scaled to a year is a
   * number with no meaning, and the model does not experience the scaling as a calculation. The
   * app computes no annualised figure at all, so the section says so and gives the real length of
   * the period in its place.
   */
  it('says no annualised figure exists and gives the real length of the period instead', () => {
    const text = performanceSection(change())
    expect(text).toContain('No annualised, per-year, compounded or "p.a." figure exists')
    expect(text).toContain('That period covers 6 calendar day(s); the whole imported history covers 6.')
    expect(text).toContain('This period is shorter than a year')
    expect(text).toContain('never describe a return over it as annual, annualised, yearly or per year')
  })

  /**
   * A period a year or longer may be *named* as such — that is not a scaling — but nothing may be
   * compounded or restated to any other period. The two sentences are exclusive: shipping both
   * would tell the model contradictory things about one figure.
   */
  it('permits naming a year-long period while still refusing to scale it', () => {
    const long = performanceSection(
      change({
        report: performance({
          valueSeries: [
            { date: Date.UTC(2024, 0, 1), value: 100_000 },
            { date: Date.UTC(2026, 5, 3), value: 124_500 },
          ],
          returnSeries: [
            { date: Date.UTC(2024, 0, 1), value: 0 },
            { date: Date.UTC(2026, 5, 3), value: 2 },
          ],
        }),
      }),
    )
    expect(long).toContain('This period covers a year or more')
    expect(long).toContain('never scaled, compounded or annualised to any other period')
    expect(long).not.toContain('This period is shorter than a year')
  })

  /** The app has none. Benchmark comparison is Epic #7, and inventing one is inventing a source. */
  it('says no benchmark, index or peer figure exists', () => {
    const text = performanceSection(change())
    expect(text).toContain('No benchmark, index, market or peer figure exists')
    expect(text).toContain('no market data beyond this portfolio’s own history')
    expect(text).toContain('never say the portfolio beat, lagged, tracked, outperformed or underperformed anything')
  })

  /**
   * Dispersion *can* be described — from the daily-return counts and the two extremes that are
   * actually in the section (DDR-0049) — and from nothing else. A Sharpe ratio quoted beside them
   * would be indistinguishable in tone from the figures that were computed.
   */
  it('names the risk statistics that do not exist and the dispersion that does', () => {
    const text = performanceSection(change())
    expect(text).toContain(
      'No volatility, standard deviation, Sharpe ratio, beta, drawdown or other risk statistic exists',
    )
    expect(text).toContain('the only description of dispersion this app has')
    // What it points at has to actually be there, or the section licenses a description of nothing.
    expect(text).toContain('3 trading day(s)')
    expect(text).toContain('Best day:')
  })

  /**
   * An empty window is where an ungrounded comparison has the most room: there is no figure to
   * anchor a sentence, so "roughly in line with the market" costs nothing to write.
   */
  it('carries the same three refusals over a period holding no data', () => {
    const text = performanceSection(
      change({
        period: {
          range: 'custom',
          custom: { from: Date.UTC(2020, 0, 1), to: Date.UTC(2020, 0, 2) },
        },
      }),
    )
    expect(text).toContain('No annualised, per-year, compounded or "p.a." figure exists')
    expect(text).toContain('No benchmark, index, market or peer figure exists')
    expect(text).toContain('No volatility, standard deviation, Sharpe ratio')
    expect(text).toContain('No day in the imported history falls inside this period')
  })

  /**
   * The block is statements of absence and two day counts off the window and the extent — no
   * figure it computed itself, and DDR-0099's guard still holds over the whole section.
   */
  it('adds no cause and no figure of its own', () => {
    const text = performanceSection(change())
    expect(text).not.toMatch(/\bbecause\b/i)
    expect(text).not.toMatch(/\bdue to\b/i)
    expect(text).not.toMatch(/\bdriven by\b/i)
  })
})

/**
 * Every standard period, in front of the model before a question is asked (Story #287, DDR-0103).
 *
 * **The set is what the removed picker was replaced with, and it is not the same shape.** A control
 * resolved one window; with the control gone (DDR-0102) there is no selection to resolve, so the
 * context carries every standard window and the question names its own. What these assert is the
 * property that only a *precomputed* set can have: a question about a window the app does not hold
 * is answerable — as a named state, with the alternatives listed — where a per-question resolution
 * would have nothing to say about its own miss.
 */
describe('the standard period set', () => {
  it('rides in the performance category, beside the explained history', () => {
    const context = buildAssistantContext(inputs())
    expect(context.performance).toContain('STANDARD PERIODS')
    expect(context.performance).toContain('RETURN over this period')
  })

  it('states that these are the only periods, and what to do about any other', () => {
    const text = buildAssistantContext(inputs()).performance ?? ''
    expect(text).toContain('These are the only periods available.')
    expect(text).toContain('say it is not available and name the periods that are')
    expect(text).toContain('Never answer about a neighbouring period as though it were the one asked for')
    expect(text).toContain('never combine two of these rows into a third')
  })

  it('anchors the set to the imported history rather than to the clock', () => {
    const text = buildAssistantContext(inputs()).performance ?? ''
    expect(text).toContain('anchored to the last day the imported history holds (2026-06-03)')
    expect(text).toContain('The whole history runs 2026-05-29 to 2026-06-03')
  })

  /** Two returns rebased to different starts are not points on one scale (DDR-0072). */
  it('states the rebasing, and forbids deriving a difference it did not compute', () => {
    const text = buildAssistantContext(inputs()).performance ?? ''
    expect(text).toContain("Each return is rebased to its own period's start")
    expect(text).toContain('Never add, subtract, chain or average two of these returns')
    expect(text).toContain('it is written on the row itself')
  })

  it('names each period in the words an owner would use, with its own window', () => {
    const text = buildAssistantContext(inputs()).performance ?? ''
    expect(text).toContain('- Full history (the whole imported history, 2026-05-29 to 2026-06-03, 6 calendar day(s))')
    expect(text).toContain('- Last 12 months (trailing window,')
    expect(text).toContain('- 2026 (calendar year,')
    expect(text).toContain('- Q2 2026 (calendar quarter,')
  })

  /** Return and value stay two figures on every row, not only in the explained history. */
  it('keeps each row’s return and value apart, both through the app’s own formatters', () => {
    const text = buildAssistantContext(inputs()).performance ?? ''
    expect(text).toContain('return +2.00%; value €100,000.00 → €124,500.00, change +€24,500.00 (+24.50%)')
    expect(text).toContain('4 day(s) of data')
  })

  it('states how many years and quarters it holds, of how many there are', () => {
    const text = buildAssistantContext(inputs()).performance ?? ''
    expect(text).toContain('Calendar years: the 1 most recent of 1 the history covers')
    expect(text).toContain('Calendar quarters: the 1 most recent of 1')
  })

  /**
   * A window with no day of history in it is a state, not a flat period — the same refusal the
   * explained history makes, applied to a row (DDR-0099). `valueAt` carries forward and would
   * otherwise report a calm 0% over a gap.
   */
  it('reports an empty row as empty rather than as unchanged', () => {
    const text =
      buildAssistantContext(
        inputs({
          performance: {
            status: 'ok',
            report: performance({
              valueSeries: [
                { date: Date.UTC(2025, 0, 15), value: 100_000 },
                { date: Date.UTC(2025, 9, 15), value: 120_000 },
              ],
              returnSeries: [
                { date: Date.UTC(2025, 0, 15), value: 0 },
                { date: Date.UTC(2025, 9, 15), value: 8 },
              ],
            }),
          },
        }),
      ).performance ?? ''

    expect(text).toContain('- Q2 2025 (calendar quarter, 2025-04-01 to 2025-06-30, 91 calendar day(s)): no day of the imported history falls inside this period')
    expect(text).toContain('It is an empty period, not a flat one')
    expect(text).toContain('say it holds no data, never that it was unchanged')
  })

  /** The comparison an owner actually makes, computed rather than left to be derived. */
  it('carries each year against the previous year in percentage points', () => {
    const text =
      buildAssistantContext(
        inputs({
          performance: {
            status: 'ok',
            report: performance({
              valueSeries: [
                { date: Date.UTC(2024, 0, 1), value: 100_000 },
                { date: Date.UTC(2024, 11, 1), value: 110_000 },
                { date: Date.UTC(2025, 0, 2), value: 111_000 },
                { date: Date.UTC(2025, 11, 1), value: 130_000 },
              ],
              returnSeries: [
                { date: Date.UTC(2024, 0, 1), value: 0 },
                { date: Date.UTC(2024, 11, 1), value: 10 },
                { date: Date.UTC(2025, 0, 2), value: 11 },
                // Deliberately not the value that makes the two years chain-link to the same
                // return: a difference asserted on a tie asserts nothing about the sign.
                { date: Date.UTC(2025, 11, 1), value: 25 },
              ],
            }),
          },
        }),
      ).performance ?? ''

    expect(text).toMatch(/- 2025 \(calendar year,[^\n]*return against 2024: [-+]\d/)
    expect(text).toContain('percentage points')
    // The oldest year in the set has nothing before it, and none is invented.
    expect(text).not.toMatch(/- 2024 \(calendar year,[^\n]*return against/)
  })

  it('is absent along with the rest of the category when nothing has been imported', () => {
    expect(
      buildAssistantContext(inputs({ performance: { status: 'needs_import' } })),
    ).not.toHaveProperty('performance')
  })
})

describe('wholeHistory', () => {
  /**
   * DDR-0085's anchor is the whole reason a preset is a pure function here: `1M` over a history
   * that stopped in an earlier month must still resolve to that history's last month. Anchored to
   * the clock it would be empty, and an empty period reads as a flat one. Asserted through
   * `periodChange` rather than the grounding, since the grounding no longer picks a preset — the
   * anchor is what #287 windows this report with.
   */
  it('anchors a preset to the last day of the history, never to today', () => {
    const resolved = change({ period: { range: '1m', custom: null } })
    expect(resolved.bounds.to).toBe(DAY[3])
    expect(resolved.days).toBeGreaterThan(0)
  })

  /**
   * **The grounding is the history entire, not a window over it** (DDR-0102). #285 resolved
   * whatever the owner had clicked; with the control gone the section describes everything there
   * is, so both bounds are the extent's own and every imported day is inside them.
   */
  it('spans the whole imported history, both ends', () => {
    const resolved = wholeHistory(inputs())
    expect(resolved?.range).toBe('all')
    expect(resolved?.bounds).toEqual(resolved?.extent)
    expect(resolved?.bounds.from).toBe(DAY[0])
    expect(resolved?.bounds.to).toBe(DAY[3])
  })

  /**
   * Which makes the empty period unreachable *here* while remaining a real state of `periodChange`
   * — the distinction the notice removal in `assistantAsk` rests on.
   */
  it('cannot resolve to an empty period, the window being the extent', () => {
    expect(wholeHistory(inputs())?.days).toBeGreaterThan(0)
  })

  it('is null when the history has nothing to window', () => {
    expect(wholeHistory(inputs({ performance: { status: 'needs_import' } }))).toBeNull()
  })
})

describe('hasProfile', () => {
  it('is false for the profile of an owner who never wrote one', () => {
    expect(hasProfile(EMPTY_INVESTOR_PROFILE)).toBe(false)
  })

  it('is true once any policy is stated, targets or style alone', () => {
    expect(hasProfile(PROFILE)).toBe(true)
    expect(hasProfile({ ...EMPTY_INVESTOR_PROFILE, styleTags: ['dividend_income'] })).toBe(true)
  })
})

// ---- the app's own standard, and saying so ----------------------------------

/**
 * The baseline block (Story #315, ADR-0012).
 *
 * The record traded ADR-0009's clean claim - *the standard is only ever the owner's* - for the
 * capability, and what it bought back is the **marking**: a judgement against a target the owner
 * wrote and a judgement against a default the app ships read identically once they are prose, and
 * only one of them carries the owner's authority. Every assertion here is about that distinction
 * surviving into the text, because the prompt is the only line of defence for phrasing (DDR-0104)
 * and a rule can be asserted present but never asserted obeyed.
 */
describe('the app’s baseline is marked apart from the owner’s own standard', () => {
  it('names whose standard it is, beside the claim rather than once at the end', () => {
    const text = profileSection(PROFILE, { status: 'ok', report: drift() })

    expect(text).toContain('The app’s default baseline, version 1')
    expect(text).toContain('say the standard is the app’s default and not theirs')
    expect(text).toContain('against the app’s default 30%')
  })

  /**
   * ADR-0012's central line in the text: the owner's own ceiling governs positions here, so the
   * baseline says it is standing aside rather than adding a second opinion about the same
   * dimension.
   */
  it('says which checks the owner’s own targets govern, and stands aside on them', () => {
    const text = profileSection(PROFILE, { status: 'ok', report: drift() })

    expect(text).toContain('Not applied, the owner’s own targets govern them: single-position size')
    expect(text).toContain('Judge those against their targets above, never against a default')
    expect(text).not.toContain('Largest single position:')
  })

  /**
   * The record's own stated risk: a default becoming a recommended profile. *"Consider setting a
   * 10% ceiling"* is proposing the policy in the baseline's clothes, and this is the sentence in
   * the grounding that forbids it - beside the rule that says the same thing in the prompt.
   */
  it('forbids the baseline being offered as a profile to adopt', () => {
    const text = profileSection(PROFILE, { status: 'ok', report: drift() })

    expect(text).toContain('not a profile for them to adopt')
    expect(text).toContain('never suggest they set one')
  })

  /**
   * Currency's absence is a decision, not an omission. The app knows where a position is priced and
   * not where its business earns, so a default there would assert an exposure it cannot see - and
   * an absent verdict reads as a clean one unless it is named (DDR-0101).
   */
  it('states that currency is covered by no default at all', () => {
    const text = profileSection(PROFILE, { status: 'ok', report: drift() })

    expect(text).toContain('The baseline covers no currency')
    expect(text).toContain('Judge currency against the owner’s targets or not at all')
  })

  /**
   * The user-facing half of ADR-0012's Option D. The app's "sector" is IBKR's `industry` field, an
   * open vocabulary - so it holds no universe to subtract a portfolio from, and a model asked which
   * sectors are missing will answer from training data unless the grounding says the list does not
   * exist.
   */
  it('gives the sector count and forbids naming a sector as missing', () => {
    const text = profileSection(PROFILE, { status: 'ok', report: drift() })

    expect(text).toContain('Holdings carry 3 distinct sector name(s)')
    expect(text).toContain('never name a missing sector')
    expect(text).toContain('not something this app computes')
  })

  /** The one absence the app *will* name, because that vocabulary is fixed and the app owns it. */
  it('names an absent asset class as a fact about shape rather than a fault', () => {
    const text = profileSection(PROFILE, { status: 'ok', report: drift() })

    expect(text).toContain('holds no weight at all in Bonds')
    expect(text).toContain('absence is a fact about shape, not a fault')
    expect(text).toContain('Never say what to buy to close it')
  })

  /**
   * A fully-targeted profile gets one sentence rather than a section. There is no baseline figure on
   * offer, so there is nothing to mark, nothing to misapply to currency and no headings to earn -
   * and this is the longest prompt the app assembles, so the saving lands where the budget binds
   * (DDR-0103).
   */
  it('shrinks to a single sentence when the owner has targeted everything', () => {
    const text = profileSection(
      PROFILE,
      {
        status: 'ok',
        report: drift({
          baseline: baseline({ applied: [], deferred: [...BASELINE_CHECKS], ceilings: [] }),
        }),
      },
    )

    expect(text).toContain('None of it applies here')
    expect(text).not.toContain('against the app’s default')
    expect(text).not.toContain('The baseline covers no currency')
  })

  /** No baseline without a reading: a gateway that is not running produces no weights to judge. */
  it('offers no baseline at all when the live portfolio could not be read', () => {
    const text = profileSection(PROFILE, { status: 'not_connected', message: 'x' })

    expect(text).not.toContain('default baseline')
    expect(text).toContain('- Currency USD:')
  })

  /**
   * The disclosure's promise, over the section this story grew. `profile` is declared as
   * percentages only, so a baseline figure in euros would make the disclosure a lie about the one
   * category that must not carry money (DDR-0098).
   */
  it('puts no amount of money in the baseline', () => {
    const text = profileSection(EMPTY_INVESTOR_PROFILE, { status: 'ok', report: drift() })

    expect(text).not.toMatch(/[€$£]/)
    expect(text).not.toMatch(/\d{1,3}(,\d{3})+(\.\d+)?(?!%)/)
  })
})
