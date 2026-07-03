import type { PingRequest, PingResponse } from '@shared/ipc/contract'

/**
 * System service — trivial business logic that proves the layering works
 * (renderer → IPC handler → service → back). Real domain services (portfolio,
 * holdings, snapshots, …) arrive in later milestones and follow this shape:
 * pure logic, independent of Electron/IPC and of where data comes from.
 */
export const systemService = {
  ping(request: PingRequest): PingResponse {
    return {
      reply: 'pong',
      echo: request.message,
      at: new Date().toISOString(),
    }
  },
}
