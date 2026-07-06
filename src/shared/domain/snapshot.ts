import { z } from 'zod'
import { holdingSchema, portfolioOverviewSchema } from './portfolio'

/**
 * Snapshot domain models (Milestone M2). A snapshot is an immutable, timestamped
 * capture of the portfolio, stored locally so history survives across sessions and
 * analytics can run without querying Interactive Brokers. See DDR-0003.
 *
 * These are plain, serializable shapes (money as decimal `number`, timestamps as
 * epoch milliseconds) — the repository converts money to/from integer minor units
 * at the storage boundary. Types cross IPC via `@shared/ipc/contract`.
 */

/** Header-level summary of a captured snapshot — enough for the history list. */
export const snapshotSummarySchema = z.object({
  id: z.number().int(),
  /** Capture time — epoch milliseconds, UTC. */
  capturedAt: z.number().int(),
  source: z.string(),
  baseCurrency: z.string(),
  totalMarketValue: z.number(),
  netLiquidation: z.number(),
  totalCash: z.number(),
  holdingsCount: z.number().int(),
})
export type SnapshotSummary = z.infer<typeof snapshotSummarySchema>

/** A full snapshot: the summary plus its per-holding detail. */
export const portfolioSnapshotSchema = snapshotSummarySchema.extend({
  holdings: z.array(holdingSchema),
})
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>

/**
 * Input to persist a new snapshot. The repository derives the header totals from
 * the overview's balances and rolls up the holdings; the service supplies the
 * capture time and provenance.
 */
export const newSnapshotInputSchema = z.object({
  capturedAt: z.number().int(),
  source: z.string().default('ibkr'),
  overview: portfolioOverviewSchema,
})
export type NewSnapshotInput = z.infer<typeof newSnapshotInputSchema>
