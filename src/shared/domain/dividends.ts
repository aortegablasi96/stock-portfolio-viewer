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
 *
 * Story #31 adds the forward-looking half: declared-but-unpaid dividends, sourced from
 * the latest statement's `OpenDividendAccrual` rows rather than the cash history (they
 * have not generated cash yet). See DDR-0010.
 *
 * Story #74 adds shares held and dividend-per-share to each cash event. Neither is in the
 * Flex cash transaction, so the share count is reconstructed from the imported trade
 * history and the per-share figure divided out of the row's own amount. See DDR-0016.
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
  /**
   * Shares held on the day before the ex-date, reconstructed from the imported trade
   * history (Story #74). Cash transactions carry no quantity, so this is derived; it is
   * `null` whenever the trade history cannot account for the position (no trades for the
   * instrument, or a non-positive running quantity), so the view shows "—" rather than a
   * number that is quietly wrong. See DDR-0016.
   */
  sharesHeld: z.number().nullable(),
  /**
   * `amountNative / sharesHeld` — the dividend (or, on a withholding row, the tax) paid per
   * share in the payment's native currency. `null` exactly when `sharesHeld` is.
   */
  perShareNative: z.number().nullable(),
})
export type DividendEvent = z.infer<typeof dividendEventSchema>

/** Gross / withholding / net income aggregated over one grouping key (symbol or month). */
export const dividendGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** Instrument description for symbol groupings (shown beneath the ticker); absent for month groupings. */
  description: z.string().optional(),
  grossBase: z.number(),
  /** Withholding tax as a positive magnitude (the amount withheld). */
  withholdingBase: z.number(),
  netBase: z.number(),
})
export type DividendGroup = z.infer<typeof dividendGroupSchema>

/**
 * A dividend that has been declared but not yet paid (Story #31), built from the latest
 * statement's Flex `OpenDividendAccrual` rows. Withholding is derived as
 * `grossBase − netBase` rather than read from the Flex `tax` field, whose sign
 * convention IBKR does not guarantee. See DDR-0010.
 */
export const upcomingDividendSchema = z.object({
  symbol: z.string(),
  description: z.string(),
  currency: z.string(),
  exDate: z.number().int().nullable(),
  payDate: z.number().int().nullable(),
  /** Shares held prior to the ex-date. */
  quantity: z.number(),
  /** Dividend per share in the payment's native currency, when reported. */
  grossRate: z.number().nullable(),
  /** Net payable in the payment's native currency. */
  netNative: z.number(),
  grossBase: z.number(),
  /** Expected withholding as a positive magnitude. */
  withholdingBase: z.number(),
  netBase: z.number(),
})
export type UpcomingDividend = z.infer<typeof upcomingDividendSchema>

/**
 * The upcoming-dividends panel's payload. `asOf` is the end date of the statement the
 * accruals came from, so a stale import is visible; it is `null` when nothing has been
 * imported. `sectionPresent` is false when the latest statement carried no accrual rows
 * at all — the view then explains that the Flex query's "Open Dividend Accruals" section
 * needs enabling, instead of implying there is simply no income coming.
 */
export const upcomingDividendsSchema = z.object({
  asOf: z.number().int().nullable(),
  sectionPresent: z.boolean(),
  totalGrossBase: z.number(),
  totalWithholdingBase: z.number(),
  totalNetBase: z.number(),
  /** Announced, not yet paid, soonest pay date first. */
  items: z.array(upcomingDividendSchema),
})
export type UpcomingDividends = z.infer<typeof upcomingDividendsSchema>

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
  /** Announced-but-unpaid dividends as of the latest statement (Story #31). */
  upcoming: upcomingDividendsSchema,
})
export type DividendReport = z.infer<typeof dividendReportSchema>

/** Dividends view result: the report, or a needs-import signal when no Flex data exists. */
export const dividendResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), report: dividendReportSchema }),
  z.object({ status: z.literal('needs_import') }),
])
export type DividendResult = z.infer<typeof dividendResultSchema>
