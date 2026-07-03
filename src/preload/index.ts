import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels } from '@shared/ipc/channels'
import type { PingRequest, PingResponse, RendererApi } from '@shared/ipc/contract'

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
}

contextBridge.exposeInMainWorld('api', api)
