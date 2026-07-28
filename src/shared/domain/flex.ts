import { z } from 'zod'

/**
 * Flex Query domain models (Milestone M3, Story #20). These are the clean,
 * transport-agnostic shapes produced by the Flex statement parser and persisted by
 * `flexRepository`. See ADR-0005 (Flex file import as an offline data source) and
 * DDR-0004 (real-valued multi-currency amounts, append-only, two-tier de-dupe).
 *
 * Money, prices, FX rates, quantities and P&L are plain decimal `number`s (stored as
 * SQLite `real`, not the minor-units convention of DDR-0003 — Flex is multi-currency
 * and carries high-precision prices/rates). Dates are epoch-millisecond integers
 * (UTC), parsed from the Flex `YYYYMMDD` / `YYYYMMDD;HHMMSS` strings at ingress. The
 * original `currency` and `fxRateToBase` are retained on every monetary row so
 * base-currency conversion stays reproducible. Types cross IPC via
 * `@shared/ipc/contract`.
 */

/** Account NAV change over the statement period (`ChangeInNAV`) — drives performance analytics. */
export const flexNavChangeSchema = z.object({
  currency: z.string(),
  fromDate: z.number().int(),
  toDate: z.number().int(),
  startingValue: z.number(),
  endingValue: z.number(),
  mtm: z.number(),
  depositsWithdrawals: z.number(),
  dividends: z.number(),
  withholdingTax: z.number(),
  interest: z.number(),
  commissions: z.number(),
  /** Time-weighted return for the period, as reported by IBKR (percent). */
  twr: z.number(),
})
export type FlexNavChange = z.infer<typeof flexNavChangeSchema>

/** An open position as of the statement's report date (`OpenPosition`). */
export const flexOpenPositionSchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  currency: z.string(),
  fxRateToBase: z.number(),
  reportDate: z.number().int().nullable(),
  position: z.number(),
  markPrice: z.number().nullable(),
  costBasisPrice: z.number().nullable(),
  costBasisMoney: z.number().nullable(),
  percentOfNav: z.number().nullable(),
  fifoPnlUnrealized: z.number().nullable(),
  side: z.string(),
})
export type FlexOpenPosition = z.infer<typeof flexOpenPositionSchema>

/**
 * One held instrument's mark-to-market on one trading day (`PriorPeriodPosition`) — the
 * daily price/MTM series that drives day-by-day performance (Story #29; DDR-0008). `date`
 * is the trading day (epoch ms, UTC midnight); `priorMtmPnl` is that day's MTM P&L versus
 * the prior day in the instrument's native `currency`, so base = `priorMtmPnl × fxRateToBase`.
 * Statement-scoped (DDR-0004), like open positions.
 */
export const flexPriorPeriodPositionSchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  currency: z.string(),
  fxRateToBase: z.number(),
  date: z.number().int(),
  price: z.number().nullable(),
  priorMtmPnl: z.number(),
})
export type FlexPriorPeriodPosition = z.infer<typeof flexPriorPeriodPositionSchema>

/** An executed trade (`Trade`). `tradeKey` is the global de-dupe identity (DDR-0004). */
export const flexTradeSchema = z.object({
  tradeKey: z.string(),
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  currency: z.string(),
  fxRateToBase: z.number(),
  dateTime: z.number().int().nullable(),
  tradeDate: z.number().int().nullable(),
  settleDate: z.number().int().nullable(),
  transactionType: z.string(),
  exchange: z.string(),
  quantity: z.number(),
  tradePrice: z.number(),
  tradeMoney: z.number().nullable(),
  proceeds: z.number().nullable(),
  taxes: z.number().nullable(),
  ibCommission: z.number().nullable(),
  ibCommissionCurrency: z.string(),
  netCash: z.number().nullable(),
  closePrice: z.number().nullable(),
  openCloseIndicator: z.string(),
  cost: z.number().nullable(),
  fifoPnlRealized: z.number().nullable(),
  mtmPnl: z.number().nullable(),
})
export type FlexTrade = z.infer<typeof flexTradeSchema>

/** A closed lot (`Lot`) — sub-row of a closing trade; statement-scoped (DDR-0004). */
export const flexLotSchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  currency: z.string(),
  fxRateToBase: z.number(),
  dateTime: z.number().int().nullable(),
  tradeDate: z.number().int().nullable(),
  quantity: z.number(),
  tradePrice: z.number().nullable(),
  cost: z.number().nullable(),
  fifoPnlRealized: z.number().nullable(),
  openCloseIndicator: z.string(),
  /** IBKR term marker: 'ST' (short-term) / 'LT' (long-term). */
  notes: z.string(),
})
export type FlexLot = z.infer<typeof flexLotSchema>

/** A cash movement (`CashTransaction`): dividends, withholding tax, deposits, etc. */
export const flexCashTransactionSchema = z.object({
  /** Global de-dupe identity: the IBKR `transactionID` when present, else a content hash (DDR-0004). */
  dedupeKey: z.string(),
  transactionId: z.string(),
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  currency: z.string(),
  fxRateToBase: z.number(),
  dateTime: z.number().int().nullable(),
  settleDate: z.number().int().nullable(),
  exDate: z.number().int().nullable(),
  amount: z.number(),
  /** e.g. 'Dividends', 'Withholding Tax', 'Payment In Lieu Of Dividends', 'Deposits/Withdrawals'. */
  type: z.string(),
  dividendType: z.string(),
  code: z.string(),
})
export type FlexCashTransaction = z.infer<typeof flexCashTransactionSchema>

/** Realized/unrealized P&L rollup per instrument (`FIFOPerformanceSummaryUnderlying`). */
export const flexPerformanceSummarySchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  realizedStProfit: z.number(),
  realizedStLoss: z.number(),
  realizedLtProfit: z.number(),
  realizedLtLoss: z.number(),
  totalRealizedPnl: z.number(),
  unrealizedProfit: z.number(),
  unrealizedLoss: z.number(),
  totalUnrealizedPnl: z.number(),
  totalFifoPnl: z.number(),
  transferredPnl: z.number(),
})
export type FlexPerformanceSummary = z.infer<typeof flexPerformanceSummarySchema>

/**
 * A dividend declared but not yet paid (`OpenDividendAccrual`) — the source behind the
 * Dividends view's "upcoming" panel (Story #31; DDR-0010). An *as-of* balance rather
 * than an event, so it is statement-scoped like open positions. `netAmount` is IBKR's
 * own net of `tax` and `fee`; those two are carried raw because IBKR's sign convention
 * for them is not guaranteed, so consumers derive the withheld amount from
 * `grossAmount − netAmount` instead.
 */
export const flexOpenDividendAccrualSchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  currency: z.string(),
  fxRateToBase: z.number(),
  exDate: z.number().int().nullable(),
  payDate: z.number().int().nullable(),
  /** Shares held prior to the ex-date. */
  quantity: z.number(),
  /** Dividend per share, in `currency`. */
  grossRate: z.number().nullable(),
  grossAmount: z.number(),
  tax: z.number(),
  fee: z.number(),
  netAmount: z.number(),
  code: z.string(),
})
export type FlexOpenDividendAccrual = z.infer<typeof flexOpenDividendAccrualSchema>

/** Instrument reference data (`SecurityInfo`) — asset class, geography, identifiers. */
export const flexSecuritySchema = z.object({
  conid: z.number().int().nullable(),
  symbol: z.string(),
  description: z.string(),
  assetCategory: z.string(),
  subCategory: z.string(),
  currency: z.string(),
  listingExchange: z.string(),
  issuerCountryCode: z.string(),
  isin: z.string(),
  cusip: z.string(),
  multiplier: z.number().nullable(),
})
export type FlexSecurity = z.infer<typeof flexSecuritySchema>

/**
 * One parsed Flex statement: period/account metadata plus the record collections.
 * A single XML file may contain more than one statement.
 */
export const flexStatementSchema = z.object({
  accountId: z.string(),
  fromDate: z.number().int(),
  toDate: z.number().int(),
  period: z.string(),
  /** When IBKR generated the export — part of the statement de-dupe identity. */
  whenGenerated: z.number().int(),
  baseCurrency: z.string(),
  navChange: flexNavChangeSchema.nullable(),
  openPositions: z.array(flexOpenPositionSchema),
  priorPeriodPositions: z.array(flexPriorPeriodPositionSchema),
  trades: z.array(flexTradeSchema),
  lots: z.array(flexLotSchema),
  cashTransactions: z.array(flexCashTransactionSchema),
  performanceSummaries: z.array(flexPerformanceSummarySchema),
  securities: z.array(flexSecuritySchema),
  openDividendAccruals: z.array(flexOpenDividendAccrualSchema),
})
export type FlexStatement = z.infer<typeof flexStatementSchema>

// ---- import summary (returned to the renderer) ------------------------------

/** Inserted vs. skipped (de-duplicated) rows for one record type. */
export const flexRecordCountSchema = z.object({
  inserted: z.number().int(),
  skipped: z.number().int(),
})
export type FlexRecordCount = z.infer<typeof flexRecordCountSchema>

/** Outcome of importing one statement — what was stored and what was already present. */
export const flexStatementImportSchema = z.object({
  filename: z.string(),
  accountId: z.string(),
  fromDate: z.number().int(),
  toDate: z.number().int(),
  period: z.string(),
  /** True when the exact statement (account + period + generation) was already imported. */
  alreadyImported: z.boolean(),
  records: z.object({
    navChanges: flexRecordCountSchema,
    openPositions: flexRecordCountSchema,
    priorPeriodPositions: flexRecordCountSchema,
    trades: flexRecordCountSchema,
    lots: flexRecordCountSchema,
    cashTransactions: flexRecordCountSchema,
    performanceSummaries: flexRecordCountSchema,
    securities: flexRecordCountSchema,
    openDividendAccruals: flexRecordCountSchema,
  }),
})
export type FlexStatementImport = z.infer<typeof flexStatementImportSchema>

/** Aggregate result of an import request across all selected files. */
export const flexImportSummarySchema = z.object({
  statements: z.array(flexStatementImportSchema),
})
export type FlexImportSummary = z.infer<typeof flexImportSummarySchema>

// ---- stored statements (what the local store already holds) -----------------

/**
 * One Flex statement as it currently sits in the local store (Story #108). Deliberately
 * *not* `FlexStatementImport`: that one describes the outcome of an import (inserted vs.
 * skipped rows, "already imported"), which is only true in the moment it is produced.
 * This one describes the store itself, so it answers "what is my analytics built from?"
 * on launch, with no import required.
 */
export const flexStoredStatementSchema = z.object({
  id: z.number().int(),
  accountId: z.string(),
  fromDate: z.number().int(),
  toDate: z.number().int(),
  period: z.string(),
  baseCurrency: z.string(),
  sourceFilename: z.string(),
  /** When this statement was imported — epoch ms. */
  importedAt: z.number().int(),
})
export type FlexStoredStatement = z.infer<typeof flexStoredStatementSchema>

/**
 * The whole imported statement store: every statement newest first (by period end date, so
 * the first row is the one statement-scoped analytics treat as latest), plus the span the
 * statements cover end to end. `coverage` is the earliest `fromDate` and the latest
 * `toDate` across all of them, so a stale newest statement is visible at a glance; it is
 * `null` when nothing has been imported. Statements may overlap — the span is a min/max,
 * not a sum of periods, and flagging overlap is deliberately out of scope (Bug #103).
 */
export const flexStatementStoreSchema = z.object({
  statements: z.array(flexStoredStatementSchema),
  coverage: z.object({ fromDate: z.number().int(), toDate: z.number().int() }).nullable(),
})
export type FlexStatementStore = z.infer<typeof flexStatementStoreSchema>
