import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc/channels'
import { pingRequestSchema, type PortfolioOverviewResult } from '@shared/ipc/contract'
import { systemService } from '@services/system/systemService'
import { portfolioService } from '@services/portfolio/portfolioService'
import { IbkrNotConnectedError } from '@shared/errors'

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
}
