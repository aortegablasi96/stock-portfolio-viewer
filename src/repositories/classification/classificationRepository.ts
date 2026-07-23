import { getDb } from '@db/client'
import { instrumentClassifications } from '@db/schema'
import { ibkrGateway } from '@repositories/portfolio/ibkrGateway'

/**
 * Data access for instrument sector / industry classification (Milestone M3, Story #30).
 *
 * This repository fronts **two** sources, exactly as CLAUDE.md's Repository Pattern
 * describes: the local SQLite cache (`instrument_classifications`) and the Interactive
 * Brokers Client Portal Gateway. Flex statements carry no sector field, so the gateway is
 * the classification source and SQLite is the durable cache that keeps the Allocation view
 * working when the gateway is closed (DDR-0009).
 *
 * The cache is deliberately mutable — it is derived reference data, not history, so a
 * refresh upserts by conid. No business logic lives here: deciding *which* conids to
 * refresh belongs to `classificationService`.
 */

export interface ClassificationRow {
  conid: number
  symbol: string
  /** Broad sector, e.g. 'Financial'; '' when the source has no classification. */
  sector: string
  /** Narrower industry, e.g. 'Banks'; '' when the source has no classification. */
  industry: string
  fetchedAt: number
}

export const classificationRepository = {
  /** Every cached classification. Small (one row per instrument ever held), so read whole. */
  getAll(): ClassificationRow[] {
    return getDb()
      .select({
        conid: instrumentClassifications.conid,
        symbol: instrumentClassifications.symbol,
        sector: instrumentClassifications.sector,
        industry: instrumentClassifications.industry,
        fetchedAt: instrumentClassifications.fetchedAt,
      })
      .from(instrumentClassifications)
      .all()
  },

  /**
   * Throw `IbkrNotConnectedError` unless the gateway has an authenticated session, so a
   * refresh fails once up front instead of once per instrument.
   */
  async ensureConnected(): Promise<void> {
    return ibkrGateway.ensureAuthenticated()
  },

  /**
   * Fetch one instrument's classification from the IBKR gateway. Throws
   * `IbkrNotConnectedError` when the gateway is closed or the session is not logged in.
   */
  async fetchClassification(conid: number): Promise<{ sector: string; industry: string }> {
    return ibkrGateway.getContractClassification(conid)
  },

  /** Insert or refresh cached classifications, keyed by conid. */
  upsertMany(rows: ClassificationRow[]): void {
    if (rows.length === 0) return
    const db = getDb()
    for (const row of rows) {
      db.insert(instrumentClassifications)
        .values({ ...row, source: 'ibkr' })
        .onConflictDoUpdate({
          target: instrumentClassifications.conid,
          set: {
            symbol: row.symbol,
            sector: row.sector,
            industry: row.industry,
            fetchedAt: row.fetchedAt,
          },
        })
        .run()
    }
  },
}
