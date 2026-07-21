/**
 * IPC channel names shared between the main process (handlers) and the preload
 * bridge. This module is dependency-free so it can be safely bundled into the
 * sandboxed preload without pulling in Zod or any service code.
 */
export const IpcChannels = {
  ping: 'app:ping',
  portfolioGetOverview: 'portfolio:getOverview',
  snapshotCapture: 'snapshot:capture',
  snapshotList: 'snapshot:list',
  flexImport: 'flex:import',
  // Main → renderer event: a snapshot was captured (e.g. on-open capture completed),
  // so the renderer should refresh its history. Carries no payload.
  snapshotCaptured: 'snapshot:captured',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
