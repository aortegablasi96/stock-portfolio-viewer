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

/**
 * One band of the portfolio-composition chart — an asset class, or the residual buckets
 * below (Story #171, DDR-0050). Bands are emitted only when they carry a non-zero value somewhere
 * in the history: an account that has never held options gets no options band rather than a flat
 * zero one no legend entry can explain.
 *
 * The array's order is the **palette** order, and since Story #222 it is no longer the stacking
 * order: the chart is drawn most-invested-first from the top, which is presentation and lives in
 * `renderer/src/lib/composition.ts` with the rest of the chart's geometry (DDR-0073). Keeping the
 * palette on this order is what let the picture be inverted without repainting a band.
 */
export const compositionBandSchema = z.object({
  /** Stable identity — drives the palette slot, so a band keeps its hue as others appear. */
  key: z.enum(['stock', 'options', 'cash', 'accruals', 'other']),
  label: z.string(),
})
export type CompositionBand = z.infer<typeof compositionBandSchema>

/**
 * One report date's NAV split across the bands. `values` is index-aligned with the series'
 * `bands` and is in base currency; `total` is IBKR's own NAV for the day.
 *
 * Values are **signed**: cash goes negative on margin, and a negative band is drawn below the
 * zero line rather than clamped, because a stacked chart that hides a short position is lying
 * about the shape it exists to show. The stacking is deliberately *not* done here — the chart
 * stacks these values cumulatively to `total` (DDR-0052), and that geometry lives in
 * `renderer/src/lib/composition.ts` where it can be unit-tested against the degenerate cases
 * (zero NAV, negative bands) as pure maths.
 *
 * The bands are **exhaustive by construction**: whatever `total` exceeds their sum is folded into
 * an `other` residual upstream. That is what makes the top of the drawn stack the reader's NAV,
 * so a future category must be folded in rather than dropped.
 */
export const compositionPointSchema = z.object({
  date: z.number().int(),
  total: z.number(),
  values: z.array(z.number()),
})
export type CompositionPoint = z.infer<typeof compositionPointSchema>

/**
 * Portfolio composition over time (Story #171). Empty `points` when the optional
 * `EquitySummaryInBase` Flex section was never exported — the chart then renders its own
 * empty state and the rest of the report is unaffected, the same degradation Story #31 gave
 * the optional dividend-accruals section.
 */
export const compositionSeriesSchema = z.object({
  bands: z.array(compositionBandSchema),
  points: z.array(compositionPointSchema),
})
export type CompositionSeries = z.infer<typeof compositionSeriesSchema>

/** The assembled performance report the Performance view renders. */
export const performanceReportSchema = z.object({
  baseCurrency: z.string(),
  /**
   * Portfolio value over time, oldest → newest. IBKR's own daily NAV
   * (`EquitySummaryByReportDateInBase`) when that section has been imported, falling back to
   * the day-by-day reconstruction of DDR-0008 when it has not (Story #171, DDR-0050).
   */
  valueSeries: z.array(valuePointSchema),
  /** How that NAV was split across asset classes on each of those days (Story #171). */
  compositionSeries: compositionSeriesSchema,
  /**
   * Cumulative time-weighted return over time, as a percentage (Story #45). Each point's
   * `value` is the chain-linked TWR since the start of the imported history — contribution-
   * adjusted, so deposits/withdrawals don't move it. Anchored to each period's IBKR-reported
   * TWR at the boundaries, so its final point equals `cumulativeTwr` exactly.
   */
  returnSeries: z.array(valuePointSchema),
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
