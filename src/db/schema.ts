import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

/**
 * Drizzle schema (SQLite). This module is intentionally pure — it imports only
 * drizzle-orm so drizzle-kit can load it outside Electron for generate/studio.
 *
 * `app_meta` is a trivial key/value table that (a) serves as the migration smoke
 * test for Milestone M0 and (b) provides a home for lightweight application
 * metadata (schema markers, first-run flags, …). The real domain schema
 * (holdings, snapshots, dividends, …) arrives in Milestone M2.
 */
export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
})

export type AppMetaRow = typeof appMeta.$inferSelect
export type NewAppMetaRow = typeof appMeta.$inferInsert
