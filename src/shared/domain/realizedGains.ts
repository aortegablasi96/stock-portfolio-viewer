import { z } from 'zod'

/**
 * Realized gains & trade-history domain models (Milestone M3, Story #24). The trade
 * list is built from the globally de-duped Flex `Trade` rows (continuous history);
 * the realized-P&L rollup (per symbol, with short-/long-term split) is built from the
 * FIFO performance summaries. See DDR-0005.
 *
 * `Trade` rows carry `fxRateToBase`, so per-trade realized P&L is converted to base
 * currency (EUR). FIFO summaries are already in base currency (no per-row FX). Amounts
 * are plain decimal numbers; dates are epoch-millisecond integers (UTC).
 */

/** One executed trade, for the trade-history table. */
export const tradeRowSchema = z.object({
  tradeKey: z.string(),
  dateTime: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  /** 'Buy' or 'Sell', derived from the signed quantity. */
  side: z.enum(['Buy', 'Sell']),
  /** Absolute share/contract quantity. */
  quantity: z.number(),
  tradePrice: z.number(),
  currency: z.string(),
  proceedsNative: z.number(),
  commissionNative: z.number(),
  /** Realized P&L for a closing trade, native currency (0 for opening trades). */
  realizedNative: z.number(),
  /** The same realized P&L converted to base currency. */
  realizedBase: z.number(),
  /** 'O' (open), 'C' (close), or 'C;O' etc. as reported by IBKR. */
  openCloseIndicator: z.string(),
})
export type TradeRow = z.infer<typeof tradeRowSchema>

/** Realized P&L per instrument, base currency, with short-/long-term split. */
export const realizedBySymbolSchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  realizedShortTerm: z.number(),
  realizedLongTerm: z.number(),
  totalRealized: z.number(),
})
export type RealizedBySymbol = z.infer<typeof realizedBySymbolSchema>

/** The assembled realized-gains report the Trade History view renders. */
export const realizedGainsReportSchema = z.object({
  baseCurrency: z.string(),
  totalRealized: z.number(),
  totalRealizedShortTerm: z.number(),
  totalRealizedLongTerm: z.number(),
  totalUnrealized: z.number(),
  /** Realized P&L per symbol, largest total first. */
  bySymbol: z.array(realizedBySymbolSchema),
  /** Trade history, newest first. */
  trades: z.array(tradeRowSchema),
})
export type RealizedGainsReport = z.infer<typeof realizedGainsReportSchema>

/** Trade History view result: the report, or a needs-import signal when no Flex data exists. */
export const realizedGainsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), report: realizedGainsReportSchema }),
  z.object({ status: z.literal('needs_import') }),
])
export type RealizedGainsResult = z.infer<typeof realizedGainsResultSchema>
