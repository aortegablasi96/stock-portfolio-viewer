import { desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@db/client'
import {
  flexCashTransactions,
  flexFifoSummaries,
  flexNavChanges,
  flexOpenPositions,
  flexPriorPeriodPositions,
  flexSecurities,
  flexStatements,
  flexTrades,
} from '@db/schema'

/**
 * Read-only data access over the imported Flex history (Milestone M3, Stories
 * #21–#24; DDR-0005). Companion to the write-only `flexRepository`: this is the only
 * layer the analytics/dividends services use to reach the `flex_*` tables, and it
 * exposes reads only. It returns plain row subsets — the services own all
 * calculation and base-currency conversion, so they stay unit-testable with this
 * repository mocked.
 *
 * De-dupe shape (DDR-0004) drives which tables are read continuously vs. as-of:
 * `flex_trades` / `flex_cash_transactions` are globally de-duped, so they are read
 * across the whole history; statement-scoped tables (open positions, securities) are
 * read from the *latest* statement; per-period rows (NAV change, FIFO summaries) are
 * read across statements and summed by the caller.
 */

/** The dividend/income cash-transaction types this app tracks (Story #23). */
export const DIVIDEND_CASH_TYPES = [
  'Dividends',
  'Payment In Lieu Of Dividends',
  'Withholding Tax',
] as const

/** External contributions/withdrawals — the dated NAV steps in the daily curve (Story #29). */
export const CONTRIBUTION_CASH_TYPE = 'Deposits/Withdrawals'

export interface NavPeriodRow {
  fromDate: number
  toDate: number
  startingValue: number
  endingValue: number
  mtm: number
  depositsWithdrawals: number
  dividends: number
  withholdingTax: number
  interest: number
  commissions: number
  twr: number
}

/** One instrument's MTM on one trading day — native `priorMtmPnl` + its rate (Story #29). */
export interface DailyMtmRow {
  date: number
  fxRateToBase: number
  priorMtmPnl: number
}

/** A dated external contribution/withdrawal — native `amount` + its rate (Story #29). */
export interface ContributionRow {
  dateTime: number | null
  fxRateToBase: number
  amount: number
}

export interface FifoSummaryRow {
  conid: number | null
  symbol: string
  description: string
  assetCategory: string
  realizedStProfit: number
  realizedStLoss: number
  realizedLtProfit: number
  realizedLtLoss: number
  totalRealizedPnl: number
  totalUnrealizedPnl: number
}

export interface OpenPositionRow {
  conid: number | null
  symbol: string
  description: string
  assetCategory: string
  currency: string
  fxRateToBase: number
  position: number
  markPrice: number | null
  costBasisMoney: number | null
  percentOfNav: number | null
  fifoPnlUnrealized: number | null
}

export interface SecurityRow {
  conid: number | null
  symbol: string
  issuerCountryCode: string
}

export interface LatestPositions {
  reportDate: number | null
  baseCurrency: string
  positions: OpenPositionRow[]
  securities: SecurityRow[]
}

export interface CashTransactionRow {
  symbol: string
  description: string
  type: string
  currency: string
  fxRateToBase: number
  dateTime: number | null
  exDate: number | null
  amount: number
}

export interface TradeRowRaw {
  tradeKey: string
  conid: number | null
  symbol: string
  description: string
  assetCategory: string
  currency: string
  fxRateToBase: number
  dateTime: number | null
  quantity: number
  tradePrice: number
  proceeds: number | null
  ibCommission: number | null
  fifoPnlRealized: number | null
  openCloseIndicator: string
}

export const flexReadRepository = {
  /** True when at least one Flex statement has been imported (drives the needs-import state). */
  hasStatements(): boolean {
    return getDb().select({ id: flexStatements.id }).from(flexStatements).limit(1).get() !== undefined
  },

  /** Base currency of the most recently dated statement, or undefined if none imported. */
  baseCurrency(): string | undefined {
    const row = getDb()
      .select({ baseCurrency: flexStatements.baseCurrency })
      .from(flexStatements)
      .orderBy(desc(flexStatements.toDate))
      .limit(1)
      .get()
    return row?.baseCurrency
  },

  /** All statement NAV-change periods, oldest → newest (Story #21). */
  getNavPeriods(): NavPeriodRow[] {
    return getDb()
      .select({
        fromDate: flexNavChanges.fromDate,
        toDate: flexNavChanges.toDate,
        startingValue: flexNavChanges.startingValue,
        endingValue: flexNavChanges.endingValue,
        mtm: flexNavChanges.mtm,
        depositsWithdrawals: flexNavChanges.depositsWithdrawals,
        dividends: flexNavChanges.dividends,
        withholdingTax: flexNavChanges.withholdingTax,
        interest: flexNavChanges.interest,
        commissions: flexNavChanges.commissions,
        twr: flexNavChanges.twr,
      })
      .from(flexNavChanges)
      .orderBy(flexNavChanges.fromDate)
      .all()
  },

  /**
   * Daily per-instrument MTM rows across the whole history, oldest → newest (Story #29).
   * Native `priorMtmPnl` + `fxRateToBase`; the service converts and groups by date.
   */
  getDailyMtm(): DailyMtmRow[] {
    return getDb()
      .select({
        date: flexPriorPeriodPositions.date,
        fxRateToBase: flexPriorPeriodPositions.fxRateToBase,
        priorMtmPnl: flexPriorPeriodPositions.priorMtmPnl,
      })
      .from(flexPriorPeriodPositions)
      .orderBy(flexPriorPeriodPositions.date)
      .all()
  },

  /**
   * External deposit/withdrawal cash flows across the whole history (Story #29) — the dated
   * NAV steps in the daily value curve. Native `amount` + `fxRateToBase`; service converts.
   */
  getContributionCashFlows(): ContributionRow[] {
    return getDb()
      .select({
        dateTime: flexCashTransactions.dateTime,
        fxRateToBase: flexCashTransactions.fxRateToBase,
        amount: flexCashTransactions.amount,
      })
      .from(flexCashTransactions)
      .where(eq(flexCashTransactions.type, CONTRIBUTION_CASH_TYPE))
      .all()
  },

  /** All FIFO performance summaries across statements (Stories #21, #24). Values are base currency. */
  getFifoSummaries(): FifoSummaryRow[] {
    return getDb()
      .select({
        conid: flexFifoSummaries.conid,
        symbol: flexFifoSummaries.symbol,
        description: flexFifoSummaries.description,
        assetCategory: flexFifoSummaries.assetCategory,
        realizedStProfit: flexFifoSummaries.realizedStProfit,
        realizedStLoss: flexFifoSummaries.realizedStLoss,
        realizedLtProfit: flexFifoSummaries.realizedLtProfit,
        realizedLtLoss: flexFifoSummaries.realizedLtLoss,
        totalRealizedPnl: flexFifoSummaries.totalRealizedPnl,
        totalUnrealizedPnl: flexFifoSummaries.totalUnrealizedPnl,
      })
      .from(flexFifoSummaries)
      .all()
  },

  /**
   * Open positions from the latest imported statement, plus that statement's security
   * reference rows (for issuer country) and base currency (Story #22). Empty when
   * nothing has been imported.
   */
  getLatestOpenPositions(): LatestPositions | undefined {
    const statement = getDb()
      .select({
        id: flexStatements.id,
        toDate: flexStatements.toDate,
        baseCurrency: flexStatements.baseCurrency,
      })
      .from(flexStatements)
      .orderBy(desc(flexStatements.toDate))
      .limit(1)
      .get()
    if (!statement) return undefined

    const positions = getDb()
      .select({
        conid: flexOpenPositions.conid,
        symbol: flexOpenPositions.symbol,
        description: flexOpenPositions.description,
        assetCategory: flexOpenPositions.assetCategory,
        currency: flexOpenPositions.currency,
        fxRateToBase: flexOpenPositions.fxRateToBase,
        position: flexOpenPositions.position,
        markPrice: flexOpenPositions.markPrice,
        costBasisMoney: flexOpenPositions.costBasisMoney,
        percentOfNav: flexOpenPositions.percentOfNav,
        fifoPnlUnrealized: flexOpenPositions.fifoPnlUnrealized,
        reportDate: flexOpenPositions.reportDate,
      })
      .from(flexOpenPositions)
      .where(eq(flexOpenPositions.statementId, statement.id))
      .all()

    const securities = getDb()
      .select({
        conid: flexSecurities.conid,
        symbol: flexSecurities.symbol,
        issuerCountryCode: flexSecurities.issuerCountryCode,
      })
      .from(flexSecurities)
      .where(eq(flexSecurities.statementId, statement.id))
      .all()

    // Report date comes from the positions themselves (all share the statement's report date).
    const reportDate = positions[0]?.reportDate ?? statement.toDate

    return {
      reportDate,
      baseCurrency: statement.baseCurrency,
      positions: positions.map((p) => ({
        conid: p.conid,
        symbol: p.symbol,
        description: p.description,
        assetCategory: p.assetCategory,
        currency: p.currency,
        fxRateToBase: p.fxRateToBase,
        position: p.position,
        markPrice: p.markPrice,
        costBasisMoney: p.costBasisMoney,
        percentOfNav: p.percentOfNav,
        fifoPnlUnrealized: p.fifoPnlUnrealized,
      })),
      securities,
    }
  },

  /** Dividend, payment-in-lieu, and withholding-tax cash transactions (Story #23). */
  getDividendCashTransactions(): CashTransactionRow[] {
    return getDb()
      .select({
        symbol: flexCashTransactions.symbol,
        description: flexCashTransactions.description,
        type: flexCashTransactions.type,
        currency: flexCashTransactions.currency,
        fxRateToBase: flexCashTransactions.fxRateToBase,
        dateTime: flexCashTransactions.dateTime,
        exDate: flexCashTransactions.exDate,
        amount: flexCashTransactions.amount,
      })
      .from(flexCashTransactions)
      .where(inArray(flexCashTransactions.type, [...DIVIDEND_CASH_TYPES]))
      .all()
  },

  /** All trades across the whole history, newest first (Story #24). */
  getTrades(): TradeRowRaw[] {
    return getDb()
      .select({
        tradeKey: flexTrades.tradeKey,
        conid: flexTrades.conid,
        symbol: flexTrades.symbol,
        description: flexTrades.description,
        assetCategory: flexTrades.assetCategory,
        currency: flexTrades.currency,
        fxRateToBase: flexTrades.fxRateToBase,
        dateTime: flexTrades.dateTime,
        quantity: flexTrades.quantity,
        tradePrice: flexTrades.tradePrice,
        proceeds: flexTrades.proceeds,
        ibCommission: flexTrades.ibCommission,
        fifoPnlRealized: flexTrades.fifoPnlRealized,
        openCloseIndicator: flexTrades.openCloseIndicator,
      })
      .from(flexTrades)
      .orderBy(desc(flexTrades.dateTime))
      .all()
  },
}
