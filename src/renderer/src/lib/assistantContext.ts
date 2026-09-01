import {
  formatCurrency,
  formatSignedCurrency,
  formatSignedPercent,
  formatSignedPoints,
} from '@shared/format'
import { periodChange, type PeriodChange } from './periodChange'
import { standardPeriods, type PeriodSet, type StandardPeriod } from './periodSet'
import type { AssistantContext } from '@shared/domain/assistantDisclosure'
import type { AllocationResult } from '@shared/domain/allocation'
import type { PerformanceResult } from '@shared/domain/performance'
import type { BalanceDriftResult } from '@shared/domain/balanceDrift'
import { isProfileEmpty, type InvestorProfile } from '@shared/domain/investorProfileTerms'

/**
 * What the assistant is given without being asked (Story #284, DDR-0098; narrowed by Story #326).
 *
 * **The model never produces a figure** (ADR-0009). That sentence is only true if something else
 * produces every one of them, and this used to be the whole of that something: holdings, weights,
 * the profile, the drift and a period explained, assembled here and sent with every question
 * whatever was asked.
 *
 * **Three of those four sections are gone from here, and are tools now** (Epic #322, DDR-0111). The
 * live book, the allocation, the investor profile and the rebalancing gaps are computed in main by
 * `services/assistant/toolReports.ts` when the model asks for them, which is what lets a question
 * about one of them cost one report instead of all four — and what lets a report reach detail a cap
 * here used to truncate away. The prose was **moved rather than copied**: there is still exactly one
 * implementation of how this app writes a weight, which is the property DDR-0098's criterion is
 * actually about.
 *
 * What is left here is the **performance** section, which #327 takes behind its own tools. Until it
 * does, an explanation of the history is assembled and sent as it always was; nothing about it
 * changed in this story except that it is now the only section.
 *
 * It is a pure module for the reason everything in `lib/` is one — Vitest runs Node-only with no
 * jsdom (DDR-0029), so a string built inside a component is a string nothing can assert.
 *
 * ## The rules that still hold it together
 *
 * **Return and value are two sections' worth of care in one.** The app's curve is cumulative
 * time-weighted return (DDR-0013) and does not move on a deposit; a portfolio can be worth 20% more
 * and have returned 2%. So the performance section states them apart, each under a heading that says
 * which it is, and says in the text itself that a flow moves one and not the other — because
 * conflating them is the failure this Epic is least likely to catch, the wrong answer being the
 * flattering one.
 *
 * **Absent is absent, never zero.** A report that could not be read produces no section rather than
 * an empty one, and the view says so beside the box in its own words. A heading with nothing under
 * it invites the model to fill it in, which is exactly the failure grounding exists to prevent.
 *
 * **What the app does not compute is said, not left out.** The three absences a summary reaches for
 * — an annualised return, a benchmark, a risk statistic — are stated **unconditionally** in the base
 * context now (`@shared/domain/assistantAbsences`, Story #325), above every section and every
 * report. This section restates the ones qualifying its own period, which is belt-and-braces rather
 * than the binding (DDR-0101, DDR-0111).
 *
 * **Every line names its source.** This section reads the **imported Flex store** and is as of the
 * latest statement; the tools that read the live portfolio say so in their own opening lines. Two
 * different clocks, and an answer that silently mixed them would be wrong in a way no reader could
 * catch — which is why the pairing is also stated unconditionally in the base context.
 */

/**
 * What a view has read, in whatever state each read came back in.
 *
 * **Still all four, and the three that no longer build a section still earn their place**: `askGate`
 * asks whether there is anything at all to ground an answer in, and `groundingNotices` names each
 * gap beside the box — a missing import, an unset profile, a gateway that is not answering. Those
 * are questions about what the *app* can see, and a tool the model may or may not call cannot answer
 * them before a question is typed (Story #326).
 */
export interface GroundingReports {
  /** Composition from imported Flex history — `needs_import` when the store is empty. */
  allocation: AllocationResult
  /** The owner's own policy. The empty profile when they have never written one. */
  profile: InvestorProfile
  /** How far the live portfolio sits from that policy, or which blocker is in the way. */
  drift: BalanceDriftResult
  /** The performance history a period is explained out of — `needs_import` with no Flex data. */
  performance: PerformanceResult
}

/**
 * Assemble the context, keyed by the categories the disclosure declares (DDR-0098).
 *
 * The keys are the disclosure's own ids and nothing else can be added here — `AssistantContext`
 * forbids it at compile time, and the IPC boundary drops it at runtime.
 *
 * **One category is assembled now, and that is the story rather than an omission** (Story #326).
 * `holdings`, `weights` and `profile` are tools; sending them here as well would put every figure in
 * front of the model twice, spend the round budget the tools need, and defeat the Epic. The category
 * *list* is untouched — the tools declare the same ids, and are held to them by the same list.
 */
export function buildAssistantContext(reports: GroundingReports): AssistantContext {
  const context: AssistantContext = {}

  const change = wholeHistory(reports)
  if (change !== null) {
    // One category, two sections. The whole history explained, then every standard window as a row
    // the question may name (Story #287) — both are returns and values out of the imported Flex
    // store, which is what the `performance` category already declares.
    const set =
      reports.performance.status === 'ok' ? standardPeriods(reports.performance.report) : null
    context.performance = [performanceSection(change), set && periodsSection(set)]
      .filter((block): block is string => typeof block === 'string')
      .join('\n\n')
  }

  return context
}

/**
 * The whole imported history as one period, or `null` where there is none.
 *
 * **`all` is not a default standing in for a missing selection — it is the only honest window when
 * nothing has been asked yet.** #285 resolved whatever the owner had clicked on a `RangeFilter`;
 * with that control gone (DDR-0102) the section describes the history entire, which is also the
 * *identity* case of rebasing that DDR-0072 already argued the curve's baseline note out of being
 * conditional on.
 *
 * `null` is the report having nothing to window, not a window being empty — the two are different
 * states. Over the full extent the second is unreachable: `periodChange` returns `null` for an empty
 * series and `boundsFor('all')` is the extent itself, so a resolved history always holds at least
 * one day. `periodChange`'s own empty-window handling stays, because #287 windows this report again
 * and a quarter with no data in it is exactly that state.
 */
export function wholeHistory(reports: GroundingReports): PeriodChange | null {
  if (reports.performance.status !== 'ok') return null
  return periodChange(reports.performance.report, { range: 'all', custom: null })
}

/**
 * Every standard period, as rows a question can name (Story #287, DDR-0103).
 *
 * **The set is the answer to a question about a period it does not hold.** A free-text box takes any
 * window — *how did I do between March and July?* — and the app holds figures for a fixed set of
 * them. The failure mode is not that the model refuses; it is that it reaches for the nearest row
 * and answers about that instead, which is a right-looking figure under the wrong heading. So the
 * section opens by saying these are the only periods available and that the unavailable ones are to
 * be *named as unavailable*, with the alternatives listed underneath. DDR-0022's discipline — an
 * unavailable thing is a state, not a silence — in prose.
 *
 * **Each row keeps return and value apart** (DDR-0013, DDR-0099), for the reason the whole-history
 * section does: a deposit moves one and not the other, and the conflation is the flattering error.
 *
 * **Rebasing is stated once, for all of them.** Every return here is chain-linked onto its own
 * period's start, so each opens at zero and no two are points on one scale (DDR-0072). That makes
 * subtracting two of them meaningless as often as not — which is why the differences that *are*
 * meaningful are computed into the rows themselves and the model is told not to produce any other.
 *
 * **An empty period is a state.** A window with no day of imported history in it gets the state
 * instead of figures, never a calm 0% (DDR-0099).
 */
export function periodsSection(set: PeriodSet): string {
  const rows = set.periods.map((period) => periodRow(period, set.baseCurrency))

  return [
    [
      'STANDARD PERIODS — every period this app has computed. These are the only periods available.',
      'If the question names a window that is not one of these, say it is not available and name the periods that are, listed below. Never answer about a neighbouring period as though it were the one asked for, and never combine two of these rows into a third.',
      `Every window below is anchored to the last day the imported history holds (${isoDay(set.extent.to)}), never to today's date. The whole history runs ${isoDay(set.extent.from)} to ${isoDay(set.extent.to)}.`,
      `Each return is rebased to its own period's start, so every period opens at 0% and two of them are not points on one scale. Never add, subtract, chain or average two of these returns. Where a difference between two periods was computed, it is written on the row itself.`,
      'For every row, the return and the change in value are different figures about the same period: money paid in or taken out moves the value and does not move the return.',
      `Calendar years: the ${set.yearsListed} most recent of ${set.yearsTotal} the history covers. Calendar quarters: the ${set.quartersListed} most recent of ${set.quartersTotal}. Older ones are not in front of you.`,
    ].join('\n'),
    rows.join('\n'),
  ].join('\n\n')
}

/** One period's row: what it is, how long it is, what it returned, and what it was worth. */
function periodRow(period: StandardPeriod, baseCurrency: string): string {
  const head = `- ${period.label} (${period.descriptor}, ${isoDay(period.bounds.from)} to ${isoDay(
    period.bounds.to,
  )}, ${period.calendarDays} calendar day(s))`

  // A window `valueAt` would happily carry a value into both ends of, reporting a flat period that
  // never happened. The state, instead of the figures (DDR-0099).
  if (period.days === 0) {
    return `${head}: no day of the imported history falls inside this period. It is an empty period, not a flat one — say it holds no data, never that it was unchanged.`
  }

  const c = (value: number): string => formatCurrency(value, baseCurrency)
  const parts = [
    `${period.days} day(s) of data`,
    `return ${formatSignedPercent(period.twr)}`,
    `value ${c(period.startValue)} → ${c(period.endValue)}, change ${formatSignedCurrency(
      period.changeAbs,
      baseCurrency,
    )}${period.changePct === null ? '' : ` (${formatSignedPercent(period.changePct)})`}`,
  ]

  if (period.previous !== null) {
    parts.push(
      `return against ${period.previous.label}: ${formatSignedPoints(period.previous.points)}`,
    )
  }

  return `${head}: ${parts.join('; ')}`
}

/**
 * What changed over the whole imported history (Story #285).
 *
 * The one section that may carry amounts of money, and the one whose ordering is an argument:
 * **return first, value second, flows third**. A reader — or a model — who meets the value change
 * first will reach for performance to explain it, and by the time the deposit appears the sentence
 * is already written. Meeting the return first, then the value, then what moved the value and not
 * the return, is the explanation in the order that makes it hard to get wrong. Each of the three
 * headings says which of the two it is, in words, rather than relying on the figure's units.
 *
 * Every figure below is `periodChange`'s, formatted here and nowhere else. Nothing is derived in
 * this function — not a difference, not a share, not a total — because a figure this file computed
 * would be a figure no page shows.
 *
 * **The period is stated with its anchor.** A preset ends at the last day the imported history
 * holds, not today (DDR-0085), and an explanation that did not say so would let a reader date the
 * period from their own calendar. Where the flows cover more than the window — statement rows are
 * summed whole, never pro-rated — the span they really cover is named instead of implied.
 *
 * **What the app cannot break down by period is put under its own heading**, in as many words.
 * Realised and unrealised profit and loss come off the FIFO summaries as whole-history rollups;
 * there is no windowed figure for either, and the honest move is to say so beside the two totals
 * rather than to quietly place them under a period's heading, where a model would read them as its
 * own. That is Story #285's "record a finding rather than compute one" (see DDR-0099).
 *
 * **What the app does not compute at all is named before any figure is.** Story #286 asks the same
 * section to survive being *summarised*, and a summary reaches for annualisation, a benchmark and a
 * risk statistic — none of which exists here. Since Story #325 those three are stated
 * unconditionally in the base context, above every section; {@link periodSpanBlock} restates them
 * for this period and gives the period's real calendar span second, ahead of the numbers, on
 * DDR-0099's own ordering argument (see DDR-0101, DDR-0111).
 */
export function performanceSection(change: PeriodChange): string {
  const c = (value: number): string => formatCurrency(value, change.baseCurrency)
  const s = (value: number): string => formatSignedCurrency(value, change.baseCurrency)

  const blocks: string[] = [
    [
      `From imported Flex history, in ${change.baseCurrency}.`,
      `Period the owner chose: ${change.label} — ${isoDay(change.bounds.from)} to ${isoDay(change.bounds.to)}.`,
      `Periods are anchored to the last day the imported history holds (${isoDay(change.extent.to)}), never to today's date. The whole history runs ${isoDay(change.extent.from)} to ${isoDay(change.extent.to)}.`,
    ].join('\n'),
    // Second, ahead of every figure, for the reason RETURN precedes VALUE: whichever is met first
    // is what a sentence reaches for (DDR-0099). A summary asked for after the numbers have been
    // read is a summary already phrased.
    periodSpanBlock(change),
  ]

  if (change.days === 0) {
    // A period with no data is a state, not a flat period. `valueAt` would happily carry the
    // nearest value into both ends of this window and report a calm 0% — which is a description
    // of nothing, phrased as a description of something.
    blocks.push(
      'No day in the imported history falls inside this period, so there is nothing to report about it. Say the period is empty; do not describe it as flat or unchanged.',
    )
    return blocks.join('\n\n')
  }

  blocks.push(
    [
      'RETURN over this period (a return, not a change in value):',
      `- Time-weighted return: ${formatSignedPercent(change.twr)}`,
      '- Money paid in or taken out does not move this figure. It is chain-linked from the cumulative return curve the app computed.',
    ].join('\n'),
    [
      'VALUE over this period (a change in value, not a return):',
      `- Value at the start of the period: ${c(change.startValue)}`,
      `- Value at the end of the period: ${c(change.endValue)}`,
      `- Change in value: ${s(change.changeAbs)}${
        change.changePct === null ? '' : ` (${formatSignedPercent(change.changePct)})`
      }`,
      '- A change in value includes money paid in or taken out. Never call it performance, and never attribute it to the return above.',
      `- Days of data inside the period: ${change.days}.`,
    ].join('\n'),
    flowsBlock(change, s, c),
    dailyBlock(change),
    compositionBlock(change, c, s),
    [
      'WHOLE IMPORTED HISTORY, not the period above — quote these only as whole-history figures:',
      `- Cumulative time-weighted return: ${formatSignedPercent(change.history.cumulativeTwr)}`,
      `- Net deposits and withdrawals: ${s(change.history.depositsWithdrawals)}`,
      `- Realised profit and loss: ${s(change.history.realizedPnl)}`,
      `- Unrealised profit and loss: ${s(change.history.unrealizedPnl)}`,
      '- Realised and unrealised profit and loss are not available for a chosen period; only these whole-history figures exist. If asked for either over the period, say it is not available.',
    ].join('\n'),
  )

  return blocks.join('\n\n')
}

/**
 * The three overclaims, restated for **this** period, and the one fact it has in their place.
 *
 * A summary is compression, and compression is where a model reaches for the conventional phrasing
 * of finance: an annualised figure, a benchmark, a risk statistic. None of the three exists anywhere
 * in this app, and until Story #325 this block is where all three were said — which made saying them
 * conditional on there being a Flex history to window at all.
 *
 * **The statements themselves are now unconditional and live in
 * `@shared/domain/assistantAbsences`**, above every section and every report, on DDR-0110's
 * coupling: three prompt prohibitions are conditional on those sentences being present, and one that
 * arrives only when a section does is not present (DDR-0111). What stays here is the half that is
 * genuinely **about this period** — its calendar span — plus the restatement that carries it, which
 * is DDR-0101's *before any figure* applied per report. The restatement is belt-and-braces and is
 * deliberately not what holds the prohibitions.
 *
 * **The span is the honest fact that replaces the annualised one.** How many calendar days the
 * period really covers is the only thing an app with no annualisation can say about "a year", and
 * below a year the block forbids the word outright. Both lines are the app's own counts off the
 * window and the extent — nothing here is derived.
 *
 * Emitted for an **empty** period too: a window with nothing in it is exactly where an ungrounded
 * comparison has the most room.
 */
function periodSpanBlock(change: PeriodChange): string {
  const span = change.span

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
  change: PeriodChange,
  s: (value: number) => string,
  c: (value: number) => string,
): string {
  const flows = change.flows
  if (flows.count === 0 || flows.covered === null) {
    return 'FLOWS AND INCOME: no statement period covers the period above, so deposits, withdrawals, dividend income and costs are not available for it.'
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

/** How the return was travelled, day by day. */
function dailyBlock(change: PeriodChange): string {
  const daily = change.daily
  if (daily.count === 0 || daily.best === null || daily.worst === null) {
    return 'DAILY RETURNS: the period holds no day with a preceding trading day to measure against, so daily returns are not available for it.'
  }

  return [
    `DAILY RETURNS over this period, chain-linked from the return curve — each day measured against the trading day that really preceded it, including the first:`,
    `- ${daily.count} trading day(s): ${daily.up} up, ${daily.down} down, ${daily.flat} unchanged.`,
    `- Best day: ${formatSignedPercent(daily.best.value)} on ${isoDay(daily.best.date)}`,
    `- Worst day: ${formatSignedPercent(daily.worst.value)} on ${isoDay(daily.worst.date)}`,
  ].join('\n')
}

/** What was held while the return was earned, at each end of the period. */
function compositionBlock(
  change: PeriodChange,
  c: (value: number) => string,
  s: (value: number) => string,
): string {
  const composition = change.composition
  if (composition.days === 0 || composition.firstDate === null || composition.lastDate === null) {
    return 'COMPOSITION: the imported statements do not include the daily net-asset-value breakdown, so how the portfolio was divided over this period is not available.'
  }

  const ends =
    composition.firstDate === composition.lastDate
      ? `on the one day of data in this period (${isoDay(composition.firstDate)})`
      : `on ${isoDay(composition.firstDate)} and ${isoDay(composition.lastDate)}, the first and last days of data in this period`

  return [
    `COMPOSITION ${ends}, in ${change.baseCurrency}. Each band is an amount, and the bands sum to net asset value:`,
    ...composition.bands.map(
      (shift) => `- ${shift.band.label}: ${c(shift.first)} → ${c(shift.last)} (${s(shift.change)})`,
    ),
    `- Net asset value: ${c(composition.firstNav ?? 0)} → ${c(composition.lastNav ?? 0)} (${s(
      composition.navChange ?? 0,
    )})`,
  ].join('\n')
}

/**
 * A date the model can quote without re-formatting it.
 *
 * ISO rather than `formatDate`'s locale form, and this is the one place the "use the app's own
 * formatters" rule gives way on purpose: a locale date is ambiguous read back (03/04 is two dates),
 * and unlike every figure here, a date in an answer is prose the model rewrites rather than a number
 * it must quote verbatim.
 */
function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/** Whether the owner has stated any policy at all — what the view's "no profile" notice asks. */
export function hasProfile(profile: InvestorProfile): boolean {
  return !isProfileEmpty(profile)
}
