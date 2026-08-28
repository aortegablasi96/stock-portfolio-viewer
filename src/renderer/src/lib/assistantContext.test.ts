import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_POSITIONS,
  buildAssistantContext,
  hasProfile,
  holdingsSection,
  measuredDrift,
  performanceSection,
  profileSection,
  selectedPeriod,
  weightsSection,
  type GroundingInputs,
} from './assistantContext'
import type { PeriodChange } from './periodChange'
import type { PerformanceReport } from '@shared/domain/performance'
import { DISCLOSURE_CATEGORY_IDS } from '@shared/domain/assistantDisclosure'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import type { AllocationPosition, AllocationReport } from '@shared/domain/allocation'
import type { BalanceDriftReport } from '@shared/domain/balanceDrift'

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

function drift(over: Partial<BalanceDriftReport> = {}): BalanceDriftReport {
  return {
    displayCurrency: 'EUR',
    readAt: Date.UTC(2026, 7, 28, 9, 15),
    placedValue: 50_000,
    dimensions: [
      {
        dimension: 'currency',
        bands: [
          { key: 'USD', label: 'USD', actual: 60, low: 30, high: 50, status: 'above', distance: 10 },
        ],
        residuals: [{ kind: 'cash', label: 'Cash', weight: 5 }],
        untargeted: 35,
      },
    ],
    position: null,
    unplaced: { positions: 0, cashBalances: 0, currencies: [], nativeTotals: [] },
    balanced: false,
    ...over,
  }
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

const inputs = (over: Partial<GroundingInputs> = {}): GroundingInputs => ({
  allocation: { status: 'ok', report: report() },
  profile: PROFILE,
  drift: { status: 'ok', report: drift() },
  performance: { status: 'ok', report: performance() },
  period: { range: 'all', custom: null },
  ...over,
})

/** The `PeriodChange` the default fixture resolves to, for the section tests below. */
const change = (over: Partial<GroundingInputs> = {}): PeriodChange => {
  const resolved = selectedPeriod(inputs(over))
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

  it('omits the profile section entirely when the owner has stated no policy and nothing measured', () => {
    const context = buildAssistantContext(
      inputs({ profile: EMPTY_INVESTOR_PROFILE, drift: { status: 'no_profile' } }),
    )
    expect(context).not.toHaveProperty('profile')
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

  it('is absent, not empty, for an owner who has stated nothing and measured nothing', () => {
    expect(profileSection(EMPTY_INVESTOR_PROFILE, { status: 'no_profile' })).toBeNull()
  })

  it('does not open with a blank line when the owner set targets but no style', () => {
    const text = profileSection({ ...PROFILE, styleTags: [] }, { status: 'no_profile' }) ?? ''
    expect(text.startsWith('\n')).toBe(false)
    expect(text.startsWith('Targets the owner set:')).toBe(true)
  })
})

describe('measuredDrift', () => {
  it('names the live reading and the moment it was taken', () => {
    expect(measuredDrift(drift())).toContain(
      'Measured against the live portfolio, read 2026-08-28 09:15 UTC',
    )
  })

  it('states the verdict the service computed, rather than leaving it to be derived', () => {
    expect(measuredDrift(drift())).toContain('At least one target is currently outside its range.')
    expect(measuredDrift(drift({ balanced: true }))).toContain(
      'Every target is currently inside its range.',
    )
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
      change({
        performance: {
          status: 'ok',
          report: performance({ compositionSeries: { bands: [], points: [] } }),
        },
      }),
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
        performance: {
          status: 'ok',
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
        },
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

describe('selectedPeriod', () => {
  /**
   * DDR-0085's anchor is the whole reason a preset is a pure function here: `1M` over a history
   * that stopped in an earlier month must still resolve to that history's last month. Anchored to
   * the clock it would be empty, and an empty period reads as a flat one.
   */
  it('anchors a preset to the last day of the history, never to today', () => {
    const resolved = change({ period: { range: '1m', custom: null } })
    expect(resolved.bounds.to).toBe(DAY[3])
    expect(resolved.days).toBeGreaterThan(0)
  })

  it('is null when the history has nothing to window', () => {
    expect(selectedPeriod(inputs({ performance: { status: 'needs_import' } }))).toBeNull()
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
