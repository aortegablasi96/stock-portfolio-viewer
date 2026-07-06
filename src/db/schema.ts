import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

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
