import {
  formatPercentValue,
  formatSignedPercent,
  instrumentName,
} from './format'
import type { AssistantContext } from '@shared/domain/assistantDisclosure'
import type { AllocationReport, AllocationResult } from '@shared/domain/allocation'
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
 * figure. The `performance` category is the one that may carry money, and this story assembles
 * nothing into it — Stories #285–#287 are what fill it, and until they do an answer about returns
 * correctly says the figure is not available.
 *
 * **Absent is absent, never zero.** A report that could not be read produces no section rather
 * than an empty one, and the view says so beside the box in its own words. A heading with nothing
 * under it invites the model to fill it in, which is exactly the failure mode grounding exists to
 * prevent. Its sharpest case is DDR-0007's: a holding that could not be valued is *unplaced*, and
 * is reported as a count and a currency, never as a weight of zero.
 *
 * **Every line names its source.** The composition sections read the **imported Flex store** and
 * are as of the latest statement; the drift section reads the **live** portfolio. Two different
 * clocks, and an answer that silently mixed them would be wrong in a way no reader could catch —
 * so each section opens by saying which one it is and when it was read.
 */

/** What a view has read, in whatever state each read came back in. */
export interface GroundingInputs {
  /** Composition from imported Flex history — `needs_import` when the store is empty. */
  allocation: AllocationResult
  /** The owner's own policy. The empty profile when they have never written one. */
  profile: InvestorProfile
  /** How far the live portfolio sits from that policy, or which blocker is in the way. */
  drift: BalanceDriftResult
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

  return context
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
