import { join } from 'node:path'
import { app, BrowserWindow, screen, shell } from 'electron'
import { registerIpcHandlers } from './ipc/handlers'
import { IpcChannels } from '@shared/ipc/channels'
import { runMigrations } from '@db/migrate'
import { metaService } from '@services/meta/metaService'
import { snapshotService } from '@services/snapshots/snapshotService'
import {
  windowStateService,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
} from '@services/window/windowStateService'

const isDev = !app.isPackaged

/**
 * How long the window must sit still before its new geometry is written (Story #110).
 * `resize` / `move` fire continuously while a window is dragged; the owner's intent is the
 * position they stop at, not every pixel on the way there.
 */
const WINDOW_STATE_SAVE_DELAY_MS = 400

/**
 * Create the single application window.
 *
 * Security defaults are locked down from day one (see ADR-0001 / Story #10):
 * the renderer is sandboxed with context isolation on and Node integration off.
 * The typed `contextBridge` IPC surface is introduced in Story #10; for now the
 * preload is a stub.
 */
function createWindow(): void {
  // Remembered size / position / maximized state (Story #110). The service is Electron-free,
  // so the displays attached *now* are handed to it as plain rectangles; it decides whether
  // the stored position is still reachable. `x` / `y` come back undefined when it is not, and
  // Electron then centres the window as it did before anything was remembered.
  const startup = windowStateService.getStartupState(
    screen.getAllDisplays().map((display) => display.workArea),
  )

  const mainWindow = new BrowserWindow({
    x: startup.x,
    y: startup.y,
    width: startup.width,
    height: startup.height,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
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

  // Re-apply a restored rectangle through `setBounds`, which is the exact inverse of the
  // `getNormalBounds()` we persist. The constructor's `width`/`height` are not: Windows adds
  // its invisible resize border to a frameless window, so a size round-tripped through the
  // constructor comes back a couple of pixels taller — and a window that grew every launch
  // would eventually be a window the owner never sized.
  if (startup.x !== undefined && startup.y !== undefined) {
    mainWindow.setBounds({
      x: startup.x,
      y: startup.y,
      width: startup.width,
      height: startup.height,
    })
  }

  // Maximize before the first paint, so the window is never shown at its restored size and
  // then snapped. The title bar seeds its own icon with `window:isMaximized` on mount
  // (DDR-0011), so it paints the restore icon straight away without needing this event.
  if (startup.isMaximized) mainWindow.maximize()

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

  /**
   * Persist the geometry to restore next launch (Story #110).
   *
   * `getNormalBounds()` is deliberate: a maximized window must remember the size it will be
   * restored *to*, not the size of the screen. A minimized window is skipped entirely — it
   * reports neither useful bounds nor (on Windows) its maximized state, so the last known good
   * state is left in place. Persisting must never be what stops the app closing, hence the
   * catch.
   */
  const persistWindowState = (): void => {
    if (mainWindow.isDestroyed() || mainWindow.isMinimized()) return
    try {
      windowStateService.save({
        bounds: mainWindow.getNormalBounds(),
        isMaximized: mainWindow.isMaximized(),
      })
    } catch (err) {
      console.error('[window] failed to persist window state', err)
    }
  }

  let saveTimer: NodeJS.Timeout | undefined
  const scheduleWindowStateSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(persistWindowState, WINDOW_STATE_SAVE_DELAY_MS)
  }

  mainWindow.on('resize', scheduleWindowStateSave)
  mainWindow.on('move', scheduleWindowStateSave)
  mainWindow.on('maximize', () => {
    emitMaximizeState(true)
    scheduleWindowStateSave()
  })
  mainWindow.on('unmaximize', () => {
    emitMaximizeState(false)
    scheduleWindowStateSave()
  })
  // The last word: written synchronously while the window still exists, so a close that lands
  // inside the debounce window is not lost.
  mainWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    persistWindowState()
  })

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

/**
 * Bring the already-running window forward after a second launch was refused (Story #107).
 *
 * The second process has quit by the time this fires, so all that is left is to make the
 * running app visible — from the owner's point of view they asked for the app, and something
 * has to happen. A minimized window cannot take focus, so restore before focusing.
 */
function focusExistingWindow(): void {
  const [existing] = BrowserWindow.getAllWindows()
  if (!existing || existing.isDestroyed()) return
  if (existing.isMinimized()) existing.restore()
  if (!existing.isVisible()) existing.show()
  existing.focus()
}

/** Everything the winning instance does on launch: schema, IPC, window, capture-on-open. */
function startPrimaryInstance(): void {
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
}

// Quit when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/**
 * Single-instance lock (Story #107).
 *
 * The app owns one SQLite file under `app.getPath('userData')`, and every write path —
 * migrations on launch, capture-on-open, Flex import, the destructive clears — assumes it is
 * the only writer. Without this, launching again while the app is already open (easy to do:
 * double-clicking the shortcut while the window sits behind another app) starts a second
 * process against the same file.
 *
 * The lock is requested at module load, before `whenReady`, so the losing process quits
 * without running migrations, capturing a snapshot, or opening the database at all —
 * `getDb()` is lazy, and nothing above this point has called it. The lock is scoped to the
 * user-data directory, so a run with its own `--user-data-dir` (the e2e suite) is unaffected.
 */
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', focusExistingWindow)
  startPrimaryInstance()
} else {
  app.quit()
}
