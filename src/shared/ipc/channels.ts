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
  // Owner-confirmed full reset of the captured snapshot history (Story #43).
  snapshotClear: 'snapshot:clear',
  flexImport: 'flex:import',
  // Owner-confirmed full reset of the imported Flex statement store (Story #43).
  flexClear: 'flex:clear',
  analyticsPerformance: 'analytics:getPerformance',
  analyticsAllocation: 'analytics:getAllocation',
  analyticsDividends: 'analytics:getDividends',
  analyticsRealizedGains: 'analytics:getRealizedGains',
  analyticsClassifyInstruments: 'analytics:classifyInstruments',
  // Main → renderer event: a snapshot was captured (e.g. on-open capture completed),
  // so the renderer should refresh its history. Carries no payload.
  snapshotCaptured: 'snapshot:captured',
  // Custom window-frame controls (Story #42). The app runs frameless, so the in-app
  // title bar drives min/maximize/close over IPC. These are fire-and-forget commands
  // (renderer → main, no payload) plus one query and one event for maximize state.
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggleMaximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:isMaximized',
  // Main → renderer event: the window's maximized state changed (from a control, an OS
  // double-click, or window snapping), so the title bar can swap its maximize/restore
  // icon. Carries a single boolean payload.
  windowMaximizeChanged: 'window:maximizeChanged',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
