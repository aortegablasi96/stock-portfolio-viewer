import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc/channels'
import { pingRequestSchema } from '@shared/ipc/contract'
import { systemService } from '@services/system/systemService'

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
}
