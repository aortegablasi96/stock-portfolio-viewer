import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc/channels'
import type {
  CaptureSnapshotResult,
  FlexImportResult,
  PingRequest,
  PingResponse,
  PortfolioOverviewResult,
  RendererApi,
  SnapshotList,
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
  getPortfolioOverview: (): Promise<PortfolioOverviewResult> =>
    ipcRenderer.invoke(IpcChannels.portfolioGetOverview),
  captureSnapshot: (): Promise<CaptureSnapshotResult> =>
    ipcRenderer.invoke(IpcChannels.snapshotCapture),
  listSnapshots: (): Promise<SnapshotList> => ipcRenderer.invoke(IpcChannels.snapshotList),
  onSnapshotCaptured: (callback: () => void): (() => void) => {
    // Wrap so the raw IpcRendererEvent is never handed to the renderer callback.
    const listener = (): void => callback()
    ipcRenderer.on(IpcChannels.snapshotCaptured, listener)
    return () => ipcRenderer.removeListener(IpcChannels.snapshotCaptured, listener)
  },
  importFlexStatements: (): Promise<FlexImportResult> =>
    ipcRenderer.invoke(IpcChannels.flexImport),
}

contextBridge.exposeInMainWorld('api', api)
