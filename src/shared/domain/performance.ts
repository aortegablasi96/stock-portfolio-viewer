import { z } from 'zod'

/**
 * Performance analytics domain models (Milestone M3, Story #21). Built from the
 * imported Flex `ChangeInNAV` records (one per statement) and the FIFO performance
 * summaries. See DDR-0005 for the read/aggregation model.
 *
 * All figures are already in the account base currency (EUR): `ChangeInNAV` and
 * `FIFOPerformanceSummaryUnderlying` carry no per-row FX rate because IBKR reports
 * them in base currency. Dates are epoch-millisecond integers (UTC). These are plain,
 * serializable shapes; the renderer imports the inferred *types* only.
 */

/** One statement period's NAV change — the raw per-period performance row. */
export const navPeriodSchema = z.object({
  fromDate: z.number().int(),
  toDate: z.number().int(),
  startingValue: z.number(),
  endingValue: z.number(),
  /** Mark-to-market P&L over the period (base currency). */
  mtm: z.number(),
  depositsWithdrawals: z.number(),
  dividends: z.number(),
  withholdingTax: z.number(),
  interest: z.number(),
  commissions: z.number(),
  /** Time-weighted return for the period, as reported by IBKR (percent). */
  twr: z.number(),
})
export type NavPeriod = z.infer<typeof navPeriodSchema>

/** A single point on the portfolio-value trend line. */
export const valuePointSchema = z.object({
  date: z.number().int(),
  value: z.number(),
})
export type ValuePoint = z.infer<typeof valuePointSchema>

/** The assembled performance report the Performance view renders. */
export const performanceReportSchema = z.object({
  baseCurrency: z.string(),
  /** Portfolio value over time, oldest → newest (period endpoints). */
  valueSeries: z.array(valuePointSchema),
  /** Per-period rows for the returns table, oldest → newest. */
  periods: z.array(navPeriodSchema),
  startingValue: z.number(),
  endingValue: z.number(),
  /** Cumulative time-weighted return across all periods, chain-linked (percent). */
  cumulativeTwr: z.number(),
  /** Net deposits (positive) / withdrawals (negative) over the whole history. */
  totalDepositsWithdrawals: z.number(),
  /** Realized and unrealized P&L rolled up from the FIFO summaries (base currency). */
  totalRealizedPnl: z.number(),
  totalUnrealizedPnl: z.number(),
})
export type PerformanceReport = z.infer<typeof performanceReportSchema>

/** Performance view result: the report, or a needs-import signal when no Flex data exists. */
export const performanceResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), report: performanceReportSchema }),
  z.object({ status: z.literal('needs_import') }),
])
export type PerformanceResult = z.infer<typeof performanceResultSchema>
