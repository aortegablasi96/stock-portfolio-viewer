import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'
import { IpcChannels } from '@shared/ipc/channels'
import { runMigrations } from '@db/migrate'
import { metaService } from '@services/meta/metaService'
import { snapshotService } from '@services/snapshots/snapshotService'

const isDev = !app.isPackaged

/**
 * Create the single application window.
 *
 * Security defaults are locked down from day one (see ADR-0001 / Story #10):
 * the renderer is sandboxed with context isolation on and Node integration off.
 * The typed `contextBridge` IPC surface is introduced in Story #10; for now the
 * preload is a stub.
 */
function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 940,
    minHeight: 600,
    show: false,
    // Frameless: the OS title bar is removed and replaced by the in-app custom title bar
    // (Story #42). Window controls are driven over IPC — the security posture below is
    // unchanged. The renderer marks its own drag/no-drag regions via `-webkit-app-region`.
    frame: false,
    backgroundColor: '#0f1115',
    title: 'Stock Portfolio Viewer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Keep the title bar's maximize/restore icon in sync with the real window state, including
  // OS-driven changes (double-clicking the drag region, window snapping). See Story #42.
  const emitMaximizeState = (isMaximized: boolean): void => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannels.windowMaximizeChanged, isMaximized)
    }
  }
  mainWindow.on('maximize', () => emitMaximizeState(true))
  mainWindow.on('unmaximize', () => emitMaximizeState(false))

  // Open target="_blank" / external links in the OS browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // electron-vite exposes the dev server URL via this env var during `dev`.
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // Bring the local schema up to date before anything reads the database.
  runMigrations()
  // Exercise the service -> repository -> SQLite slice on every launch.
  console.log(`[app] install id ${metaService.getInstallId()}`)
  registerIpcHandlers()
  createWindow()

  // Capture a portfolio snapshot on open (de-duplicated within 12h; skipped
  // silently when the gateway isn't connected). Fire-and-forget so it never
  // blocks the window (DDR-0003). When a snapshot is written, signal the renderer
  // to refresh its history (the network fetch resolves after the renderer has
  // mounted and subscribed).
  void snapshotService
    .captureOnOpen()
    .then((result) => {
      console.log(`[snapshot] capture-on-open: ${result.status}`)
      if (result.status === 'captured') {
        for (const window of BrowserWindow.getAllWindows()) {
          if (!window.isDestroyed()) window.webContents.send(IpcChannels.snapshotCaptured)
        }
      }
    })
    .catch((err) => console.error('[snapshot] capture-on-open failed', err))

  // macOS: re-create a window when the dock icon is clicked and none are open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
