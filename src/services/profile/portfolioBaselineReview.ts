/**
 * The app's baseline, measured (Story #315, ADR-0012).
 *
 * The counterpart of `driftMoves`: a pure function over already-computed weights, so the arithmetic
 * this Epic must never hand to a model has one testable home. **It computes no weights of its own**
 * — every figure that reaches it was derived by `balanceDriftService` from one live reading and one
 * denominator, which is what keeps the baseline and the drift report from ever disagreeing about how
 * large a position is (ADR-0012, Option F).
 *
 * The whole of "the owner's profile wins" is {@link governingFieldIsSet}: a check whose governing
 * field carries anything is **deferred**, and a deferred check computes nothing, reports nothing and
 * is named as deferred. Filling a silence is permitted; contradicting a stated target is not.
 */
import {
  BASELINE_CEILINGS,
  BASELINE_CHECK_GOVERNED_BY,
  BASELINE_CHECKS,
  BASELINE_COVERAGE_CLASSES,
  BASELINE_VERSION,
  type BaselineCheck,
} from '@shared/domain/portfolioBaseline'
import { assetClassLabel, CASH_ASSET_KEY } from '@shared/domain/assetClass'
import type { InvestorProfileDraft } from '@shared/domain/investorProfileTerms'
import type { BaselineCeiling, BaselineReview } from '@shared/domain/balanceDrift'

/** One placed position, already weighed. */
export interface WeighedPosition {
  symbol: string
  /** The instrument's name where the live reading carries one (DDR-0088). */
  name: string | null
  /** Share of the placed portfolio, in percent. */
  weight: number
}

export interface BaselineInput {
  profile: InvestorProfileDraft
  positions: readonly WeighedPosition[]
  /**
   * Weight per sector name, in percent.
   *
   * The unclassified residual is **not** in here. It is a gap in local reference data, not a sector
   * (DDR-0009), and letting it compete for "largest sector" would report a cache miss as a
   * concentration.
   */
  sectorWeights: ReadonlyMap<string, number>
  /**
   * Weight per asset-class key, in percent, including {@link CASH_ASSET_KEY} for uninvested cash.
   *
   * The `unknown_asset_class` residual is likewise absent: an instrument imported history has never
   * seen has no class, and counting it as one would make coverage look better than it is.
   */
  assetClassWeights: ReadonlyMap<string, number>
  /**
   * True where any holding or balance could not be valued, which makes every weight above a **lower
   * bound** (DDR-0007).
   */
  bounded: boolean
}

/**
 * Where the portfolio sits against the app's own standard, for the dimensions the profile left
 * silent.
 */
export function reviewAgainstBaseline(input: BaselineInput): BaselineReview {
  const applied: BaselineCheck[] = []
  const deferred: BaselineCheck[] = []
  for (const check of BASELINE_CHECKS) {
    ;(governingFieldIsSet(input.profile, check) ? deferred : applied).push(check)
  }

  const ceilings: BaselineCeiling[] = []
  if (applied.includes('position')) {
    const largest = largestBy(input.positions, (p) => p.weight)
    if (largest !== null) {
      ceilings.push(
        against('position', largest.symbol, largest.symbol, largest.name, largest.weight, input.bounded),
      )
    }
  }
  if (applied.includes('sector')) {
    const largest = largestEntry(input.sectorWeights)
    if (largest !== null) {
      ceilings.push(against('sector', largest[0], largest[0], null, largest[1], input.bounded))
    }
  }
  if (applied.includes('cash')) {
    // Always reported, including at 0%. "No idle cash" is a fact about the portfolio's shape, and
    // an absent cash line would read as a cash weight nobody looked at.
    const cash = input.assetClassWeights.get(CASH_ASSET_KEY) ?? 0
    ceilings.push(
      against('cash', CASH_ASSET_KEY, assetClassLabel(CASH_ASSET_KEY), null, cash, input.bounded),
    )
  }

  const absentAssetClasses = applied.includes('coverage')
    ? BASELINE_COVERAGE_CLASSES.filter((key) => (input.assetClassWeights.get(key) ?? 0) <= 0).map(
        (key) => ({ key, label: assetClassLabel(key) }),
      )
    : []

  return {
    version: BASELINE_VERSION,
    applied,
    deferred,
    ceilings,
    absentAssetClasses,
    sectorsHeld: input.sectorWeights.size,
    // `null` where nothing ran, for the reason the drift report's own `balanced` is nullable: a
    // verdict over an empty set of checks is one a model would phrase as reassurance.
    withinBaseline: ceilings.length === 0 ? null : ceilings.every((c) => c.status === 'inside'),
  }
}

/**
 * Whether the owner has said anything about what this check covers.
 *
 * The mapping is `BASELINE_CHECK_GOVERNED_BY`'s, so the rule is declared once in the module a
 * reviewer reads rather than re-derived here.
 */
function governingFieldIsSet(profile: InvestorProfileDraft, check: BaselineCheck): boolean {
  switch (BASELINE_CHECK_GOVERNED_BY[check]) {
    case 'positionSize':
      return profile.positionSize !== null
    case 'sector':
      return profile.sectorTargets.length > 0
    case 'assetClass':
      return profile.assetClassTargets.length > 0
  }
}

/**
 * One figure against one ceiling. `distance` is points **above** it, and exactly `0` when inside.
 *
 * Unrounded, and on the ceiling counts as inside — both are `balanceDriftService`'s own `verdict`
 * conventions, kept identical here because the two verdicts are read side by side. A baseline that
 * rounded where the drift report does not would put two precisions in one answer, and a baseline
 * that faulted a portfolio sitting at exactly 10% would disagree with a profile ceiling of 10%
 * about the same portfolio.
 */
function against(
  check: 'position' | 'sector' | 'cash',
  key: string,
  label: string,
  name: string | null,
  actual: number,
  bounded: boolean,
): BaselineCeiling {
  const limit = BASELINE_CEILINGS[check]
  const above = actual > limit
  return {
    check,
    key,
    label,
    name,
    actual,
    limit,
    status: above ? 'above' : 'inside',
    distance: above ? actual - limit : 0,
    bounded,
  }
}

function largestBy<T>(items: readonly T[], of: (item: T) => number): T | null {
  let best: T | null = null
  for (const item of items) if (best === null || of(item) > of(best)) best = item
  return best
}

function largestEntry(weights: ReadonlyMap<string, number>): [string, number] | null {
  return largestBy([...weights.entries()], ([, weight]) => weight)
}
