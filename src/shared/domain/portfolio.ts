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
  /**
   * The instrument's name as the imported Flex `SecurityInfo` records it, e.g. `SERABI GOLD PLC`
   * (Story #263 follow-up) — resolved by conid against local history, never fetched.
   *
   * It exists because `description` is the *gateway's* answer and this build has none: it sends no
   * `ticker`, so `description` falls back to `contractDesc` and repeats the symbol (DDR-0066). The
   * raw exported string is carried, not a shortened one — every view shortens through
   * `instrumentName` at the point of drawing, and a pre-shortened value here would be a second
   * naming path.
   *
   * `null` where local history knows nothing of the instrument — one bought since the last Flex
   * import, or nothing imported at all — and on snapshot-sourced holdings.
   */
  companyName: z.string().nullable(),
  quantity: z.number(),
  averageCost: z.number().nullable(),
  marketPrice: z.number().nullable(),
  marketValue: z.number(),
  /**
   * Unrealized gain or loss on the position, in the position's **native** currency (Story #263).
   *
   * `null` where it cannot be known — a gateway build that reports neither its own figure nor an
   * `avgCost` to derive one, and every snapshot-sourced holding, which records what a position was
   * worth and not what it had made at the time.
   *
   * Deliberately distinct from the Trades view's unrealized P&L, which comes from the Flex FIFO
   * summary: that one is a base-currency balance as of the latest statement's end date, this one is
   * live at current market prices. The two are measured on different days from different sources
   * and are not expected to agree.
   */
  unrealizedPnl: z.number().nullable(),
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
  /**
   * `unrealizedPnl` converted into the overview's `displayCurrency`, on the same terms as
   * `displayValue` and at the same rate (Story #263).
   *
   * A gain is an *amount*, not a quote, so unlike `marketPrice` and `averageCost` it does convert.
   * Absent on the native overview and on snapshot-sourced holdings; `null` where the rate was
   * unavailable or the native figure itself is unknown.
   */
  displayUnrealizedPnl: z.number().nullable().optional(),
})
export type Holding = z.infer<typeof holdingSchema>

/** Account-level cash and value figures, in the account's base currency. */
export const accountBalancesSchema = z.object({
  currency: z.string(),
  totalCashValue: z.number(),
  /**
   * Net (total) portfolio value = `stockMarketValue + totalCashValue`, in base currency.
   * Computed from those two rather than IBKR's `netliquidationvalue` (which also folds in
   * dividend/interest accruals and so never reconciles with the holdings + cash tiles beside
   * it); a single-user viewer wants net = holdings + cash exactly (Bug #68 refinement).
   */
  netLiquidation: z.number(),
  /**
   * Holdings (stock) market value, already expressed in the account's base currency by the
   * IBKR ledger — the authoritative base figure, unlike a raw sum of positions whose native
   * values are in mixed currencies. Snapshots persist this as their holdings total so history
   * reconciles to base (Bug #68); the live view converts per-position instead (DDR-0007).
   */
  stockMarketValue: z.number(),
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
