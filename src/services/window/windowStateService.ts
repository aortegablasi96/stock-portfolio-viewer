import { z } from 'zod'
import { metaRepository } from '@repositories/meta/metaRepository'

/**
 * Window size / position / maximized state, remembered across launches (Story #110).
 *
 * The shell is frameless with in-app controls (DDR-0011), so the OS restores nothing for us —
 * window state is entirely app code. It is lightweight application metadata, not history, so
 * it lives as a single JSON value in the existing `app_meta` key/value table rather than in a
 * table of its own; the service reaches it only through `metaRepository` (ADR-0003).
 *
 * This module must stay free of `electron` (ESLint-enforced): the display geometry needed to
 * decide whether stored bounds are still reachable is passed **in** as plain rectangles by the
 * main process, which keeps the recovery maths pure and unit-testable.
 */

/** Key under which the JSON blob is stored in `app_meta`. */
const WINDOW_STATE_KEY = 'window_state'

/** First-launch size — the values the window used before anything was remembered. */
export const WINDOW_DEFAULT_WIDTH = 1280
export const WINDOW_DEFAULT_HEIGHT = 800

/** Floor for a restored window; mirrors the `BrowserWindow` minimum. */
export const WINDOW_MIN_WIDTH = 940
export const WINDOW_MIN_HEIGHT = 600

/**
 * Reachability is judged on the window's title bar, not its whole area: the shell is
 * frameless, so the 40px bar is the only thing the owner can grab (DDR-0011). A window whose
 * body covers a display but whose bar sits above its top edge cannot be moved — which is why a
 * plain area overlap is not the test. The bar must be **wholly** on a display vertically, and
 * at least a grabbable span of it horizontally.
 */
const TITLE_BAR_HEIGHT = 40
const MIN_GRABBABLE_WIDTH = 120

/** A screen-coordinate rectangle: stored window bounds, or a display's work area. */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/** What is persisted. Bounds are always the *restored* (un-maximized) ones. */
export interface WindowState {
  bounds: WindowBounds
  isMaximized: boolean
}

/**
 * What `createWindow()` needs. `x` / `y` are absent when no usable stored position exists,
 * which is how Electron is told to centre the window on the primary display.
 */
export interface WindowStartupState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized: boolean
}

/**
 * Stored state is parsed, never trusted: the value is a hand-editable row in a local database
 * and can also predate a change to this shape. Anything that fails to parse is treated as
 * absent, so a corrupt value costs the owner their layout, not their launch.
 */
const storedWindowStateSchema = z.object({
  bounds: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  }),
  isMaximized: z.boolean(),
})

export const windowStateService = {
  /** Resolve the size, position and maximized state to open with. */
  getStartupState(workAreas: WindowBounds[]): WindowStartupState {
    const stored = readStoredState()
    if (!stored) {
      return {
        width: WINDOW_DEFAULT_WIDTH,
        height: WINDOW_DEFAULT_HEIGHT,
        isMaximized: false,
      }
    }
    return { ...resolveBounds(stored.bounds, workAreas), isMaximized: stored.isMaximized }
  },

  /** Remember the current state. Callers pass the *restored* bounds, not the maximized ones. */
  save(state: WindowState): void {
    metaRepository.set(WINDOW_STATE_KEY, JSON.stringify(state))
  },
}

function readStoredState(): WindowState | undefined {
  const raw = metaRepository.get(WINDOW_STATE_KEY)
  if (!raw) return undefined

  try {
    const parsed = storedWindowStateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    // Not JSON at all.
    return undefined
  }
}

/**
 * Fit stored bounds to the displays actually attached now.
 *
 * A window saved on a monitor that has since been unplugged — or on a desktop since rearranged
 * or shrunk — would otherwise reopen somewhere the owner cannot reach it. The rule is
 * deliberately conservative about *moving* the window: a position the owner chose is kept
 * whenever its title bar is still grabbable, including one deliberately straddling two
 * displays. The position is only overridden when the window cannot be reached at all (centred
 * by Electron instead), or when it had to be shrunk to fit the display it reopens on — a
 * window we resized should land wholly inside that display rather than half off it.
 */
export function resolveBounds(
  bounds: WindowBounds,
  workAreas: WindowBounds[],
): Omit<WindowStartupState, 'isMaximized'> {
  const width = Math.max(WINDOW_MIN_WIDTH, Math.round(bounds.width))
  const height = Math.max(WINDOW_MIN_HEIGHT, Math.round(bounds.height))
  const x = Math.round(bounds.x)
  const y = Math.round(bounds.y)
  const titleBar = { x, y, width, height: TITLE_BAR_HEIGHT }

  const target = workAreas
    .map((area) => ({ area, grabbable: intersection(titleBar, area) }))
    .filter(
      (c) => c.grabbable.width >= MIN_GRABBABLE_WIDTH && c.grabbable.height >= TITLE_BAR_HEIGHT,
    )
    .sort((a, b) => b.grabbable.width - a.grabbable.width)[0]

  // Unreachable (display gone, or no displays reported): keep the size, drop the position and
  // let Electron centre the window on the primary display.
  if (!target) return { width, height }

  // A display can be smaller than the window that was saved on it. Shrink to fit, but never
  // below the window's own minimum — an undersized window is preferable to an unusable one.
  const fittedWidth = Math.max(WINDOW_MIN_WIDTH, Math.min(width, target.area.width))
  const fittedHeight = Math.max(WINDOW_MIN_HEIGHT, Math.min(height, target.area.height))
  if (fittedWidth === width && fittedHeight === height) return { width, height, x, y }

  return {
    width: fittedWidth,
    height: fittedHeight,
    x: clamp(x, target.area.x, target.area.x + target.area.width - fittedWidth),
    y: clamp(y, target.area.y, target.area.y + target.area.height - fittedHeight),
  }
}

/** Overlapping width/height of two rectangles; zeroed when they do not overlap. */
function intersection(a: WindowBounds, b: WindowBounds): { width: number; height: number } {
  return {
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  }
}

/** Clamp, resolving an inverted range (a window wider than its display) to the lower bound. */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}
