import { describe, expect, it } from 'vitest'
import {
  MAX_HISTORY_POINTS,
  dailyReturnsReport,
  performancePeriodsReport,
  performanceReport,
  portfolioHistoryReport,
} from './performanceReports'
import type { PerformanceReport, PerformanceResult } from '@shared/domain/performance'

/**
 * The four reports the model may ask for about the history (Story #327, DDR-0111).
 *
 * **Most of this file was `renderer/src/lib/assistantContext.test.ts`'s**, and it moved with the
 * prose it is about: the section that explained a period and the list of standard periods are four
 * tools now, computed in main. The properties are unchanged, and every one still has a test:
 *
 * 1. A report carries **no more than its disclosure allows** — these four declare `performance`,
 *    the one category disclosed at `figures`, so amounts of money are in bounds here and nowhere
 *    else in the registry.
 * 2. **Absent is absent, never zero** — a period with no day in it, a composition section that was
 *    never exported and a window this app did not compute are three different *states*, each said in
 *    its own words rather than reported as a flat period or an empty list.
 * 3. Every figure goes through the **app's own formatters**, so prose and dashboard agree.
 * 4. A report **says which store and which clock it came from** — all four read the imported Flex
 *    store as of the latest statement, and say so before any figure.
 *
 * **The fixture is built so return and value disagree loudly**: a €20,000 deposit lands mid-history,
 * value rises 24.5%, and the time-weighted return rises 2%. Every assertion about the pair is really
 * one assertion — that a flow moves one field and never the other (DDR-0013, DDR-0099).
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

const ok = (over: Partial<PerformanceReport> = {}): PerformanceResult => ({
  status: 'ok',
  report: performance(over),
})

const NEEDS_IMPORT: PerformanceResult = { status: 'needs_import' }
const NO_HISTORY = ok({ valueSeries: [], returnSeries: [] })

/**
 * A longer history, for the caps and the calendar rows. Two full years of daily points, which puts
 * enough days in a period for {@link MAX_HISTORY_POINTS} to bite.
 */
function twoYears(): PerformanceReport {
  const DAY_MS = 86_400_000
  const start = Date.UTC(2024, 0, 1)
  const points = Array.from({ length: 730 }, (_, index) => ({
    date: start + index * DAY_MS,
    value: 100_000 + index * 100,
  }))
  return performance({
    valueSeries: points,
    returnSeries: points.map((point, index) => ({ date: point.date, value: index / 100 })),
    compositionSeries: {
      bands: [
        { key: 'stock', label: 'Stocks' },
        { key: 'cash', label: 'Cash' },
      ],
      points: points.map((point) => ({
        date: point.date,
        total: point.value,
        values: [point.value * 0.9, point.value * 0.1],
      })),
    },
  })
}

/** Every report, so a property claimed of "all four" is asserted over all four. */
const EVERY_REPORT: [string, (result: PerformanceResult, period: string) => string][] = [
  ['get_performance_periods', (result) => performancePeriodsReport(result)],
  ['get_performance', (result, period) => performanceReport(result, period)],
  ['get_daily_returns', (result, period) => dailyReturnsReport(result, period)],
  ['get_portfolio_history', (result, period) => portfolioHistoryReport(result, period, 'value')],
]

// ---- what every one of the four owes the reader -----------------------------

describe('every performance report', () => {
  /**
   * DDR-0098's pairing, applied per report. Composition and returns are Flex as of the latest
   * statement; holdings and drift are live. Reports **arriving separately** is exactly how that gets
   * lost, so each says which store it read before it says anything else.
   */
  it.each(EVERY_REPORT)('names its store and its clock: %s', (_name, render) => {
    expect(render(ok(), 'all')).toContain(
      'From imported Flex history, as of the latest statement imported — never live, and never as of today.',
    )
  })

  /**
   * **Nothing imported is a state, never an empty report** (DDR-0022, DDR-0111). A model handed an
   * empty list phrases it as a finding — *your portfolio was flat* — where the truth is that this
   * app has been told nothing at all.
   */
  it.each(EVERY_REPORT)('says nothing has been imported rather than reporting nothing: %s', (
    _name,
    render,
  ) => {
    const text = render(NEEDS_IMPORT, 'all')
    expect(text).toContain('no Flex statement has been imported')
    expect(text).toContain('Do not answer from the live portfolio')
  })

  /** A report that resolved but holds no dated value is its own state, and not the one above. */
  it.each(EVERY_REPORT)('separates an imported history with no dated value: %s', (_name, render) => {
    const text = render(NO_HISTORY, 'all')
    expect(text).toContain('carry no dated portfolio value')
    expect(text).not.toContain('no Flex statement has been imported')
  })

  /**
   * The story's main guardrail at the level this file can hold it: a report states what changed and
   * never why. Refusing a cause is the model's job and the prompt carries that rule — but it must
   * not be handed one to repeat either (DDR-0099).
   */
  it.each(EVERY_REPORT)('offers no cause for anything it reports: %s', (_name, render) => {
    for (const text of [render(ok(), 'all'), render(ok(), 'year:2026')]) {
      expect(text).not.toMatch(/\bbecause\b/i)
      expect(text).not.toMatch(/\bdue to\b/i)
      expect(text).not.toMatch(/\bdriven by\b/i)
    }
  })
})

// ---- get_performance_periods ------------------------------------------------

/**
 * The discovery tool, and the reason a question about a window this app never measured has an
 * honest answer (Story #287, DDR-0102, DDR-0103).
 *
 * A control resolved one window; with the control gone there is no selection to resolve, so the set
 * carries every standard window and the question names its own. What only a *precomputed* set can
 * do is answer about its own miss: a per-question resolution that finds nothing has nothing to say.
 */
describe('get_performance_periods', () => {
  it('states that these are the only periods, and what to do about any other', () => {
    const text = performancePeriodsReport(ok())
    expect(text).toContain('These are the only periods available')
    expect(text).toContain('each is named by the exact key below')
  })

  it('anchors the set to the imported history rather than to the clock', () => {
    const text = performancePeriodsReport(ok())
    expect(text).toContain('anchored to the last day the imported history holds (2026-06-03)')
    expect(text).toContain("never to today's date")
    expect(text).toContain('The whole history runs 2026-05-29 to 2026-06-03, in EUR.')
  })

  /**
   * **Both vocabularies, and neither collapsed** (DDR-0103). "Last 12 months" is the trailing
   * window; 2026 is the calendar row. `RANGE_OPTIONS` calls the first of them "Last year", which is
   * unambiguous beside a button marked 1Y and ambiguous beside a row named 2026 — so the trailing
   * window is named by its length here, and the report says the phrase has two readings rather than
   * quietly picking one.
   */
  it('keeps the trailing year and the calendar year apart, and says the phrase is ambiguous', () => {
    const text = performancePeriodsReport(ok())
    expect(text).toContain('- trailing:1y — Last 12 months (trailing window,')
    expect(text).toContain('- year:2026 — 2026 (calendar year,')
    expect(text).not.toContain('Last year')
    expect(text).toContain(
      'The phrase "last year" names one or the other and this app does not choose between them',
    )
  })

  it('names every period by the exact key a tool takes, with the window it covers', () => {
    const text = performancePeriodsReport(ok())
    expect(text).toContain(
      '- all — Full history (the whole imported history, 2026-05-29 to 2026-06-03, 6 calendar day(s)): 4 day(s) of data.',
    )
    expect(text).toContain('- quarter:Q2 2026 — Q2 2026 (calendar quarter,')
    expect(text).toContain('- trailing:ytd — Since 1 January (calendar-anchored window,')
  })

  /**
   * **It carries no figures, and that is the story rather than an omission.** A discovery tool that
   * also listed every period's return and value would be the assembled context this Epic replaced,
   * arriving under a new name and spending a whole round's budget to do it.
   */
  it('carries no return and no value at all', () => {
    const text = performancePeriodsReport(ok())
    expect(text).not.toContain('%')
    expect(text).not.toContain('€')
    expect(text).toContain('This report names the periods and carries no figures')
  })

  it('states how many years and quarters it holds, of how many there are', () => {
    const text = performancePeriodsReport({ status: 'ok', report: twoYears() })
    expect(text).toContain('Calendar years: the 2 most recent of 2 the history covers')
    expect(text).toContain('Calendar quarters: the 8 most recent of 8')
  })

  /**
   * A window with no day of history in it is a state, not a flat period (DDR-0099). `valueAt`
   * carries forward and would otherwise let a caller report a calm 0% over a gap.
   */
  it('marks a row that holds no day as empty rather than as unchanged', () => {
    const text = performancePeriodsReport(
      ok({
        valueSeries: [
          { date: Date.UTC(2025, 0, 15), value: 100_000 },
          { date: Date.UTC(2025, 9, 15), value: 120_000 },
        ],
        returnSeries: [
          { date: Date.UTC(2025, 0, 15), value: 0 },
          { date: Date.UTC(2025, 9, 15), value: 8 },
        ],
      }),
    )
    expect(text).toContain('- quarter:Q2 2025 — Q2 2025 (calendar quarter,')
    expect(text).toContain('empty. No day of the imported history falls inside it')
    expect(text).toContain('never that it was unchanged')
  })
})

// ---- the period argument ----------------------------------------------------

/**
 * **A window the set does not hold is a named state with alternatives, never the adjacent row**
 * (DDR-0102, DDR-0111).
 *
 * The failure this guards is not a refusal — it is a *helpful substitution*. Asked about March to
 * July, a model reaches for the nearest period and answers about that, which is a right-looking
 * figure under the wrong heading. So the state names what was asked for, forbids the substitution,
 * and lists every key that would have worked.
 */
describe('a period this app did not compute', () => {
  const ASKING: [string, (result: PerformanceResult, period: string) => string][] =
    EVERY_REPORT.filter(([name]) => name !== 'get_performance_periods')

  it.each(ASKING)('names the miss and lists the alternatives: %s', (_name, render) => {
    const text = render(ok(), '2024-03-01..2024-06-15')

    expect(text).toContain('this app holds no period called "2024-03-01..2024-06-15"')
    expect(text).toContain('there is no way to ask for an arbitrary date range')
    expect(text).toContain('Never answer about a neighbouring period as though it were the one asked for')
    expect(text).toContain('- all — Full history (the whole imported history)')
    expect(text).toContain('- year:2026 — 2026 (calendar year)')
  })

  /** No figure may appear beside the miss: an adjacent period's return is exactly the substitution. */
  it.each(ASKING)('quotes no figure at all beside the miss: %s', (_name, render) => {
    const text = render(ok(), 'quarter:Q1 2026')
    expect(text).not.toContain('%')
    expect(text).not.toContain('€')
  })

  /**
   * Exact, or nothing. Every softening — a case fold, a stray space, the label instead of the key —
   * is a step toward the nearest match, and the nearest match is the failure.
   */
  it.each(['YEAR:2026', 'year:2026 ', '2026', 'Full history', ''])(
    'resolves nothing for a key that is not exactly one of the set’s: %s',
    (key) => {
      expect(performanceReport(ok(), key)).toContain('this app holds no period called')
    },
  )
})

// ---- get_performance --------------------------------------------------------

describe('get_performance', () => {
  it('names the period, the store and the anchor before any figure', () => {
    const text = performanceReport(ok(), 'all')
    expect(text).toContain(
      'PERFORMANCE over Full history (the whole imported history, 2026-05-29 to 2026-06-03), in EUR.',
    )
    expect(text).toContain('anchored to the last day the imported history holds (2026-06-03)')
  })

  /** Return first, value second: whichever is met first is what a sentence reaches for. */
  it('states the return before the value, each labelled as what it is', () => {
    const text = performanceReport(ok(), 'all')
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
    const text = performanceReport(ok(), 'all')
    expect(text).toContain('Time-weighted return: +2.00%')
    expect(text).toContain('Change in value: +€24,500.00 (+24.50%)')
    expect(text).toContain('Money paid in or taken out does not move this figure')
    expect(text).toContain('Never call it performance')
  })

  /** Each period's return is rebased to its own start, so two of them are not one scale (DDR-0072). */
  it('states the rebasing and forbids combining two returns', () => {
    expect(performanceReport(ok(), 'all')).toContain(
      'Never add, subtract, chain or average it with another',
    )
  })

  /**
   * **Only consecutive same-kind differences exist, and the report says so either way** (DDR-0103).
   * Quoting two returns is a reading the model may make; subtracting them is arithmetic it may not
   * (ADR-0009), so the one difference the app computed is written on the row and every other is
   * forbidden in as many words.
   */
  it('carries the one difference the app computed, and refuses every other', () => {
    const text = performanceReport({ status: 'ok', report: twoYears() }, 'year:2025')
    expect(text).toMatch(
      /Against 2024, the period of the same kind immediately before it: [-+][\d.]+ percentage points/,
    )
    expect(text).toContain('never produce a difference between any other pair of periods')
  })

  it('says outright when no difference was computed, rather than leaving the silence', () => {
    const text = performanceReport(ok(), 'all')
    expect(text).toContain('No difference against another period was computed for this one')
    expect(text).toContain('do not compare it with another by subtracting returns')
  })

  it('names the deposit that moved the value, as a flow that moved no return', () => {
    const text = performanceReport(ok(), 'all')
    expect(text).toContain('Net deposits and withdrawals: +€20,000.00')
    expect(text).toContain('these move value; none of them moves the return above')
  })

  /**
   * Statement rows are summed **whole**, never pro-rated — there is no pro-rated deposit in any
   * report the app holds — so a window that cuts one gets the totals of the rows it touched and is
   * told which span those rows really cover.
   */
  it('says which span the flow totals really cover when the statements overrun the period', () => {
    const text = performanceReport(ok(), 'quarter:Q2 2026')
    expect(text).toContain('are not cut to the chosen period')
    expect(text).toContain('2026-05-01 to 2026-06-30')
  })

  it('says flows are unavailable rather than reporting zeroes when no statement covers the period', () => {
    const text = performanceReport(ok({ periods: [] }), 'all')
    expect(text).toContain('no statement period covers the period above')
    expect(text).toContain('do not quote the whole-history deposits below in their place')
  })

  /**
   * Realised and unrealised profit and loss are FIFO roll-ups with no windowed figure at all. Under
   * a period's heading a model reads them as the period's own, so they go under their own with the
   * absence stated beside them.
   */
  it('puts the whole-history figures under their own heading and says they are not the period', () => {
    const text = performanceReport(ok(), 'all')
    expect(text).toContain('WHOLE IMPORTED HISTORY, not the period above')
    expect(text).toContain('Realised profit and loss: +€4,300.00')
    expect(text).toContain('not available for a chosen period')
  })

  /**
   * A period with no data is a state, not an empty explanation. `valueAt` carries a value forward,
   * so this window would otherwise be described as a calm, flat, 0% period that never happened.
   */
  it('reports an empty period as empty rather than as flat', () => {
    const text = performanceReport(
      ok({
        valueSeries: [
          { date: Date.UTC(2025, 0, 15), value: 100_000 },
          { date: Date.UTC(2025, 9, 15), value: 120_000 },
        ],
        returnSeries: [
          { date: Date.UTC(2025, 0, 15), value: 0 },
          { date: Date.UTC(2025, 9, 15), value: 8 },
        ],
      }),
      'quarter:Q2 2025',
    )
    expect(text).toContain('No day of the imported history falls inside this period')
    expect(text).toContain('never describe it as flat, unchanged or steady')
    // Nothing else may be there to quote: an empty period has no return and no value change.
    expect(text).not.toContain('Time-weighted return:')
    expect(text).not.toContain('Change in value:')
  })

  /**
   * Every figure goes through `@shared/format`, so a figure in an answer and the same figure on a
   * page are one number. The formatters group thousands; a raw JavaScript number would not.
   */
  it('formats every figure through the app’s own formatters', () => {
    const text = performanceReport(ok(), 'all')
    expect(text).not.toContain('124500')
    expect(text).not.toContain('24500')
    expect(text).toMatch(/€124,500\.00/)
  })
})

/**
 * The three overclaims, restated for **this** period (Story #286; relocated by Story #325).
 *
 * The statements themselves are unconditional and live in `@shared/domain/assistantAbsences`, above
 * every question and whether or not a tool ran. What stays here is the half that is genuinely about
 * this period — its real calendar span — plus the restatement carrying it, which is DDR-0101's
 * *before any figure* applied per report. The restatement is belt-and-braces and is deliberately not
 * what holds the prohibitions.
 */
describe('get_performance: the three overclaims, restated for the period', () => {
  it('names what the app does not compute before it names a single figure', () => {
    const text = performanceReport(ok(), 'all')
    const limitsAt = text.indexOf('WHAT THIS APP DOES NOT COMPUTE')
    const returnAt = text.indexOf('RETURN over this period')
    expect(limitsAt).toBeGreaterThan(-1)
    expect(returnAt).toBeGreaterThan(limitsAt)
  })

  it('restates all three absences for the period it is about', () => {
    expect(performanceReport(ok(), 'all')).toContain(
      'no annualised figure, no benchmark, no risk statistic.',
    )
  })

  /**
   * The most common way a summary becomes misleading: six days of history scaled to a year is a
   * number with no meaning, and the model does not experience the scaling as a calculation. The app
   * computes no annualised figure at all, so the report gives the real length of the period in its
   * place — the one fact only this report holds.
   */
  it('gives the real length of the period, in calendar days, against the whole history', () => {
    const text = performanceReport(ok(), 'all')
    expect(text).toContain('This period covers 6 calendar day(s); the whole imported history covers 6.')
    expect(text).toContain('This period is shorter than a year')
    expect(text).toContain('never describe a return over it as annual, annualised, yearly or per year')
  })

  /**
   * A period a year or longer may be *named* as such — that is not a scaling — but nothing may be
   * compounded or restated to any other period. The two sentences are exclusive: shipping both would
   * tell the model contradictory things about one figure.
   */
  it('permits naming a year-long period while still refusing to scale it', () => {
    const text = performanceReport({ status: 'ok', report: twoYears() }, 'all')
    expect(text).toContain('This period covers a year or more')
    expect(text).toContain('never scaled, compounded or annualised to any other period')
    expect(text).not.toContain('This period is shorter than a year')
  })

  /**
   * An empty window is where an ungrounded comparison has the most room: with no figure to anchor a
   * sentence, "roughly in line with the market" costs nothing to write.
   */
  it('carries the same three refusals over a period holding no data', () => {
    const text = performanceReport(
      ok({
        valueSeries: [
          { date: Date.UTC(2025, 0, 15), value: 100_000 },
          { date: Date.UTC(2025, 9, 15), value: 120_000 },
        ],
        returnSeries: [
          { date: Date.UTC(2025, 0, 15), value: 0 },
          { date: Date.UTC(2025, 9, 15), value: 8 },
        ],
      }),
      'quarter:Q2 2025',
    )
    expect(text).toContain('no annualised figure, no benchmark, no risk statistic.')
    expect(text).toContain('calendar day(s); the whole imported history covers')
    expect(text).toContain('No day of the imported history falls inside this period')
  })
})

// ---- get_daily_returns ------------------------------------------------------

/**
 * The tool that was proposed as `get_daily_extremes`, and the rename is the whole point.
 *
 * Its example question was *"how volatile has the ride been?"* DDR-0101 states the app computes **no
 * risk statistic**, and DDR-0110 made that prohibition conditional on *"unless explicitly supplied
 * by the application"* — so a tool whose **name** promised volatility would read as that supply and
 * unbind the rule it was named after. The data is real; the name says what it returns, and the
 * report says in its own words that no dispersion statistic is in it.
 */
describe('get_daily_returns', () => {
  it('reports the counts and the two extremes, chain-linked from the return curve', () => {
    const text = dailyReturnsReport(ok(), 'all')
    expect(text).toContain('chain-linked from the cumulative return curve')
    expect(text).toContain('3 trading day(s): 2 up, 1 down, 0 unchanged.')
    expect(text).toContain('Best day: +1.49% on 2026-06-03')
    expect(text).toContain('Worst day: -0.50% on 2026-06-02')
  })

  /** The half of DDR-0110's bargain this report owes: dispersion exists, and only this much of it. */
  it('supplies no dispersion statistic and says the app computes none', () => {
    const text = dailyReturnsReport(ok(), 'all')
    expect(text).toContain('This report supplies no dispersion statistic')
    expect(text).toContain(
      'no volatility, standard deviation, Sharpe ratio, beta or drawdown',
    )
    expect(text).toContain('never derive one of the others from them')
  })

  /**
   * DDR-0049: the steps take the **unwindowed** series, so a window's first day is measured against
   * the trading day that really preceded it — here 2 June's −0.50%, measured against 1 June, a day
   * outside the window.
   */
  it('measures the first day of a window against the day that really preceded it', () => {
    const text = dailyReturnsReport(
      ok({
        valueSeries: [
          { date: Date.UTC(2026, 2, 31), value: 100_000 },
          { date: Date.UTC(2026, 3, 1), value: 121_000 },
        ],
        returnSeries: [
          { date: Date.UTC(2026, 2, 31), value: 0.5 },
          { date: Date.UTC(2026, 3, 1), value: 2 },
        ],
        compositionSeries: { bands: [], points: [] },
      }),
      'quarter:Q2 2026',
    )
    expect(text).toContain('1 trading day(s)')
    expect(text).toContain('Best day: +1.49% on 2026-04-01')
  })

  /** A period with a day but no predecessor has no daily return, which is a state and not a zero. */
  it('says no daily return exists rather than reporting an unchanged period', () => {
    const text = dailyReturnsReport(
      ok({
        valueSeries: [{ date: DAY[3], value: 124_500 }],
        returnSeries: [{ date: DAY[3], value: 2 }],
      }),
      'all',
    )
    expect(text).toContain('no day with a preceding trading day to measure against')
    expect(text).toContain('do not report the period as unchanged')
  })

  it('reports an empty period as empty rather than as flat', () => {
    const text = dailyReturnsReport(
      ok({
        valueSeries: [
          { date: Date.UTC(2025, 0, 15), value: 100_000 },
          { date: Date.UTC(2025, 9, 15), value: 120_000 },
        ],
        returnSeries: [
          { date: Date.UTC(2025, 0, 15), value: 0 },
          { date: Date.UTC(2025, 9, 15), value: 8 },
        ],
      }),
      'quarter:Q2 2025',
    )
    expect(text).toContain('never describe it as flat, unchanged or steady')
    expect(text).not.toContain('Best day:')
  })
})

// ---- get_portfolio_history --------------------------------------------------

/**
 * Value over time **or** composition over time, never both in one payload (DDR-0013, DDR-0111).
 *
 * The `series` argument is the split. Both answer questions about the same days, and a payload
 * carrying both is how a model attributes a deposit to performance — so the model asks for one, and
 * neither branch carries a return at all.
 */
describe('get_portfolio_history', () => {
  it('lists the value on each day, and says outright that a value is not a return', () => {
    const text = portfolioHistoryReport(ok(), 'all', 'value')
    expect(text).toContain('PORTFOLIO VALUE, day by day, over Full history')
    expect(text).toContain('- 2026-05-29: €100,000.00')
    expect(text).toContain('- 2026-06-03: €124,500.00')
    expect(text).toContain('never read a rise here as performance')
  })

  /** The split, asserted as an absence: neither series may carry the other. */
  it('returns one series and never the other in the same payload', () => {
    const value = portfolioHistoryReport(ok(), 'all', 'value')
    const composition = portfolioHistoryReport(ok(), 'all', 'composition')

    expect(value).not.toContain('net asset value')
    expect(value).not.toContain('Stocks')
    expect(composition).not.toContain('PORTFOLIO VALUE')
    // Neither carries a return: a period's return is get_performance's single figure.
    expect(value).not.toContain('%')
    expect(composition).not.toContain('%')
  })

  it('lists the bands as amounts summing to net asset value, absent ones absent', () => {
    const text = portfolioHistoryReport(ok(), 'all', 'composition')
    expect(text).toContain(
      '- 2026-05-29 — net asset value €100,000.00: Stocks €90,000.00; Cash €10,000.00',
    )
    expect(text).toContain('it is absent, not zero')
    expect(text).toContain('a negative band is a real observation, not an error')
  })

  /** The optional NAV-in-base Flex section degrades, never fails (DDR-0050). */
  it('says composition is unavailable rather than drawing a shape out of nothing', () => {
    const text = portfolioHistoryReport(
      ok({ compositionSeries: { bands: [], points: [] } }),
      'all',
      'composition',
    )
    expect(text).toContain('do not include the daily net-asset-value breakdown')
    expect(text).toContain('do not describe a shape')
    expect(text).not.toContain('net asset value €')
  })

  /**
   * **It is the largest payload in the Epic, so it is the one that says what it left out.**
   * Sampling is a *selection*: every day listed is one the app really observed, nothing is averaged
   * or interpolated, and the report states that the days between are not in front of the model —
   * otherwise a monthly list reads as a daily one.
   */
  it.each(['value', 'composition'] as const)('samples a long period and says it did: %s', (series) => {
    const text = portfolioHistoryReport({ status: 'ok', report: twoYears() }, 'all', series)
    const rows = text.split('\n').filter((line) => line.startsWith('- 20'))

    expect(rows).toHaveLength(MAX_HISTORY_POINTS)
    expect(text).toContain(
      `The ${MAX_HISTORY_POINTS} day(s) below are evenly spaced samples of the 730 day(s) this period holds`,
    )
    expect(text).toContain('never read this list as every day of the period')
    // Both ends kept, so the period's own bounds are the list's own bounds.
    expect(rows[0]).toContain('2024-01-01')
    expect(rows[rows.length - 1]).toContain('2025-12-30')
  })

  it('says it listed every day when the period is short enough to fit', () => {
    const text = portfolioHistoryReport(ok(), 'all', 'value')
    expect(text).toContain('All 4 day(s) of data in this period, oldest first.')
  })

  it('reports an empty period as empty rather than as an empty list', () => {
    const text = portfolioHistoryReport(
      ok({
        valueSeries: [
          { date: Date.UTC(2025, 0, 15), value: 100_000 },
          { date: Date.UTC(2025, 9, 15), value: 120_000 },
        ],
        returnSeries: [
          { date: Date.UTC(2025, 0, 15), value: 0 },
          { date: Date.UTC(2025, 9, 15), value: 8 },
        ],
      }),
      'quarter:Q2 2025',
      'value',
    )
    expect(text).toContain('never describe it as flat, unchanged or steady')
  })
})
