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
  /**
   * Market value converted into the overview's `displayCurrency` (live Portfolio view
   * only — Story #28, DDR-0007). Present *only* when a display currency was requested:
   * a `number` is the converted value; `null` means no FX rate was available, so the
   * position is shown in its native currency and excluded from converted totals. The
   * field is **absent** on the native overview and on snapshot-sourced holdings, so the
   * historical/snapshot path keeps persisting native values unchanged. `marketPrice`
   * and `averageCost` are deliberately *not* converted — a quote is a native-currency fact.
   */
  displayValue: z.number().nullable().optional(),
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
  /**
   * The currency that `totalMarketValue`, each holding's `displayValue`, the allocation
   * slices, and `balances` are expressed in when a display currency was requested
   * (Story #28). **Absent** on the native overview — in which case every figure is in
   * its own native currency and totals are the raw (native) sums, as before.
   */
  displayCurrency: z.string().optional(),
})
export type PortfolioOverview = z.infer<typeof portfolioOverviewSchema>
