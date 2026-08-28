import {
  formatCurrency,
  formatPercentValue,
  formatSignedCurrency,
  formatSignedPercent,
  instrumentName,
} from './format'
import { periodChange, type PeriodChange, type PeriodSelection } from './periodChange'
import type { AssistantContext } from '@shared/domain/assistantDisclosure'
import type { AllocationReport, AllocationResult } from '@shared/domain/allocation'
import type { PerformanceResult } from '@shared/domain/performance'
import type {
  BalanceDriftReport,
  BalanceDriftResult,
  DimensionDrift,
} from '@shared/domain/balanceDrift'
import {
  STYLE_TAG_LABELS,
  TARGET_DIMENSION_LABELS,
  isProfileEmpty,
  type CategoryTarget,
  type InvestorProfile,
  type TargetDimension,
} from '@shared/domain/investorProfileTerms'

/**
 * Everything the assistant may say, written down before it is asked (Story #284, DDR-0098).
 *
 * **The model never produces a figure** (ADR-0009). That sentence is only true if something else
 * produces every one of them, and this is that something: each section below is text assembled
 * from a report a service already computed, through the same formatters the dashboards use, so a
 * number in an answer and the same number on a page agree to the digit. The model's job is to
 * choose which of these lines to quote and to phrase the choosing.
 *
 * It is a pure module for the reason everything in `lib/` is one — Vitest runs Node-only with no
 * jsdom (DDR-0029), so a string built inside a component is a string nothing can assert. Here the
 * whole of the grounding is a function from reports to text, and the tests are about the only
 * defence the Epic has against an answer that reads like being right.
 *
 * ## Three rules hold it together
 *
 * **A section carries no more than its disclosure allows.** `holdings` is declared as names, and
 * `weights` and `profile` as percentages only — so no amount of money appears in any of the three,
 * however convenient one would be. That is not caution about a leak; it is the disclosure being
 * true. `assistantContext.test.ts` reads every section back and fails on a currency-formatted
 * figure. The `performance` category is the one that may carry money, and Story #285 is what fills
 * it: an explanation of a chosen period is the one question whose honest answer needs amounts.
 *
 * **Return and value are two sections' worth of care in one.** The app's curve is cumulative
 * time-weighted return (DDR-0013) and does not move on a deposit; a portfolio can be worth 20%
 * more and have returned 2%. So the performance section states them apart, each under a heading
 * that says which it is, and says in the text itself that a flow moves one and not the other —
 * because conflating them is the failure this Epic is least likely to catch, the wrong answer
 * being the flattering one.
 *
 * **Absent is absent, never zero.** A report that could not be read produces no section rather
 * than an empty one, and the view says so beside the box in its own words. A heading with nothing
 * under it invites the model to fill it in, which is exactly the failure mode grounding exists to
 * prevent. Its sharpest case is DDR-0007's: a holding that could not be valued is *unplaced*, and
 * is reported as a count and a currency, never as a weight of zero.
 *
 * **What the app does not compute is said, not left out.** The three absences a summary reaches
 * for — an annualised return, a benchmark, a risk statistic — are named in the section itself,
 * ahead of the figures they would otherwise decorate (Story #286, DDR-0101). Absence is stated for
 * the same reason it is elsewhere: a gap the model finds is a gap the model fills.
 *
 * **Every line names its source.** The composition sections read the **imported Flex store** and
 * are as of the latest statement; the drift section reads the **live** portfolio. Two different
 * clocks, and an answer that silently mixed them would be wrong in a way no reader could catch —
 * so each section opens by saying which one it is and when it was read.
 */

/**
 * What a view has read, in whatever state each read came back in.
 *
 * Split from {@link GroundingInputs} because the period is not a *read*: it is a selection the
 * owner makes on the view, and changing it must reframe the explanation without re-issuing four
 * IPC calls — the same relationship the Performance view's `RangeFilter` has with its report.
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

/** Those reads, plus the period the owner chose to have explained (Story #285). */
export interface GroundingInputs extends GroundingReports {
  period: PeriodSelection
}

/**
 * How many positions the holdings and weights sections name.
 *
 * A ceiling rather than the whole book, because the prompt has one too (`MAX_PROMPT_CHARS`) and a
 * context truncated by the gateway is truncated arbitrarily — the last section simply stops. This
 * cuts at a place that can be *stated*: the list says how many of how many it holds, so a model
 * asked about the hundredth position answers that it is not in front of it rather than inventing
 * one. Positions are taken largest-first, so what is cut is what matters least.
 */
export const MAX_LISTED_POSITIONS = 40

/**
 * Assemble the context, keyed by the categories the owner read (DDR-0097).
 *
 * The keys are the disclosure's own ids and nothing else can be added here — `AssistantContext`
 * forbids it at compile time, and the IPC boundary drops it at runtime.
 */
export function buildAssistantContext(inputs: GroundingInputs): AssistantContext {
  const context: AssistantContext = {}

  if (inputs.allocation.status === 'ok') {
    context.holdings = holdingsSection(inputs.allocation.report)
    context.weights = weightsSection(inputs.allocation.report)
  }

  const profile = profileSection(inputs.profile, inputs.drift)
  if (profile !== null) context.profile = profile

  const change = selectedPeriod(inputs)
  if (change !== null) context.performance = performanceSection(change)

  return context
}

/**
 * The chosen period resolved against the imported history, or `null` where there is none.
 *
 * One function so the view's notice and the section it explains cannot disagree about whether a
 * period exists: `needs_import` and a history with no dated value are both "nothing to window",
 * and an empty *window* is not — that one resolves, and the section says the period is empty.
 */
export function selectedPeriod(inputs: GroundingInputs): PeriodChange | null {
  if (inputs.performance.status !== 'ok') return null
  return periodChange(inputs.performance.report, inputs.period)
}

/**
 * What the owner holds: ticker, name, currency, sector, asset class. Names, and nothing else.
 *
 * The name goes through `instrumentName` like every view does, so a description that only repeats
 * the ticker resolves to nothing rather than to `Cad` (DDR-0066, DDR-0067). An unclassified
 * position says *unclassified* rather than carrying an empty field, because a blank in a list the
 * model reads is an invitation to guess what belongs there.
 */
export function holdingsSection(report: AllocationReport): string {
  const positions = [...report.positions].sort((a, b) => b.percentOfNav - a.percentOfNav)
  const listed = positions.slice(0, MAX_LISTED_POSITIONS)

  const lines = listed.map((position) => {
    const name = instrumentName(position.symbol, position.description)
    const parts = [
      name === null ? position.symbol : `${position.symbol} (${name})`,
      `currency ${position.currency}`,
      `sector ${position.sector === '' ? 'unclassified' : position.sector}`,
      `asset class ${position.assetCategory === '' ? 'unknown' : position.assetCategory}`,
    ]
    return `- ${parts.join(' · ')}`
  })

  return [
    sourceLine(report),
    countLine(listed.length, positions.length),
    '',
    ...lines,
    ...(report.unclassifiedCount > 0
      ? ['', `${report.unclassifiedCount} of these have no sector in the local classification cache.`]
      : []),
  ].join('\n')
}

/**
 * How the portfolio is divided: percentages, and no amounts of money.
 *
 * Each breakdown is the report's own — the same arrays the Allocation view draws — so a weight
 * quoted in an answer is the weight on the chart. Cash is included where the report includes it:
 * allocation's cash slice is the NAV residual and not the `percentOfNAV` shortfall, which is a
 * trap this module inherits rather than re-derives (DDR-0015).
 */
export function weightsSection(report: AllocationReport): string {
  const positions = [...report.positions].sort((a, b) => b.percentOfNav - a.percentOfNav)
  const listed = positions.slice(0, MAX_LISTED_POSITIONS)

  const blocks: string[] = [sourceLine(report), countLine(listed.length, positions.length), '']

  blocks.push('By position:')
  for (const position of listed) {
    blocks.push(`- ${position.symbol}: ${formatPercentValue(position.percentOfNav)}`)
  }

  for (const [heading, slices] of [
    ['By asset class:', report.byAssetClass],
    ['By currency:', report.byCurrency],
    ['By sector:', report.bySector],
    ['By issuer country:', report.byCountry],
  ] as const) {
    if (slices.length === 0) continue
    blocks.push('', heading)
    for (const slice of slices) {
      blocks.push(`- ${slice.label}: ${formatPercentValue(slice.percentOfNav)}`)
    }
  }

  return blocks.join('\n')
}

/**
 * The owner's policy, and how far the live portfolio sits from it.
 *
 * Two things in one section because the disclosure declares them as one: a target range read
 * without the actual weight beside it is a number with nothing to say. `null` when the owner has
 * written no policy *and* there is no drift to report — the section would then be a heading over
 * nothing, and the view says "no profile" in its own words instead.
 *
 * **No model ever does this arithmetic** (DDR-0095). Every band, every distance and the verdict
 * itself are computed by `balanceDriftService`; what is written here is the phrasing of a decided
 * answer.
 */
export function profileSection(
  profile: InvestorProfile,
  drift: BalanceDriftResult,
): string | null {
  const blocks: string[] = []

  if (profile.styleTags.length > 0) {
    const tags = profile.styleTags.map((tag) => STYLE_TAG_LABELS[tag]).join(', ')
    blocks.push(`Investing style the owner states: ${tags}.`)
  }

  const targets = targetLines(profile)
  if (targets.length > 0) blocks.push('', 'Targets the owner set:', ...targets)

  const measured = driftBlock(drift)
  if (measured !== null) blocks.push('', measured)

  if (blocks.length === 0) return null
  // A leading blank from an absent style line would open the section with an empty row.
  return blocks.join('\n').replace(/^\n+/, '')
}

/** Every target the profile carries, dimension by dimension, as ranges. */
function targetLines(profile: InvestorProfile): string[] {
  const lines: string[] = []
  const byDimension: Record<TargetDimension, readonly CategoryTarget[]> = {
    currency: profile.currencyTargets,
    sector: profile.sectorTargets,
    assetClass: profile.assetClassTargets,
  }

  for (const dimension of ['currency', 'sector', 'assetClass'] as const) {
    for (const target of byDimension[dimension]) {
      lines.push(
        `- ${TARGET_DIMENSION_LABELS[dimension]} ${target.key}: ${range(target.low, target.high)}`,
      )
    }
  }

  if (profile.positionSize !== null) {
    lines.push(
      `- Any single position: ${range(profile.positionSize.low, profile.positionSize.high)}`,
    )
  }

  return lines
}

/**
 * The measured half, or `null` where there is nothing measured to report.
 *
 * The six non-`ok` variants are not all the same absence, and none of them becomes a figure here:
 * a gateway that is not running produces no weights at all, which is a fact the model should state
 * rather than route around (DDR-0022).
 */
function driftBlock(drift: BalanceDriftResult): string | null {
  if (drift.status !== 'ok') return null
  return measuredDrift(drift.report)
}

/** The drift report as prose the model may quote, in percentage points throughout. */
export function measuredDrift(report: BalanceDriftReport): string {
  const lines: string[] = [
    `Measured against the live portfolio, read ${isoMinute(report.readAt)}, weights as a share of what could be valued in ${report.displayCurrency}.`,
    report.balanced
      ? 'Every target is currently inside its range.'
      : 'At least one target is currently outside its range.',
  ]

  for (const dimension of report.dimensions) {
    lines.push('', `${TARGET_DIMENSION_LABELS[dimension.dimension]} targets:`, ...bandLines(dimension))
  }

  if (report.position !== null) {
    const p = report.position
    const name = p.name === null ? p.symbol : `${p.symbol} (${p.name})`
    lines.push(
      '',
      `Largest single position: ${name} at ${formatPercentValue(p.actual)} against a ${range(p.low, p.high)} ceiling — ${verdict(p.status, p.distance)}.${
        p.bounded ? ' This is a lower bound: some holding could not be valued, so a larger one may be hidden among them.' : ''
      }`,
    )
  }

  const unplaced = report.unplaced
  if (unplaced.positions > 0 || unplaced.cashBalances > 0) {
    // Counts and currencies, never a percentage: there is no rate with which to compute one, and
    // inventing it is precisely what this Epic must not do (DDR-0007, Bug #68).
    lines.push(
      '',
      `${unplaced.positions} holding(s) and ${unplaced.cashBalances} cash balance(s) could not be valued in ${report.displayCurrency} (${unplaced.currencies.join(', ')}). They are in none of the weights above, and no percentage exists for them.`,
    )
  }

  return lines.join('\n')
}

/** One dimension's bands, its residuals, and whatever carries no target at all. */
function bandLines(dimension: DimensionDrift): string[] {
  const lines = dimension.bands.map(
    (band) =>
      `- ${band.label}: ${formatPercentValue(band.actual)} against ${range(band.low, band.high)} — ${verdict(band.status, band.distance)}`,
  )

  // Surfaced, never redistributed (DDR-0095). A dimension whose bands sum to 80% has to say what
  // the other fifth is, or the model reads the gap as a rounding error and explains it away.
  for (const residual of dimension.residuals) {
    lines.push(`- ${residual.label} (no target applies): ${formatPercentValue(residual.weight)}`)
  }
  if (dimension.untargeted > 0) {
    lines.push(`- Held in categories with no target: ${formatPercentValue(dimension.untargeted)}`)
  }

  return lines
}

/**
 * What changed over the period the owner chose (Story #285).
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
 * risk statistic — none of which exists here. {@link uncomputedBlock} says so second, ahead of the
 * numbers, on DDR-0099's own ordering argument (see DDR-0101).
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
    uncomputedBlock(change),
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
 * The three things a summary reaches for that this app does not hold (Story #286).
 *
 * A summary is compression, and compression is where a model reaches for the conventional
 * phrasing of finance. Each of these is a sentence that sounds like a summary and is not grounded
 * in anything:
 *
 * **An annualised figure.** The app computes none — not one report carries a per-year, compounded
 * or "p.a." number — so producing one is arithmetic, which is already forbidden. What makes it
 * worth its own line is that it is the one calculation a model does not experience as a
 * calculation: "roughly 30% a year" reads as a restatement of "+5% over two months" rather than as
 * a derivation, and it is meaningless besides. So the honest fact is stated instead — how many
 * calendar days the period really covers — and below a year the section forbids the word outright.
 *
 * **A benchmark.** The app has none. Benchmark comparison is Epic #7, a different data source in a
 * different milestone, and "outperformed the market" is invented wholesale in the register that
 * sounds most authoritative.
 *
 * **A risk statistic.** Daily returns exist ({@link PeriodChange.daily}, DDR-0049), so dispersion
 * *can* be described — from the counts and the two extremes that are actually in front of the
 * model, and from nothing else. A Sharpe ratio quoted beside them would be indistinguishable in
 * tone from the figures that were computed.
 *
 * The block carries no figure that is not the app's own: two day counts off the window and the
 * extent, and otherwise statements of absence. It is emitted for an **empty** period too — a
 * window with nothing in it is exactly where an ungrounded comparison has the most room.
 */
function uncomputedBlock(change: PeriodChange): string {
  const span = change.span

  return [
    'WHAT THIS APP DOES NOT COMPUTE — none of it is available, and none of it may be supplied:',
    `- No annualised, per-year, compounded or "p.a." figure exists anywhere in this context. A return here is the return over the period named above and nothing else. That period covers ${span.periodDays} calendar day(s); the whole imported history covers ${span.historyDays}.`,
    span.coversAYear
      ? '- This period covers a year or more, so a return over it may be given as the return over this period — still never scaled, compounded or annualised to any other period.'
      : '- This period is shorter than a year, so never describe a return over it as annual, annualised, yearly or per year. State the period instead.',
    '- No benchmark, index, market or peer figure exists. This app holds no market data beyond this portfolio’s own history, so never say the portfolio beat, lagged, tracked, outperformed or underperformed anything.',
    '- No volatility, standard deviation, Sharpe ratio, beta, drawdown or other risk statistic exists. The daily-return counts and the best and worst day in this section are the only description of dispersion this app has; use those where they are given, and otherwise say a risk figure is not available.',
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

/** How a band reads: inside, or how far out and in which direction. */
function verdict(status: 'inside' | 'below' | 'above', distance: number): string {
  if (status === 'inside') return 'inside the range'
  return `${status} the range by ${formatSignedPercent(distance)}`
}

/** A target range, both ends in the app's own percent format. */
function range(low: number, high: number): string {
  return `${formatPercentValue(low)}–${formatPercentValue(high)}`
}

/** Which store a composition section read, and as of when. */
function sourceLine(report: AllocationReport): string {
  const asOf = report.reportDate === null ? 'an unknown date' : isoDay(report.reportDate)
  return `From imported Flex history, as of ${asOf}. Positions valued in ${report.baseCurrency}.`
}

/** How much of the book is in front of the model, stated rather than silently cut. */
function countLine(listed: number, total: number): string {
  return listed === total
    ? `All ${total} open position(s).`
    : `The ${listed} largest of ${total} open positions; the rest are not in front of you.`
}

/**
 * A date the model can quote without re-formatting it.
 *
 * ISO rather than `formatDate`'s locale form, and this is the one place the "use the app's own
 * formatters" rule gives way on purpose: a locale date is ambiguous read back (03/04 is two dates),
 * and unlike every figure here, a date in an answer is prose the model rewrites rather than a
 * number it must quote verbatim.
 */
function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/** The same, to the minute, for a live reading whose time of day is the point. */
function isoMinute(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Whether the owner has stated any policy at all — what the view's "no profile" notice asks. */
export function hasProfile(profile: InvestorProfile): boolean {
  return !isProfileEmpty(profile)
}
