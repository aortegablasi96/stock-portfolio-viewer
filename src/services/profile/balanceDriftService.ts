import { classificationRepository } from '@repositories/classification/classificationRepository'
import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import { portfolioService, type CashPosition } from '@services/portfolio/portfolioService'
import { investorProfileService } from '@services/profile/investorProfileService'
import { driftMove, type BandPosition } from '@services/profile/driftMoves'
import { assetClassLabel, CASH_ASSET_KEY, CASH_ASSET_LABEL } from '@shared/domain/assetClass'
import {
  countTargets,
  isProfileEmpty,
  TARGET_DIMENSIONS,
  TARGET_DIMENSION_FIELDS,
  type CategoryTarget,
  type InvestorProfile,
  type TargetDimension,
} from '@shared/domain/investorProfileTerms'
import type {
  BalanceDriftResult,
  DimensionDrift,
  DriftBand,
  DriftResidual,
  DriftStatus,
  PositionDrift,
  UnplacedHoldings,
} from '@shared/domain/balanceDrift'
import type { Holding } from '@shared/domain/portfolio'

/**
 * Balance drift against the investor profile (Milestone M10, Story #281, DDR-0095).
 *
 * **The point of this service is that no model ever does this arithmetic.** Epic #5 names that as
 * its largest correctness risk: asked "is my portfolio balanced?", a language model will add
 * percentages and will sometimes be wrong in a way that reads exactly like being right. So every
 * figure in every later answer is computed here, deterministically, and the model is only ever
 * given numbers to phrase.
 *
 * ### It reads the live portfolio, not Flex
 *
 * "Is my portfolio balanced?" is a question about **now**, and Flex would answer it as of the last
 * statement — which may be weeks old, and which the owner has no way to tell from the answer. So
 * every *weight* comes from one live reading: positions and their prices from the gateway, cash
 * per currency from the same ledger read, all converted with live FX in this service (never the
 * repository, never the renderer). That also makes the gateway states real, which is why the
 * result distinguishes `not_connected` from `not_responding` at all.
 *
 * The story warns against a *mixed* answer, where one dimension is live and another as-of, and
 * this is not one. Two things do come from local stores, and both are **reference data about an
 * instrument** rather than a weight: its sector, from the classification cache (DDR-0009), and
 * its asset class, from imported `SecurityInfo` (the live gateway carries neither — DDR-0088
 * records the same gap for the instrument's name). A sector does not change between Tuesday and
 * Wednesday; a weight does. Every number in the report is as of the same moment.
 *
 * ### Three things are surfaced rather than absorbed
 *
 * A holding whose FX rate the gateway could not supply is **unplaced**: excluded from the
 * denominator, and reported by count, currency and native amount (DDR-0007). It is never given a
 * percentage — there is no rate with which to compute one.
 *
 * A holding the classification cache has not reached has **no sector**, and one imported history
 * has never seen has **no asset class**. Each becomes its own named residual with its own weight,
 * never spread across the buckets that do have a category (DDR-0052). Cash is a residual in the
 * sector dimension for the same reason: money has no sector.
 *
 * A dimension the profile states nothing about is **absent from the report** — not present with
 * an empty band list, and never a drift of zero.
 */

/** The denominator, and everything that goes into it. */
interface PlacedItem {
  /** Value in the display currency. */
  value: number
  currency: string
  /** `null` for cash, which is not an instrument. */
  holding: Holding | null
}

export const balanceDriftService = {
  /**
   * How far the portfolio sits from the profile's targets, in `displayCurrency`.
   *
   * Gateway failures are **not** caught here: `IbkrNotConnectedError` and `IbkrTimeoutError`
   * propagate for the IPC handler to map, exactly as they do for `portfolio:getOverview`, which
   * is the read this is built on. Everything the service itself can determine — no profile, no
   * targets, nothing to weigh — comes back as its own variant.
   */
  async getBalanceDrift(
    displayCurrency: string,
    now: number = Date.now(),
  ): Promise<BalanceDriftResult> {
    const profile = investorProfileService.get()
    if (isProfileEmpty(profile)) return { status: 'no_profile' }
    if (countTargets(profile) === 0) return { status: 'no_targets' }

    const [overview, cash] = await Promise.all([
      portfolioService.getOverview(displayCurrency),
      portfolioService.getCashPositions(displayCurrency),
    ])

    const placed = placedItems(overview.holdings, cash)
    const placedValue = placed.reduce((sum, item) => sum + item.value, 0)
    // Nothing to weigh: an empty account, or one in which no rate was available for anything. The
    // second is not a different answer for this report — with no denominator there are no weights
    // either way, and the Portfolio view is where unconverted rows are already shown.
    if (placedValue <= 0) return { status: 'no_data' }

    const weightOf = (value: number): number => (value / placedValue) * 100
    const sectorOf = sectorResolver()
    const classOf = assetClassResolver()

    const dimensions = TARGET_DIMENSIONS.map((dimension) =>
      driftFor(dimension, profile, placed, weightOf, sectorOf, classOf),
    ).filter((d): d is DimensionDrift => d !== null)

    const unplaced = unplacedFrom(overview.holdings, cash)
    const position = positionDriftFor(profile, placed, weightOf, unplaced)

    return {
      status: 'ok',
      report: {
        displayCurrency,
        readAt: now,
        placedValue: round2(placedValue),
        dimensions,
        position,
        unplaced,
        // Vacuously true only when there is nothing to judge, which `no_targets` above has
        // already ruled out: a profile reaching here carries at least one target.
        balanced:
          dimensions.every((d) => d.bands.every((b) => b.status === 'inside')) &&
          (position === null || position.status === 'inside'),
      },
    }
  },
}

/** Round a money amount to cents. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * Everything that could be valued in the display currency: convertible holdings, plus convertible
 * cash.
 *
 * Cash is in here rather than beside it because a currency target is about the whole portfolio,
 * not about the invested part of it — an owner holding 40% of their money in dollars holds it
 * whether or not it is in a position. `displayValue === null` on either kind means unconvertible,
 * and unconvertible means *absent from this list*, never a zero inside it (DDR-0007).
 */
function placedItems(holdings: readonly Holding[], cash: readonly CashPosition[]): PlacedItem[] {
  const items: PlacedItem[] = []
  for (const holding of holdings) {
    if (holding.displayValue == null) continue
    items.push({ value: holding.displayValue, currency: holding.currency, holding })
  }
  for (const balance of cash) {
    if (balance.displayValue == null) continue
    items.push({ value: balance.displayValue, currency: balance.currency, holding: null })
  }
  return items
}

/** What was left out, by count, currency and native amount — never by percentage (DDR-0007). */
function unplacedFrom(
  holdings: readonly Holding[],
  cash: readonly CashPosition[],
): UnplacedHoldings {
  const nativeTotals = new Map<string, number>()
  let positions = 0
  let cashBalances = 0

  for (const holding of holdings) {
    if (holding.displayValue != null) continue
    positions += 1
    nativeTotals.set(
      holding.currency,
      (nativeTotals.get(holding.currency) ?? 0) + holding.marketValue,
    )
  }
  for (const balance of cash) {
    if (balance.displayValue != null) continue
    cashBalances += 1
    nativeTotals.set(balance.currency, (nativeTotals.get(balance.currency) ?? 0) + balance.amount)
  }

  return {
    positions,
    cashBalances,
    currencies: [...nativeTotals.keys()].sort(),
    nativeTotals: [...nativeTotals.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, amount]) => ({ currency, amount: round2(amount) })),
  }
}

/**
 * An instrument's sector, from the local classification cache.
 *
 * Conid first, symbol second — the same resolver `allocationService` uses, for the reason DDR-0088
 * gives: a conid is stable where a ticker is not. `''` where the cache has not reached the
 * instrument, which becomes the `unclassified` residual rather than a bucket.
 *
 * A plain cache read, never a network call, so a closed gateway costs sectors nothing beyond what
 * the live reading above already needed (DDR-0009).
 */
function sectorResolver(): (holding: Holding) => string {
  const rows = classificationRepository.getAll()
  const byConid = new Map(rows.map((r) => [r.conid, r.sector]))
  const bySymbol = new Map(rows.filter((r) => r.symbol).map((r) => [r.symbol, r.sector]))
  return (holding) => byConid.get(holding.conid) ?? bySymbol.get(holding.symbol) ?? ''
}

/**
 * An instrument's asset class, from imported `SecurityInfo`.
 *
 * The keys are IBKR's own codes, which is what makes a stored target join: the profile's
 * asset-class vocabulary comes from the allocation report, which groups by exactly this field
 * (`@shared/domain/assetClass`). `''` where nothing imported knows the instrument — one bought
 * since the last Flex import, or nothing imported at all — which becomes the
 * `unknown_asset_class` residual.
 */
function assetClassResolver(): (holding: Holding) => string {
  const rows = flexReadRepository.getInstrumentAssetClasses()
  const byConid = new Map<number, string>()
  const bySymbol = new Map<string, string>()
  for (const row of rows) {
    if (row.assetCategory === '') continue
    if (row.conid != null && !byConid.has(row.conid)) byConid.set(row.conid, row.assetCategory)
    if (row.symbol !== '' && !bySymbol.has(row.symbol)) bySymbol.set(row.symbol, row.assetCategory)
  }
  return (holding) => byConid.get(holding.conid) ?? bySymbol.get(holding.symbol) ?? ''
}

/**
 * How one dimension buckets the placed portfolio: a key per item, or `null` for an item that
 * belongs to a **residual** rather than to a bucket.
 *
 * Cash is the interesting row. In `currency` it is an ordinary bucket — dollars are dollars
 * whether invested or not. In `sector` it is a residual, because money has no sector. In
 * `assetClass` it is a bucket again, under the sentinel key the allocation report already uses,
 * so a stored "Cash" target joins with it.
 */
function bucketFor(
  dimension: TargetDimension,
  item: PlacedItem,
  sectorOf: (h: Holding) => string,
  classOf: (h: Holding) => string,
): { key: string; label: string } | { residual: DriftResidualDescriptor } {
  if (dimension === 'currency') {
    return { key: item.currency, label: item.currency || 'Unknown' }
  }

  if (dimension === 'sector') {
    if (item.holding === null) return { residual: RESIDUALS.cash }
    const sector = sectorOf(item.holding)
    return sector === '' ? { residual: RESIDUALS.unclassified } : { key: sector, label: sector }
  }

  if (item.holding === null) {
    return { key: CASH_ASSET_KEY, label: CASH_ASSET_LABEL }
  }
  const code = classOf(item.holding)
  return code === ''
    ? { residual: RESIDUALS.unknownAssetClass }
    : { key: code, label: assetClassLabel(code) }
}

interface DriftResidualDescriptor {
  kind: DriftResidual['kind']
  label: string
}

/**
 * The three residuals, named once.
 *
 * The wording says *why* each one is outside the buckets rather than merely that it is: "no
 * sector" invites a classification refresh, "not in imported history" invites an import, and
 * "cash" invites neither because nothing is missing.
 */
const RESIDUALS = {
  cash: { kind: 'cash', label: 'Cash (no sector)' },
  unclassified: { kind: 'unclassified', label: 'Not yet classified' },
  unknownAssetClass: { kind: 'unknown_asset_class', label: 'Not in imported history' },
} as const satisfies Record<string, DriftResidualDescriptor>

/**
 * One dimension's drift, or `null` when the profile states no target in it.
 *
 * `null` rather than an empty dimension is the point: a profile stating nothing about sectors is
 * not a profile stating that sectors do not matter, and a dimension present with no bands would
 * read as the second.
 */
function driftFor(
  dimension: TargetDimension,
  profile: InvestorProfile,
  placed: readonly PlacedItem[],
  weightOf: (value: number) => number,
  sectorOf: (h: Holding) => string,
  classOf: (h: Holding) => string,
): DimensionDrift | null {
  const targets = profile[TARGET_DIMENSION_FIELDS[dimension]]
  if (targets.length === 0) return null

  // Bucketed value, and the residual value beside it. Both are sums of the *same* placed items,
  // so nothing can land in two places and nothing can be dropped.
  const buckets = new Map<string, { label: string; value: number }>()
  const residuals = new Map<DriftResidual['kind'], { label: string; value: number }>()
  // Which instruments carry each bucket's weight, summed per conid — the input a move is sized
  // from (Story #287). Cash lands in a bucket without landing here on purpose: a currency band's
  // weight can be part cash, and cash is not a position anyone trims.
  const carriers = new Map<string, Map<number, { holding: Holding; value: number }>>()

  for (const item of placed) {
    const bucket = bucketFor(dimension, item, sectorOf, classOf)
    if ('residual' in bucket) {
      const existing = residuals.get(bucket.residual.kind) ?? {
        label: bucket.residual.label,
        value: 0,
      }
      existing.value += item.value
      residuals.set(bucket.residual.kind, existing)
      continue
    }
    const id = bucket.key.toUpperCase()
    const existing = buckets.get(id) ?? { label: bucket.label, value: 0 }
    existing.value += item.value
    buckets.set(id, existing)

    if (item.holding !== null) {
      const byConid = carriers.get(id) ?? new Map()
      const held = byConid.get(item.holding.conid)
      if (held) held.value += item.value
      else byConid.set(item.holding.conid, { holding: item.holding, value: item.value })
      carriers.set(id, byConid)
    }
  }

  // Matched case-insensitively, because the vocabularies are not case-sensitive and a target the
  // owner typed as `usd` names the same exposure as a bucket keyed `USD` (DDR-0094).
  const claimed = new Set<string>()
  const bands = targets.map((target) => {
    const id = target.key.toUpperCase()
    claimed.add(id)
    const bucket = buckets.get(id)
    // A target the portfolio does not hold is a real drift at 0%, not an absent band: "I want 10%
    // in utilities and hold none" is exactly the answer being asked for.
    return bandFor(
      target,
      bucket ? weightOf(bucket.value) : 0,
      bucket?.label ?? target.key,
      bandPositions(carriers.get(id), weightOf),
      profile.positionSize?.high ?? null,
    )
  })

  const untargeted = [...buckets.entries()]
    .filter(([id]) => !claimed.has(id))
    .reduce((sum, [, bucket]) => sum + weightOf(bucket.value), 0)

  return {
    dimension,
    bands,
    residuals: [...residuals.entries()]
      .map(([kind, residual]) => ({ kind, label: residual.label, weight: weightOf(residual.value) }))
      .sort((a, b) => b.weight - a.weight),
    untargeted,
  }
}

/**
 * The verdict on one target: where the actual sits, how far outside it is, and how to close it.
 *
 * The move is computed from the verdict rather than beside it, so a band cannot be out of range
 * and carry no move — the one place the two could disagree is this expression, and there is only
 * one of it (Story #287).
 */
function bandFor(
  target: CategoryTarget,
  actual: number,
  label: string,
  positions: readonly BandPosition[],
  ceiling: number | null,
): DriftBand {
  const measured = verdict(actual, target.low, target.high)
  return {
    key: target.key,
    label,
    actual,
    low: target.low,
    high: target.high,
    ...measured,
    move: driftMove(measured.status, measured.distance, positions, ceiling),
  }
}

/**
 * A bucket's instruments as weights, largest first — the input a move is sized from.
 *
 * The name is the live reading's `companyName`, which is `null` where nothing local knows the
 * instrument (DDR-0088). A move naming a bare ticker is still a move; a move naming `Cad` would be
 * a renamed company (DDR-0066).
 */
function bandPositions(
  carriers: Map<number, { holding: Holding; value: number }> | undefined,
  weightOf: (value: number) => number,
): BandPosition[] {
  if (carriers === undefined) return []
  return [...carriers.values()]
    .map((entry) => ({
      symbol: entry.holding.symbol,
      name: entry.holding.companyName,
      weight: weightOf(entry.value),
    }))
    .sort((a, b) => b.weight - a.weight)
}

/**
 * Status and signed distance in one place, so the two can never disagree.
 *
 * `distance` is percentage points to the **nearer edge**, negative below and positive above, and
 * exactly `0` inside — including on an edge, which is inside: a range is closed, or a target of
 * 20–40 would fault a portfolio sitting at exactly 40.
 */
function verdict(actual: number, low: number, high: number): { status: DriftStatus; distance: number } {
  if (actual < low) return { status: 'below', distance: actual - low }
  if (actual > high) return { status: 'above', distance: actual - high }
  return { status: 'inside', distance: 0 }
}

/**
 * The largest single holding against the concentration ceiling.
 *
 * Cash is excluded: the ceiling is about how much of the portfolio rides on one *instrument*, and
 * cash is not one. `bounded` says some position could not be valued, so the answer is "at least
 * this much" — a larger holding may be hiding among the unplaced, and reporting a bare figure
 * there would be the quiet kind of wrong this Epic exists to avoid.
 */
function positionDriftFor(
  profile: InvestorProfile,
  placed: readonly PlacedItem[],
  weightOf: (value: number) => number,
  unplaced: UnplacedHoldings,
): PositionDrift | null {
  const band = profile.positionSize
  if (band === null) return null

  // One entry per instrument, not per row: the gateway reports a position once, but summing by
  // conid costs nothing and makes a split holding impossible to under-report.
  const byConid = new Map<number, { holding: Holding; value: number }>()
  for (const item of placed) {
    if (item.holding === null) continue
    const existing = byConid.get(item.holding.conid)
    if (existing) existing.value += item.value
    else byConid.set(item.holding.conid, { holding: item.holding, value: item.value })
  }

  let largest: { holding: Holding; value: number } | null = null
  for (const entry of byConid.values()) {
    if (largest === null || entry.value > largest.value) largest = entry
  }
  if (largest === null) return null

  const actual = weightOf(largest.value)
  return {
    symbol: largest.holding.symbol,
    name: largest.holding.companyName,
    actual,
    low: band.low,
    high: band.high,
    ...verdict(actual, band.low, band.high),
    bounded: unplaced.positions > 0,
  }
}
