import { formatCurrency, formatSignedCurrency, instrumentName } from '@shared/format'
import {
  dividendIncome,
  dividendWindows,
  undatedEvents,
  type DividendSymbolIncome,
} from '@shared/domain/dividendPeriods'
import { findWindow, type PeriodWindow, type PeriodWindowSet } from '@shared/domain/standardPeriods'
import { isoDay, isoMinute } from './toolReports'
import type { DataCoverage } from '@services/dataCoverage/dataCoverageService'
import type { DividendResult, UpcomingDividends } from '@shared/domain/dividends'
import type { RealizedGainsReport, RealizedGainsResult } from '@shared/domain/realizedGains'

/**
 * The three reports the assistant has never seen (Story #329, DDR-0111).
 *
 * Dividend income and realised gains have been services since M3, on IPC, drawn on two dashboards —
 * and reachable by the model nowhere. They satisfied ADR-0009's 1:1 rule the whole time; the only
 * thing keeping them out was **cost**, because the assembled context committed 82.2% of the send
 * ceiling before a question was asked (DDR-0110). Epic #322 is what removed that constraint, and
 * this story is where the removal is spent.
 *
 * ## Coverage is the one that keeps the other two honest
 *
 * DDR-0098 requires every figure to name its **store and its clock**, and reports arriving one at a
 * time is exactly how that pairing gets lost — the base context says there are two stores on two
 * clocks, and `get_data_coverage` is what says *where each one currently stands*. It is also the
 * only tool in the app with **no `needs_import` state**: nothing imported is not a failure to report
 * coverage, it is the coverage. A state there would be the empty-report-standing-in-for-a-state
 * failure inverted, which is worth naming because every other analytics report here does the
 * opposite.
 *
 * ## What each report may carry
 *
 * Income and realised gains declare `performance`, the one disclosure category written at `figures`
 * and the only one under which an amount of money may appear — its own text already names dividend
 * income and realised gains as amounts in the base currency of the imported statements (DDR-0098).
 * Coverage declares `coverage`, added by this story because what it sends — how many statements,
 * what span, when imported, how many snapshots — is named by no existing category, and the whole
 * mechanism of that list is that a story cannot send something new without declaring it.
 *
 * ## The traps these two carry, and where they are actually handled
 *
 * Realised gains has shipped **25% overstated** once (#103), on two traps that live in the FIFO
 * summary: an aggregate `Total (All Assets)` row with a blank symbol that doubles every total, and a
 * row that mixes a flow with a balance — realised P&L is per-period and must be summed across
 * statements, unrealised is an as-of balance that must not be. Both are `realizedGainsService`'s,
 * filtered with `isInstrumentSummary` and scoped with `fromLatestStatement`, and tested there. What
 * this module must not do is undo them: **every total below is the service's own**, never a sum over
 * the rows this report happens to list, because the rows are capped and the totals are not.
 */

/** How many instruments an income breakdown names before it says what it left out. */
export const MAX_LISTED_INCOME_SYMBOLS = 10

/** How many instruments each end of the realised-gains list names. Two ends, so twice this. */
export const MAX_LISTED_REALIZED = 6

/** How many announced-but-unpaid dividends are named, soonest first. */
export const MAX_LISTED_UPCOMING = 5

/** Which store both income and realised gains read, and on which clock. */
const SOURCE_NOTE =
  'From imported Flex history, as of the latest statement imported — never live, and never as of today.'

// ---- get_dividend_income ----------------------------------------------------

/**
 * What the portfolio paid over one standard period, gross and withholding kept apart (DDR-0080).
 *
 * **Two series across one baseline, never one net figure.** The chart draws gross rising and
 * withholding hanging below zero because they are different facts about the same events; a report
 * that handed over a net figure alone would be a third number neither of the two can be recovered
 * from. All three are given, and the text says which is which.
 *
 * **The window is cut from the dividend history's own span.** This tool reaches one service method
 * (DDR-0111) and that method knows nothing about the value series, so `trailing:1y` here trails back
 * from the last dated *dividend*, which may not be the last day the value history holds. The report
 * says so in its own opening rather than letting a key carried from `get_performance_periods` mean
 * two windows silently.
 *
 * **Absent is not zero, in three places**: a period with no dividend event is a state and not a
 * period that paid nothing, an undated cash event is inside no window at all and is counted out
 * loud, and a statement exported without its open-accruals section says the section is missing
 * rather than that nothing is coming (DDR-0010).
 */
export function dividendIncomeReport(result: DividendResult, periodId: string): string {
  const heading = 'DIVIDEND INCOME'

  if (result.status === 'needs_import') {
    return `${heading}: no Flex statement has been imported, so this app holds no dividend history at all. Say nothing has been imported and that importing a statement from the Portfolio view is what makes income available. Do not answer from the live portfolio, which is a different store on a different clock and holds no income at all.`
  }

  const report = result.report
  const windows = dividendWindows(report)

  if (windows === null) {
    // Two different silences, and they recover differently: an account that has been paid nothing is
    // not an import whose rows carry no date (DDR-0022).
    return report.events.length === 0
      ? `${heading}: the imported statements carry no dividend or withholding cash transaction at all. Say the imported history records no dividend income — never that income was zero over some period, because no period was measured.`
      : `${heading}: the imported statements carry ${report.events.length} dividend cash event(s), but not one of them carries a date, so no period can be measured over them. Say the income cannot be placed in time; do not report it as belonging to any period.`
  }

  const window = findWindow(windows, periodId)
  if (window === null) return periodNotAvailable(heading, windows, periodId)

  const income = dividendIncome(report, window.bounds)
  const currency = report.baseCurrency
  const c = (value: number): string => formatCurrency(value, currency)

  const blocks: string[] = [
    [
      `${heading} over ${window.label} (${window.descriptor}, ${isoDay(window.bounds.from)} to ${isoDay(window.bounds.to)}), in ${currency}.`,
      SOURCE_NOTE,
      `Periods here are cut from the dividend history's own span — ${isoDay(windows.extent.from)} to ${isoDay(windows.extent.to)}, the first and last dated dividend event — and not from the value history, which may end on a different day. A period key names the same shape of window in both reports over a possibly different span, so say which report a figure came from and never read one period's income beside another report's return as though the two covered the same days.`,
      'Gross income and withholding tax are two separate figures about the same events, never one net figure alone. Withholding is given as the amount withheld, a positive number.',
    ].join('\n'),
  ]

  if (income.events === 0) {
    blocks.push(
      'No dividend cash event falls inside this period, so there is nothing to report about it. Say the period holds no dividend income; never say the portfolio paid nothing, and never describe the income as flat, steady or unchanged.',
    )
  } else {
    blocks.push(
      [
        `- Gross dividend income: ${c(income.grossBase)}`,
        `- Withholding tax: ${c(income.withholdingBase)}`,
        `- Net income after withholding: ${c(income.netBase)}`,
        `- Cash events inside this period: ${income.events}`,
        '- Withholding is reported as the figure it is. This app computes no tax treatment, no tax efficiency and no tax outcome, so never conclude one from it and never describe a withheld amount as recoverable, reclaimable or a cost that could be avoided.',
      ].join('\n'),
      symbolBlock(income.bySymbol, currency),
    )
  }

  const undated = undatedEvents(report)
  if (undated > 0) {
    blocks.push(
      `${undated} dividend cash event(s) in the imported history carry no date at all. They fall inside no period — not even the whole history — so they are in none of the figures above. Say so if the totals are questioned; never add them to a period yourself.`,
    )
  }

  blocks.push(upcomingBlock(report.upcoming, currency))

  return blocks.join('\n\n')
}

/** Which instruments paid, largest net first, with the cut stated rather than silent. */
function symbolBlock(bySymbol: readonly DividendSymbolIncome[], currency: string): string {
  const listed = bySymbol.slice(0, MAX_LISTED_INCOME_SYMBOLS)
  const head =
    listed.length === bySymbol.length
      ? `All ${bySymbol.length} instrument(s) that paid inside this period, by net income:`
      : `The ${listed.length} largest of ${bySymbol.length} instruments that paid inside this period, by net income; the rest are not in front of you, so do not say these are all of them:`

  return [
    head,
    ...listed.map((group) => {
      // `instrumentName`, never `formatCompanyName`: a description that repeats the ticker is not a
      // name, and title-casing one produces `Cad` (DDR-0066, DDR-0067).
      const name = instrumentName(group.symbol, group.description)
      return `- ${name === null ? group.symbol : `${group.symbol} (${name})`}: gross ${formatCurrency(group.grossBase, currency)}, withholding ${formatCurrency(group.withholdingBase, currency)}, net ${formatCurrency(group.netBase, currency)}`
    }),
  ].join('\n')
}

/**
 * Dividends declared and not yet paid — as of a statement, and **not** part of the period above.
 *
 * It is carried whatever period was asked for, because it belongs to no period: an accrual is an
 * as-of balance from the latest statement, like an open position (DDR-0010). The section is optional
 * in a Flex export and its absence is stated as an absent section — an account whose export omits it
 * has not been told there is nothing coming.
 */
function upcomingBlock(upcoming: UpcomingDividends, currency: string): string {
  const heading =
    'ANNOUNCED BUT NOT YET PAID — declared dividends that have generated no cash. These belong to no period and are in none of the figures above; never add them to a period’s income and never call them income received.'

  if (!upcoming.sectionPresent) {
    return `${heading}\nThe latest imported statement carries no open-dividend-accruals section at all. That is a section missing from the export, not an absence of upcoming dividends: say it is unavailable, and never say that nothing is coming.`
  }

  if (upcoming.items.length === 0) {
    return `${heading}\nThe latest imported statement declared no unpaid dividend as of ${upcoming.asOf === null ? 'its report date' : isoDay(upcoming.asOf)}. Say none was declared as of that date — this is as of a statement, not as of today, and a dividend announced since is not in this app.`
  }

  const listed = upcoming.items.slice(0, MAX_LISTED_UPCOMING)
  return [
    heading,
    `As of ${upcoming.asOf === null ? 'the latest statement’s report date' : isoDay(upcoming.asOf)}, ${upcoming.items.length} declared dividend(s) were unpaid, coming to ${formatCurrency(upcoming.totalGrossBase, currency)} gross and ${formatCurrency(upcoming.totalNetBase, currency)} net of expected withholding.`,
    listed.length === upcoming.items.length
      ? 'All of them, soonest pay date first:'
      : `The ${listed.length} soonest of them; the rest are not in front of you:`,
    ...listed.map((item) => {
      const name = instrumentName(item.symbol, item.description)
      return `- ${name === null ? item.symbol : `${item.symbol} (${name})`}: ${formatCurrency(item.netBase, currency)} net, ${
        item.payDate === null
          ? 'with no pay date set yet — declared, and not scheduled'
          : `payable ${isoDay(item.payDate)}`
      }`
    }),
  ].join('\n')
}

// ---- get_realized_gains -----------------------------------------------------

/**
 * What closing trades came to, and what open positions are worth above cost (Story #329).
 *
 * **Two figures of different kinds, and the difference is the bug that shipped.** Realised P&L is a
 * per-period *flow* and is summed across every imported statement; unrealised P&L is an *as-of
 * balance* and is taken from the latest statement alone, or an instrument held through two
 * statements contributes its gain twice — which is Bug #103, and 25% overstated. Both are scoped in
 * `realizedGainsService`; this report quotes them and says what each one is, because a model given
 * two amounts under one heading will add them.
 *
 * **It takes no arguments and holds no period.** There is no windowed realised figure in this app at
 * all — `get_performance` says the same thing about its own whole-history roll-ups — so the report
 * states that outright rather than letting a question about last year be answered with a
 * whole-history total.
 *
 * **It is a report, not the trade history.** The service also returns every executed trade; a list
 * of rows is raw data for a model to derive from, which is the one thing ADR-0009 forbids a tool to
 * return, so no trade appears here.
 */
export function realizedGainsReport(result: RealizedGainsResult): string {
  const heading = 'REALISED GAINS'

  if (result.status === 'needs_import') {
    return `${heading}: no Flex statement has been imported, so this app holds no realised or unrealised profit and loss at all. Say nothing has been imported and that importing a statement from the Portfolio view is what makes them available. Never answer from the live portfolio: its figures are today's prices against cost, not what the imported statements recorded.`
  }

  const report = result.report
  const currency = report.baseCurrency
  const s = (value: number): string => formatSignedCurrency(value, currency)

  return [
    [
      `${heading} AND UNREALISED PROFIT AND LOSS, over the whole imported history, in ${currency}. This report holds no period at all.`,
      SOURCE_NOTE,
    ].join('\n'),
    [
      'REALISED — what closing trades actually came to, summed over every imported statement:',
      `- Realised profit and loss: ${s(report.totalRealized)}`,
      `- Of which short-term: ${s(report.totalRealizedShortTerm)}`,
      `- Of which long-term: ${s(report.totalRealizedLongTerm)}`,
      '- Short and long term are IBKR’s own holding-period split. They are not a tax outcome: this app computes no tax treatment, no tax efficiency and no tax outcome, so never conclude one from them.',
    ].join('\n'),
    [
      'UNREALISED — what open positions were worth above or below cost, as of the latest imported statement alone:',
      `- Unrealised profit and loss: ${s(report.totalUnrealized)}`,
      '- This is a balance on one day, not a flow over the history, and it is out of the imported statements rather than out of today’s prices. Never add it to the realised figure above, never present the pair as a total profit, and never call either one a return — this app computes no return from them. The return over a period is get_performance’s figure and is a different kind of number entirely.',
      '- Realised and unrealised figures are not available for a chosen period. If asked for either over a period, say only the whole-history figures exist rather than answering from them.',
    ].join('\n'),
    instrumentBlock(report, currency),
    'No trade-by-trade history is in this report: this app gives no list of executions to the assistant. Say that individual trades are not available, and never reconstruct one from the figures above.',
  ].join('\n\n')
}

/**
 * The instruments behind the realised figure, at both ends of it.
 *
 * Both ends rather than the largest N, because a list sorted by realised profit and cut at the top
 * shows every winner and no loser — a shape a model reads as a portfolio that only wins. The rows
 * are a **selection out of the order the service produced**, and the totals above are the service's
 * own: an instrument outside these lists is inside those totals, which the count line says.
 */
function instrumentBlock(report: RealizedGainsReport, currency: string): string {
  const rows = report.bySymbol
  if (rows.length === 0) {
    return 'No instrument in the imported history has any realised profit or loss: nothing has been closed, or the statements cover only open positions. Say so rather than reporting a realised figure of zero for an instrument.'
  }

  const gains = rows.filter((row) => row.totalRealized > 0).slice(0, MAX_LISTED_REALIZED)
  const losses = rows
    .filter((row) => row.totalRealized < 0)
    .slice(-MAX_LISTED_REALIZED)
    .reverse()

  const line = (row: RealizedGainsReport['bySymbol'][number]): string => {
    const name = instrumentName(row.symbol, row.description)
    return `- ${name === null ? row.symbol : `${row.symbol} (${name})`}: ${formatSignedCurrency(row.totalRealized, currency)} (short-term ${formatSignedCurrency(row.realizedShortTerm, currency)}, long-term ${formatSignedCurrency(row.realizedLongTerm, currency)})`
  }

  const lines = [
    `BY INSTRUMENT — ${rows.length} instrument(s) have realised profit or loss in the imported history. The totals above cover all of them; the rows below are the largest at each end and never a sum of their own.`,
  ]

  lines.push(
    '',
    gains.length === 0
      ? 'No instrument closed at a profit.'
      : `Largest realised gains (${gains.length} of ${rows.filter((row) => row.totalRealized > 0).length}):`,
    ...gains.map(line),
  )
  lines.push(
    '',
    losses.length === 0
      ? 'No instrument closed at a loss.'
      : `Largest realised losses (${losses.length} of ${rows.filter((row) => row.totalRealized < 0).length}):`,
    ...losses.map(line),
  )

  return lines.join('\n')
}

// ---- get_data_coverage ------------------------------------------------------

/**
 * What this app holds, where, and on which clock — the report that always answers (Story #329).
 *
 * **Nothing imported is a coverage report, never `needs_import`.** It is the answer to the question,
 * and it is the one place in the app where an empty store is not a state to be routed around.
 *
 * The three sources are named apart because DDR-0098's pairing is the thing most easily lost once
 * reports arrive one at a time: the imported statements are a store *and* a clock, the local
 * snapshots are a store the assistant has no report over at all, and the live portfolio is a clock
 * with no history. A model that has been handed a composition figure and a drift figure in the same
 * conversation has met two of those without being told they are two.
 *
 * No money appears here — not a snapshot's value, not a statement's net asset value. Coverage says
 * how much data there is, never what it is worth.
 */
export function dataCoverageReport(coverage: DataCoverage): string {
  const { flex, snapshots } = coverage

  const flexLines =
    flex.statements === 0
      ? [
          '- Nothing has been imported at all. This is the coverage, not a failure to report it: every report built on imported statements — returns, value, composition, allocation, dividend income and realised gains — has nothing to read, and says so when asked. The owner imports a Flex statement from the Portfolio view.',
        ]
      : [
          `- Statements imported: ${flex.statements}.`,
          `- They cover ${isoDay(flex.from!)} to ${isoDay(flex.to!)}. Every figure out of this store is as of the latest statement imported, never as of today — so anything the account did after ${isoDay(flex.to!)} is in none of it.`,
          `- The most recent import ran ${isoDay(flex.latestImportedAt!)}.`,
          flex.baseCurrencies.length === 1
            ? `- Base currency of the imported statements: ${flex.baseCurrencies[0]}. Every amount out of this store is in it.`
            : `- The statements carry more than one base currency (${flex.baseCurrencies.join(', ')}). Amounts out of this store are in the currency each report names; never total two of them.`,
        ]

  return [
    [
      `DATA COVERAGE — what this app holds locally and how current it is, read ${isoMinute(coverage.readAt)}. This report carries no amount of money and no portfolio figure of any kind.`,
      'There are three sources and they do not tick together. Never mix a figure from one with a figure from another.',
    ].join('\n'),
    [
      'IMPORTED FLEX STATEMENTS — the store behind returns, value, composition, allocation, dividend income and realised gains:',
      ...flexLines,
    ].join('\n'),
    [
      'LOCAL SNAPSHOTS — the app’s own captured history of the live portfolio, kept on this machine:',
      snapshots.captures === 0
        ? '- No snapshot has been captured. Nothing depends on them today; this is a fact about the app, not a gap in an answer.'
        : `- ${snapshots.captures} capture(s), the first ${isoDay(snapshots.earliest!)} and the most recent ${isoDay(snapshots.latest!)}.`,
      '- No report you can ask for is built on them, so never answer a question from a snapshot: say the assistant has no report over the captured history.',
    ].join('\n'),
    [
      'THE LIVE PORTFOLIO — holdings, weights, single positions and rebalancing gaps:',
      '- Read from the IBKR gateway at the moment each of those reports is asked for, and named with the time it was read. It has no coverage and no history: it is whatever the account holds now.',
      '- It is not covered by anything above. If the gateway is not running, those reports say so and nothing in the imported store stands in for them.',
    ].join('\n'),
  ].join('\n\n')
}

// ---- shared phrasing --------------------------------------------------------

/**
 * The miss, with the alternatives beside it — the same shape `performanceReports.ts` writes.
 *
 * Written twice rather than shared, and the difference is what makes it worth writing twice: the
 * alternatives here are the **dividend history's** windows, which is the fact the report has to
 * carry. Sharing the function would mean passing the vocabulary in, which is the point at which two
 * period sets start looking like one (DDR-0102).
 */
function periodNotAvailable(heading: string, set: PeriodWindowSet, asked: string): string {
  return [
    `${heading}: this app holds no dividend period called "${asked.trim()}". It computes a fixed set of periods over the dividend history and nothing else — there is no way to ask for an arbitrary date range.`,
    'Say the period is not available and name the ones that are, listed below. Never answer about a neighbouring period as though it were the one asked for, and never combine two of them into a third.',
    `These are cut from the dividend history's own span, ${isoDay(set.extent.from)} to ${isoDay(set.extent.to)}, so a key get_performance_periods lists may not be among them:`,
    '',
    ...set.windows.map((window: PeriodWindow) => `- ${window.id} — ${window.label} (${window.descriptor})`),
  ].join('\n')
}
