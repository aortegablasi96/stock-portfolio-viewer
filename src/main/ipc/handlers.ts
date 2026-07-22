import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc/channels'
import {
  pingRequestSchema,
  type CaptureSnapshotResult,
  type FlexImportResult,
  type PortfolioOverviewResult,
  type SnapshotList,
} from '@shared/ipc/contract'
import { systemService } from '@services/system/systemService'
import { portfolioService } from '@services/portfolio/portfolioService'
import { snapshotService } from '@services/snapshots/snapshotService'
import { flexImportService } from '@services/flex/flexImportService'
import { performanceService } from '@services/analytics/performanceService'
import { allocationService } from '@services/analytics/allocationService'
import { realizedGainsService } from '@services/analytics/realizedGainsService'
import { dividendService } from '@services/dividends/dividendService'
import { IbkrNotConnectedError, ValidationError } from '@shared/errors'

/**
 * Register all IPC handlers. Handlers are intentionally *thin*: they validate
 * the untrusted renderer input with Zod and delegate to a service. No business
 * logic lives here (see ADR-0002 / CLAUDE.md Architecture Rules).
 */
export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.ping, (_event, rawInput: unknown) => {
    const request = pingRequestSchema.parse(rawInput)
    return systemService.ping(request)
  })

  // No payload to validate. Connection failures are mapped to a serializable
  // result variant so the renderer can render them as first-class states (ADR-0004).
  ipcMain.handle(IpcChannels.portfolioGetOverview, async (): Promise<PortfolioOverviewResult> => {
    try {
      const overview = await portfolioService.getOverview()
      return { status: 'ok', overview }
    } catch (err) {
      if (err instanceof IbkrNotConnectedError) {
        return { status: 'not_connected', message: err.message }
      }
      const message = err instanceof Error ? err.message : 'Unexpected error reading the portfolio.'
      return { status: 'error', message }
    }
  })

  // Manual "Capture now". No payload. A disconnected gateway is returned as data
  // (not thrown) so the renderer can prompt recovery (DDR-0003).
  ipcMain.handle(IpcChannels.snapshotCapture, async (): Promise<CaptureSnapshotResult> => {
    try {
      const summary = await snapshotService.captureNow()
      return { status: 'captured', summary }
    } catch (err) {
      if (err instanceof IbkrNotConnectedError) {
        return { status: 'not_connected', message: err.message }
      }
      const message = err instanceof Error ? err.message : 'Unexpected error capturing the snapshot.'
      return { status: 'error', message }
    }
  })

  // Snapshot history (local read; independent of the gateway). No payload.
  ipcMain.handle(IpcChannels.snapshotList, (): SnapshotList => snapshotService.getHistory())

  // Import IBKR Flex Query statement files (M3, Story #20). The native file dialog is a
  // main-process concern (the sandboxed renderer cannot open it); the handler stays thin
  // otherwise — parse/persist/de-dupe all live in the service and repository. Outcomes are
  // returned as data (canceled/invalid/error), never thrown across IPC (ADR-0005).
  ipcMain.handle(IpcChannels.flexImport, async (): Promise<FlexImportResult> => {
    const parentWindow = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Import IBKR Flex Query statements',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Flex Query XML', extensions: ['xml'] }],
    }
    const selection = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)

    if (selection.canceled || selection.filePaths.length === 0) {
      return { status: 'canceled' }
    }

    try {
      const summary = flexImportService.import(selection.filePaths)
      return { status: 'imported', summary }
    } catch (err) {
      if (err instanceof ValidationError) {
        return { status: 'invalid', message: err.message }
      }
      const message = err instanceof Error ? err.message : 'Unexpected error importing the statements.'
      return { status: 'error', message }
    }
  })

  // Analytics views (M3, Stories #21–#24). Each is a pure local read over the imported
  // Flex store; the service returns an `ok` / `needs_import` result, so there is no
  // payload to validate and no connection state to map. No business logic here.
  ipcMain.handle(IpcChannels.analyticsPerformance, () => performanceService.getPerformance())
  ipcMain.handle(IpcChannels.analyticsAllocation, () => allocationService.getAllocation())
  ipcMain.handle(IpcChannels.analyticsDividends, () => dividendService.getDividends())
  ipcMain.handle(IpcChannels.analyticsRealizedGains, () => realizedGainsService.getRealizedGains())
}
