import { z } from 'zod'
import {
  STYLE_TAGS,
  TARGET_DIMENSIONS,
  TARGET_DIMENSION_FIELDS,
  TARGET_DIMENSION_LABELS,
  type InvestorProfileDraft,
} from './investorProfileTerms'

/**
 * The investor profile's Zod schemas (Milestone M10, Story #280).
 *
 * The profile is the Epic's foundation because "is my portfolio balanced?" has no honest answer
 * without it. Balance is not a property of a portfolio, it is a relation between a portfolio and
 * an intent — so the app either measures against a standard the owner set, or invents one, and
 * inventing one is the single thing ADR-0009 does *not* license. Everything downstream (the drift
 * report, the rebalancing proposal) inherits its authority from here.
 *
 * The **shape** and the vocabulary live in `./investorProfileTerms`, which has no dependencies so
 * the renderer can import the five tags and three dimensions as values without pulling Zod into
 * its bundle. This module adds validation over them and re-exports the lot, so the main process
 * has one import path. Four shape decisions are recorded in DDR-0094:
 *
 * - **Targets are ranges, not points.** A point target is drifted from the moment the market
 *   moves; a range is a policy.
 * - **A partial profile is valid.** No category is required, nothing has to sum to 100, and the
 *   app never fills a blank with a default of its own choosing — an omitted category means the
 *   owner has no policy there, which is different from a policy of zero.
 * - **A target names a category, never an instrument.**
 * - **A key the portfolio does not currently hold is preserved, not dropped.**
 */

export * from './investorProfileTerms'

export const styleTagSchema = z.enum(STYLE_TAGS)

/**
 * A percentage bound. Whole-percent granularity is deliberately *not* imposed — a 12.5% ceiling
 * is a policy someone may hold — but the bound itself must be a real number inside 0–100, which
 * is what "invalid ranges are rejected at the boundary, not stored" means.
 */
const percentSchema = z.number().finite().min(0).max(100)

/** A low/high pair in percent. `low > high` is rejected by {@link refineInvestorProfile}. */
export const targetRangeSchema = z.object({
  low: percentSchema,
  high: percentSchema,
})

/** A range attached to one currency, sector or asset class. */
export const categoryTargetSchema = z.object({
  key: z.string().trim().min(1).max(60),
  low: percentSchema,
  high: percentSchema,
})

/** What the renderer sends — no `updatedAt`, which is the service's fact rather than the caller's. */
export const investorProfileDraftSchema = z.object({
  styleTags: z.array(styleTagSchema),
  currencyTargets: z.array(categoryTargetSchema),
  sectorTargets: z.array(categoryTargetSchema),
  assetClassTargets: z.array(categoryTargetSchema),
  positionSize: targetRangeSchema.nullable(),
})

/** The stored profile: a draft plus when it was written, or `null` if it never has been. */
export const investorProfileSchema = investorProfileDraftSchema.extend({
  updatedAt: z.number().int().nullable(),
})

/**
 * The two structural rules a `low`/`high` pair cannot express on its own, applied to the whole
 * profile so one parse answers both.
 *
 * **`low <= high`**, per target. An inverted range is not a narrow policy, it is a typo, and
 * storing it would hand the drift story a window nothing can ever sit inside.
 *
 * **No duplicate key within a dimension.** Two ranges for `USD` are two policies for one
 * exposure, and there is no rule for choosing between them that is not a guess. Comparison is
 * case-insensitive because the vocabularies are not: `usd` and `USD` name the same currency. The
 * dimensions are separate policies, so the same name in two of them is not a duplicate.
 *
 * Style tags are de-duplicated rather than rejected — a repeated tag is the same statement twice,
 * which has an obvious reading — so that rule lives in the service's normalisation, not here.
 */
export function refineInvestorProfile(profile: InvestorProfileDraft, ctx: z.RefinementCtx): void {
  if (profile.positionSize && profile.positionSize.low > profile.positionSize.high) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['positionSize'],
      message: 'Position size: the minimum must not be above the maximum.',
    })
  }

  for (const dimension of TARGET_DIMENSIONS) {
    const field = TARGET_DIMENSION_FIELDS[dimension]
    const seen = new Set<string>()

    profile[field].forEach((target, index) => {
      if (target.low > target.high) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field, index],
          message: `${TARGET_DIMENSION_LABELS[dimension]} ${target.key}: the minimum must not be above the maximum.`,
        })
      }

      const key = target.key.toUpperCase()
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field, index],
          message: `${TARGET_DIMENSION_LABELS[dimension]} ${target.key} is listed twice.`,
        })
      }
      seen.add(key)
    })
  }
}

/** The draft schema with the structural rules applied — what the IPC handler parses. */
export const validatedInvestorProfileDraftSchema =
  investorProfileDraftSchema.superRefine(refineInvestorProfile)

/**
 * Result of saving the profile.
 *
 * `invalid` is its own variant rather than an `error`: a range the owner typed backwards is a
 * correctable statement about the form, not a failure of the app, and the two want different
 * copy (DDR-0022). Success echoes the stored profile so the form re-seats on exactly what
 * landed, `updatedAt` included.
 */
export const saveInvestorProfileResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('saved'), profile: investorProfileSchema }),
  z.object({ status: z.literal('invalid'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type SaveInvestorProfileResult = z.infer<typeof saveInvestorProfileResultSchema>

/**
 * Result of clearing the profile.
 *
 * `cleared` echoes `EMPTY_INVESTOR_PROFILE` for the same reason `saved` echoes the stored one.
 * This is **not** ADR-0006's sanctioned reset: no history is deleted, because the profile is not
 * history — it is the one owner-written setting the app keeps, and un-setting it is the same
 * class of act as re-writing it.
 */
export const clearInvestorProfileResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cleared'), profile: investorProfileSchema }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type ClearInvestorProfileResult = z.infer<typeof clearInvestorProfileResultSchema>
