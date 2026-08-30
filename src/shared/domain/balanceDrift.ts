import { z } from 'zod'
import { TARGET_DIMENSIONS } from './investorProfileTerms'

/**
 * Balance drift: how far the portfolio sits from the targets the owner set (Story #281,
 * DDR-0095).
 *
 * **This module exists to keep the model out of the arithmetic**, which Epic #5 names as its
 * single largest correctness risk. A language model asked "is my portfolio balanced?" will
 * happily add percentages, and will sometimes be wrong in a way that reads exactly like being
 * right. The defence is that it never does: every figure in every later answer comes from a
 * service that already computed it, and this is the shape of what that service computes.
 *
 * Three rules run through the whole shape, and each is a way of *not* absorbing something into a
 * number that would then look fine.
 *
 * **A residual is surfaced, never redistributed** (DDR-0052). Cash has no sector; an instrument
 * the classification cache has not reached has no sector either; an instrument imported history
 * has never seen has no asset class. Each of those is its own named quantity with its own weight,
 * and none of them is spread across the buckets that *do* have a category. Drop one into the
 * wrong bucket and nothing will look wrong.
 *
 * **An unconvertible holding is unplaced, not zero** (DDR-0007). It is excluded from the
 * denominator and reported in {@link unplacedHoldingsSchema} by count, currency and native
 * amount — never given a percentage, because there is no rate with which to compute one and
 * inventing it is exactly what this Epic must not do.
 *
 * **A category with no target produces no band, and never a band of zero.** A profile stating
 * nothing about sectors is not a profile stating that sectors do not matter, so the dimension is
 * absent from the report rather than present and empty.
 */

/** Where the actual weight sits relative to its target range. */
export const DRIFT_STATUSES = ['inside', 'below', 'above'] as const
export type DriftStatus = (typeof DRIFT_STATUSES)[number]

/** Which way a band has to move to get back inside its range. */
export const MOVE_DIRECTIONS = ['trim', 'add'] as const
export type MoveDirection = (typeof MOVE_DIRECTIONS)[number]

/**
 * One held position, and the share of a move it would carry.
 *
 * **Percentage points, never money** (Story #287). The `profile` category is declared as
 * percentages only, and a euro figure inside a proposal would exceed what that category may carry
 * (DDR-0098). It would also be the wrong unit: the
 * profile is written in percentages, so a move that closes it is written in the difference between
 * two of them.
 */
export const moveContributorSchema = z.object({
  symbol: z.string(),
  /** The instrument's name where the live reading carries one. */
  name: z.string().nullable(),
  /** The position's share of the placed portfolio now, in percent. */
  weight: z.number(),
  /** Percentage points this position gives up (`trim`) or takes on (`add`). */
  points: z.number(),
  /** Where the position sits once it has, in percent. */
  resultingWeight: z.number(),
})
export type MoveContributor = z.infer<typeof moveContributorSchema>

/**
 * The arithmetic that closes one band's gap (Story #287).
 *
 * **It is computed here so that a proposal narrates arithmetic rather than generating it.** #281
 * already gave the model the gap; what it did not give was the *move*, and a model asked to close a
 * gap will size one — spreading points across positions is exactly the kind of calculation that
 * reads as prose. Computing it first also retires the check #289 wanted on the model's answer:
 * verifying a proposed end state means parsing free text, which fights the free-text surface, and
 * there is nothing to verify once the end state is the app's own.
 *
 * `uncovered` is the honest half. A band the owner targets and holds nothing in has no position to
 * carry the points at all, and a ceiling can stop the ones that do — in both cases the remainder is
 * *stated*, never spread over the positions that had no room for it (DDR-0052's rule, applied to a
 * proposal instead of a weight).
 */
export const driftMoveSchema = z.object({
  direction: z.enum(MOVE_DIRECTIONS),
  /** Percentage points that must shift for the band to reach the nearer edge of its range. */
  points: z.number(),
  /** The held positions that carry it, largest share first. */
  contributors: z.array(moveContributorSchema),
  /** Points the listed positions cannot carry — no holding, no room, or beyond the listed few. */
  uncovered: z.number(),
  /** Whether the owner's own concentration ceiling is what stopped them carrying it. */
  ceilingLimited: z.boolean(),
  /** How many held positions sit in this band, so a capped list can say how many of how many. */
  candidates: z.number().int().nonnegative(),
})
export type DriftMove = z.infer<typeof driftMoveSchema>

/**
 * One target, and the verdict on it.
 *
 * `distance` is the **signed percentage points to the nearer edge** — negative below the range,
 * positive above it, exactly `0` inside. That signed number is what makes a suggestion sizeable
 * later ("trim 4 points of USD"), and what makes "balanced" something the app can state rather
 * than a mood.
 *
 * `move` is that suggestion, sized (Story #287). It is non-`null` exactly when `status` is not
 * `inside`, which is what makes "every out-of-range band carries its move" a property of the shape
 * rather than of a caller remembering to compute one.
 */
export const driftBandSchema = z.object({
  /** The stored target key: a currency code, a sector name, an asset-class code. */
  key: z.string(),
  /** How that key is written on screen. */
  label: z.string(),
  /** Share of the placed portfolio, in percent. `0` where the owner targets what they do not hold. */
  actual: z.number(),
  low: z.number(),
  high: z.number(),
  status: z.enum(DRIFT_STATUSES),
  distance: z.number(),
  /** How to close it, or `null` because there is nothing to close. */
  move: driftMoveSchema.nullable(),
})
export type DriftBand = z.infer<typeof driftBandSchema>

/**
 * A quantity that belongs to the portfolio but to no bucket in this dimension.
 *
 * `cash` in the sector dimension is not a failure — money has no sector. `unclassified` and
 * `unknown_asset_class` are gaps in local reference data, and both are recoverable (a
 * classification refresh, a Flex import). What matters is that all three are *visible*: a
 * dimension whose bands sum to 80% because a fifth of the portfolio has no category must say so,
 * not quietly rescale to 100%.
 */
export const DRIFT_RESIDUAL_KINDS = ['cash', 'unclassified', 'unknown_asset_class'] as const
export type DriftResidualKind = (typeof DRIFT_RESIDUAL_KINDS)[number]

export const driftResidualSchema = z.object({
  kind: z.enum(DRIFT_RESIDUAL_KINDS),
  label: z.string(),
  /** Share of the placed portfolio, in percent. */
  weight: z.number(),
})
export type DriftResidual = z.infer<typeof driftResidualSchema>

/**
 * One dimension's verdict.
 *
 * The three numbers account for the whole placed portfolio, and that is the invariant the tests
 * check end to end: `Σ bands.actual + Σ residuals.weight + untargeted === 100`. A dimension the
 * profile states nothing about is **absent from the report**, never present with an empty
 * `bands`.
 */
export const dimensionDriftSchema = z.object({
  dimension: z.enum(TARGET_DIMENSIONS),
  bands: z.array(driftBandSchema),
  residuals: z.array(driftResidualSchema),
  /** Weight held in categories that exist in the portfolio but carry no target, in percent. */
  untargeted: z.number(),
})
export type DimensionDrift = z.infer<typeof dimensionDriftSchema>

/**
 * The largest single holding against the concentration ceiling.
 *
 * `bounded` says the figure is a **lower bound**: some position could not be valued in the
 * display currency, so a larger one may be hiding among the unplaced. Reporting `12.4%` when the
 * true answer is "at least 12.4%" is the sort of quiet wrongness this Epic exists to avoid.
 */
export const positionDriftSchema = z.object({
  symbol: z.string(),
  /** The instrument's name from imported history, or `null` where local history has none. */
  name: z.string().nullable(),
  actual: z.number(),
  low: z.number(),
  high: z.number(),
  status: z.enum(DRIFT_STATUSES),
  distance: z.number(),
  bounded: z.boolean(),
})
export type PositionDrift = z.infer<typeof positionDriftSchema>

/**
 * What could not be valued in the display currency, and is therefore in no weight above
 * (DDR-0007).
 *
 * Reported as a **count, a currency list and native totals** rather than as a percentage. The
 * percentage does not exist: pricing it in the display currency is precisely the thing the
 * gateway could not do, and deriving it from the gap between our summed conversions and IBKR's
 * own base-currency total would be reading rounding noise as a quantity (Bug #68). What is
 * reported is what is known.
 */
export const unplacedHoldingsSchema = z.object({
  /** How many holdings could not be valued. */
  positions: z.number().int().nonnegative(),
  /** How many cash balances could not be valued. */
  cashBalances: z.number().int().nonnegative(),
  /** The currencies involved, sorted. */
  currencies: z.array(z.string()),
  /** What is unplaced, per currency, in that currency. */
  nativeTotals: z.array(z.object({ currency: z.string(), amount: z.number() })),
})
export type UnplacedHoldings = z.infer<typeof unplacedHoldingsSchema>

export const balanceDriftReportSchema = z.object({
  /** The currency every weight below was computed in. */
  displayCurrency: z.string(),
  /** When the live reading behind it was taken — epoch ms, UTC. */
  readAt: z.number().int(),
  /**
   * The denominator of every weight: convertible holdings **plus convertible cash**, in
   * `displayCurrency`.
   *
   * Deliberately not `balances.netLiquidation`. That figure is IBKR's own base-currency total
   * converted at one rate, while these weights are per-position conversions at per-currency
   * rates — two different rate paths that disagree by small amounts routinely, so dividing one
   * by the other would put rounding noise into every percentage (Bug #68).
   */
  placedValue: z.number(),
  /** One entry per dimension the profile carries targets in; never an empty-band dimension. */
  dimensions: z.array(dimensionDriftSchema),
  /** `null` when the profile states no position ceiling, or when nothing is placed. */
  position: positionDriftSchema.nullable(),
  unplaced: unplacedHoldingsSchema,
  /** True when every band is inside its range. */
  balanced: z.boolean(),
})
export type BalanceDriftReport = z.infer<typeof balanceDriftReportSchema>

/**
 * The drift result, as data (DDR-0022).
 *
 * Six states, and the pairs that look alike are kept apart on purpose. `no_profile` (nothing
 * stated at all) and `no_targets` (style tags but no numbers) both mean "nothing to measure" and
 * want different copy — one says *set a profile*, the other *add some targets*, and telling
 * someone to do what they have already done is the failure. `not_connected` (the gateway is not
 * running) and `not_responding` (it accepted and then went quiet) are the pair DDR-0022 records,
 * and they are still not interchangeable.
 *
 * `no_data` covers an account holding nothing **and** one in which nothing could be valued in the
 * display currency: with no denominator there are no weights either way, and the Portfolio view
 * is where unconverted rows are already shown.
 */
export const balanceDriftResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), report: balanceDriftReportSchema }),
  z.object({ status: z.literal('no_profile') }),
  z.object({ status: z.literal('no_targets') }),
  z.object({ status: z.literal('no_data') }),
  z.object({ status: z.literal('not_connected'), message: z.string() }),
  z.object({ status: z.literal('not_responding'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type BalanceDriftResult = z.infer<typeof balanceDriftResultSchema>
