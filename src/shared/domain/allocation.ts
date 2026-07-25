import { z } from 'zod'

/**
 * Allocation analytics domain models (Milestone M3, Story #22). Built from the
 * latest imported statement's Flex `OpenPosition` rows joined to `SecurityInfo`
 * (for issuer country / asset class). See DDR-0005.
 *
 * Sector / industry is *not* in the Flex data — it comes from the locally cached IBKR
 * classification (Story #30, DDR-0009), so a position may legitimately be unclassified.
 *
 * Market value, cost basis, and unrealized P&L are converted from each position's
 * native currency to the base currency (EUR) using its `fxRateToBase`. Position
 * weight uses the Flex-provided `percentOfNav` (share of NAV, which includes cash),
 * so grouped breakdowns sum those weights. Amounts are plain decimal numbers.
 */

/** One open position, valued in the base currency. */
export const allocationPositionSchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  /** Native currency of the instrument. */
  currency: z.string(),
  /** Two-letter issuer country code from SecurityInfo, or '' when unknown. */
  issuerCountry: z.string(),
  /** Broad sector from the local classification cache, or '' when unclassified (Story #30). */
  sector: z.string(),
  /** Narrower industry from the local classification cache, or '' when unclassified. */
  industry: z.string(),
  marketValueBase: z.number(),
  costBasisBase: z.number(),
  unrealizedPnlBase: z.number(),
  /** Share of NAV as reported by IBKR (percent). */
  percentOfNav: z.number(),
})
export type AllocationPosition = z.infer<typeof allocationPositionSchema>

/** One slice of a grouped breakdown (by asset class, currency, or country). */
export const allocationSliceSchema = z.object({
  /** The group key (asset category code, currency code, or country code). */
  key: z.string(),
  /** A human-friendly label for the key. */
  label: z.string(),
  marketValueBase: z.number(),
  /** Summed share of NAV for the group (percent). */
  percentOfNav: z.number(),
})
export type AllocationSlice = z.infer<typeof allocationSliceSchema>

/** The assembled allocation report the Allocation view renders. */
export const allocationReportSchema = z.object({
  baseCurrency: z.string(),
  /** Report date of the statement the positions were taken from (epoch ms, UTC). */
  reportDate: z.number().int().nullable(),
  totalMarketValueBase: z.number(),
  positions: z.array(allocationPositionSchema),
  /** Asset-class breakdown; includes a derived 'Cash' slice when the portfolio holds cash (Story #47). */
  byAssetClass: z.array(allocationSliceSchema),
  byCurrency: z.array(allocationSliceSchema),
  byCountry: z.array(allocationSliceSchema),
  /** Sector breakdown (Story #30); unclassified positions collect in an 'Unclassified' slice. */
  bySector: z.array(allocationSliceSchema),
  /** How many positions have no sector yet — drives the "classify" prompt in the view. */
  unclassifiedCount: z.number().int(),
})
export type AllocationReport = z.infer<typeof allocationReportSchema>

/** Allocation view result: the report, or a needs-import signal when no Flex data exists. */
export const allocationResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), report: allocationReportSchema }),
  z.object({ status: z.literal('needs_import') }),
])
export type AllocationResult = z.infer<typeof allocationResultSchema>
