import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import type { FlexStatementStore, FlexStoredStatement } from '@shared/domain/flex'

/**
 * Reads the imported Flex statement store itself — which statements are held and what
 * period they cover (Story #108). The companion to `flexImportService`, which writes it:
 * this one never imports, clears, or reaches IBKR, and goes through the read-only
 * `flexReadRepository` so the read/write split of the `flex_*` tables holds (DDR-0004).
 *
 * The store's *contents* are already exposed by the analytics services; what was missing
 * was its shape. Until this story the only view of it was `FlexImport`'s post-import
 * summary, which exists solely in the moment after an import — so on launch the owner
 * could not tell what their analytics were built from, or how stale it was. Bug #103
 * (unrealized P&L double-counted across two statements) was invisible for exactly that
 * reason.
 */
export const flexStatementsService = {
  /**
   * Every stored statement in the repository's order (newest first), plus the span they
   * cover end to end. Empty store → an empty list and `coverage: null`; that is a
   * first-class empty state, not an error, so it needs no result variant of its own.
   */
  listStatements(): FlexStatementStore {
    const statements = flexReadRepository.getStatements()
    return { statements, coverage: coverageOf(statements) }
  },
}

/**
 * Earliest start and latest end across the statements. Derived here rather than read from
 * the first/last row because statements may overlap or be imported out of order — the span
 * is a min/max over all of them, and the repository's ordering is a display convenience,
 * not a guarantee this calculation should lean on.
 */
function coverageOf(
  statements: FlexStoredStatement[],
): { fromDate: number; toDate: number } | null {
  if (statements.length === 0) return null
  return {
    fromDate: Math.min(...statements.map((s) => s.fromDate)),
    toDate: Math.max(...statements.map((s) => s.toDate)),
  }
}
