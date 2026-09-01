import {
  formatPercentValue,
  formatPoints,
  formatSignedPercent,
  holdingName,
  instrumentName,
} from '@shared/format'
import { CURRENCY_EXPOSURE_NOTE } from '@shared/domain/assistantAbsences'
import {
  BASELINE_LABEL,
  BASELINE_UNCOVERED_NOTE,
  NO_SECTOR_UNIVERSE_NOTE,
  type BaselineCheck,
} from '@shared/domain/portfolioBaseline'
import {
  STYLE_TAG_LABELS,
  TARGET_DIMENSIONS,
  TARGET_DIMENSION_LABELS,
  isProfileEmpty,
  targetLabel,
  type CategoryTarget,
  type InvestorProfile,
  type TargetDimension,
} from '@shared/domain/investorProfileTerms'
import type { AllocationReport, AllocationResult } from '@shared/domain/allocation'
import type { Holding, PortfolioOverview } from '@shared/domain/portfolio'
import type {
  BalanceDriftReport,
  BalanceDriftResult,
  BaselineCeiling,
  BaselineReview,
  DimensionDrift,
  DriftBand,
  DriftMove,
} from '@shared/domain/balanceDrift'

/**
 * The four reports the model may ask for, written in the app's own prose (Story #326, DDR-0111).
 *
 * **A tool result is prose, never JSON.** DDR-0111 decision 5 settles it: a payload the model has to
 * read figures out of is a payload it can recombine, and the whole of ADR-0009's grounding rule is
 * that it never does. So every figure below goes through `@shared/format` — the same functions the
 * dashboards call since Story #324 moved them — and a number in an answer is the number on the
 * page, to the digit (DDR-0098).
 *
 * ## Why these functions live in main and not beside the renderer's
 *
 * They *were* beside them: `holdingsSection`, `weightsSection`, `profileSection` and `measuredDrift`
 * were `lib/assistantContext.ts`'s, assembled in the renderer and sent with every question whatever
 * was asked. This story moves them rather than copying them, and the renderer's copies are **gone**
 * — which is the property DDR-0098's criterion actually protects. Two implementations of "how this
 * app writes a percentage" is the failure; one implementation that moved is a path change.
 *
 * The prose is not the same prose, and the differences are the story:
 *
 * - **The profile splits from its measurement.** `profileSection` wrote the owner's policy, the
 *   drift against it and the app's baseline as one block, because one context section had to carry
 *   all three. Two tools carry them now, and the split is along the seam that matters: what the
 *   owner *set* is one report, what the app *measured* is another. The baseline stays welded to the
 *   drift — ADR-0012 computes it off the same reading and the same denominator, and splitting them
 *   is the second answer that record refused.
 * - **Allocation arrives one dimension at a time.** A question about sectors used to cost every
 *   breakdown the report holds; it now costs one.
 * - **The live book is a report of its own.** Nothing sent it before: the assembled context's
 *   holdings came out of imported Flex history, so a position bought since the last import was
 *   invisible however it was asked about.
 *
 * ## Two rules every report here obeys
 *
 * **No money, in any of them.** Each tool declares a `DISCLOSURE_CATEGORIES` category
 * (`assistantTools.ts`), and all four fall under `holdings`, `weights` or `profile` — declared as
 * names and percentages, with `weights` saying *"No amounts of money"* in as many words. That is not
 * caution about a leak; it is the disclosure being true. `toolReports.test.ts` reads every report
 * back and fails on a currency-formatted figure, which is `assistantContext.test.ts`'s assertion
 * carried across with the code it guards.
 *
 * **Absent is absent, never zero, and a state is never an empty report.** A gateway that is not
 * running produces a named state the model must say out loud, not a report with nothing in it — a
 * model handed an empty report phrases it as a finding (DDR-0022, and `assistant-builder`'s own
 * rule). The sharpest case is DDR-0007's: a holding that could not be valued is *unplaced*, is named
 * without a percentage, and makes every weight beside it a lower bound (Bug #68).
 */

/**
 * How many positions a list names before it says what it left out.
 *
 * It was the cap that made the 41st position invisible — the reason Epic #322 exists — and it is
 * still here, doing a different job. The ceiling is no longer *why* the model cannot see a position:
 * a question about one is `get_position` (#328), and a question about the shape of the book is
 * answered by weights whose tail is arithmetically uninteresting. What the cap now stops is one
 * report spending a whole round's budget, and it cuts at a place that can be **stated**: the list
 * says how many of how many, largest first, so a model asked about the hundredth position answers
 * that it is not in front of it rather than inventing one.
 */
export const MAX_LISTED_POSITIONS = 40

/**
 * How many drift-closing moves the rebalancing report sizes.
 *
 * The same ceiling for the same reason, applied to the report that grows with the *profile* rather
 * than with the portfolio: an owner may state thirty targets and have every one of them out of
 * range. The moves are taken **largest gap first** — what is cut is what matters least — and every
 * band still carries its verdict, sized or not. The report says how many of how many it sized.
 */
export const MAX_LISTED_MOVES = 6

/** Which breakdown `get_allocation` was asked for. Enumerated, because a predicate is a query. */
export const ALLOCATION_DIMENSIONS = [
  'position',
  'assetClass',
  'currency',
  'sector',
  'country',
] as const
export type AllocationDimension = (typeof ALLOCATION_DIMENSIONS)[number]

/** How each dimension is headed, and which array of the report it reads. */
const ALLOCATION_HEADINGS: Record<AllocationDimension, string> = {
  position: 'By position',
  assetClass: 'By asset class',
  currency: 'By currency',
  sector: 'By sector',
  country: 'By issuer country',
}

// ---- get_portfolio_overview -------------------------------------------------

/**
 * What a live read produced, in the shape every other report here already has (DDR-0022).
 *
 * `portfolioService.getOverview` **throws** the gateway's two typed errors, because the IPC handler
 * is where they are mapped for the views. A tool has no handler above it, so the mapping happens in
 * {@link liveOverview} and arrives here as a state — never as an exception the loop would have to
 * name, and never as an empty overview standing in for a gateway that is not running.
 */
export type LivePortfolioResult =
  | { status: 'ok'; overview: PortfolioOverview; displayCurrency: string; readAt: number }
  | { status: 'not_connected'; message: string }
  | { status: 'not_responding'; message: string }
  | { status: 'error'; message: string }

/**
 * The live book: what is held right now, and what share of it each position is (Story #326).
 *
 * **The denominator is stated, because there are two in this app and they disagree by design.**
 * These weights are each position's share of the total value of *holdings that could be valued*;
 * `get_rebalance_gaps` weighs the same portfolio with **cash in the denominator**, because a target
 * of "5% cash" is meaningless against a total that excludes it (DDR-0095). Two right answers to
 * "what percentage is this", and a model that met them without being told would reconcile them by
 * picking one. So each report says what its percentages are a share of, in its own opening line.
 *
 * **No money, so no total.** The report is declared under `holdings` and `weights`, which carry
 * names and percentages and no amounts (DDR-0098). What the portfolio is *worth* is not withheld as
 * a judgement about secrecy — it is simply not in a category the assistant discloses, and the
 * honest place for it is a report that declares one.
 *
 * `readAt` is passed in rather than read here, so the sentence naming the clock is testable and so
 * this module holds no `Date.now()`.
 */
export function portfolioOverviewReport(result: LivePortfolioResult): string {
  if (result.status === 'not_connected') {
    return `LIVE PORTFOLIO: the IBKR gateway is not running, so what the owner holds right now could not be read. Say the gateway is not running; do not answer from the imported statement history instead, which is a different store on a different clock. (${result.message})`
  }
  if (result.status === 'not_responding') {
    return `LIVE PORTFOLIO: the IBKR gateway accepted the connection and then stopped answering, so what the owner holds right now could not be read. Say it is not responding and that trying again shortly may work — this is not the same as the gateway not running. (${result.message})`
  }
  if (result.status === 'error') {
    return `LIVE PORTFOLIO: the live portfolio could not be read, so what the owner holds right now is not available. (${result.message})`
  }

  const { overview, displayCurrency, readAt } = result
  const valued = overview.holdings.filter((holding) => valueOf(holding) !== null)
  const unvalued = overview.holdings.filter((holding) => valueOf(holding) === null)
  const total = valued.reduce((sum, holding) => sum + (valueOf(holding) ?? 0), 0)

  const ranked = [...valued].sort((a, b) => (valueOf(b) ?? 0) - (valueOf(a) ?? 0))
  const listed = ranked.slice(0, MAX_LISTED_POSITIONS)

  const lines: string[] = [
    `LIVE PORTFOLIO, read from the IBKR gateway at ${isoMinute(readAt)}. This is the live book, not the imported statement history — never mix it with a figure out of the imported store.`,
    `Weights below are each position's share of the total value of the holdings that could be valued in ${displayCurrency}. Cash is not in that total and has no weight here; the rebalancing report weighs the same portfolio with cash included, so its percentages are a share of a different total and the two are not comparable.`,
  ]

  if (overview.holdings.length === 0) {
    lines.push('The account holds no open position at all. Say so; do not describe an empty book.')
    return lines.join('\n')
  }

  lines.push('', countLine(listed.length, ranked.length), '')

  for (const holding of listed) {
    // `holdingName`, not `instrumentName`: a live row has two candidate descriptions and the Flex
    // one wins, which is the same resolution every view draws (DDR-0066, DDR-0088).
    const name = holdingName(holding.symbol, holding.description, holding.companyName)
    const weight = total > 0 ? (valueOf(holding) ?? 0) / total : null
    lines.push(
      `- ${name === null ? holding.symbol : `${holding.symbol} (${name})`} · currency ${holding.currency}: ${
        weight === null ? 'no weight (nothing could be valued, so there is no total to be a share of)' : formatPercentValue(weight * 100)
      }`,
    )
  }

  if (unvalued.length > 0) {
    // Named, never weighted. There is no rate with which to compute a percentage for these, and
    // inventing one is what DDR-0007 and Bug #68 exist to stop — which is also why every weight
    // above is a lower bound rather than a measurement.
    const currencies = [...new Set(unvalued.map((holding) => holding.currency))].sort()
    lines.push(
      '',
      `${unvalued.length} holding(s) could not be valued in ${displayCurrency} (${currencies.join(', ')}): ${unvalued
        .map((holding) => holding.symbol)
        .join(', ')}. They are in none of the weights above and no percentage exists for them, so every weight here is a lower bound — a larger position may be hidden among them.`,
    )
  }

  return lines.join('\n')
}

/** A live holding's value in the display currency, or `null` where no rate was available. */
function valueOf(holding: Holding): number | null {
  return holding.displayValue === undefined ? holding.marketValue : holding.displayValue
}

// ---- get_investor_profile ---------------------------------------------------

/**
 * The owner's own policy, and nothing about whether the portfolio meets it (Story #326).
 *
 * The separation is the point. A target range read beside the actual weight is a *judgement*, and a
 * judgement against the owner's standard is `get_rebalance_gaps`'s to make — off one reading and one
 * denominator (ADR-0012). What this report carries is what the owner wrote, plus the dimensions they
 * wrote nothing about, because an untargeted dimension absent from a report reads as a dimension
 * that came back clean (DDR-0095).
 *
 * "Never written" and "cleared" are one state, which is DDR-0094's decision arriving here: the
 * profile is a setting, `clear` removes the key, and there is no third thing for the model to
 * distinguish.
 */
export function investorProfileReport(profile: InvestorProfile): string {
  const lines: string[] = [
    'THE INVESTOR PROFILE THE OWNER WROTE — their own standard, not the app’s. Nothing here says whether the portfolio currently meets it; that is the rebalancing report, which measures the live portfolio against these ranges. Never recommend a change to this profile and never suggest a target for the owner to set.',
    '',
  ]

  if (isProfileEmpty(profile)) {
    // The state, in the same words the assembled context used. An owner with nothing stored has not
    // left three dimensions untargeted — they have no profile, and saying it that way is what stops
    // "untargeted" reading as a decision they took.
    lines.push(
      'The owner has not set an investor profile at all. There is no standard of theirs to judge against: say so, and say they can set one in the Assistant view’s profile section. Never treat the app’s baseline as theirs.',
    )
    return lines.join('\n')
  }

  const blocks: string[] = []
  if (profile.styleTags.length > 0) {
    const tags = profile.styleTags.map((tag) => STYLE_TAG_LABELS[tag]).join(', ')
    blocks.push(`Investing style the owner states: ${tags}.`)
  }

  const targets = targetLines(profile)
  if (targets.length > 0) blocks.push(['Targets the owner set:', ...targets].join('\n'))

  const untargeted = untargetedLines(
    TARGET_DIMENSIONS.filter((dimension) => targetsIn(profile, dimension).length === 0),
    profile.positionSize === null,
  )
  if (untargeted.length > 0) blocks.push(untargeted.join('\n'))

  lines.push(blocks.join('\n\n'))
  return lines.join('\n')
}

/** Every target the profile carries, dimension by dimension, as ranges. */
function targetLines(profile: InvestorProfile): string[] {
  const lines: string[] = []

  for (const dimension of TARGET_DIMENSIONS) {
    for (const target of targetsIn(profile, dimension)) {
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

/** One dimension's targets, keyed by the profile's own three fields. */
function targetsIn(profile: InvestorProfile, dimension: TargetDimension): readonly CategoryTarget[] {
  const byDimension: Record<TargetDimension, readonly CategoryTarget[]> = {
    currency: profile.currencyTargets,
    sector: profile.sectorTargets,
    assetClass: profile.assetClassTargets,
  }
  return byDimension[dimension]
}

/**
 * The dimensions carrying no target, named as **untargeted** (Story #287, moved in #326).
 *
 * A dimension with no target is absent from the drift report entirely — `balanceDriftService`
 * returns `null` for it, deliberately, because a profile stating nothing about sectors is not a
 * profile stating that sectors do not matter. That absence is right in the report and wrong in front
 * of a model: a heading that is not there reads as a question that came back clean, and "your
 * sectors are balanced" is the sentence that follows.
 *
 * Taken as **which dimensions are missing** rather than as a profile, so both tools can write it:
 * `get_investor_profile` derives it from the profile it is reporting, and `get_rebalance_gaps`
 * derives it from the dimensions its own report carries — one service method each, which is
 * DDR-0111's rule that no tool spans two.
 */
function untargetedLines(missing: readonly TargetDimension[], noPositionCeiling: boolean): string[] {
  const lines: string[] = []

  if (missing.length > 0) {
    const named = missing.map((dimension) => TARGET_DIMENSION_LABELS[dimension].toLowerCase())
    lines.push(
      `Untargeted: the owner has set no target for ${list(named)}. There is no standard of theirs to measure ${missing.length === 1 ? 'it' : 'them'} against, so ${missing.length === 1 ? 'it is' : 'they are'} neither balanced nor unbalanced by the owner’s standard. Never report ${missing.length === 1 ? 'it' : 'them'} as balanced, and invent no standard of your own — where the app’s baseline covers ${missing.length === 1 ? 'it' : 'them'}, judge against that and say the standard is the app’s.`,
    )
  }

  if (noPositionCeiling) {
    lines.push(
      'Untargeted: the owner has set no single-position concentration ceiling, so no position is too large or too small by any standard of theirs. Where the app’s baseline covers it, judge against that and say the standard is the app’s.',
    )
  }

  return lines
}

// ---- get_allocation ---------------------------------------------------------

/**
 * One breakdown of the imported book, and only the one asked for (Story #326).
 *
 * `needs_import` is a **state**, never an empty breakdown: nothing imported is a fact about the app
 * rather than a portfolio holding nothing, and the two would be indistinguishable as an empty list
 * (DDR-0022).
 *
 * **Largest-N by weight is here, so there is no `get_concentration`.** Concentration already exists
 * twice — as position weights here, and as the baseline's 10% ceiling inside the rebalancing report
 * (ADR-0012) — and a third path would compute it off a third denominator. Two figures both called
 * concentration, legitimately disagreeing because one excludes what could not be valued, is the
 * second answer ADR-0012 refused (DDR-0111).
 */
export function allocationReport(
  result: AllocationResult,
  dimension: AllocationDimension,
  limit: number | null,
): string {
  if (result.status === 'needs_import') {
    return 'ALLOCATION: no Flex statement has been imported, so this app holds no allocation at all. Say that nothing is imported and that the owner can import a Flex statement from the Portfolio view. Never describe this as a portfolio holding nothing.'
  }

  const report = result.report
  const lines: string[] = [
    `ALLOCATION — ${ALLOCATION_HEADINGS[dimension].toLowerCase()}. ${sourceLine(report)}`,
  ]

  if (dimension === 'position') return [...lines, '', ...positionLines(report, limit)].join('\n')

  const slices = slicesFor(report, dimension)
  if (slices.length === 0) {
    // Absent, not zero: the statement carries no such attribute rather than every weight being nil.
    return [
      ...lines,
      '',
      `The imported statement carries no ${ALLOCATION_HEADINGS[dimension].slice(3)} breakdown at all — this is an absent attribute, not a set of zero weights. Say it is not available.`,
    ].join('\n')
  }

  lines.push('', `${ALLOCATION_HEADINGS[dimension]}, as a share of net asset value:`)
  // Beside the breakdown rather than once at the top, because a breakdown is quoted on its own and
  // a qualification three headings away is one that will not travel with it.
  if (dimension === 'currency') lines.push(CURRENCY_EXPOSURE_NOTE)
  for (const slice of slices) {
    lines.push(`- ${slice.label}: ${formatPercentValue(slice.percentOfNav)}`)
  }

  if (dimension === 'sector') {
    lines.push('', NO_SECTOR_UNIVERSE_NOTE)
    if (report.unclassifiedCount > 0) {
      lines.push(
        `${report.unclassifiedCount} position(s) have no sector in the local classification cache and are collected as unclassified. They are not a sector; never read them as one.`,
      )
    }
  }

  return lines.join('\n')
}

/** The positions themselves: names, currencies, classifications and weights. Largest first. */
function positionLines(report: AllocationReport, limit: number | null): string[] {
  const ranked = [...report.positions].sort((a, b) => b.percentOfNav - a.percentOfNav)
  const listed = ranked.slice(0, boundedLimit(limit))

  if (ranked.length === 0) {
    return [
      'The imported statement holds no open position. Say the statement records none; do not describe weights that are not there.',
    ]
  }

  const lines = [
    // The denominator, said where the figures are. `percentOfNAV` sums to 100% across positions and
    // *excludes cash*, so a list of positions that stops short of 100% is not a missing slice — it
    // is the cash the allocation report derives as the NAV residual (DDR-0015).
    'Each weight is that position’s share of net asset value as the statement reports it. Cash is not a position and is not in this list, so these weights do not sum to 100% — the remainder is cash, which the asset-class breakdown carries as its own slice.',
    countLine(listed.length, ranked.length),
    '',
  ]

  for (const position of listed) {
    const name = instrumentName(position.symbol, position.description)
    lines.push(
      `- ${name === null ? position.symbol : `${position.symbol} (${name})`} · currency ${position.currency} · sector ${
        position.sector === '' ? 'unclassified' : position.sector
      } · asset class ${position.assetCategory === '' ? 'unknown' : position.assetCategory}: ${formatPercentValue(position.percentOfNav)}`,
    )
  }

  return lines
}

/**
 * The count the model asked for, bounded by the cap it does not know about.
 *
 * A **count, not a condition** (DDR-0111): "the largest 5" is a shape the report already computes,
 * where "everything above 5%" would be the predicate ADR-0009 forbids arriving as a parameter. A
 * missing, nonsensical or oversized count falls back to the cap rather than being refused — the
 * model asking for 500 positions is asking for all of them.
 */
function boundedLimit(limit: number | null): number {
  if (limit === null || !Number.isFinite(limit) || limit < 1) return MAX_LISTED_POSITIONS
  return Math.min(Math.floor(limit), MAX_LISTED_POSITIONS)
}

/** Which array of the report a dimension reads. `position` is handled before this is reached. */
function slicesFor(
  report: AllocationReport,
  dimension: Exclude<AllocationDimension, 'position'>,
): AllocationReport['byCurrency'] {
  const byDimension = {
    assetClass: report.byAssetClass,
    currency: report.byCurrency,
    sector: report.bySector,
    country: report.byCountry,
  }
  return byDimension[dimension]
}

// ---- get_rebalance_gaps -----------------------------------------------------

/**
 * How far the live portfolio sits from the owner's targets, and from the app's own baseline
 * (Story #326, ADR-0012).
 *
 * **One report, because there is one reading and one denominator.** `balanceDriftService` computes
 * the baseline inside the same pass as the drift, off the same weights, precisely so there is one
 * answer to "how large is the largest position" (ADR-0012, Option F). Two tools would let the model
 * receive one without the other and lose the attribution that makes both safe: every line says whose
 * standard it is.
 *
 * **No model ever does this arithmetic** (DDR-0095). Every band, every distance, every move and both
 * verdicts arrive computed; what happens here is phrasing.
 *
 * The four non-`ok` variants are states and stay states. A gateway that is not running produces no
 * weights at all — a fact to be said, not routed around — and `not_connected` and `not_responding`
 * are not interchangeable, because one means start the gateway and the other means it is running and
 * stalled (DDR-0022).
 */
export function rebalanceGapsReport(result: BalanceDriftResult): string {
  if (result.status === 'not_connected') {
    return `REBALANCING GAPS: the IBKR gateway is not running, so the live portfolio could not be read and no gap could be measured. Say the gateway is not running; do not answer from the imported statement history instead, which is a different store on a different clock. (${result.message})`
  }
  if (result.status === 'not_responding') {
    return `REBALANCING GAPS: the IBKR gateway accepted the connection and then stopped answering, so no gap could be measured. Say it is not responding and that trying again shortly may work — this is not the same as the gateway not running. (${result.message})`
  }
  if (result.status === 'error') {
    return `REBALANCING GAPS: the live portfolio could not be read, so no gap could be measured. (${result.message})`
  }
  if (result.status === 'no_data') {
    return 'REBALANCING GAPS: nothing in the account could be valued in the display currency, so there is no total for a weight to be a share of and no gap can be measured. Say so; never report this as a balanced portfolio.'
  }

  const report = result.report
  const blocks: string[] = [measuredDrift(report)]

  // Derived from the report rather than from the profile, which is what keeps this tool on one
  // service method: a dimension the owner targeted is in `dimensions`, and one they did not is
  // absent from it (DDR-0111).
  const targeted = new Set(report.dimensions.map((dimension) => dimension.dimension))
  const untargeted = untargetedLines(
    TARGET_DIMENSIONS.filter((dimension) => !targeted.has(dimension)),
    report.position === null,
  )
  if (untargeted.length > 0) blocks.push(untargeted.join('\n'))

  const baseline = baselineBlock(report.baseline)
  if (baseline !== null) blocks.push(baseline)

  return blocks.join('\n\n')
}

/** The drift report as prose the model may quote, in percentage points throughout. */
export function measuredDrift(report: BalanceDriftReport): string {
  const sized = sizedMoves(report)

  const lines: string[] = [
    `REBALANCING GAPS, measured against the live portfolio, read ${isoMinute(report.readAt)}. Weights are each holding's share of everything that could be valued in ${report.displayCurrency}, **cash included** — a different total from the live holdings report, whose weights exclude cash.`,
    report.balanced === null
      ? 'The owner has set no targets, so there is nothing of theirs to be inside or outside. Say that rather than that the portfolio is balanced.'
      : report.balanced
        ? 'Every target the owner set is currently inside its range.'
        : 'At least one target the owner set is currently outside its range.',
  ]

  if (report.balanced === false) lines.push('', ...movesPreamble(report, sized))

  for (const dimension of report.dimensions) {
    lines.push('', `${TARGET_DIMENSION_LABELS[dimension.dimension]} targets:`)
    // Beside the breakdown it qualifies, for the reason the allocation report puts it there.
    if (dimension.dimension === 'currency') lines.push(CURRENCY_EXPOSURE_NOTE)
    lines.push(...bandLines(dimension, sized))
  }

  if (report.position !== null) {
    const p = report.position
    const name = p.name === null ? p.symbol : `${p.symbol} (${p.name})`
    lines.push(
      '',
      `Largest single position: ${name} at ${formatPercentValue(p.actual)} against a ${range(p.low, p.high)} ceiling — ${verdict(p.status, p.distance)}.${
        p.bounded
          ? ' This is a lower bound: some holding could not be valued, so a larger one may be hidden among them.'
          : ''
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
 * the owner's authority. The marking is beside each claim rather than once at the top, because a
 * caveat at the top of a section is read once and then not read.
 *
 * **What did not run is stated as loudly as what did.** A deferred check and an uncovered dimension
 * are both absences, and an absent verdict reads as a clean one unless it is named (DDR-0101).
 *
 * `null` where nothing ran and nothing was deferred, which is a portfolio with no shape to judge.
 */
export function baselineBlock(review: BaselineReview): string | null {
  if (review.applied.length === 0 && review.deferred.length === 0) return null

  // Nothing applied is one sentence, not a section. The owner has spoken about every dimension the
  // baseline covers, so all that is worth saying is *which* checks stood down — that a default
  // exists and stands down where they spoke is said unconditionally in the base context
  // (`BASELINE_SILENCE_NOTE`, Story #325), so repeating it here is a second copy.
  if (review.applied.length === 0) {
    return `None of the app’s default baseline applies here: the owner’s own targets govern ${list(review.deferred.map((check) => BASELINE_CHECK_LABELS[check]))}. Judge against their targets alone.`
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
    lines.push('', `Holdings carry ${review.sectorsHeld} distinct sector name(s). ${NO_SECTOR_UNIVERSE_NOTE}`)
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
  // The ceiling is written bare rather than through `formatPercentValue`: it is a round constant
  // the baseline owns, and `10.00%` reads as a measurement of something.
  return `- ${subject} at ${formatPercentValue(ceiling.actual)} against the app’s default ${ceiling.limit}% — ${measured}.${bound}`
}

/** How each check reads in a sentence that lists several of them. */
const BASELINE_CHECK_LABELS: Record<BaselineCheck, string> = {
  position: 'single-position size',
  sector: 'sector concentration',
  cash: 'uninvested cash',
  coverage: 'asset-class coverage',
}

/**
 * Which out-of-range bands get their move written out, largest gap first.
 *
 * A budget shared across the three dimensions rather than one per dimension: a profile carrying
 * thirty currency targets and one sector target should not spend the report on currencies because
 * they were declared first. Keyed by dimension and key together, because a currency and a sector may
 * both be called `USD` in principle and would otherwise collide silently.
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
 * the model's — which is the sentence that makes them quotable at all (ADR-0009, DDR-0095). And they
 * are expressed **against the portfolio as it stands**: shifting weight between positions, with
 * nothing paid in and nothing taken out. A move read as "buy this much more" would change the
 * denominator every other percentage here is a share of.
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

  // Surfaced, never redistributed (DDR-0095). A dimension whose bands sum to 80% has to say what the
  // other fifth is, or the model reads the gap as a rounding error and explains it away.
  for (const residual of dimension.residuals) {
    lines.push(`- ${residual.label} (no target applies): ${formatPercentValue(residual.weight)}`)
  }
  if (dimension.untargeted > 0) {
    lines.push(`- Held in categories with no target: ${formatPercentValue(dimension.untargeted)}`)
  }

  return lines
}

/**
 * One band's move, written out (Story #287, DDR-0103).
 *
 * **The end state is computed, which is what makes verifying the model's answer unnecessary.** There
 * is nothing the model produced to verify, because the arithmetic arrived done.
 *
 * **Percentage points, never money.** The `profile` category is declared as percentages only, and a
 * euro figure here would exceed what that category may carry — in a unit the profile is not even
 * written in (DDR-0098).
 *
 * **What the move cannot carry is stated, not spread.** A band the owner targets and holds nothing
 * in has no position to trim; a ceiling can stop the positions that exist from taking the rest. In
 * both cases the remainder is named, with what would actually close it — a different sentence from
 * the move, and one only the owner can act on.
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
      const name =
        contributor.name === null ? contributor.symbol : `${contributor.symbol} (${contributor.name})`
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

// ---- shared phrasing --------------------------------------------------------

/** How a band reads: inside, or how far out and in which direction. */
function verdict(status: 'inside' | 'below' | 'above', distance: number): string {
  if (status === 'inside') return 'inside the range'
  return `${status} the range by ${formatSignedPercent(distance)}`
}

/** A target range, both ends in the app's own percent format. */
function range(low: number, high: number): string {
  return `${formatPercentValue(low)}–${formatPercentValue(high)}`
}

/** A short list in prose: "a", "a and b", "a, b and c". */
function list(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Sentence case for a label written mid-sentence elsewhere. */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** Which store a composition report read, and as of when. */
function sourceLine(report: AllocationReport): string {
  const asOf = report.reportDate === null ? 'an unknown date' : isoDay(report.reportDate)
  return `From imported Flex history, as of ${asOf} and never as of today. Positions valued in ${report.baseCurrency}.`
}

/** How much of a list is in front of the model, stated rather than silently cut. */
function countLine(listed: number, total: number): string {
  return listed === total
    ? `All ${total} open position(s).`
    : `The ${listed} largest of ${total} open positions, by weight; the rest are not in front of you.`
}

/**
 * A date the model can quote without re-formatting it.
 *
 * ISO rather than `formatDate`'s locale form, and this is the one place the "use the app's own
 * formatters" rule gives way on purpose: a locale date is ambiguous read back (03/04 is two dates),
 * and unlike every figure here, a date in an answer is prose the model rewrites rather than a number
 * it must quote verbatim.
 *
 * Exported for `performanceReports.ts`, which writes dates in the same shape (Story #327). One
 * definition rather than two: a period's bounds and an allocation's report date have to read alike,
 * or the model has two date formats to reconcile inside one answer.
 */
export function isoDay(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

/** The same, to the minute, for a live reading whose time of day is the point. */
function isoMinute(epochMs: number): string {
  return `${new Date(epochMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}
