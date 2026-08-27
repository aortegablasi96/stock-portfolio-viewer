import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc/channels'
import type {
  AllocationResult,
  BalanceDriftRequest,
  BalanceDriftResult,
  CaptureSnapshotResult,
  ClassificationProgress,
  ClassifyInstrumentsResult,
  ClearHistoryResult,
  ClearInvestorProfileResult,
  ClearStatementsResult,
  DividendResult,
  FlexImportResult,
  FlexStatementStore,
  InvestorProfile,
  InvestorProfileDraft,
  PerformanceResult,
  PingRequest,
  PingResponse,
  PortfolioOverviewRequest,
  PortfolioOverviewResult,
  RealizedGainsResult,
  RendererApi,
  SaveInvestorProfileResult,
  SidebarState,
  SnapshotList,
  SnapshotListRequest,
} from '@shared/ipc/contract'

/**
 * The typed IPC bridge. This is the *only* surface the renderer can use to reach
 * the main process — context isolation is on and Node integration is off, so the
 * renderer can never touch Electron, Node, services, or repositories directly.
 *
 * Only channel-name constants and (erased) types are imported here, so Zod and
 * service code stay out of the sandboxed preload bundle.
 */
const api: RendererApi = {
  ping: (request: PingRequest): Promise<PingResponse> =>
    ipcRenderer.invoke(IpcChannels.ping, request),
  getPortfolioOverview: (request?: PortfolioOverviewRequest): Promise<PortfolioOverviewResult> =>
    ipcRenderer.invoke(IpcChannels.portfolioGetOverview, request),
  captureSnapshot: (): Promise<CaptureSnapshotResult> =>
    ipcRenderer.invoke(IpcChannels.snapshotCapture),
  listSnapshots: (request?: SnapshotListRequest): Promise<SnapshotList> =>
    ipcRenderer.invoke(IpcChannels.snapshotList, request),
  onSnapshotCaptured: (callback: () => void): (() => void) => {
    // Wrap so the raw IpcRendererEvent is never handed to the renderer callback.
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.snapshotCaptured, listener)
    return () => ipcRenderer.removeListener(IpcChannels.snapshotCaptured, listener)
  },
  importFlexStatements: (): Promise<FlexImportResult> =>
    ipcRenderer.invoke(IpcChannels.flexImport),
  listFlexStatements: (): Promise<FlexStatementStore> =>
    ipcRenderer.invoke(IpcChannels.flexListStatements),
  clearStatements: (): Promise<ClearStatementsResult> =>
    ipcRenderer.invoke(IpcChannels.flexClear),
  clearHistory: (): Promise<ClearHistoryResult> => ipcRenderer.invoke(IpcChannels.snapshotClear),
  getPerformance: (): Promise<PerformanceResult> =>
    ipcRenderer.invoke(IpcChannels.analyticsPerformance),
  getAllocation: (): Promise<AllocationResult> =>
    ipcRenderer.invoke(IpcChannels.analyticsAllocation),
  getDividends: (): Promise<DividendResult> => ipcRenderer.invoke(IpcChannels.analyticsDividends),
  getRealizedGains: (): Promise<RealizedGainsResult> =>
    ipcRenderer.invoke(IpcChannels.analyticsRealizedGains),
  classifyInstruments: (): Promise<ClassifyInstrumentsResult> =>
    ipcRenderer.invoke(IpcChannels.analyticsClassifyInstruments),
  onClassifyProgress: (callback: (progress: ClassificationProgress) => void): (() => void) => {
    // Wrap so the raw IpcRendererEvent is never handed to the renderer callback.
    const listener = (_event: unknown, progress: ClassificationProgress): void => callback(progress)
    ipcRenderer.on(IpcChannels.analyticsClassifyProgress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.analyticsClassifyProgress, listener)
  },
  // Window controls for the custom frameless title bar (Story #42). The commands are
  // fire-and-forget (send, not invoke); the query and event report maximize state.
  minimizeWindow: (): void => ipcRenderer.send(IpcChannels.windowMinimize),
  toggleMaximizeWindow: (): void => ipcRenderer.send(IpcChannels.windowToggleMaximize),
  closeWindow: (): void => ipcRenderer.send(IpcChannels.windowClose),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke(IpcChannels.windowIsMaximized),
  onWindowMaximizeChanged: (callback: (isMaximized: boolean) => void): (() => void) => {
    // Wrap so the raw IpcRendererEvent is never handed to the renderer callback.
    const listener = (_event: unknown, isMaximized: boolean): void => callback(isMaximized)
    ipcRenderer.on(IpcChannels.windowMaximizeChanged, listener)
    return () => ipcRenderer.removeListener(IpcChannels.windowMaximizeChanged, listener)
  },
  // The sidebar's remembered width (Story #184). A payload to validate, so unlike the three
  // window commands above these are `invoke` rather than `send`.
  getSidebarState: (): Promise<SidebarState> =>
    ipcRenderer.invoke(IpcChannels.windowGetSidebarState),
  setSidebarState: (state: SidebarState): Promise<SidebarState> =>
    ipcRenderer.invoke(IpcChannels.windowSetSidebarState, state),
  // The owner's investor profile (Story #280). A read with no variant to discriminate, and two
  // writes whose outcomes cross as data — `invalid` for a range the boundary rejected.
  getInvestorProfile: (): Promise<InvestorProfile> => ipcRenderer.invoke(IpcChannels.profileGet),
  saveInvestorProfile: (draft: InvestorProfileDraft): Promise<SaveInvestorProfileResult> =>
    ipcRenderer.invoke(IpcChannels.profileSave, draft),
  clearInvestorProfile: (): Promise<ClearInvestorProfileResult> =>
    ipcRenderer.invoke(IpcChannels.profileClear),
  // Balance drift (Story #281). Carries the display currency, because every weight in the report
  // is a share of a total expressed in it.
  getBalanceDrift: (request: BalanceDriftRequest): Promise<BalanceDriftResult> =>
    ipcRenderer.invoke(IpcChannels.profileGetDrift, request),
}

contextBridge.exposeInMainWorld('api', api)
