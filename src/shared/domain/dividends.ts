import { z } from 'zod'

/**
 * Dividend & income analytics domain models (Milestone M3, Story #23). Built from the
 * imported Flex `CashTransaction` rows of type `Dividends`, `Payment In Lieu Of
 * Dividends` (gross income) and `Withholding Tax` (negative). See DDR-0005.
 *
 * Each cash row carries `fxRateToBase`, so gross income and withholding are converted
 * from the payment's native currency to the base currency (EUR). Net = gross +
 * withholding (withholding amounts are negative). Amounts are plain decimal numbers;
 * dates are epoch-millisecond integers (UTC).
 */

/** A single dividend/PIL or withholding cash event, for the detail table. */
export const dividendEventSchema = z.object({
  /** Ex-date when present, else the pay/settle date (epoch ms, UTC). */
  date: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  /** 'Dividends', 'Payment In Lieu Of Dividends', or 'Withholding Tax'. */
  type: z.string(),
  currency: z.string(),
  /** Signed amount in the payment's native currency (withholding is negative). */
  amountNative: z.number(),
  /** The same amount converted to base currency. */
  amountBase: z.number(),
})
export type DividendEvent = z.infer<typeof dividendEventSchema>

/** Gross / withholding / net income aggregated over one grouping key (symbol or month). */
export const dividendGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  grossBase: z.number(),
  /** Withholding tax as a positive magnitude (the amount withheld). */
  withholdingBase: z.number(),
  netBase: z.number(),
})
export type DividendGroup = z.infer<typeof dividendGroupSchema>

/** The assembled dividends report the Dividends view renders. */
export const dividendReportSchema = z.object({
  baseCurrency: z.string(),
  totalGrossBase: z.number(),
  totalWithholdingBase: z.number(),
  totalNetBase: z.number(),
  /** Income per symbol, largest net first. */
  bySymbol: z.array(dividendGroupSchema),
  /** Income per calendar month ('YYYY-MM'), oldest → newest. */
  byMonth: z.array(dividendGroupSchema),
  /** Individual cash events, newest first. */
  events: z.array(dividendEventSchema),
})
export type DividendReport = z.infer<typeof dividendReportSchema>

/** Dividends view result: the report, or a needs-import signal when no Flex data exists. */
export const dividendResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), report: dividendReportSchema }),
  z.object({ status: z.literal('needs_import') }),
])
export type DividendResult = z.infer<typeof dividendResultSchema>
