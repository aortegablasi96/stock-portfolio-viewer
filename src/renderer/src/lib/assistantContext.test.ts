import { describe, expect, it } from 'vitest'
import {
  buildAssistantContext,
  hasProfile,
  performanceSection,
  wholeHistory,
  type GroundingReports,
} from './assistantContext'
import { periodChange, type PeriodChange, type PeriodSelection } from './periodChange'
import type { PerformanceReport } from '@shared/domain/performance'
import { DISCLOSURE_CATEGORY_IDS } from '@shared/domain/assistantDisclosure'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import type { AllocationPosition, AllocationReport } from '@shared/domain/allocation'
import type { BalanceDriftReport, BaselineReview } from '@shared/domain/balanceDrift'
import { BASELINE_VERSION } from '@shared/domain/portfolioBaseline'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'

/**
 * The grounding that is still assembled (Story #284, DDR-0098; narrowed by Story #326).
 *
 * **This file was the Epic's largest correctness risk written down as assertions**, and half of it
 * moved rather than went away: the holdings, weights, profile and drift assertions are
 * `services/assistant/toolReports.test.ts`'s now, over the same prose in the process that computes
 * it (DDR-0111). What is left is the performance section and the standard period set, which #327
 * takes behind its own tools, and the assembly itself — which is now asserted for what it *stops*
 * carrying as much as for what it carries.
 *
 * The properties are unchanged, and every one of them still has a test on each side of the move:
 *
 * 1. A section carries **no more than its disclosure allows** — `performance` is the one category
 *    that may carry money, and it is the one still assembled here.
 * 2. **Absent is absent, never zero** — a report that could not be read produces no section.
 * 3. Every figure goes through the **app's own formatters**, so prose and dashboard agree.
 * 4. A section **says which store and which clock it came from** — this one reads imported Flex
 *    history, and the tools that read live say so themselves.
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

  /**
   * **One section, and its three former siblings are tools now** (Story #326, DDR-0111).
   *
   * Asserted as an exact list rather than as "contains performance", because the point of the story
   * is what is *no longer* here: `holdings`, `weights` and `profile` are computed in main when the
   * model asks for them, and sending them here as well would put every figure in front of it twice
   * and spend the budget the tool rounds need. A story that re-added one would pass a "contains"
   * assertion and fail this.
   */
  it('assembles the one section the model cannot yet ask for', () => {
    expect(Object.keys(buildAssistantContext(inputs())).sort()).toEqual(['performance'])
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

  /**
   * The composition sections went to the tools, and so did the reads behind them (Story #326).
   *
   * Pinned as an absence rather than dropped, because "nothing imported" used to be the case that
   * removed two of the four sections and it is now the case that changes nothing here at all: the
   * allocation is `get_allocation`'s to report — as a *state*, not as a missing section — and this
   * context's only input is the performance report.
   */
  it('assembles nothing from the reports the tools now answer', () => {
    const context = buildAssistantContext(inputs({ allocation: { status: 'needs_import' } }))
    expect(Object.keys(context)).toEqual(['performance'])
  })

  /**
   * The same, for the profile: an owner who has written nothing used to get the most important
   * sentence in the section — *they have not set one* — assembled here whether they asked or not.
   * It is `get_investor_profile`'s now, in the same words, and `toolReports.test.ts` holds it.
   */
  it('assembles no profile section, for an owner with a policy or without one', () => {
    expect(buildAssistantContext(inputs())).not.toHaveProperty('profile')
    expect(
      buildAssistantContext(inputs({ profile: EMPTY_INVESTOR_PROFILE, drift: { status: 'no_data' } })),
    ).not.toHaveProperty('profile')
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
   * Every figure goes through `@shared/format`, so a figure in an answer and the same figure on a page
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
 * The three overclaims a summary reaches for (Story #286; relocated by Story #325).
 *
 * **A summary is compression, and compression is where a model reaches for the conventional
 * phrasing of finance.** Each of the three sounds like a summary and is grounded in nothing this
 * app holds: an annualised return (no report carries one), a benchmark (Epic #7, a different data
 * source in a different milestone) and a risk statistic (no volatility, no Sharpe, no beta, no
 * drawdown is computed anywhere).
 *
 * **The statements themselves are no longer here**, and that is Story #325's whole point: living
 * inside this section made them conditional on there being a Flex history to window, and under Epic
 * #322 conditional on a model choosing to ask for one. They are in
 * `@shared/domain/assistantAbsences` now, sent above every section on every question, and
 * `assistantService.test.ts` holds the assertion that a conversation with no report in it still
 * carries all three.
 *
 * What stays here is the half that is about **this period**: its real calendar span, which is the
 * honest fact an app with no annualisation has in place of one, and the restatement that carries
 * it. That restatement is belt-and-braces — DDR-0101's *before any figure* applied per report — and
 * is deliberately not what holds the prohibitions.
 */
describe('performanceSection: the three overclaims, restated for the period', () => {
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

  /** All three named together, in one line, so the period's figures arrive already qualified. */
  it('restates all three absences for the period it is about', () => {
    expect(performanceSection(change())).toContain(
      'no annualised figure, no benchmark, no risk statistic.',
    )
  })

  /**
   * The most common way a summary becomes misleading: six days of history scaled to a year is a
   * number with no meaning, and the model does not experience the scaling as a calculation. The
   * app computes no annualised figure at all, so the section gives the real length of the period
   * in its place — the one fact only this report holds.
   */
  it('gives the real length of the period, in calendar days, against the whole history', () => {
    const text = performanceSection(change())
    expect(text).toContain('This period covers 6 calendar day(s); the whole imported history covers 6.')
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

  /**
   * The dispersion the base context's risk statement points at has to actually be in the report,
   * or the unconditional sentence licenses a description of nothing. This is the section's half of
   * that bargain (DDR-0049).
   */
  it('supplies the dispersion the risk statement says is the only one available', () => {
    const text = performanceSection(change())
    expect(text).toContain('3 trading day(s)')
    expect(text).toContain('Best day:')
    expect(text).toContain('Worst day:')
  })

  /**
   * An empty window is where an ungrounded comparison has the most room: there is no figure to
   * anchor a sentence, so "roughly in line with the market" costs nothing to write. An empty period
   * is a **state**, and it keeps the restatement and its span (DDR-0099, DDR-0101).
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
    expect(text).toContain('no annualised figure, no benchmark, no risk statistic.')
    expect(text).toContain('calendar day(s); the whole imported history covers')
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
