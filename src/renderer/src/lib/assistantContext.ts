import {
  formatCurrency,
  formatPercentValue,
  formatPoints,
  formatSignedCurrency,
  formatSignedPercent,
  formatSignedPoints,
  instrumentName,
} from '@shared/format'
import { periodChange, type PeriodChange } from './periodChange'
import { standardPeriods, type PeriodSet, type StandardPeriod } from './periodSet'
import type { AssistantContext } from '@shared/domain/assistantDisclosure'
import type { AllocationReport, AllocationResult } from '@shared/domain/allocation'
import type { PerformanceResult } from '@shared/domain/performance'
import type {
  BalanceDriftReport,
  BalanceDriftResult,
  BaselineCeiling,
  BaselineReview,
  DimensionDrift,
  DriftBand,
  DriftMove,
} from '@shared/domain/balanceDrift'
import {
  BASELINE_LABEL,
  BASELINE_UNCOVERED_NOTE,
  NO_SECTOR_UNIVERSE_NOTE,
  type BaselineCheck,
} from '@shared/domain/portfolioBaseline'
import {
  STYLE_TAG_LABELS,
  TARGET_DIMENSION_LABELS,
  isProfileEmpty,
  targetLabel,
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
 * **This is the whole input.** #285 split a `GroundingInputs` off this to carry the period the
 * owner had selected on a `RangeFilter`; DDR-0102 removed that control, so the grounding is once
 * again a function of the reads alone and the two types are one. What replaces the selection is not
 * another input but *more computation over the same report* — the period set #287 adds is derived
 * here, from `performance`, with nothing to pass in.
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
 * How many drift-closing moves the profile section sizes.
 *
 * The same ceiling for the same reason, applied to the section that grows with the *profile* rather
 * than with the portfolio: an owner may state thirty targets, and every one of them may be out of
 * range. The moves are taken **largest gap first** — what is cut is what matters least — and the
 * bands themselves are all still listed, so a target whose move is not sized still has its verdict.
 * The section says how many of how many it sized.
 */
export const MAX_LISTED_MOVES = 6

/**
 * What a currency weight in this app is a weight *of*, said wherever one appears.
 *
 * A currency exposure has two readings and the app only computes one: this is the currency each
 * position is held and priced in, which is not where the underlying business earns its revenue. An
 * owner holding a US-listed miner in dollars has dollar *pricing* and commodity revenue, and a
 * sentence about "currency exposure" that does not say which it means is wrong for whichever
 * reading the reader had (Story #287).
 */
export const CURRENCY_EXPOSURE_NOTE =
  'Currency here is the currency each position is held and priced in — not the currency the underlying business earns its revenue in, which this app does not know.'

/**
 * Assemble the context, keyed by the categories the owner read (DDR-0097).
 *
 * The keys are the disclosure's own ids and nothing else can be added here — `AssistantContext`
 * forbids it at compile time, and the IPC boundary drops it at runtime.
 */
export function buildAssistantContext(reports: GroundingReports): AssistantContext {
  const context: AssistantContext = {}

  if (reports.allocation.status === 'ok') {
    context.holdings = holdingsSection(reports.allocation.report)
    context.weights = weightsSection(reports.allocation.report)
  }

  // Unconditional since Story #315: there is always something to say about the owner's policy,
  // and "they have not written one" is the most important of those things - it is what stops a
  // model treating the app's baseline as theirs.
  context.profile = profileSection(reports.profile, reports.drift)

  const change = wholeHistory(reports)
  if (change !== null) {
    // One category, two sections. The whole history explained, then every standard window as a row
    // the question may name (Story #287) — both are returns and values out of the imported Flex
    // store, which is what the `performance` category already declares, so the set widens what is
    // grounded without widening what is *sent*.
    const set = reports.performance.status === 'ok' ? standardPeriods(reports.performance.report) : null
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
 * states. Over the full extent the second is unreachable: `periodChange` returns `null` for an
 * empty series and `boundsFor('all')` is the extent itself, so a resolved history always holds at
 * least one day. `periodChange`'s own empty-window handling stays, because #287 windows this report
 * again and a quarter with no data in it is exactly that state.
 */
export function wholeHistory(reports: GroundingReports): PeriodChange | null {
  if (reports.performance.status !== 'ok') return null
  return periodChange(reports.performance.report, { range: 'all', custom: null })
}

/**
 * Every standard period, as rows a question can name (Story #287, DDR-0103).
 *
 * **The set is the answer to a question about a period it does not hold.** A free-text box takes
 * any window — *how did I do between March and July?* — and the app holds figures for a fixed set
 * of them. The failure mode is not that the model refuses; it is that it reaches for the nearest
 * row and answers about that instead, which is a right-looking figure under the wrong heading. So
 * the section opens by saying these are the only periods available and that the unavailable ones
 * are to be *named as unavailable*, with the alternatives listed underneath. DDR-0022's discipline
 * — an unavailable thing is a state, not a silence — in prose.
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
    // Beside the breakdown rather than once at the top, because a breakdown is quoted on its own
    // and a qualification three headings away is a qualification that will not travel with it.
    if (heading === 'By currency:') blocks.push(CURRENCY_EXPOSURE_NOTE)
    for (const slice of slices) {
      blocks.push(`- ${slice.label}: ${formatPercentValue(slice.percentOfNav)}`)
    }
  }

  return blocks.join('\n')
}

/**
 * The owner's policy, how far the live portfolio sits from it, and the app's own baseline over
 * whatever it leaves silent.
 *
 * Three things in one section because the disclosure declares them as one: a target range read
 * without the actual weight beside it is a number with nothing to say, and the baseline is only
 * legible next to the targets it is standing in for. It is never absent and never empty: an owner
 * who has written nothing still has that fact stated, and that statement is what stops a model
 * reading the app's baseline below as a policy of theirs.
 *
 * **No model ever does this arithmetic** (DDR-0095, ADR-0012). Every band, every distance, every
 * baseline ceiling and both verdicts are computed by `balanceDriftService`; what is written here is
 * the phrasing of a decided answer.
 *
 * The order is deliberate: the owner's standard first, then the measurement against it, then the
 * app's. A reader who stops early stops on the owner's own policy.
 */
export function profileSection(profile: InvestorProfile, drift: BalanceDriftResult): string {
  const blocks: string[] = []

  if (profile.styleTags.length > 0) {
    const tags = profile.styleTags.map((tag) => STYLE_TAG_LABELS[tag]).join(', ')
    blocks.push(`Investing style the owner states: ${tags}.`)
  }

  const targets = targetLines(profile)
  if (targets.length > 0) blocks.push('', 'Targets the owner set:', ...targets)

  // An owner with nothing stored has not left three dimensions untargeted — they have no profile,
  // and saying it in those words is what stops "untargeted" reading as a policy decision. Before
  // Story #315 this branch emitted nothing at all, because there was no standard to fall back on
  // and a heading over nothing is an invitation to fill it in. Now there is one, so the absence is
  // named and handed to the baseline below.
  if (isProfileEmpty(profile)) {
    blocks.push(
      '',
      'The owner has not set an investor profile at all. There is no standard of theirs to judge against: say so, and say they can set one in the Assistant view’s profile section. Never treat the app’s baseline below as theirs.',
    )
  } else {
    const untargeted = untargetedLines(profile)
    if (untargeted.length > 0) blocks.push('', ...untargeted)
  }

  const measured = driftBlock(drift)
  if (measured !== null) blocks.push('', measured)

  const baseline = drift.status === 'ok' ? baselineBlock(drift.report.baseline) : null
  if (baseline !== null) blocks.push('', baseline)

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
      // `targetLabel`, never the raw key: an asset-class target is stored under IBKR's code, and
      // cash under a sentinel that means nothing to a model (DDR-0094).
      lines.push(
        `- ${TARGET_DIMENSION_LABELS[dimension]} ${targetLabel(dimension, target.key)}: ${range(target.low, target.high)}`,
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
 * The dimensions the owner set no target in, named as **untargeted** (Story #287).
 *
 * A dimension with no target is absent from the drift report entirely — `balanceDriftService`
 * returns `null` for it, deliberately, because a profile stating nothing about sectors is not a
 * profile stating that sectors do not matter. That absence is right in the report and wrong in
 * front of a model: a heading that is not there reads as a question that came back clean, and
 * "your sectors are balanced" is the sentence that follows. So the absence is said out loud, with
 * the reason it is not a verdict.
 *
 * **Story #315 changed what follows from that absence, not the absence itself.** These lines used to
 * end with *never against a standard of your own*, which is still true of the model — it may invent
 * nothing. What has changed is that the app now supplies one for the silence, so each line hands the
 * dimension to the baseline block below rather than closing the subject.
 */
function untargetedLines(profile: InvestorProfile): string[] {
  const byDimension: Record<TargetDimension, readonly CategoryTarget[]> = {
    currency: profile.currencyTargets,
    sector: profile.sectorTargets,
    assetClass: profile.assetClassTargets,
  }
  const missing = (['currency', 'sector', 'assetClass'] as const).filter(
    (dimension) => byDimension[dimension].length === 0,
  )

  const lines: string[] = []
  if (missing.length > 0) {
    const named = missing.map((dimension) => TARGET_DIMENSION_LABELS[dimension].toLowerCase())
    lines.push(
      `Untargeted: the owner has set no target for ${list(named)}. There is no standard of theirs to measure ${missing.length === 1 ? 'it' : 'them'} against, so ${missing.length === 1 ? 'it is' : 'they are'} neither balanced nor unbalanced by the owner’s standard. Never report ${missing.length === 1 ? 'it' : 'them'} as balanced, and invent no standard of your own — where the app’s baseline below covers ${missing.length === 1 ? 'it' : 'them'}, judge against that and say the standard is the app’s.`,
    )
  }
  if (profile.positionSize === null) {
    lines.push(
      "Untargeted: the owner has set no single-position concentration ceiling, so no position is too large or too small by any standard of theirs. Where the app’s baseline below covers it, judge against that and say the standard is the app’s.",
    )
  }

  return lines
}

/** A short list in prose: "a", "a and b", "a, b and c". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
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
  const sized = sizedMoves(report)

  const lines: string[] = [
    `Measured against the live portfolio, read ${isoMinute(report.readAt)}, weights as a share of what could be valued in ${report.displayCurrency}.`,
    report.balanced === null
      ? 'The owner has set no targets, so there is nothing of theirs to be inside or outside. Say that rather than that the portfolio is balanced.'
      : report.balanced
        ? 'Every target the owner set is currently inside its range.'
        : 'At least one target the owner set is currently outside its range.',
  ]

  if (report.balanced === false) lines.push('', ...movesPreamble(report, sized))

  for (const dimension of report.dimensions) {
    lines.push('', `${TARGET_DIMENSION_LABELS[dimension.dimension]} targets:`)
    // Beside the breakdown it qualifies, for the reason the weights section puts it there.
    if (dimension.dimension === 'currency') lines.push(CURRENCY_EXPOSURE_NOTE)
    lines.push(...bandLines(dimension, sized))
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

/**
 * The app's own standard, and where the portfolio sits against it (Story #315, ADR-0012).
 *
 * **Every line here says whose standard it is.** That is not politeness, it is the whole of what
 * ADR-0012 traded for the capability: a judgement against a target the owner wrote and a judgement
 * against a default the app ships read identically once they are prose, and only one of them carries
 * the owner's authority. The marking is beside each claim rather than once at the top, the same
 * discipline ADR-0009 already imposes on grounded against repeated claims, and for the same reason —
 * a caveat at the top of a section is read once and then not read.
 *
 * **What did not run is stated as loudly as what did.** A deferred check and an uncovered dimension
 * are both absences, and an absent verdict reads as a clean one unless it is named (DDR-0101).
 *
 * `null` where nothing ran and nothing was deferred, which is a portfolio with no shape to judge.
 */
function baselineBlock(review: BaselineReview): string | null {
  if (review.applied.length === 0 && review.deferred.length === 0) return null

  // Nothing applied is one sentence, not a section. The owner has spoken about every dimension the
  // baseline covers, so all that is worth saying is that a default exists and is not in play — and
  // the currency note below is beside the point when there is no baseline figure to misapply. This
  // is the case a fully-targeted profile hits, which is also the longest prompt the app assembles,
  // so the saving lands exactly where the budget binds (DDR-0103).
  if (review.applied.length === 0) {
    return `The app has a default baseline for dimensions the owner leaves unstated. None of it applies here — their own targets govern ${list(review.deferred.map((check) => BASELINE_CHECK_LABELS[check]))} — so judge against their targets alone.`
  }

  const lines: string[] = [
    `${capitalise(BASELINE_LABEL)}, version ${review.version}: what the app falls back on where the owner has stated nothing. Beside every judgement below, say the standard is the app’s default and not theirs. It is not a profile for them to adopt, so never present one of these figures as a target they set, and never suggest they set one.`,
  ]

  if (review.deferred.length > 0) {
    lines.push(
      '',
      `Not applied, the owner’s own targets govern them: ${list(review.deferred.map((check) => BASELINE_CHECK_LABELS[check]))}. Judge those against their targets above, never against a default.`,
    )
  }

  lines.push(
    '',
    BASELINE_UNCOVERED_NOTE,
    '',
    `Applied, the owner has set no target covering them: ${list(review.applied.map((check) => BASELINE_CHECK_LABELS[check]))}.`,
    review.withinBaseline === null
      ? 'Nothing could be measured against them.'
      : review.withinBaseline
        ? 'Every applied ceiling is inside the default.'
        : 'At least one applied ceiling is above the default.',
  )

  for (const ceiling of review.ceilings) {
    lines.push(ceilingLine(ceiling))
  }

  if (review.applied.includes('sector')) {
    lines.push(
      '',
      `Holdings carry ${review.sectorsHeld} distinct sector name(s). ${NO_SECTOR_UNIVERSE_NOTE}`,
    )
  }

  if (review.applied.includes('coverage')) {
    lines.push(
      '',
      review.absentAssetClasses.length === 0
        ? 'Asset-class coverage (the app’s check): the portfolio holds a weight in every class the app checks for.'
        : `Asset-class coverage (the app’s check): the portfolio holds no weight at all in ${list(review.absentAssetClasses.map((c) => c.label))}. Only these classes are checked; absence is a fact about shape, not a fault. Never say what to buy to close it.`,
    )
  }

  return lines.join('\n')
}

/** One ceiling as a sentence, in percentage points, saying whose ceiling it is. */
function ceilingLine(ceiling: BaselineCeiling): string {
  // The same `symbol (name)` shape `measuredDrift` writes, from the same already-resolved field:
  // `null` there means local history knows no name, not that the name is blank (DDR-0088).
  const held = ceiling.name === null ? ceiling.key : `${ceiling.key} (${ceiling.name})`
  const subject =
    ceiling.check === 'position'
      ? `Largest single position: ${held}`
      : ceiling.check === 'sector'
        ? `Largest sector: ${ceiling.label}`
        : `Uninvested cash: ${ceiling.label}`
  const measured =
    ceiling.status === 'above' ? `${formatPoints(ceiling.distance)} above it` : 'inside it'
  const bound = ceiling.bounded ? ' Lower bound: something could not be valued.' : ''
  // The ceiling is written bare rather than through `formatPercentValue`: it is a round
  // constant this module owns, and `10.00%` reads as a measurement of something.
  return `- ${subject} at ${formatPercentValue(ceiling.actual)} against the app’s default ${ceiling.limit}% — ${measured}.${bound}`
}

/** How each check reads in a sentence that lists several of them. */
const BASELINE_CHECK_LABELS: Record<BaselineCheck, string> = {
  position: 'single-position size',
  sector: 'sector concentration',
  cash: 'uninvested cash',
  coverage: 'asset-class coverage',
}

/** Sentence case for a label written mid-sentence elsewhere. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * Which out-of-range bands get their move written out, largest gap first.
 *
 * A budget shared across the three dimensions rather than one per dimension: a profile carrying
 * thirty currency targets and one sector target should not spend the section on currencies because
 * they were declared first. Keyed by dimension and key together, because a currency and a sector
 * may both be called `USD` in principle and would otherwise collide silently.
 */
function sizedMoves(report: BalanceDriftReport): Set<string> {
  const out: { id: string; distance: number }[] = []
  for (const dimension of report.dimensions) {
    for (const band of dimension.bands) {
      if (band.move === null) continue
      out.push({ id: `${dimension.dimension}|${band.key}`, distance: Math.abs(band.distance) })
    }
  }
  return new Set(
    out
      .sort((a, b) => b.distance - a.distance)
      .slice(0, MAX_LISTED_MOVES)
      .map((entry) => entry.id),
  )
}

/**
 * How to read the moves below, said once before any of them (Story #287).
 *
 * Two qualifications that a proposal is wrong without. **The moves are the app's arithmetic**, not
 * the model's — which is the sentence that makes them quotable at all (ADR-0009, DDR-0095). And
 * they are expressed **against the portfolio as it stands**: shifting weight between positions,
 * with nothing paid in and nothing taken out. A move read as "buy this much more" would change the
 * denominator every other percentage in this section is a share of.
 */
function movesPreamble(report: BalanceDriftReport, sized: Set<string>): string[] {
  const total = report.dimensions.reduce(
    (count, dimension) => count + dimension.bands.filter((band) => band.move !== null).length,
    0,
  )

  const lines = [
    'HOW TO CLOSE THE GAPS. Each out-of-range band below carries a move this app computed: how many percentage points must shift, and which held positions carry that weight. Quote these; never size a move of your own, and never total two of them.',
    'Every move is in percentage points and assumes the portfolio keeps its current total — weight shifts between positions, with nothing paid in and nothing taken out. No amount of money is available for any of them.',
  ]
  if (total > sized.size) {
    lines.push(
      `${total} band(s) are outside their range; the ${sized.size} with the largest gaps have a move sized below. The rest carry their verdict without one — say a move for them is not available rather than sizing it.`,
    )
  }
  return lines
}

/** One dimension's bands, its residuals, and whatever carries no target at all. */
function bandLines(dimension: DimensionDrift, sized: Set<string>): string[] {
  const lines = dimension.bands.flatMap((band) => [
    `- ${band.label}: ${formatPercentValue(band.actual)} against ${range(band.low, band.high)} — ${verdict(band.status, band.distance)}`,
    ...(band.move !== null && sized.has(`${dimension.dimension}|${band.key}`)
      ? moveLines(band, band.move)
      : []),
  ])

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

/**
 * One band's move, written out (Story #287, DDR-0103).
 *
 * **The end state is computed, which is what makes verifying the model's answer unnecessary.**
 * #289 wanted a check that a proposed allocation actually lands inside the ranges; verifying free
 * text means asking the model to emit a parseable structure, which fights the free-text surface
 * this Epic settled on. Computing the end state first makes the check pointless rather than merely
 * cheaper — there is nothing the model produced to verify, because the arithmetic arrived done.
 *
 * **Percentage points, never money.** The `profile` category is declared as percentages only, and
 * a euro figure here would exceed what that category may carry — in a unit the profile is not even
 * written in (DDR-0098). The declaration is the bound; the panel that used to read it out is gone
 * (ADR-0011).
 *
 * **What the move cannot carry is stated, not spread.** A band the owner targets and holds nothing
 * in has no position to trim; a ceiling can stop the positions that exist from taking the rest. In
 * both cases the remainder is named, with what would actually close it — which is a different
 * sentence from the move, and one only the owner can act on (DDR-0052's rule, applied to a
 * proposal).
 */
function moveLines(band: DriftBand, move: DriftMove): string[] {
  const covered = move.points - move.uncovered
  const landing = band.status === 'above' ? band.actual - covered : band.actual + covered
  const edge = band.status === 'above' ? band.high : band.low
  const instruction =
    move.direction === 'trim'
      ? `trim ${formatPoints(move.points)} out of`
      : `add ${formatPoints(move.points)} to`

  const lines = [
    `  Move: ${instruction} ${band.label} to reach ${formatPercentValue(edge)}, the nearer edge of its range.`,
  ]

  if (move.contributors.length === 0) {
    lines.push(
      move.candidates === 0
        ? `  No position currently held sits in ${band.label}, so nothing held carries this weight. Closing it means buying an instrument the owner does not hold — say so; do not name one from the positions above.`
        : `  No position currently held has room to carry this move.`,
    )
  } else {
    lines.push(
      `  Positions carrying it (the ${move.contributors.length} largest of ${move.candidates} held in ${band.label}):`,
    )
    for (const contributor of move.contributors) {
      const name = contributor.name === null ? contributor.symbol : `${contributor.symbol} (${contributor.name})`
      lines.push(
        `    · ${name}: ${formatPercentValue(contributor.weight)} of the portfolio now, ${
          move.direction === 'trim' ? 'giving up' : 'taking on'
        } ${formatPoints(contributor.points)}, leaving it at ${formatPercentValue(contributor.resultingWeight)}`,
      )
    }
    lines.push(
      `  After this move ${band.label} sits at ${formatPercentValue(landing)}${
        move.uncovered > 0 ? ', still outside its range' : ', inside its range'
      }.`,
    )
  }

  if (move.uncovered > 0) {
    lines.push(
      `  ${formatPoints(move.uncovered)} of this move ${move.contributors.length === 0 ? 'is' : 'is still'} not carried by anything listed above.${
        move.ceilingLimited
          ? ' The owner’s own single-position ceiling is what stops it: no computed move takes a position above that ceiling to close another target.'
          : ''
      } Say the remainder is uncovered; do not place it on a position yourself.`,
    )
  }

  return lines
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
