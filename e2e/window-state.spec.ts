import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import electronBinary from 'electron'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

// Outside Electron, the `electron` package resolves to the path of its binary.
const electronPath = electronBinary as unknown as string
const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * Window state persistence (Story #110). The behaviour only exists *between* launches, so
 * unlike the rest of the e2e suite these tests start the app more than once against a single
 * user-data directory — the same SQLite file, and therefore the same remembered state.
 */

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

/** A user-data directory of its own, so a run starts with nothing remembered. */
function freshUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'spv-e2e-window-'))
}

async function launch(userDataDir: string): Promise<ElectronApplication> {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainEntry, `--user-data-dir=${userDataDir}`],
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return app
}

const readState = (app: ElectronApplication): Promise<{ bounds: Bounds; isMaximized: boolean }> =>
  app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!
    return { bounds: window.getNormalBounds(), isMaximized: window.isMaximized() }
  })

test('reopens at the size and position it was left at', async () => {
  const userDataDir = freshUserDataDir()
  const wanted: Bounds = { x: 140, y: 90, width: 1040, height: 680 }

  const first = await launch(userDataDir)
  await first.evaluate(({ BrowserWindow }, bounds) => {
    BrowserWindow.getAllWindows()[0]!.setBounds(bounds)
  }, wanted)
  // Closing persists synchronously, ahead of the debounce that a live resize would use.
  await first.close()

  const second = await launch(userDataDir)
  const restored = await readState(second)
  await second.close()

  // Windows adjusts a frameless window's bounds by a few pixels for its invisible resize
  // border, so the restored geometry is asserted as near-identical rather than identical.
  expect(restored.isMaximized).toBe(false)
  for (const edge of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(restored.bounds[edge] - wanted[edge])).toBeLessThanOrEqual(10)
  }

  // And it must *settle*: the same few pixels re-applied on every launch would grow the
  // window a little each time the app opened.
  const third = await launch(userDataDir)
  const again = await readState(third)
  await third.close()
  expect(again.bounds).toEqual(restored.bounds)
})

test('reopens maximized, with the title bar showing restore', async () => {
  const userDataDir = freshUserDataDir()

  const first = await launch(userDataDir)
  await first.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.maximize())
  await first.close()

  const second = await launch(userDataDir)
  const page = await second.firstWindow()
  const restored = await readState(second)
  // The icon is seeded from the real window state on mount, so it is correct on first paint
  // without waiting for a maximize event (DDR-0011).
  await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible()
  await second.close()

  expect(restored.isMaximized).toBe(true)
})

test('uses the default size on a first launch with nothing remembered', async () => {
  const app = await launch(freshUserDataDir())
  const { bounds, isMaximized } = await readState(app)
  await app.close()

  expect({ width: bounds.width, height: bounds.height }).toEqual({ width: 1280, height: 800 })
  expect(isMaximized).toBe(false)
})
