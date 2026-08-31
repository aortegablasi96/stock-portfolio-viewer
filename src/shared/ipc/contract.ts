import { z } from 'zod'
import { portfolioOverviewSchema } from '@shared/domain/portfolio'
import { snapshotSummarySchema } from '@shared/domain/snapshot'
import { flexImportSummarySchema, flexStatementStoreSchema } from '@shared/domain/flex'
import { performanceResultSchema, type PerformanceResult } from '@shared/domain/performance'
import { allocationResultSchema, type AllocationResult } from '@shared/domain/allocation'
import { dividendResultSchema, type DividendResult } from '@shared/domain/dividends'
import { realizedGainsResultSchema, type RealizedGainsResult } from '@shared/domain/realizedGains'
import {
  classifyInstrumentsResultSchema,
  type ClassificationProgress,
  type ClassifyInstrumentsResult,
} from '@shared/domain/classification'
import {
  clearInvestorProfileResultSchema,
  investorProfileSchema,
  saveInvestorProfileResultSchema,
  validatedInvestorProfileDraftSchema,
  type ClearInvestorProfileResult,
  type InvestorProfile,
  type InvestorProfileDraft,
  type SaveInvestorProfileResult,
} from '@shared/domain/investorProfile'
import {
  balanceDriftResultSchema,
  type BalanceDriftReport,
  type BalanceDriftResult,
} from '@shared/domain/balanceDrift'
import {
  assistantAskResultSchema,
  assistantStatusSchema,
  saveApiKeyResultSchema,
  type AssistantAskResult,
  type AssistantStatus,
  type SaveApiKeyResult,
} from '@shared/domain/assistant'
import {
  pickDisclosedSections,
  type AssistantContext,
} from '@shared/domain/assistantDisclosure'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'

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
 * not thrown exceptions, so the renderer can render the `not_connected`, `not_responding`
 * and `error` states as first-class UI (see the M1 Architecture Review and ADR-0004). The IPC
 * handler maps `IbkrNotConnectedError` / `IbkrTimeoutError` / other failures onto these
 * variants. `not_connected` and `not_responding` are separate because their recovery differs:
 * one means start the gateway, the other means it is running but stalled (Story #104,
 * DDR-0022).
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
  z.object({ status: z.literal('not_responding'), message: z.string() }),
  z.object({ status: z.literal('error'), message: z.string() }),
])
export type PortfolioOverviewResult = z.infer<typeof portfolioOverviewResultSchema>

// ---- snapshot:capture -------------------------------------------------------

/**
 * Result of a manual "Capture now" request. Like the portfolio overview, the
 * connection state is modelled as data (DDR-0002/0003): a disconnected gateway is
 * a `not_connected` variant and a stalled one `not_responding`, not a thrown error
 * (Story #104). Takes no payload.
 */
export const captureSnapshotResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('captured'), summary: snapshotSummarySchema }),
  z.object({ status: z.literal('not_connected'), message: z.string() }),
  z.object({ status: z.literal('not_responding'), message: z.string() }),
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

// ---- flex:listStatements ----------------------------------------------------

/**
 * What the local Flex store currently holds (Story #108): every stored statement plus the
 * span they cover. A pure local read with no payload, so — like `snapshot:list` — there is
 * no result variant to discriminate: an empty store is an empty list, which the renderer
 * renders as its own empty state. The schema lives with the domain; re-exported here as
 * the IPC response.
 */
export { flexStatementStoreSchema }
export type FlexStatementStore = z.infer<typeof flexStatementStoreSchema>

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
 *
 * Because the lookups are sequential and can number in the dozens, the refresh also pushes
 * `ClassificationProgress` events main→renderer while it runs (Story #105, DDR-0023). Those
 * are a main→renderer *event*, like `snapshot:captured` — not part of the invoke response.
 */
export { classifyInstrumentsResultSchema }
export type { ClassifyInstrumentsResult, ClassificationProgress }

/**
 * The sidebar's collapsed/expanded state (Story #184).
 *
 * Declared here rather than in `shared/domain/` because it is not a domain result: nothing about
 * a portfolio is being reported. It is shell state, the renderer half of the `app_meta` value
 * `sidebarStateService` keeps — the same relationship the window's own remembered bounds have to
 * `windowStateService`, which likewise has no domain module.
 *
 * The setter echoes the state it stored rather than resolving to `void`, so a caller that wants
 * to know the write landed can await one value instead of inferring it from silence.
 */
export const sidebarStateSchema = z.object({
  /** `true` = the 56px icon rail, `false` = the labelled column. */
  collapsed: z.boolean(),
})
export type SidebarState = z.infer<typeof sidebarStateSchema>

// ---- profile:* (M10, Story #280) --------------------------------------------

/**
 * The owner's investor profile: style tags and target ranges (Story #280, DDR-0094).
 *
 * The read has no result variant, like `snapshot:list` and `flex:listStatements`: it is a pure
 * local read of a setting, and an owner who has never written one gets the *empty profile*
 * rather than an absence to branch on. The write and the clear do have variants, because both
 * can fail in ways the renderer must render — `invalid` above all, which is the Zod parse of
 * this schema failing at the boundary and never reaching storage (ADR-0002, DDR-0022).
 *
 * The request is the **draft** schema, which carries no `updatedAt`: when the profile was last
 * written is the service's fact, not the caller's.
 */
export {
  investorProfileSchema,
  validatedInvestorProfileDraftSchema,
  saveInvestorProfileResultSchema,
  clearInvestorProfileResultSchema,
}
export type {
  InvestorProfile,
  InvestorProfileDraft,
  SaveInvestorProfileResult,
  ClearInvestorProfileResult,
}

/**
 * Balance drift (Story #281, DDR-0095): how far the live portfolio sits from the profile's
 * targets, in a display currency the renderer names.
 *
 * The request carries the display currency for the reason `portfolio:getOverview` does — it is
 * the app's selection, held in the sidebar, and every weight in the report is a share of a total
 * expressed in it. Six result variants, and the two pairs that look alike are deliberately kept
 * apart: `no_profile` / `no_targets` want different copy, and `not_connected` / `not_responding`
 * are DDR-0022's pair, mapped from the same two errors `portfolio:getOverview` maps.
 */
export const balanceDriftRequestSchema = z.object({
  displayCurrency: z.string().min(1),
})
export type BalanceDriftRequest = z.infer<typeof balanceDriftRequestSchema>

export { balanceDriftResultSchema }
export type { BalanceDriftReport, BalanceDriftResult }

// ---- assistant:getStatus (M11, Story #309) ----------------------------------

/**
 * Whether the assistant can run (ADR-0011).
 *
 * A pure local read with no result variant to discriminate — `AssistantStatus` *is* the variant,
 * and after ADR-0011 it names one fact: whether a key is in force. There is no setter beside it any
 * more; `assistant:setConsent` went with the concept it carried, and the status the key channel
 * echoes back is how a caller re-seats on what actually landed.
 *
 * It reports **whether** a key exists and never the key, which is the whole reason the status is a
 * computed shape rather than the environment crossing the bridge.
 */
export { assistantStatusSchema }
export type { AssistantStatus }

// ---- assistant:setApiKey (M10, Story #300; M11, Story #309) -----------------

/**
 * The owner's own OpenAI key, crossing the bridge (DDR-0105).
 *
 * **The one request in this app whose payload is a secret**, and the boundary is shaped around
 * that. It travels in one direction only: the renderer sends a key and is never sent one back, so
 * `MAX_API_KEY_CHARS` is the only thing this schema has to say about it — no format, no prefix, no
 * provider-specific shape, because a key is opaque and `OPENAI_BASE_URL` can point the gateway at
 * a compatible endpoint whose credentials look like something else. What *is* wrong with a paste
 * is `apiKeyService.describeKeyProblem`'s business, and comes back as an `invalid` variant rather
 * than a Zod throw, so the owner is told what to fix.
 *
 * The renderer holds the value only for as long as it takes to type it: the field is cleared on
 * save and nothing repopulates it, which is what makes "never displayed back in full" a property
 * of the wire rather than of the component.
 *
 * **Inbound only, and there is no companion that removes it** (Story #309). The field is shown when
 * there is no working key and not shown once there is one, so `assistant:clearApiKey` and its
 * result shape are gone with the Remove control they served.
 */
export const assistantApiKeyRequestSchema = z.object({
  key: z.string().max(MAX_API_KEY_CHARS),
})
export type AssistantApiKeyRequest = z.infer<typeof assistantApiKeyRequestSchema>

export { saveApiKeyResultSchema }
export type { SaveApiKeyResult }

// ---- assistant:ask (M10, Story #284) ----------------------------------------

/**
 * A question and the grounding it is asked against (DDR-0098).
 *
 * **The context is assembled in the renderer, and that is a decision rather than a convenience.**
 * Every figure the assistant may quote is already on a dashboard, and the criterion this story is
 * held to is that a number in prose and the same number on a dashboard agree to the digit. The
 * renderer is not therefore trusted: the schema below is what bounds *what* may cross.
 *
 * The formatters that put those figures there used to be renderer code, which is what made
 * assembling in main mean a second set of them. They are `@shared/format` now (Story #324,
 * DDR-0111), so both processes reach the same ones — the criterion is *strengthened*, and the
 * renderer keeps assembling this context because DDR-0111 kept it there, not because main could
 * not.
 *
 * `context` is parsed as an arbitrary string map and then **reduced to the declared categories**.
 * An undeclared section is dropped here, at the boundary, rather than being relied on to be absent
 * — the runtime half of the promise `AssistantContext`'s key type makes at compile time. ADR-0011
 * stopped `DISCLOSURE_CATEGORIES` being *rendered*; this bound is the job of it that stayed.
 */

/** The longest question the box accepts. The prompt as a whole is bounded again by the gateway. */
export const MAX_QUESTION_CHARS = 2_000

/**
 * The longest a single context section may be.
 *
 * A ceiling per section rather than one over the whole context: the gateway already holds the
 * total (`MAX_PROMPT_CHARS`), and what this stops is a single runaway section — a thousand-position
 * account's holdings list — consuming the whole budget and silently starving every other section
 * of its place in the prompt.
 */
export const MAX_CONTEXT_SECTION_CHARS = 8_000

export const assistantAskRequestSchema = z.object({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
  context: z
    .record(z.string(), z.string().max(MAX_CONTEXT_SECTION_CHARS))
    .default({})
    .transform((raw): AssistantContext => pickDisclosedSections(raw)),
})
export type AssistantAskRequest = z.input<typeof assistantAskRequestSchema>

export { assistantAskResultSchema }
export type { AssistantAskResult, AssistantContext }

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
  /** The statements currently in the local Flex store, and the period they cover (Story #108). */
  listFlexStatements: () => Promise<FlexStatementStore>
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
  /**
   * Subscribe to per-lookup progress while a classification refresh runs (Story #105).
   * Returns an unsubscribe fn.
   */
  onClassifyProgress: (callback: (progress: ClassificationProgress) => void) => () => void
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
  /** Whether the sidebar was left collapsed to its icon rail, read once on launch (Story #184). */
  getSidebarState: () => Promise<SidebarState>
  /** Remember the sidebar's collapsed state; resolves to what was stored (Story #184). */
  setSidebarState: (state: SidebarState) => Promise<SidebarState>
  /** The owner's investor profile; the empty profile when none has been written (Story #280). */
  getInvestorProfile: () => Promise<InvestorProfile>
  /** Store the investor profile; `invalid` when a range is out of bounds or inverted (Story #280). */
  saveInvestorProfile: (draft: InvestorProfileDraft) => Promise<SaveInvestorProfileResult>
  /** Un-set the investor profile, resolving to the empty profile now in force (Story #280). */
  clearInvestorProfile: () => Promise<ClearInvestorProfileResult>
  /** How far the live portfolio sits from the profile's targets (Story #281). */
  getBalanceDrift: (request: BalanceDriftRequest) => Promise<BalanceDriftResult>
  /** Whether the assistant can run — after ADR-0011, whether there is a key (Story #309). */
  getAssistantStatus: () => Promise<AssistantStatus>
  /**
   * Store the owner's own OpenAI key, so a packaged build can use the assistant (Story #300) — and,
   * since ADR-0011, the single act that authorizes sending.
   *
   * The one call in this app that carries a secret, and it carries it inbound only. Nothing ever
   * returns a key or a fragment of one; the status that comes back says which source is in force.
   * There is no companion that removes it (Story #309).
   */
  setAssistantApiKey: (request: AssistantApiKeyRequest) => Promise<SaveApiKeyResult>
  /**
   * Ask the assistant a question, grounded in context the view assembled (Story #284).
   *
   * The one call in this app that reaches the internet with portfolio figures on it. Its result
   * carries every way the exchange can end, all of them the gateway's own: nothing stands in front
   * of it any more (ADR-0011, DDR-0022, DDR-0096).
   */
  askAssistant: (request: AssistantAskRequest) => Promise<AssistantAskResult>
}
