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
  // What the local Flex store currently holds, read on launch rather than after an
  // import (Story #108).
  flexListStatements: 'flex:listStatements',
  // Owner-confirmed full reset of the imported Flex statement store (Story #43).
  flexClear: 'flex:clear',
  analyticsPerformance: 'analytics:getPerformance',
  analyticsAllocation: 'analytics:getAllocation',
  analyticsDividends: 'analytics:getDividends',
  analyticsRealizedGains: 'analytics:getRealizedGains',
  analyticsClassifyInstruments: 'analytics:classifyInstruments',
  // Main → renderer event: one sequential classification lookup finished, so the renderer can
  // show "n of m" while a refresh runs (Story #105). Carries `{ completed, total }`.
  analyticsClassifyProgress: 'analytics:classifyProgress',
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
  // Whether the sidebar is collapsed to its icon rail, remembered across launches (Story
  // #184). Under the `window:` prefix because with no OS frame the app owns its own chrome
  // (DDR-0011), and the rail's width is the same class of remembered shell fact as the
  // window's own bounds (DDR-0028). A payload to validate, so these are `invoke` channels
  // rather than the payload-free commands above.
  windowGetSidebarState: 'window:getSidebarState',
  windowSetSidebarState: 'window:setSidebarState',
  // The owner's investor profile — style tags and target ranges (M10, Story #280). Its own
  // prefix rather than `window:` because it is not shell state: it is the one thing in the
  // database the app cannot reconstruct from any source, since its source is the owner. Kept in
  // a single overwritten `app_meta` value all the same (DDR-0094, extending DDR-0028).
  profileGet: 'profile:get',
  profileSave: 'profile:save',
  profileClear: 'profile:clear',
  // How far the live portfolio sits from the profile's targets (M10, Story #281). Under the
  // `profile:` prefix rather than `analytics:` because it measures against the owner's own
  // standard rather than reporting the portfolio, and because it reads **live** holdings where
  // every `analytics:*` channel reads the imported Flex store (DDR-0095).
  profileGetDrift: 'profile:getDrift',
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]
