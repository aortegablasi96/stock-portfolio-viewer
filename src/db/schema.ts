import { sqliteTable, text, integer, real, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema (SQLite). This module is intentionally pure — it imports only
 * drizzle-orm so drizzle-kit can load it outside Electron for generate/studio.
 *
 * `app_meta` is a trivial key/value table that (a) serves as the migration smoke
 * test for Milestone M0 and (b) provides a home for lightweight application
 * metadata (schema markers, first-run flags, …).
 *
 * The `snapshots` / `snapshot_holdings` tables (Milestone M2) store the immutable,
 * append-only portfolio history. See DDR-0003 for the persistence model: monetary
 * amounts are stored as **integer minor units** (cents) alongside the raw currency;
 * `quantity` is a `real` share count; timestamps are epoch-millisecond integers (UTC).
 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export type AppMetaRow = typeof appMeta.$inferSelect
export type NewAppMetaRow = typeof appMeta.$inferInsert

/**
 * One immutable row per captured portfolio state. Rolled-up totals are stored on
 * the header (integer minor units) so the history list and analytics read totals
 * without re-summing the detail rows. Append-only: never updated or deleted.
 */
export const snapshots = sqliteTable(
  'snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Capture time — epoch milliseconds, UTC. */
    capturedAt: integer('captured_at').notNull(),
    /** Provenance of the capture (e.g. 'ibkr'); room for future multi-broker. */
    source: text('source').notNull().default('ibkr'),
    baseCurrency: text('base_currency').notNull(),
    totalMarketValue: integer('total_market_value').notNull(),
    netLiquidation: integer('net_liquidation').notNull(),
    totalCash: integer('total_cash').notNull(),
    holdingsCount: integer('holdings_count').notNull(),
    /** Row insert time — epoch milliseconds. */
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    // The history list sorts newest-first and de-dupe reads the latest capture.
    byCapturedAt: index('idx_snapshots_captured_at').on(t.capturedAt),
  }),
)

export type SnapshotRow = typeof snapshots.$inferSelect
export type NewSnapshotRow = typeof snapshots.$inferInsert

/** Per-holding detail belonging to a snapshot. Deleted only via cascade (never in normal use). */
export const snapshotHoldings = sqliteTable(
  'snapshot_holdings',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    snapshotId: integer('snapshot_id')
      .notNull()
      .references(() => snapshots.id, { onDelete: 'cascade' }),
    conid: integer('conid').notNull(),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    /** Share count — may be fractional; not money, so stored as real. */
    quantity: real('quantity').notNull(),
    averageCost: integer('average_cost'),
    marketPrice: integer('market_price'),
    marketValue: integer('market_value').notNull(),
    currency: text('currency').notNull(),
  },
  (t) => ({
    bySnapshot: index('idx_snapshot_holdings_snapshot_id').on(t.snapshotId),
  }),
)

export type SnapshotHoldingRow = typeof snapshotHoldings.$inferSelect
export type NewSnapshotHoldingRow = typeof snapshotHoldings.$inferInsert

/**
 * Imported IBKR Flex Query history (Milestone M3, Story #20). See ADR-0005 (Flex
 * file import as an offline data source) and DDR-0004 for the persistence model:
 * numeric fields are stored as **`real`** (money, prices, FX rates, quantities, P&L)
 * — deliberately *not* the integer-minor-units convention of the snapshot tables,
 * because Flex is multi-currency and carries high-precision prices/rates. Dates are
 * epoch-millisecond integers (UTC). All tables are append-only; the repository
 * exposes no update/delete. De-dupe is two-tier: event tables (`flex_trades`,
 * `flex_cash_transactions`) carry a global unique key so overlapping re-exports
 * merge; as-of tables are scoped to their statement.
 */
export const flexStatements = sqliteTable(
  'flex_statements',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id').notNull(),
    /** Statement period bounds — epoch ms, UTC. */
    fromDate: integer('from_date').notNull(),
    toDate: integer('to_date').notNull(),
    period: text('period').notNull(),
    /** When IBKR generated the export — epoch ms; part of the de-dupe identity. */
    whenGenerated: integer('when_generated').notNull(),
    baseCurrency: text('base_currency').notNull(),
    sourceFilename: text('source_filename').notNull(),
    /** Import time — epoch ms. */
    importedAt: integer('imported_at').notNull(),
  },
  (t) => ({
    // Re-importing the exact same exported statement is a no-op (statement-level de-dupe).
    identity: uniqueIndex('idx_flex_statements_identity').on(
      t.accountId,
      t.fromDate,
      t.toDate,
      t.whenGenerated,
    ),
  }),
)

export type FlexStatementRow = typeof flexStatements.$inferSelect
export type NewFlexStatementRow = typeof flexStatements.$inferInsert

/** Account NAV change for a statement (`ChangeInNAV`). One per statement. */
export const flexNavChanges = sqliteTable(
  'flex_nav_changes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    currency: text('currency').notNull(),
    fromDate: integer('from_date').notNull(),
    toDate: integer('to_date').notNull(),
    startingValue: real('starting_value').notNull(),
    endingValue: real('ending_value').notNull(),
    mtm: real('mtm').notNull(),
    depositsWithdrawals: real('deposits_withdrawals').notNull(),
    dividends: real('dividends').notNull(),
    withholdingTax: real('withholding_tax').notNull(),
    interest: real('interest').notNull(),
    commissions: real('commissions').notNull(),
    twr: real('twr').notNull(),
  },
  (t) => ({
    byStatement: index('idx_flex_nav_changes_statement_id').on(t.statementId),
  }),
)

export type FlexNavChangeRow = typeof flexNavChanges.$inferSelect
export type NewFlexNavChangeRow = typeof flexNavChanges.$inferInsert

/** Open positions as of a statement's report date (`OpenPosition`). Statement-scoped. */
export const flexOpenPositions = sqliteTable(
  'flex_open_positions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    assetCategory: text('asset_category').notNull(),
    currency: text('currency').notNull(),
    fxRateToBase: real('fx_rate_to_base').notNull(),
    reportDate: integer('report_date'),
    position: real('position').notNull(),
    markPrice: real('mark_price'),
    costBasisPrice: real('cost_basis_price'),
    costBasisMoney: real('cost_basis_money'),
    percentOfNav: real('percent_of_nav'),
    fifoPnlUnrealized: real('fifo_pnl_unrealized'),
    side: text('side').notNull(),
  },
  (t) => ({
    byStatement: index('idx_flex_open_positions_statement_id').on(t.statementId),
    byConid: index('idx_flex_open_positions_conid').on(t.conid),
  }),
)

export type FlexOpenPositionRow = typeof flexOpenPositions.$inferSelect
export type NewFlexOpenPositionRow = typeof flexOpenPositions.$inferInsert

/**
 * Per-instrument, per-trading-day mark-to-market (`PriorPeriodPosition`) — the daily
 * price/MTM series behind day-by-day performance (Story #29; DDR-0008). Statement-scoped
 * like open positions: fresh insert per statement, cascade-deleted, no global de-dupe.
 */
export const flexPriorPeriodPositions = sqliteTable(
  'flex_prior_period_positions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    assetCategory: text('asset_category').notNull(),
    currency: text('currency').notNull(),
    fxRateToBase: real('fx_rate_to_base').notNull(),
    /** Trading day — epoch ms, UTC midnight. */
    date: integer('date').notNull(),
    price: real('price'),
    /** MTM P&L vs. prior day, native currency (base = priorMtmPnl × fxRateToBase). */
    priorMtmPnl: real('prior_mtm_pnl').notNull(),
  },
  (t) => ({
    byStatement: index('idx_flex_prior_period_positions_statement_id').on(t.statementId),
    byDate: index('idx_flex_prior_period_positions_date').on(t.date),
  }),
)

export type FlexPriorPeriodPositionRow = typeof flexPriorPeriodPositions.$inferSelect
export type NewFlexPriorPeriodPositionRow = typeof flexPriorPeriodPositions.$inferInsert

/** Executed trades (`Trade`). De-duped globally by `trade_key` (DDR-0004). */
export const flexTrades = sqliteTable(
  'flex_trades',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    tradeKey: text('trade_key').notNull(),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    assetCategory: text('asset_category').notNull(),
    currency: text('currency').notNull(),
    fxRateToBase: real('fx_rate_to_base').notNull(),
    dateTime: integer('date_time'),
    tradeDate: integer('trade_date'),
    settleDate: integer('settle_date'),
    transactionType: text('transaction_type').notNull(),
    exchange: text('exchange').notNull(),
    quantity: real('quantity').notNull(),
    tradePrice: real('trade_price').notNull(),
    tradeMoney: real('trade_money'),
    proceeds: real('proceeds'),
    taxes: real('taxes'),
    ibCommission: real('ib_commission'),
    ibCommissionCurrency: text('ib_commission_currency').notNull(),
    netCash: real('net_cash'),
    closePrice: real('close_price'),
    openCloseIndicator: text('open_close_indicator').notNull(),
    cost: real('cost'),
    fifoPnlRealized: real('fifo_pnl_realized'),
    mtmPnl: real('mtm_pnl'),
  },
  (t) => ({
    byTradeKey: uniqueIndex('idx_flex_trades_trade_key').on(t.tradeKey),
    byConid: index('idx_flex_trades_conid').on(t.conid),
    byDateTime: index('idx_flex_trades_date_time').on(t.dateTime),
  }),
)

export type FlexTradeRow = typeof flexTrades.$inferSelect
export type NewFlexTradeRow = typeof flexTrades.$inferInsert

/** Closed lots (`Lot`). Statement-scoped (DDR-0004). */
export const flexLots = sqliteTable(
  'flex_lots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    currency: text('currency').notNull(),
    fxRateToBase: real('fx_rate_to_base').notNull(),
    dateTime: integer('date_time'),
    tradeDate: integer('trade_date'),
    quantity: real('quantity').notNull(),
    tradePrice: real('trade_price'),
    cost: real('cost'),
    fifoPnlRealized: real('fifo_pnl_realized'),
    openCloseIndicator: text('open_close_indicator').notNull(),
    notes: text('notes').notNull(),
  },
  (t) => ({
    byStatement: index('idx_flex_lots_statement_id').on(t.statementId),
  }),
)

export type FlexLotRow = typeof flexLots.$inferSelect
export type NewFlexLotRow = typeof flexLots.$inferInsert

/** Cash transactions (`CashTransaction`). De-duped globally by `dedupe_key` (DDR-0004). */
export const flexCashTransactions = sqliteTable(
  'flex_cash_transactions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    dedupeKey: text('dedupe_key').notNull(),
    transactionId: text('transaction_id').notNull(),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    assetCategory: text('asset_category').notNull(),
    currency: text('currency').notNull(),
    fxRateToBase: real('fx_rate_to_base').notNull(),
    dateTime: integer('date_time'),
    settleDate: integer('settle_date'),
    exDate: integer('ex_date'),
    amount: real('amount').notNull(),
    type: text('type').notNull(),
    dividendType: text('dividend_type').notNull(),
    code: text('code').notNull(),
  },
  (t) => ({
    byDedupeKey: uniqueIndex('idx_flex_cash_transactions_dedupe_key').on(t.dedupeKey),
    byType: index('idx_flex_cash_transactions_type').on(t.type),
    byDateTime: index('idx_flex_cash_transactions_date_time').on(t.dateTime),
    byConid: index('idx_flex_cash_transactions_conid').on(t.conid),
  }),
)

export type FlexCashTransactionRow = typeof flexCashTransactions.$inferSelect
export type NewFlexCashTransactionRow = typeof flexCashTransactions.$inferInsert

/** Per-instrument realized/unrealized P&L (`FIFOPerformanceSummaryUnderlying`). Statement-scoped. */
export const flexFifoSummaries = sqliteTable(
  'flex_fifo_summaries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    assetCategory: text('asset_category').notNull(),
    realizedStProfit: real('realized_st_profit').notNull(),
    realizedStLoss: real('realized_st_loss').notNull(),
    realizedLtProfit: real('realized_lt_profit').notNull(),
    realizedLtLoss: real('realized_lt_loss').notNull(),
    totalRealizedPnl: real('total_realized_pnl').notNull(),
    unrealizedProfit: real('unrealized_profit').notNull(),
    unrealizedLoss: real('unrealized_loss').notNull(),
    totalUnrealizedPnl: real('total_unrealized_pnl').notNull(),
    totalFifoPnl: real('total_fifo_pnl').notNull(),
    transferredPnl: real('transferred_pnl').notNull(),
  },
  (t) => ({
    byStatement: index('idx_flex_fifo_summaries_statement_id').on(t.statementId),
  }),
)

export type FlexFifoSummaryRow = typeof flexFifoSummaries.$inferSelect
export type NewFlexFifoSummaryRow = typeof flexFifoSummaries.$inferInsert

/** Instrument reference data (`SecurityInfo`). Statement-scoped. */
export const flexSecurities = sqliteTable(
  'flex_securities',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    assetCategory: text('asset_category').notNull(),
    subCategory: text('sub_category').notNull(),
    currency: text('currency').notNull(),
    listingExchange: text('listing_exchange').notNull(),
    issuerCountryCode: text('issuer_country_code').notNull(),
    isin: text('isin').notNull(),
    cusip: text('cusip').notNull(),
    multiplier: real('multiplier'),
  },
  (t) => ({
    byStatement: index('idx_flex_securities_statement_id').on(t.statementId),
    byConid: index('idx_flex_securities_conid').on(t.conid),
  }),
)

export type FlexSecurityRow = typeof flexSecurities.$inferSelect
export type NewFlexSecurityRow = typeof flexSecurities.$inferInsert

/**
 * Dividends declared but not yet paid as of the statement's generation
 * (`OpenDividendAccrual`) — the "upcoming dividends" source (Story #31; DDR-0010).
 *
 * Statement-scoped like open positions: it is an *as-of* balance, not an event, so
 * there is no global de-dupe key and each import inserts a fresh set that the read
 * layer queries for the latest statement only. `netAmount` is IBKR's own net after tax
 * and fees; `tax` / `fee` are retained raw because IBKR's sign convention for them is
 * not guaranteed — the service derives the withheld magnitude as `grossAmount −
 * netAmount` rather than trusting the sign.
 */
export const flexOpenDividendAccruals = sqliteTable(
  'flex_open_dividend_accruals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    statementId: integer('statement_id')
      .notNull()
      .references(() => flexStatements.id, { onDelete: 'cascade' }),
    conid: integer('conid'),
    symbol: text('symbol').notNull(),
    description: text('description').notNull(),
    assetCategory: text('asset_category').notNull(),
    currency: text('currency').notNull(),
    fxRateToBase: real('fx_rate_to_base').notNull(),
    /** Ex-dividend and pay dates — epoch ms, UTC. */
    exDate: integer('ex_date'),
    payDate: integer('pay_date'),
    /** Shares held prior to the ex-date. */
    quantity: real('quantity').notNull(),
    /** Dividend per share, in `currency`. */
    grossRate: real('gross_rate'),
    grossAmount: real('gross_amount').notNull(),
    tax: real('tax').notNull(),
    fee: real('fee').notNull(),
    netAmount: real('net_amount').notNull(),
    code: text('code').notNull(),
  },
  (t) => ({
    byStatement: index('idx_flex_open_dividend_accruals_statement_id').on(t.statementId),
    byPayDate: index('idx_flex_open_dividend_accruals_pay_date').on(t.payDate),
  }),
)

export type FlexOpenDividendAccrualRow = typeof flexOpenDividendAccruals.$inferSelect
export type NewFlexOpenDividendAccrualRow = typeof flexOpenDividendAccruals.$inferInsert

/**
 * Sector / industry classification for an instrument (Milestone M3, Story #30).
 *
 * Unlike every other table here this one is a **cache, not history**: IBKR Flex
 * statements carry no sector field, so the classification is fetched from the Client
 * Portal Gateway and stored locally so the Allocation view keeps working offline.
 * Rows are therefore upserted (refreshed) rather than append-only — the immutable
 * `snapshots` / `flex_*` tables are unaffected. A row whose `sector` is `''` records a
 * *resolved-but-unknown* answer, so the gateway is not re-queried for it every refresh.
 * See DDR-0009.
 */
export const instrumentClassifications = sqliteTable(
  'instrument_classifications',
  {
    /** IBKR contract id — the join key back to positions. */
    conid: integer('conid').primaryKey(),
    symbol: text('symbol').notNull(),
    /** Broad sector, e.g. 'Financial' (IBKR `industry`); '' when the source has none. */
    sector: text('sector').notNull(),
    /** Narrower industry, e.g. 'Banks' (IBKR `category`); '' when the source has none. */
    industry: text('industry').notNull(),
    /** Where the classification came from; room for future providers. */
    source: text('source').notNull().default('ibkr'),
    /** When it was fetched — epoch milliseconds, UTC. */
    fetchedAt: integer('fetched_at').notNull(),
  },
  (t) => ({
    // Fallback lookup for position rows that carry no conid.
    bySymbol: index('idx_instrument_classifications_symbol').on(t.symbol),
  }),
)

export type InstrumentClassificationRow = typeof instrumentClassifications.$inferSelect
export type NewInstrumentClassificationRow = typeof instrumentClassifications.$inferInsert
