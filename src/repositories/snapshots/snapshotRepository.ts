import { desc, eq } from 'drizzle-orm'
import { getDb } from '@db/client'
import { snapshots, snapshotHoldings } from '@db/schema'
import type { NewSnapshotInput, PortfolioSnapshot, SnapshotSummary } from '@shared/domain/snapshot'
import { rowToHolding, rowToSummary, toHeaderValues, toHoldingValues } from './snapshotMapping'

/**
 * Data access for the append-only snapshot history (Milestone M2, DDR-0003).
 *
 * This is the only layer that touches the `snapshots` / `snapshot_holdings`
 * tables (ADR-0003). History is immutable in normal operation: there is **no per-row
 * update or delete**, so the absence of a mutation surface is the guarantee, not a
 * convention. The one sanctioned exception is `clearAll` — a deliberate, owner-confirmed
 * full reset of the history (Story #43, ADR-0006) — never a partial edit. The
 * decimal⇄minor-units conversion lives in `snapshotMapping`.
 */
export const snapshotRepository = {
  /**
   * Persist one immutable snapshot and its holdings in a single transaction
   * (all-or-nothing: a snapshot is never stored without its holdings). Returns
   * the stored header summary.
   */
  append(input: NewSnapshotInput): SnapshotSummary {
    return getDb().transaction((tx) => {
      const header = tx.insert(snapshots).values(toHeaderValues(input, Date.now())).returning().get()

      if (input.overview.holdings.length > 0) {
        tx.insert(snapshotHoldings)
          .values(input.overview.holdings.map((holding) => toHoldingValues(holding, header.id)))
          .run()
      }

      return rowToSummary(header)
    })
  },

  /** Capture time of the most recent snapshot, or undefined if none exist (drives de-dupe). */
  latestCapturedAt(): number | undefined {
    const row = getDb()
      .select({ capturedAt: snapshots.capturedAt })
      .from(snapshots)
      .orderBy(desc(snapshots.capturedAt))
      .limit(1)
      .get()
    return row?.capturedAt
  },

  /** All snapshot headers, newest first. */
  listSummaries(): SnapshotSummary[] {
    return getDb().select().from(snapshots).orderBy(desc(snapshots.capturedAt)).all().map(rowToSummary)
  },

  /** A full snapshot (header + holdings) by id, or undefined if not found. */
  getById(id: number): PortfolioSnapshot | undefined {
    const header = getDb().select().from(snapshots).where(eq(snapshots.id, id)).get()
    if (!header) return undefined
    const holdings = getDb()
      .select()
      .from(snapshotHoldings)
      .where(eq(snapshotHoldings.snapshotId, id))
      .all()
      .map(rowToHolding)
    return { ...rowToSummary(header), holdings }
  },

  /**
   * Delete the **entire** snapshot history in a single transaction — the sole sanctioned
   * deletion path (owner-confirmed full reset; Story #43, ADR-0006). Removing each
   * `snapshots` header cascades to its `snapshot_holdings` rows (FKs are enforced). Returns
   * the number of snapshot headers removed. Not a partial delete: there is no by-id/date
   * variant, so the append-only-in-normal-use guarantee is preserved.
   */
  clearAll(): number {
    return getDb().transaction((tx) => {
      const removed = tx.select({ id: snapshots.id }).from(snapshots).all().length
      tx.delete(snapshots).run()
      return removed
    })
  },
}
