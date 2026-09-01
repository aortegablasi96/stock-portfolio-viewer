import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
  formatSignedPoints,
} from '@shared/format'
import {
  findPeriod,
  flowWindow,
  periodComposition,
  periodDailyReturns,
  periodDays,
  periodFlows,
  periodSpan,
  periodValueSeries,
  standardPeriods,
  type PeriodSet,
  type StandardPeriod,
} from '@shared/domain/standardPeriods'
import { isoDay } from './toolReports'
import type { PerformanceReport, PerformanceResult } from '@shared/domain/performance'

/**
 * The four reports the model may ask for about the history (Story #327, DDR-0111).
 *
 * **All four are slices of one service method.** `analytics:getPerformance` returns the value
 * series, the return curve, the composition series, the statement rows and the roll-up totals in a
 * single report; these tools *narrow* it and add nothing. DDR-0111 settled the shape: many tools may
 * share one method, none may span two, and a single tool with a `section` argument was weighed and
 * rejected — it is a discriminated tool wearing a disguise, the model must know the sections before
 * it can ask for one, and the states differ per section (`period_not_available` is meaningless for
 * `get_portfolio_history`).
 *
 * ## Return and value are two answers, and they are never in one payload
 *
 * The app's curve is cumulative **time-weighted return** (DDR-0013) and does not move on a deposit;
 * a portfolio can be worth 20% more and have returned 2%. So {@link performanceReport} states them
 * apart, under headings that name which is which, **return first** — whichever is met first is what
 * a sentence reaches for (DDR-0099) — and {@link portfolioHistoryReport} takes a `series` argument
 * rather than returning both, since a combined payload is how a deposit gets attributed to
 * performance.
 *
 * ## A period is an enumerated key, and a window the set does not hold is a state
 *
 * Every standard period is precomputed (DDR-0102, DDR-0103), so a question about *March to July* has
 * an honest answer: the app does not hold that window, and here are the ones it does.
 * {@link findPeriod} matches exactly — no prefix, no nearest neighbour — and the miss is reported
 * **with the alternatives**, never as the adjacent row. A tool taking a free-form range would be the
 * period picker DDR-0102 removed, arriving through a different door.
 *
 * ## What each report restates, and what actually holds the prohibitions
 *
 * *WHAT THIS APP DOES NOT COMPUTE* rides in `BASE_CONTEXT` above every question, whichever tools ran
 * and when none did (Story #325). A period report restating the three absences that qualify **its
 * own** figures is belt-and-braces, not the binding (DDR-0101, DDR-0110, DDR-0111). What only a
 * report can supply is the period's real calendar span, which is the honest fact an app with no
 * annualisation has in place of one.
 *
 * Every figure goes through `@shared/format`, so a figure in an answer and the same figure on a page
 * are one number (DDR-0098). Nothing here derives one: not a difference, not a share, not a total.
 */

/** How many days of history one report lists before it says what it sampled past. */
export const MAX_HISTORY_POINTS = 24

/**
 * Which series {@link portfolioHistoryReport} was asked for. Enumerated, never both at once.
 *
 * The split is DDR-0013's, and it is the whole point of the argument: value over time and the return
 * curve answer different questions about the same days, and a payload carrying both invites the
 * model to read a deposit as performance. There is no `return` member — a period's return is
 * `get_performance`'s single figure, and a *curve* of rebased returns is a chart, not a sentence.
 */
export const HISTORY_SERIES = ['value', 'composition'] as const
export type HistorySeries = (typeof HISTORY_SERIES)[number]

/** Which store every report here read, and on which clock. */
const SOURCE_NOTE =
  'From imported Flex history, as of the latest statement imported — never live, and never as of today.'

/** What an empty window is, in the words that stop it being read as a flat one. */
const EMPTY_PERIOD_NOTE =
  'No day of the imported history falls inside this period, so there is nothing to report about it. Say the period holds no data; never describe it as flat, unchanged or steady.'

/** The state a period key that resolves to nothing lands in, and what it carries with it. */
type ResolvedPeriod =
  | { status: 'ok'; report: PerformanceReport; set: PeriodSet; period: StandardPeriod }
  | { status: 'needs_import' }
  | { status: 'no_history' }
  | { status: 'period_not_available'; set: PeriodSet }

/**
 * Resolve a report and a key into the one period they name, or into the state that stopped them.
 *
 * Three misses, and they are kept apart because their recoveries are (DDR-0022): nothing has been
 * imported at all, a report resolved but holds no dated value to window, and the window asked for is
 * not one this app computes. The third is the one that must never degrade into an adjacent row.
 */
function resolve(result: PerformanceResult, periodId: string): ResolvedPeriod {
  if (result.status !== 'ok') return { status: 'needs_import' }

  const set = standardPeriods(result.report)
  if (set === null) return { status: 'no_history' }

  const period = findPeriod(set, periodId)
  if (period === null) return { status: 'period_not_available', set }

  return { status: 'ok', report: result.report, set, period }
}

/** The two states every report here shares, in the words that name the recovery. */
function stateLine(heading: string, status: 'needs_import' | 'no_history'): string {
  return status === 'needs_import'
    ? `${heading}: no Flex statement has been imported, so this app holds no history at all. Say nothing has been imported and that importing a statement from the Portfolio view is what makes returns, value and composition available. Do not answer from the live portfolio, which is a different store on a different clock.`
    : `${heading}: the imported statements carry no dated portfolio value, so there is no history to measure a period over. Say so; do not describe a period that could not be resolved.`
}

/**
 * The miss, with the alternatives beside it (DDR-0102).
 *
 * **The failure a precomputed set exists to prevent is not a refusal — it is a helpful
 * substitution.** Asked about a window the app cannot compute, a model reaches for the nearest row
 * and answers about that instead, which is a right-looking figure under the wrong heading. So the
 * state names the key that missed, forbids the substitution outright, and lists every key that would
 * have worked.
 */
function periodNotAvailable(heading: string, set: PeriodSet, asked: string): string {
  return [
    `${heading}: this app holds no period called "${asked.trim()}". It computes a fixed set of periods and nothing else — there is no way to ask for an arbitrary date range, and no period was measured for this one.`,
    'Say the period is not available and name the ones that are, listed below. Never answer about a neighbouring period as though it were the one asked for, and never combine two of them into a third.',
    '',
    ...set.periods.map((period) => `- ${period.id} — ${period.label} (${period.descriptor})`),
  ].join('\n')
}

// ---- get_performance_periods ------------------------------------------------

/**
 * Which periods exist, by their exact keys — the discovery tool, and required rather than optional.
 *
 * It carries **no return and no value**, deliberately. Its whole job is to keep `get_performance`
 * from being asked for a window the set does not hold, and a list that also carried every period's
 * figures would be the assembled context this Epic replaced, arriving under a new name and spending
 * a whole round's budget to do it.
 *
 * **Both vocabularies are carried and neither is collapsed** (DDR-0103). "Last 12 months" is the
 * trailing window; a calendar year is the row named for the year. The phrase *last year* names one
 * or the other and this app does not choose between them, so the report says outright that an answer
 * has to name which row it took.
 */
export function performancePeriodsReport(result: PerformanceResult): string {
  const heading = 'STANDARD PERIODS'
  if (result.status !== 'ok') return stateLine(heading, 'needs_import')

  const set = standardPeriods(result.report)
  if (set === null) return stateLine(heading, 'no_history')

  return [
    [
      `${heading} — every period this app has computed. These are the only periods available, and each is named by the exact key below.`,
      SOURCE_NOTE,
      `Every window is anchored to the last day the imported history holds (${isoDay(set.extent.to)}), never to today's date. The whole history runs ${isoDay(set.extent.from)} to ${isoDay(set.extent.to)}, in ${set.baseCurrency}.`,
      '"Last 12 months" is the trailing window ending on that last day; a calendar year is the row named for the year itself. The phrase "last year" names one or the other and this app does not choose between them — answer from one row and say which.',
      `Calendar years: the ${set.yearsListed} most recent of ${set.yearsTotal} the history covers. Calendar quarters: the ${set.quartersListed} most recent of ${set.quartersTotal}. Older ones are not in front of you.`,
      'This report names the periods and carries no figures. Ask get_performance with one of these keys for a period’s return and value.',
    ].join('\n'),
    set.periods.map(periodRow).join('\n'),
  ].join('\n\n')
}

/** One period as a row: its key, its name, its window, and whether it holds a day at all. */
function periodRow(period: StandardPeriod): string {
  const head = `- ${period.id} — ${period.label} (${period.descriptor}, ${isoDay(
    period.bounds.from,
  )} to ${isoDay(period.bounds.to)}, ${period.calendarDays} calendar day(s))`

  // `valueAt` would carry a value into both ends of this window and report a flat period that never
  // happened. The state, instead of the figures (DDR-0099).
  return period.days === 0
    ? `${head}: empty. No day of the imported history falls inside it — say it holds no data, never that it was unchanged.`
    : `${head}: ${period.days} day(s) of data.`
}

// ---- get_performance --------------------------------------------------------

/**
 * One period's return and one period's value, apart and in that order (DDR-0099, DDR-0013).
 *
 * A deposit moves the value and moves no return, so the two sit under headings that say which is
 * which and the text repeats it in words. The flows follow, since what they explain is the half of
 * the value change that is not performance — and the statement rows are summed **whole**, naming the
 * span they really cover, since there is no pro-rated deposit in any report the app holds.
 *
 * The whole-history roll-ups come last under their own heading. Realised and unrealised profit and
 * loss are FIFO roll-ups with no windowed figure at all, and the honest move is to say so beside
 * them rather than to leave them under a period's heading where they read as its own.
 */
export function performanceReport(result: PerformanceResult, periodId: string): string {
  const heading = 'PERFORMANCE'
  const resolved = resolve(result, periodId)
  if (resolved.status === 'needs_import') return stateLine(heading, 'needs_import')
  if (resolved.status === 'no_history') return stateLine(heading, 'no_history')
  if (resolved.status === 'period_not_available') {
    return periodNotAvailable(heading, resolved.set, periodId)
  }

  const { report, set, period } = resolved
  const currency = set.baseCurrency
  const c = (value: number): string => formatCurrency(value, currency)
  const s = (value: number): string => formatSignedCurrency(value, currency)

  const blocks: string[] = [
    [
      `${heading} over ${period.label} (${period.descriptor}, ${isoDay(period.bounds.from)} to ${isoDay(period.bounds.to)}), in ${currency}.`,
      SOURCE_NOTE,
      `Periods are anchored to the last day the imported history holds (${isoDay(set.extent.to)}), never to today's date. The whole history runs ${isoDay(set.extent.from)} to ${isoDay(set.extent.to)}.`,
    ].join('\n'),
    // Ahead of every figure, for the reason RETURN precedes VALUE: whichever is met first is what a
    // sentence reaches for (DDR-0099, DDR-0101). A summary asked for after the numbers have been
    // read is a summary already phrased.
    spanBlock(period, set),
  ]

  if (period.days === 0) {
    blocks.push(EMPTY_PERIOD_NOTE)
    return blocks.join('\n\n')
  }

  blocks.push(
    [
      'RETURN over this period (a return, not a change in value):',
      `- Time-weighted return: ${formatSignedPercent(period.twr)}`,
      "- It is rebased to this period's own start, so it opens at 0% and is not a point on the same scale as any other period's return. Never add, subtract, chain or average it with another.",
      '- Money paid in or taken out does not move this figure. It is chain-linked from the cumulative return curve the app computed.',
      previousLine(period),
    ].join('\n'),
    [
      'VALUE over this period (a change in value, not a return):',
      `- Value at the start of the period: ${c(period.startValue)}`,
      `- Value at the end of the period: ${c(period.endValue)}`,
      `- Change in value: ${s(period.changeAbs)}${
        period.changePct === null ? '' : ` (${formatSignedPercent(period.changePct)})`
      }`,
      '- A change in value includes money paid in or taken out. Never call it performance, and never attribute it to the return above.',
      `- Days of data inside the period: ${period.days}.`,
    ].join('\n'),
    flowsBlock(report, period, s, c),
    [
      'WHOLE IMPORTED HISTORY, not the period above — quote these only as whole-history figures:',
      `- Cumulative time-weighted return: ${formatSignedPercent(report.cumulativeTwr)}`,
      `- Net deposits and withdrawals: ${s(report.totalDepositsWithdrawals)}`,
      `- Realised profit and loss: ${s(report.totalRealizedPnl)}`,
      `- Unrealised profit and loss: ${s(report.totalUnrealizedPnl)}`,
      '- Realised and unrealised profit and loss are not available for a chosen period; only these whole-history figures exist. If asked for either over the period, say it is not available.',
    ].join('\n'),
  )

  return blocks.join('\n\n')
}

/**
 * The one comparison the app computed, and the refusal of every other (DDR-0103).
 *
 * Consecutive same-kind pairs only — 2025 against 2024, Q1 against Q4 — which is the comparison an
 * owner actually makes and is linear where every pair would be quadratic. Quoting two returns is a
 * reading; subtracting them is arithmetic the model is forbidden (ADR-0009), so the line says both
 * what was computed and that nothing else may be.
 */
function previousLine(period: StandardPeriod): string {
  return period.previous === null
    ? '- No difference against another period was computed for this one. State this period on its own; do not compare it with another by subtracting returns.'
    : `- Against ${period.previous.label}, the period of the same kind immediately before it: ${formatSignedPoints(period.previous.points)}. This app computed that one difference and no other — never produce a difference between any other pair of periods.`
}

/**
 * The three overclaims restated for **this** period, and the one fact it has in their place.
 *
 * A summary is compression, and compression is where a model reaches for the conventional phrasing
 * of finance: an annualised figure, a benchmark, a risk statistic. All three are stated
 * unconditionally in the base context (Story #325), and what only this report can add is how long
 * the period really is — the honest fact an app with no annualisation states instead of scaling a
 * two-month return to a year. Emitted for an **empty** period too, which is where an ungrounded
 * comparison has the most room.
 */
function spanBlock(period: StandardPeriod, set: PeriodSet): string {
  const span = periodSpan(period.bounds, set.extent)

  return [
    'WHAT THIS APP DOES NOT COMPUTE, for this period: no annualised figure, no benchmark, no risk statistic.',
    `- This period covers ${span.periodDays} calendar day(s); the whole imported history covers ${span.historyDays}.`,
    span.coversAYear
      ? '- This period covers a year or more, so a return over it may be given as the return over this period — still never scaled, compounded or annualised to any other period.'
      : '- This period is shorter than a year, so never describe a return over it as annual, annualised, yearly or per year. State the period instead.',
  ].join('\n')
}

/** What moved value without moving return, over the statement rows the window touches. */
function flowsBlock(
  report: PerformanceReport,
  period: StandardPeriod,
  s: (value: number) => string,
  c: (value: number) => string,
): string {
  const flows = periodFlows(report.periods, flowWindow(period))
  if (flows.count === 0 || flows.covered === null) {
    return 'FLOWS AND INCOME: no statement period covers the period above, so deposits, withdrawals, dividend income and costs are not available for it. Say they are unavailable for this period; do not quote the whole-history deposits below in their place.'
  }

  const span = `${isoDay(flows.covered.from)} to ${isoDay(flows.covered.to)}`
  const lines = [
    `FLOWS AND INCOME, summed over the ${flows.count} statement period(s) covering ${span} (these move value; none of them moves the return above):`,
    `- Net deposits and withdrawals: ${s(flows.depositsWithdrawals)}`,
    `- Dividend income: ${c(flows.dividends)}`,
    `- Withholding tax: ${s(flows.withholdingTax)}`,
    `- Interest: ${s(flows.interest)}`,
    `- Commissions: ${s(flows.commissions)}`,
    `- Mark-to-market profit and loss: ${s(flows.mtm)}`,
  ]

  if (flows.partial) {
    // Statement rows are summed whole rather than split, so the totals belong to their own span.
    // Saying which span that is costs a sentence; letting a model read them as the window's own
    // would be a wrong figure under a right heading.
    lines.push(
      `- These statement periods are not cut to the chosen period: they run ${span}, which extends beyond it. Quote these totals as covering ${span}, not the period above.`,
    )
  }

  return lines.join('\n')
}

// ---- get_daily_returns ------------------------------------------------------

/**
 * The shape of the ride, and the statement that it is the only shape there is.
 *
 * **The tool was proposed as `get_daily_extremes` and its example question was "how volatile has the
 * ride been?"** DDR-0101 states the app computes **no risk statistic**, and DDR-0110 then made that
 * prohibition conditional — *"unless explicitly supplied by the application"* — so a tool whose
 * **name** promised volatility would read as that supply and unbind the rule it was named after. The
 * data is real; the name says what it returns, and the report says in its own words that no
 * dispersion statistic is in it and that none may be derived from what is.
 */
export function dailyReturnsReport(result: PerformanceResult, periodId: string): string {
  const heading = 'DAILY RETURNS'
  const resolved = resolve(result, periodId)
  if (resolved.status === 'needs_import') return stateLine(heading, 'needs_import')
  if (resolved.status === 'no_history') return stateLine(heading, 'no_history')
  if (resolved.status === 'period_not_available') {
    return periodNotAvailable(heading, resolved.set, periodId)
  }

  const { report, period } = resolved
  const opening = [
    `${heading} over ${period.label} (${period.descriptor}, ${isoDay(period.bounds.from)} to ${isoDay(period.bounds.to)}).`,
    SOURCE_NOTE,
    'Each day is chain-linked from the cumulative return curve and measured against the trading day that really preceded it, including the first day of the period. These are returns, not changes in value: money paid in or taken out moves no figure here.',
    'This report supplies no dispersion statistic. This app computes no volatility, standard deviation, Sharpe ratio, beta or drawdown, and the counts and two extremes below are the only dispersion that exists — never derive one of the others from them.',
  ].join('\n')

  if (period.days === 0) {
    return [opening, EMPTY_PERIOD_NOTE].join('\n\n')
  }

  const days = periodDays(periodDailyReturns(report, period))
  if (days.count === 0 || days.best === null || days.worst === null) {
    return [
      opening,
      'This period holds no day with a preceding trading day to measure against, so no daily return exists for it. Say so; do not report the period as unchanged.',
    ].join('\n\n')
  }

  return [
    opening,
    [
      `- ${days.count} trading day(s): ${days.up} up, ${days.down} down, ${days.flat} unchanged.`,
      `- Best day: ${formatSignedPercent(days.best.value)} on ${isoDay(days.best.date)}`,
      `- Worst day: ${formatSignedPercent(days.worst.value)} on ${isoDay(days.worst.date)}`,
    ].join('\n'),
  ].join('\n\n')
}

// ---- get_portfolio_history --------------------------------------------------

/**
 * Value over time **or** composition over time, never both in one payload (DDR-0013, DDR-0111).
 *
 * The `series` argument is the split, and it is the reason this tool exists as one tool rather than
 * as a value curve beside a return curve: the two answer different questions about the same days,
 * and a payload carrying both is how a model attributes a deposit to performance. Neither branch
 * carries a return — a period's return is `get_performance`'s single figure.
 *
 * **It is the largest payload in the Epic, so it is the one that says what it left out.** The days
 * are sampled to {@link MAX_HISTORY_POINTS}, evenly and with both ends kept, and the report states
 * that it sampled rather than letting a model read a monthly list as a daily one.
 */
export function portfolioHistoryReport(
  result: PerformanceResult,
  periodId: string,
  series: HistorySeries,
): string {
  const heading = series === 'value' ? 'PORTFOLIO VALUE' : 'PORTFOLIO COMPOSITION'
  const resolved = resolve(result, periodId)
  if (resolved.status === 'needs_import') return stateLine(heading, 'needs_import')
  if (resolved.status === 'no_history') return stateLine(heading, 'no_history')
  if (resolved.status === 'period_not_available') {
    return periodNotAvailable(heading, resolved.set, periodId)
  }

  const { report, set, period } = resolved
  const opening = `${heading}, day by day, over ${period.label} (${period.descriptor}, ${isoDay(period.bounds.from)} to ${isoDay(period.bounds.to)}), in ${set.baseCurrency}.\n${SOURCE_NOTE}`

  return series === 'value'
    ? valueHistory(report, period, set.baseCurrency, opening)
    : compositionHistory(report, period, set.baseCurrency, opening)
}

/** The days the portfolio was worth something, listed. A value, and never a return. */
function valueHistory(
  report: PerformanceReport,
  period: StandardPeriod,
  currency: string,
  opening: string,
): string {
  const points = periodValueSeries(report, period)
  const head = [
    opening,
    'Every figure below is a portfolio value, never a return: money paid in or taken out moves all of them and moves no return. Ask get_performance for the return over this period, and never read a rise here as performance.',
  ].join('\n')

  if (points.length === 0) return [head, EMPTY_PERIOD_NOTE].join('\n\n')

  const listed = downsample(points, MAX_HISTORY_POINTS)
  return [
    head,
    sampleLine(listed.length, points.length),
    listed.map((point) => `- ${isoDay(point.date)}: ${formatCurrency(point.value, currency)}`).join('\n'),
  ].join('\n\n')
}

/**
 * How the portfolio was divided on each of those days, in amounts that sum to net asset value.
 *
 * An asset class the imported statements never carried has **no band at all** — absent, not zero
 * (DDR-0050) — and a negative band is a real observation rather than an error: cash goes negative on
 * margin, and the app neither clamps it nor folds it away (DDR-0052).
 */
function compositionHistory(
  report: PerformanceReport,
  period: StandardPeriod,
  currency: string,
  opening: string,
): string {
  const composition = periodComposition(report, period.bounds)
  const head = [
    opening,
    'Each band is an amount and the bands sum to net asset value on that day. An asset class the imported statements never carried has no band here at all — it is absent, not zero — and a negative band is a real observation, not an error.',
  ].join('\n')

  if (composition.points.length === 0) {
    return [
      head,
      'The imported statements do not include the daily net-asset-value breakdown for this period, so how the portfolio was divided over it is not available. Say it is unavailable; do not describe a shape.',
    ].join('\n\n')
  }

  const bands = report.compositionSeries.bands
  const listed = downsample(composition.points, MAX_HISTORY_POINTS)

  return [
    head,
    sampleLine(listed.length, composition.points.length),
    listed
      .map((point) => {
        const split = bands
          .map((band, index) => `${band.label} ${formatCurrency(point.values[index] ?? 0, currency)}`)
          .join('; ')
        return `- ${isoDay(point.date)} — net asset value ${formatCurrency(point.total, currency)}: ${split}`
      })
      .join('\n'),
  ].join('\n\n')
}

/** How much of the history is in front of the model, stated rather than silently cut. */
function sampleLine(listed: number, total: number): string {
  return listed === total
    ? `All ${total} day(s) of data in this period, oldest first.`
    : `The ${listed} day(s) below are evenly spaced samples of the ${total} day(s) this period holds, oldest first, with the first and last day kept. The days between them are not in front of you — never read this list as every day of the period.`
}

/**
 * Evenly spaced samples of a list, both ends kept.
 *
 * A **selection**, not a computation: every figure listed is one the app really observed on a day it
 * really observed it, and nothing is averaged, interpolated or smoothed into a point that never
 * existed. What the sampling costs is stated by {@link sampleLine} rather than left to be noticed.
 */
function downsample<T>(items: readonly T[], cap: number): T[] {
  if (items.length <= cap) return [...items]
  const step = (items.length - 1) / (cap - 1)
  return Array.from({ length: cap }, (_, index) => items[Math.round(index * step)]!)
}
