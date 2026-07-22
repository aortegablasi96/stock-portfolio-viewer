import { z } from 'zod'
import { portfolioOverviewSchema } from '@shared/domain/portfolio'
import { snapshotSummarySchema } from '@shared/domain/snapshot'
import { flexImportSummarySchema } from '@shared/domain/flex'
import { performanceResultSchema, type PerformanceResult } from '@shared/domain/performance'
import { allocationResultSchema, type AllocationResult } from '@shared/domain/allocation'
import { dividendResultSchema, type DividendResult } from '@shared/domain/dividends'
import { realizedGainsResultSchema, type RealizedGainsResult } from '@shared/domain/realizedGains'

/**
 * The typed contract for every IPC channel: the Zod schema used by the main
 * process to validate renderer input at the boundary, the inferred request/
 * response types, and the shape of the `window.api` bridge exposed to the
 * renderer.
 *
 * The renderer and preload import only the *types* from this module (erased at
 * compile time), so Zod never reaches the renderer bundle. The main process
 * imports the schemas at runtime to validate.
 */

// ---- app:ping ---------------------------------------------------------------

export const pingRequestSchema = z.object({
  message: z.string().min(1).max(200),
})
export type PingRequest = z.infer<typeof pingRequestSchema>

export const pingResponseSchema = z.object({
  reply: z.literal('pong'),
  echo: z.string(),
  at: z.string().datetime(),
})
export type PingResponse = z.infer<typeof pingResponseSchema>

// ---- portfolio:getOverview --------------------------------------------------

/**
 * The read-only portfolio overview result. Connection state is modelled as *data*,
 * not thrown exceptions, so the renderer can render the `not_connected` and `error`
 * states as first-class UI (see the M1 Architecture Review and ADR-0004). The IPC
 * handler maps `IbkrNotConnectedError` / other failures onto these variants.
 *
 * `getPortfolioOverview` takes no payload, so there is no request schema to validate.
 */
export const portfolioOverviewResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), overview: portfolioOverviewSchema }),
  z.object({ status: z.literal('not_connected'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type PortfolioOverviewResult = z.infer<typeof portfolioOverviewResultSchema>

// ---- snapshot:capture -------------------------------------------------------

/**
 * Result of a manual "Capture now" request. Like the portfolio overview, the
 * connection state is modelled as data (DDR-0002/0003): a disconnected gateway is
 * a `not_connected` variant, not a thrown error. Takes no payload.
 */
export const captureSnapshotResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('captured'), summary: snapshotSummarySchema }),
  z.object({ status: z.literal('not_connected'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type CaptureSnapshotResult = z.infer<typeof captureSnapshotResultSchema>

// ---- snapshot:list ----------------------------------------------------------

/** The snapshot history (headers only), newest first. Reads local storage; takes no payload. */
export const snapshotListSchema = z.array(snapshotSummarySchema)
export type SnapshotList = z.infer<typeof snapshotListSchema>

// ---- flex:import ------------------------------------------------------------

/**
 * Result of a "Import Flex statements" request (M3, Story #20). The file dialog and
 * the outcome are modelled as *data*, not thrown errors, consistent with the other
 * channels (ADR-0005): `canceled` when the owner closes the dialog, `invalid` when a
 * selected file is not a valid Flex Query statement (nothing imported), `error` for
 * anything unexpected. Takes no payload — the main process owns the native dialog.
 */
export const flexImportResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('imported'), summary: flexImportSummarySchema }),
  z.object({ status: z.literal('canceled') }),
  z.object({ status: z.literal('invalid'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type FlexImportResult = z.infer<typeof flexImportResultSchema>

// ---- analytics:* (M3, Stories #21–#24) --------------------------------------

/**
 * The four analytics views (performance, allocation, dividends, realized gains) each
 * read from the imported Flex data and degrade to a `needs_import` state when none is
 * present — modelled as data, consistent with the other channels (DDR-0005). The
 * result schemas live with their domain models; re-exported here as the IPC responses.
 * None takes a payload — each reads the local Flex store.
 */
export {
  performanceResultSchema,
  allocationResultSchema,
  dividendResultSchema,
  realizedGainsResultSchema,
}
export type { PerformanceResult, AllocationResult, DividendResult, RealizedGainsResult }

// ---- window.api bridge shape ------------------------------------------------

/**
 * The API surface exposed on `window.api` by the preload script. Both the
 * preload (implementation) and the renderer (consumer) reference this type so
 * the bridge stays in sync with a single source of truth.
 */
export interface RendererApi {
  ping: (request: PingRequest) => Promise<PingResponse>
  getPortfolioOverview: () => Promise<PortfolioOverviewResult>
  captureSnapshot: () => Promise<CaptureSnapshotResult>
  listSnapshots: () => Promise<SnapshotList>
  /** Subscribe to "snapshot captured" events (e.g. capture-on-open). Returns an unsubscribe fn. */
  onSnapshotCaptured: (callback: () => void) => () => void
  /** Open a file dialog to import IBKR Flex Query statement files into the local history. */
  importFlexStatements: () => Promise<FlexImportResult>
  /** Performance over time from imported Flex data (M3, Story #21). */
  getPerformance: () => Promise<PerformanceResult>
  /** Allocation breakdown from imported Flex data (M3, Story #22). */
  getAllocation: () => Promise<AllocationResult>
  /** Dividend & income tracking from imported Flex data (M3, Story #23). */
  getDividends: () => Promise<DividendResult>
  /** Realized gains & trade history from imported Flex data (M3, Story #24). */
  getRealizedGains: () => Promise<RealizedGainsResult>
}
