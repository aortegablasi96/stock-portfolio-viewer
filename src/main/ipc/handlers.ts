import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { ZodError } from 'zod'
import { IpcChannels } from '@shared/ipc/channels'
import {
  balanceDriftRequestSchema,
  pingRequestSchema,
  portfolioOverviewRequestSchema,
  sidebarStateSchema,
  snapshotListRequestSchema,
  validatedInvestorProfileDraftSchema,
  type BalanceDriftResult,
  type CaptureSnapshotResult,
  type ClearHistoryResult,
  type ClearInvestorProfileResult,
  type ClearStatementsResult,
  type FlexImportResult,
  type FlexStatementStore,
  type InvestorProfile,
  type PortfolioOverviewResult,
  type SaveInvestorProfileResult,
  type SidebarState,
  type SnapshotList,
} from '@shared/ipc/contract'
import { systemService } from '@services/system/systemService'
import { portfolioService } from '@services/portfolio/portfolioService'
import { snapshotService } from '@services/snapshots/snapshotService'
import { flexImportService } from '@services/flex/flexImportService'
import { flexStatementsService } from '@services/flex/flexStatementsService'
import { performanceService } from '@services/analytics/performanceService'
import { allocationService } from '@services/analytics/allocationService'
import { realizedGainsService } from '@services/analytics/realizedGainsService'
import { dividendService } from '@services/dividends/dividendService'
import { classificationService } from '@services/classification/classificationService'
import { sidebarStateService } from '@services/window/sidebarStateService'
import { investorProfileService } from '@services/profile/investorProfileService'
import { balanceDriftService } from '@services/profile/balanceDriftService'
import { IbkrNotConnectedError, IbkrTimeoutError, ValidationError } from '@shared/errors'

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

  // Validates the optional display currency (Story #28); connection failures are mapped to
  // a serializable result variant so the renderer renders them as first-class states (ADR-0004).
  // A stalled gateway is its own variant, distinct from one that isn't running (Story #104).
  ipcMain.handle(
    IpcChannels.portfolioGetOverview,
    async (_event, rawInput: unknown): Promise<PortfolioOverviewResult> => {
      try {
        const { displayCurrency } = portfolioOverviewRequestSchema.parse(rawInput ?? {})
        const overview = await portfolioService.getOverview(displayCurrency)
        return { status: 'ok', overview }
      } catch (err) {
        if (err instanceof IbkrTimeoutError) {
          return { status: 'not_responding', message: err.message }
        }
        if (err instanceof IbkrNotConnectedError) {
          return { status: 'not_connected', message: err.message }
        }
        const message =
          err instanceof Error ? err.message : 'Unexpected error reading the portfolio.'
        return { status: 'error', message }
      }
    },
  )

  // Manual "Capture now". No payload. A disconnected gateway is returned as data
  // (not thrown) so the renderer can prompt recovery (DDR-0003).
  ipcMain.handle(IpcChannels.snapshotCapture, async (): Promise<CaptureSnapshotResult> => {
    try {
      const summary = await snapshotService.captureNow()
      return { status: 'captured', summary }
    } catch (err) {
      if (err instanceof IbkrTimeoutError) {
        return { status: 'not_responding', message: err.message }
      }
      if (err instanceof IbkrNotConnectedError) {
        return { status: 'not_connected', message: err.message }
      }
      const message = err instanceof Error ? err.message : 'Unexpected error capturing the snapshot.'
      return { status: 'error', message }
    }
  })

  // Snapshot history (local read). The optional display currency is validated like any
  // renderer payload; conversion uses live gateway FX in the service (Bug #44, DDR-0007),
  // degrading gracefully so history stays visible when the gateway is disconnected.
  ipcMain.handle(
    IpcChannels.snapshotList,
    (_event, rawInput: unknown): Promise<SnapshotList> => {
      const { displayCurrency } = snapshotListRequestSchema.parse(rawInput ?? {})
      return snapshotService.getHistory(displayCurrency)
    },
  )

  // Owner-confirmed full reset of the snapshot history (Story #43). No payload; a destructive
  // but local operation, so failures surface as an `error` result variant, never thrown.
  ipcMain.handle(IpcChannels.snapshotClear, (): ClearHistoryResult => {
    try {
      const { removedSnapshots } = snapshotService.clearHistory()
      return { status: 'cleared', removedSnapshots }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error clearing the history.'
      return { status: 'error', message }
    }
  })

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

  // What the local Flex store holds (Story #108). A pure local read with no payload and no
  // connection state, so there is nothing to validate or map — the same shape as the
  // analytics reads, minus the needs-import variant (an empty store is an empty list).
  ipcMain.handle(
    IpcChannels.flexListStatements,
    (): FlexStatementStore => flexStatementsService.listStatements(),
  )

  // Owner-confirmed full reset of the imported Flex store (Story #43). No payload; local and
  // destructive, so failures surface as an `error` result variant, never thrown.
  ipcMain.handle(IpcChannels.flexClear, (): ClearStatementsResult => {
    try {
      const { removedStatements } = flexImportService.clearStatements()
      return { status: 'cleared', removedStatements }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error clearing the statements.'
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

  // Story #30: the one analytics channel that talks to IBKR. The service already returns
  // not_connected / error as data, so there is nothing to map here. The progress callback is
  // the handler's only real job (Story #105): the service owns the loop but must not import
  // Electron, so *sending* each tick is a main-process concern. The sender can be gone by
  // then — the owner may have closed the window mid-refresh — hence the destroyed check.
  ipcMain.handle(IpcChannels.analyticsClassifyInstruments, (event) =>
    classificationService.refreshClassifications((progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(IpcChannels.analyticsClassifyProgress, progress)
      }
    }),
  )

  // Custom frameless title-bar controls (Story #42). These carry no untrusted payload, so
  // there is nothing to Zod-validate; each command resolves its own window from the calling
  // webContents rather than closing over a shared reference. No business logic — pure window
  // chrome, kept in the main process because the sandboxed renderer cannot touch BrowserWindow.
  ipcMain.on(IpcChannels.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on(IpcChannels.windowToggleMaximize, (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })
  ipcMain.on(IpcChannels.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle(
    IpcChannels.windowIsMaximized,
    (event): boolean => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false,
  )

  // The sidebar's remembered width (Story #184). Persisted the way the window's own bounds are
  // — one overwritten `app_meta` value, no new table (DDR-0028).
  ipcMain.handle(IpcChannels.windowGetSidebarState, (): SidebarState => sidebarStateService.get())
  ipcMain.handle(IpcChannels.windowSetSidebarState, (_event, rawInput: unknown): SidebarState => {
    const state = sidebarStateSchema.parse(rawInput)
    sidebarStateService.set(state)
    return state
  })

  // The owner's investor profile (M10, Story #280). A pure local read of a setting, so — like
  // `snapshot:list` — there is no variant to discriminate and no payload to validate; an owner
  // who has never written one gets the empty profile.
  ipcMain.handle(IpcChannels.profileGet, (): InvestorProfile => investorProfileService.get())

  // The one channel in the app whose payload is a whole document rather than a flag or a code,
  // and therefore the one where Zod at the ingress does real work: an inverted or out-of-bounds
  // range is rejected **here** and never reaches storage (ADR-0002). A parse failure is
  // `invalid`, not `error` — the owner mistyped a number, which is a correctable statement about
  // the form rather than a failure of the app (DDR-0022).
  ipcMain.handle(IpcChannels.profileSave, (_event, rawInput: unknown): SaveInvestorProfileResult => {
    const parsed = validatedInvestorProfileDraftSchema.safeParse(rawInput)
    if (!parsed.success) {
      return { status: 'invalid', message: firstIssueMessage(parsed.error) }
    }
    try {
      return { status: 'saved', profile: investorProfileService.save(parsed.data) }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error saving the profile.'
      return { status: 'error', message }
    }
  })

  // Un-setting the profile. Local and reversible-by-retyping, so failures surface as an `error`
  // result variant, never thrown. This is not ADR-0006's sanctioned reset — no history is
  // deleted, because a profile is a setting rather than history (DDR-0094).
  ipcMain.handle(IpcChannels.profileClear, (): ClearInvestorProfileResult => {
    try {
      return { status: 'cleared', profile: investorProfileService.clear() }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error clearing the profile.'
      return { status: 'error', message }
    }
  })

  // Balance drift (M10, Story #281). It reads the **live** portfolio, so it maps the gateway's
  // two failures exactly as `portfolio:getOverview` does — and for the same reason they are not
  // interchangeable: one means start the gateway, the other means it is running but stalled
  // (DDR-0022). Everything the service can determine for itself — no profile, no targets, nothing
  // to weigh — arrives as its own variant and passes straight through.
  ipcMain.handle(
    IpcChannels.profileGetDrift,
    async (_event, rawInput: unknown): Promise<BalanceDriftResult> => {
      try {
        const { displayCurrency } = balanceDriftRequestSchema.parse(rawInput)
        return await balanceDriftService.getBalanceDrift(displayCurrency)
      } catch (err) {
        if (err instanceof IbkrTimeoutError) {
          return { status: 'not_responding', message: err.message }
        }
        if (err instanceof IbkrNotConnectedError) {
          return { status: 'not_connected', message: err.message }
        }
        const message = err instanceof Error ? err.message : 'Unexpected error measuring drift.'
        return { status: 'error', message }
      }
    },
  )
}

/**
 * The first thing wrong with a rejected profile, as a sentence the form can show.
 *
 * One issue rather than all of them: the form validates every row as it is typed and disables its
 * own Save, so a payload reaching here with several faults means something bypassed the form
 * entirely, and a list of Zod paths would be no more useful to the owner than the first line.
 * The domain's own refinements already write their messages in the owner's vocabulary
 * ("Currency USD is listed twice"), so those pass straight through.
 */
function firstIssueMessage(error: ZodError): string {
  return error.issues[0]?.message ?? 'That profile could not be stored.'
}
