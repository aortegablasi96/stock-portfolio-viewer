import { desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@db/client'
import {
  flexCashTransactions,
  flexEquitySummaries,
  flexFifoSummaries,
  flexNavChanges,
  flexOpenDividendAccruals,
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
 * across the whole history; statement-scoped tables (open positions, securities, open
 * dividend accruals) are read from the *latest* statement; per-period rows (NAV change,
 * FIFO summaries) are read across statements and summed by the caller.
 *
 * FIFO summaries are the one row shape that is *both*: realized P&L is a per-period flow
 * that sums across statements, while unrealized P&L is an as-of balance that must not
 * (Bug #103). So the rows carry their statement identity and the caller scopes the
 * as-of half with `fromLatestStatement`.
 */

/** The dividend/income cash-transaction types this app tracks (Story #23). */
export const DIVIDEND_CASH_TYPES = [
  'Dividends',
  'Payment In Lieu Of Dividends',
  'Withholding Tax',
] as const

/** External contributions/withdrawals — the dated NAV steps in the daily curve (Story #29). */
export const CONTRIBUTION_CASH_TYPE = 'Deposits/Withdrawals'

/** A statement header as stored — the period it covers and when it was imported (Story #108). */
export interface StoredStatementRow {
  id: number
  accountId: string
  fromDate: number
  toDate: number
  period: string
  baseCurrency: string
  sourceFilename: string
  importedAt: number
}

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

/**
 * One report date's NAV by category, already in base currency (Story #171). No `fxRateToBase`
 * — IBKR reports this section in base — so unlike the other rows here nothing needs converting.
 *
 * Carries `statementToDate` for the same reason `FifoSummaryRow` does: statements may overlap,
 * and this is the only *daily* statement-scoped table, so one calendar day can arrive from two
 * statements at once. The caller keeps the row from the statement that ends latest — the most
 * recent restatement of that day. Sorted by report date, then by statement end date ascending,
 * so a straight last-write-wins pass over the rows leaves the freshest one in place.
 */
export interface DailyEquityRow {
  statementToDate: number
  reportDate: number
  cash: number
  stock: number
  options: number
  dividendAccruals: number
  interestAccruals: number
  brokerFeesAccruals: number
  total: number
}

/** A dated external contribution/withdrawal — native `amount` + its rate (Story #29). */
export interface ContributionRow {
  dateTime: number | null
  fxRateToBase: number
  amount: number
}

export interface FifoSummaryRow {
  /** The statement this summary belongs to, and that statement's end date (Bug #103). */
  statementId: number
  statementToDate: number
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
  /**
   * The statement's ending NAV in base currency (from ChangeInNAV), or null when the section
   * is absent. The residual of this over the invested market value is uninvested cash (Story #47).
   */
  navEndingValue: number | null
  positions: OpenPositionRow[]
  securities: SecurityRow[]
}

export interface CashTransactionRow {
  conid: number | null
  symbol: string
  description: string
  type: string
  currency: string
  fxRateToBase: number
  dateTime: number | null
  exDate: number | null
  amount: number
}

/** Clean instrument name from `SecurityInfo`, for resolving a display name by conid/symbol. */
export interface InstrumentName {
  conid: number | null
  symbol: string
  description: string
}

/** A declared-but-unpaid dividend from the latest statement, in native currency (Story #31). */
export interface DividendAccrualRow {
  symbol: string
  description: string
  currency: string
  fxRateToBase: number
  exDate: number | null
  payDate: number | null
  quantity: number
  grossRate: number | null
  grossAmount: number
  netAmount: number
}

/** The latest statement's open dividend accruals, plus the date they were reported as of. */
export interface LatestDividendAccruals {
  asOf: number
  accruals: DividendAccrualRow[]
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
  /**
   * Every imported statement's header row, newest first (Story #108). The only read that
   * describes the *store* rather than its contents, so the Portfolio view can show what
   * analytics are built from without an import having just happened.
   *
   * Ordered by **end** date, not start date or id, so the top row is the same statement the
   * statement-scoped reads below treat as "latest" (`getLatestOpenPositions`,
   * `getLatestOpenDividendAccruals`, `fromLatestStatement`). Ids follow import order and
   * would put a back-filled older statement on top; start date would do the same for a
   * statement that begins earlier but ends later. Ties break on start date.
   */
  getStatements(): StoredStatementRow[] {
    return getDb()
      .select({
        id: flexStatements.id,
        accountId: flexStatements.accountId,
        fromDate: flexStatements.fromDate,
        toDate: flexStatements.toDate,
        period: flexStatements.period,
        baseCurrency: flexStatements.baseCurrency,
        sourceFilename: flexStatements.sourceFilename,
        importedAt: flexStatements.importedAt,
      })
      .from(flexStatements)
      .orderBy(desc(flexStatements.toDate), desc(flexStatements.fromDate))
      .all()
  },

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
   * The daily NAV-by-category series across the whole history, oldest → newest (Story #171).
   * Already base currency. Backs both the Performance view's value curve — authoritative,
   * replacing the reconstruction of DDR-0008 — and its composition chart (DDR-0050).
   *
   * Ordered by report date, then by the owning statement's end date **ascending**, so the
   * caller's de-dupe of overlapping statements is a plain last-write-wins over this order.
   * Empty when the optional `EquitySummaryInBase` section was never exported.
   */
  getDailyEquitySummaries(): DailyEquityRow[] {
    return getDb()
      .select({
        statementToDate: flexStatements.toDate,
        reportDate: flexEquitySummaries.reportDate,
        cash: flexEquitySummaries.cash,
        stock: flexEquitySummaries.stock,
        options: flexEquitySummaries.options,
        dividendAccruals: flexEquitySummaries.dividendAccruals,
        interestAccruals: flexEquitySummaries.interestAccruals,
        brokerFeesAccruals: flexEquitySummaries.brokerFeesAccruals,
        total: flexEquitySummaries.total,
      })
      .from(flexEquitySummaries)
      .innerJoin(flexStatements, eq(flexEquitySummaries.statementId, flexStatements.id))
      .orderBy(flexEquitySummaries.reportDate, flexStatements.toDate)
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

  /**
   * All FIFO performance summaries across statements (Stories #21, #24). Values are base
   * currency. Each row carries its statement id and that statement's end date so callers can
   * scope the as-of half (unrealized P&L) to the latest statement — see `fromLatestStatement`
   * and Bug #103.
   */
  getFifoSummaries(): FifoSummaryRow[] {
    return getDb()
      .select({
        statementId: flexFifoSummaries.statementId,
        statementToDate: flexStatements.toDate,
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
      .innerJoin(flexStatements, eq(flexFifoSummaries.statementId, flexStatements.id))
      .all()
  },

  /**
   * Open positions from the latest imported statement, plus that statement's security
   * reference rows (for issuer country), base currency, and ending NAV (Story #22, #47).
   * Empty when nothing has been imported.
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

    // Ending NAV for this statement (in base currency) — one ChangeInNAV per statement.
    const nav = getDb()
      .select({ endingValue: flexNavChanges.endingValue })
      .from(flexNavChanges)
      .where(eq(flexNavChanges.statementId, statement.id))
      .get()

    // Report date comes from the positions themselves (all share the statement's report date).
    const reportDate = positions[0]?.reportDate ?? statement.toDate

    return {
      reportDate,
      baseCurrency: statement.baseCurrency,
      navEndingValue: nav?.endingValue ?? null,
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
        conid: flexCashTransactions.conid,
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

  /**
   * Clean instrument names from `SecurityInfo` (e.g. "GOEASY LTD"), for resolving a
   * display name by conid/symbol. Cash-transaction rows carry a verbose transaction
   * description ("GSY (CA…) CASH DIVIDEND …"), not the instrument name, so the dividend
   * tables look this up to match the ticker-with-description style of the other views.
   * Distinct across statements — the name is stable per instrument, so cross-statement
   * duplicates collapse and there is no fan-out.
   */
  getInstrumentNames(): InstrumentName[] {
    return getDb()
      .selectDistinct({
        conid: flexSecurities.conid,
        symbol: flexSecurities.symbol,
        description: flexSecurities.description,
      })
      .from(flexSecurities)
      .all()
  },

  /**
   * Open (declared but unpaid) dividend accruals from the **latest** imported statement
   * (Story #31). An as-of balance, not an event history: an older statement's accruals
   * have since been paid and would double-count against the cash transactions, so only
   * the newest statement is read. `asOf` is that statement's end date, which the view
   * shows so a stale import is visible. Returns `undefined` when nothing is imported;
   * an empty `accruals` list means the statement carried no accruals section.
   */
  getLatestOpenDividendAccruals(): LatestDividendAccruals | undefined {
    const statement = getDb()
      .select({ id: flexStatements.id, toDate: flexStatements.toDate })
      .from(flexStatements)
      .orderBy(desc(flexStatements.toDate))
      .limit(1)
      .get()
    if (!statement) return undefined

    const accruals = getDb()
      .select({
        symbol: flexOpenDividendAccruals.symbol,
        description: flexOpenDividendAccruals.description,
        currency: flexOpenDividendAccruals.currency,
        fxRateToBase: flexOpenDividendAccruals.fxRateToBase,
        exDate: flexOpenDividendAccruals.exDate,
        payDate: flexOpenDividendAccruals.payDate,
        quantity: flexOpenDividendAccruals.quantity,
        grossRate: flexOpenDividendAccruals.grossRate,
        grossAmount: flexOpenDividendAccruals.grossAmount,
        netAmount: flexOpenDividendAccruals.netAmount,
      })
      .from(flexOpenDividendAccruals)
      .where(eq(flexOpenDividendAccruals.statementId, statement.id))
      .all()

    return { asOf: statement.toDate, accruals }
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
