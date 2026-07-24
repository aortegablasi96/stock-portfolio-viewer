import { z } from 'zod'
import { portfolioOverviewSchema } from '@shared/domain/portfolio'
import { snapshotSummarySchema } from '@shared/domain/snapshot'
import { flexImportSummarySchema } from '@shared/domain/flex'
import { performanceResultSchema, type PerformanceResult } from '@shared/domain/performance'
import { allocationResultSchema, type AllocationResult } from '@shared/domain/allocation'
import { dividendResultSchema, type DividendResult } from '@shared/domain/dividends'
import { realizedGainsResultSchema, type RealizedGainsResult } from '@shared/domain/realizedGains'
import {
  classifyInstrumentsResultSchema,
  type ClassifyInstrumentsResult,
} from '@shared/domain/classification'

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
 * `getPortfolioOverview` accepts an optional display currency (Story #28): when given, the
 * overview is converted into it; when omitted, it is returned in native currencies. The
 * input is validated at the IPC boundary like any other untrusted renderer payload.
 */
export const portfolioOverviewRequestSchema = z.object({
  displayCurrency: z.string().min(1).optional(),
})
export type PortfolioOverviewRequest = z.infer<typeof portfolioOverviewRequestSchema>

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

/**
 * Optional request for the snapshot history. When `displayCurrency` is given, each summary's
 * total is converted into it with live gateway FX (Bug #44, DDR-0007); omitted, the stored
 * native summaries are returned. Validated at the IPC boundary like any renderer payload.
 */
export const snapshotListRequestSchema = z.object({
  displayCurrency: z.string().min(1).optional(),
})
export type SnapshotListRequest = z.infer<typeof snapshotListRequestSchema>

/** The snapshot history (headers only), newest first. Reads local storage. */
export const snapshotListSchema = z.array(snapshotSummarySchema)
export type SnapshotList = z.infer<typeof snapshotListSchema>

// ---- snapshot:clear ---------------------------------------------------------

/**
 * Result of an owner-confirmed "Clear history" request (Story #43, ADR-0006). A full,
 * deliberate reset of the captured snapshot history — the only sanctioned deletion path.
 * The outcome is modelled as data like the other channels: `cleared` with the number of
 * snapshots removed, or `error`. Takes no payload.
 */
export const clearHistoryResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cleared'), removedSnapshots: z.number().int().nonnegative() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type ClearHistoryResult = z.infer<typeof clearHistoryResultSchema>

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

// ---- flex:clear -------------------------------------------------------------

/**
 * Result of an owner-confirmed "Clear statements" request (Story #43, ADR-0006). A full,
 * deliberate reset of the imported Flex store — the only sanctioned deletion path —
 * independent of the snapshot history. `cleared` with the number of statements removed, or
 * `error`. Takes no payload.
 */
export const clearStatementsResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('cleared'), removedStatements: z.number().int().nonnegative() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type ClearStatementsResult = z.infer<typeof clearStatementsResultSchema>

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

/**
 * Sector classification refresh (M3, Story #30). The only analytics channel that reaches
 * Interactive Brokers: Flex carries no sector, so classifications are fetched from the
 * gateway and cached locally. It therefore adds `not_connected` to the usual variants —
 * again as data, not an exception (DDR-0009). Takes no payload.
 */
export { classifyInstrumentsResultSchema }
export type { ClassifyInstrumentsResult }

// ---- window.api bridge shape ------------------------------------------------

/**
 * The API surface exposed on `window.api` by the preload script. Both the
 * preload (implementation) and the renderer (consumer) reference this type so
 * the bridge stays in sync with a single source of truth.
 */
export interface RendererApi {
  ping: (request: PingRequest) => Promise<PingResponse>
  getPortfolioOverview: (request?: PortfolioOverviewRequest) => Promise<PortfolioOverviewResult>
  captureSnapshot: () => Promise<CaptureSnapshotResult>
  /** Snapshot history, newest first; optionally converted into a display currency (Bug #44). */
  listSnapshots: (request?: SnapshotListRequest) => Promise<SnapshotList>
  /** Subscribe to "snapshot captured" events (e.g. capture-on-open). Returns an unsubscribe fn. */
  onSnapshotCaptured: (callback: () => void) => () => void
  /** Open a file dialog to import IBKR Flex Query statement files into the local history. */
  importFlexStatements: () => Promise<FlexImportResult>
  /** Owner-confirmed full reset of the imported Flex statement store (Story #43). */
  clearStatements: () => Promise<ClearStatementsResult>
  /** Owner-confirmed full reset of the captured snapshot history (Story #43). */
  clearHistory: () => Promise<ClearHistoryResult>
  /** Performance over time from imported Flex data (M3, Story #21). */
  getPerformance: () => Promise<PerformanceResult>
  /** Allocation breakdown from imported Flex data (M3, Story #22). */
  getAllocation: () => Promise<AllocationResult>
  /** Dividend & income tracking from imported Flex data (M3, Story #23). */
  getDividends: () => Promise<DividendResult>
  /** Realized gains & trade history from imported Flex data (M3, Story #24). */
  getRealizedGains: () => Promise<RealizedGainsResult>
  /** Fetch & cache sector classification for the latest statement's positions (M3, Story #30). */
  classifyInstruments: () => Promise<ClassifyInstrumentsResult>
  /** Minimize the application window (custom frameless title bar, Story #42). */
  minimizeWindow: () => void
  /** Toggle the application window between maximized and restored (Story #42). */
  toggleMaximizeWindow: () => void
  /** Close the application window (Story #42). */
  closeWindow: () => void
  /** Query whether the window is currently maximized, for the initial title-bar icon (Story #42). */
  isWindowMaximized: () => Promise<boolean>
  /**
   * Subscribe to window maximize-state changes (control, OS double-click, or snapping) so the
   * title bar can swap its maximize/restore icon (Story #42). Returns an unsubscribe fn.
   */
  onWindowMaximizeChanged: (callback: (isMaximized: boolean) => void) => () => void
}
