import { z } from 'zod'

/**
 * Portfolio / holdings domain models. These are the canonical, transport-agnostic
 * shapes for the read-only portfolio overview (Milestone M1). They are plain,
 * serializable data so they can cross the IPC boundary unchanged.
 *
 * The schemas are authored here once; the IPC contract (`@shared/ipc/contract`)
 * composes them into the `portfolio:getOverview` response, the repository/service
 * produce them, and the renderer imports the inferred *types* only (Zod is erased
 * from the renderer bundle).
 */

/** A single position the owner holds. */
export const holdingSchema = z.object({
  /** Interactive Brokers contract id — stable identifier for the instrument. */
  conid: z.number().int(),
  symbol: z.string(),
  description: z.string(),
  quantity: z.number(),
  averageCost: z.number().nullable(),
  marketPrice: z.number().nullable(),
  marketValue: z.number(),
  currency: z.string(),
})
export type Holding = z.infer<typeof holdingSchema>

/** Account-level cash and value figures, in the account's base currency. */
export const accountBalancesSchema = z.object({
  currency: z.string(),
  totalCashValue: z.number(),
  netLiquidation: z.number(),
})
export type AccountBalances = z.infer<typeof accountBalancesSchema>

/** One holding's share of the total holdings market value. */
export const allocationSliceSchema = z.object({
  conid: z.number().int(),
  symbol: z.string(),
  marketValue: z.number(),
  /** Fraction of total holdings market value, in [0, 1]. */
  weight: z.number(),
})
export type AllocationSlice = z.infer<typeof allocationSliceSchema>

/** The full read-only snapshot the dashboard renders. Assembled in-memory (no persistence in M1). */
export const portfolioOverviewSchema = z.object({
  holdings: z.array(holdingSchema),
  balances: accountBalancesSchema,
  allocation: z.array(allocationSliceSchema),
  totalMarketValue: z.number(),
})
export type PortfolioOverview = z.infer<typeof portfolioOverviewSchema>
