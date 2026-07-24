import { readFileSync } from 'node:fs'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@db/client'
import {
  flexCashTransactions,
  flexFifoSummaries,
  flexLots,
  flexNavChanges,
  flexOpenDividendAccruals,
  flexOpenPositions,
  flexPriorPeriodPositions,
  flexSecurities,
  flexStatements,
  flexTrades,
} from '@db/schema'
import type {
  FlexRecordCount,
  FlexStatement,
  FlexStatementImport,
} from '@shared/domain/flex'
import { parseFlexStatements } from './flexStatementParser'

/**
 * Data access for imported Flex Query history (Milestone M3, Story #20; ADR-0005,
 * DDR-0004). The only layer that touches the `flex_*` tables and the XML files.
 *
 * Like `snapshotRepository`, imported history is immutable in normal operation: there is
 * **no per-row update or delete**, so the absence of a mutation surface is the guarantee.
 * The one sanctioned exception is `clearAll` — a deliberate, owner-confirmed full reset of
 * the imported store (Story #43, ADR-0006) — never a partial edit. De-dupe is two-tier: a
 * statement is skipped whole if its identity already exists; event rows (`flex_trades`,
 * `flex_cash_transactions`) are inserted with `onConflictDoNothing` against their unique key
 * so overlapping re-exports merge without duplicates.
 */

const nil: FlexRecordCount = { inserted: 0, skipped: 0 }

/** Zero-count outcome for a statement whose exact identity was already imported. */
function alreadyImported(statement: FlexStatement, filename: string): FlexStatementImport {
  return {
    filename,
    accountId: statement.accountId,
    fromDate: statement.fromDate,
    toDate: statement.toDate,
    period: statement.period,
    alreadyImported: true,
    records: {
      navChanges: nil,
      openPositions: nil,
      priorPeriodPositions: nil,
      trades: nil,
      lots: nil,
      cashTransactions: nil,
      performanceSummaries: nil,
      securities: nil,
      openDividendAccruals: nil,
    },
  }
}

export const flexRepository = {
  /**
   * Read a Flex Query XML file and parse it into typed statements. Pure of the
   * database — the service parses every file first (validation gate) before any
   * persistence, so a malformed file aborts the batch without partial writes.
   * Throws `ValidationError` (from the parser) for a non–Flex-Query file.
   */
  readAndParse(path: string): FlexStatement[] {
    return parseFlexStatements(readFileSync(path, 'utf8'))
  },

  /**
   * Persist one parsed statement idempotently, in a single transaction (all-or-nothing).
   * Returns what was stored versus skipped as duplicates.
   */
  persist(statement: FlexStatement, filename: string): FlexStatementImport {
    return getDb().transaction((tx): FlexStatementImport => {
      const existing = tx
        .select({ id: flexStatements.id })
        .from(flexStatements)
        .where(
          and(
            eq(flexStatements.accountId, statement.accountId),
            eq(flexStatements.fromDate, statement.fromDate),
            eq(flexStatements.toDate, statement.toDate),
            eq(flexStatements.whenGenerated, statement.whenGenerated),
          ),
        )
        .get()

      if (existing) return alreadyImported(statement, filename)

      const header = tx
        .insert(flexStatements)
        .values({
          accountId: statement.accountId,
          fromDate: statement.fromDate,
          toDate: statement.toDate,
          period: statement.period,
          whenGenerated: statement.whenGenerated,
          baseCurrency: statement.baseCurrency,
          sourceFilename: filename,
          importedAt: Date.now(),
        })
        .returning()
        .get()
      const sid = header.id

      // As-of / aggregate rows: scoped to this statement, so every row is a fresh insert.
      let navInserted = 0
      if (statement.navChange) {
        tx.insert(flexNavChanges).values({ statementId: sid, ...statement.navChange }).run()
        navInserted = 1
      }
      if (statement.openPositions.length > 0) {
        tx.insert(flexOpenPositions)
          .values(statement.openPositions.map((p) => ({ statementId: sid, ...p })))
          .run()
      }
      if (statement.priorPeriodPositions.length > 0) {
        tx.insert(flexPriorPeriodPositions)
          .values(statement.priorPeriodPositions.map((p) => ({ statementId: sid, ...p })))
          .run()
      }
      if (statement.lots.length > 0) {
        tx.insert(flexLots)
          .values(statement.lots.map((l) => ({ statementId: sid, ...l })))
          .run()
      }
      if (statement.performanceSummaries.length > 0) {
        tx.insert(flexFifoSummaries)
          .values(statement.performanceSummaries.map((s) => ({ statementId: sid, ...s })))
          .run()
      }
      if (statement.securities.length > 0) {
        tx.insert(flexSecurities)
          .values(statement.securities.map((s) => ({ statementId: sid, ...s })))
          .run()
      }
      if (statement.openDividendAccruals.length > 0) {
        tx.insert(flexOpenDividendAccruals)
          .values(statement.openDividendAccruals.map((a) => ({ statementId: sid, ...a })))
          .run()
      }

      // Event rows: de-duped globally by unique key so overlapping statements merge.
      let tradesInserted = 0
      for (const trade of statement.trades) {
        const res = tx
          .insert(flexTrades)
          .values({ statementId: sid, ...trade })
          .onConflictDoNothing({ target: flexTrades.tradeKey })
          .run()
        tradesInserted += res.changes
      }
      let cashInserted = 0
      for (const cash of statement.cashTransactions) {
        const res = tx
          .insert(flexCashTransactions)
          .values({ statementId: sid, ...cash })
          .onConflictDoNothing({ target: flexCashTransactions.dedupeKey })
          .run()
        cashInserted += res.changes
      }

      const count = (inserted: number, total: number): FlexRecordCount => ({
        inserted,
        skipped: total - inserted,
      })

      return {
        filename,
        accountId: statement.accountId,
        fromDate: statement.fromDate,
        toDate: statement.toDate,
        period: statement.period,
        alreadyImported: false,
        records: {
          navChanges: count(navInserted, statement.navChange ? 1 : 0),
          openPositions: count(statement.openPositions.length, statement.openPositions.length),
          priorPeriodPositions: count(
            statement.priorPeriodPositions.length,
            statement.priorPeriodPositions.length,
          ),
          trades: count(tradesInserted, statement.trades.length),
          lots: count(statement.lots.length, statement.lots.length),
          cashTransactions: count(cashInserted, statement.cashTransactions.length),
          performanceSummaries: count(
            statement.performanceSummaries.length,
            statement.performanceSummaries.length,
          ),
          securities: count(statement.securities.length, statement.securities.length),
          openDividendAccruals: count(
            statement.openDividendAccruals.length,
            statement.openDividendAccruals.length,
          ),
        },
      }
    })
  },

  /**
   * Delete **all** imported Flex history in a single transaction — the sole sanctioned
   * deletion path (owner-confirmed full reset; Story #43, ADR-0006). Every `flex_*` child
   * table references `flex_statements` with `onDelete: 'cascade'` and FKs are enforced, so
   * removing the statement headers clears the entire imported store. Returns the number of
   * statements removed. Not a partial delete: there is no by-statement/date variant, so the
   * append-only-in-normal-use guarantee (DDR-0004) is preserved.
   */
  clearAll(): number {
    return getDb().transaction((tx) => {
      const removed = tx.select({ id: flexStatements.id }).from(flexStatements).all().length
      tx.delete(flexStatements).run()
      return removed
    })
  },
}
