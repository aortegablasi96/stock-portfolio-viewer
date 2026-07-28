import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  resolveBounds,
  windowStateService,
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  type WindowBounds,
} from './windowStateService'
import { metaRepository } from '@repositories/meta/metaRepository'

// Mock the repository so the service is tested in isolation (no database).
vi.mock('@repositories/meta/metaRepository', () => ({
  metaRepository: {
    get: vi.fn(),
    set: vi.fn(),
  },
}))

const mockRepo = vi.mocked(metaRepository)

/** A single 1920x1080 display with a taskbar-shortened work area. */
const primary: WindowBounds = { x: 0, y: 0, width: 1920, height: 1040 }
/** A second display to the left, as Windows reports one: negative x. */
const secondary: WindowBounds = { x: -1920, y: 0, width: 1920, height: 1040 }

describe('windowStateService.getStartupState', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to the default size, centred, on first launch', () => {
    mockRepo.get.mockReturnValue(undefined)

    const state = windowStateService.getStartupState([primary])

    expect(state).toEqual({
      width: WINDOW_DEFAULT_WIDTH,
      height: WINDOW_DEFAULT_HEIGHT,
      isMaximized: false,
    })
    expect(state.x).toBeUndefined()
    expect(state.y).toBeUndefined()
  })

  it('restores stored bounds and the maximized flag', () => {
    mockRepo.get.mockReturnValue(
      JSON.stringify({ bounds: { x: 240, y: 120, width: 1500, height: 900 }, isMaximized: true }),
    )

    expect(windowStateService.getStartupState([primary])).toEqual({
      x: 240,
      y: 120,
      width: 1500,
      height: 900,
      isMaximized: true,
    })
  })

  it('treats an unparseable stored value as absent rather than failing the launch', () => {
    mockRepo.get.mockReturnValue('not json')

    expect(windowStateService.getStartupState([primary])).toEqual({
      width: WINDOW_DEFAULT_WIDTH,
      height: WINDOW_DEFAULT_HEIGHT,
      isMaximized: false,
    })
  })

  it('treats stored JSON of the wrong shape as absent', () => {
    mockRepo.get.mockReturnValue(JSON.stringify({ bounds: { x: 0, y: 0 }, isMaximized: 'yes' }))

    expect(windowStateService.getStartupState([primary])).toEqual({
      width: WINDOW_DEFAULT_WIDTH,
      height: WINDOW_DEFAULT_HEIGHT,
      isMaximized: false,
    })
  })
})

describe('windowStateService.save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists the state as JSON under a single app_meta key', () => {
    const state = { bounds: { x: 10, y: 20, width: 1300, height: 820 }, isMaximized: false }

    windowStateService.save(state)

    expect(mockRepo.set).toHaveBeenCalledWith('window_state', JSON.stringify(state))
  })
})

describe('resolveBounds', () => {
  it('keeps bounds that sit fully on a display', () => {
    expect(resolveBounds({ x: 100, y: 50, width: 1400, height: 900 }, [primary])).toEqual({
      x: 100,
      y: 50,
      width: 1400,
      height: 900,
    })
  })

  it('keeps bounds on a secondary display at negative coordinates', () => {
    expect(resolveBounds({ x: -1800, y: 60, width: 1400, height: 900 }, [primary, secondary])).toEqual(
      { x: -1800, y: 60, width: 1400, height: 900 },
    )
  })

  it('drops the position when the display it was saved on is gone', () => {
    // Saved on the secondary display, which is no longer attached.
    expect(resolveBounds({ x: -1800, y: 60, width: 1400, height: 900 }, [primary])).toEqual({
      width: 1400,
      height: 900,
    })
  })

  it('drops the position when too little of the title bar would be grabbable', () => {
    // Only a 30px-wide sliver would land on the display.
    expect(resolveBounds({ x: 1890, y: 100, width: 1400, height: 900 }, [primary])).toEqual({
      width: 1400,
      height: 900,
    })
  })

  it('drops the position when the title bar sits above the top of every display', () => {
    // The body covers most of the display, but the draggable strip is partly off the top —
    // the window could never be moved back.
    expect(resolveBounds({ x: 200, y: -30, width: 1400, height: 900 }, [primary])).toEqual({
      width: 1400,
      height: 900,
    })
  })

  it('leaves a partly-overhanging window where the owner put it', () => {
    // Runs off the right and bottom edges, but the title bar is still grabbable.
    expect(resolveBounds({ x: 900, y: 700, width: 1400, height: 900 }, [primary])).toEqual({
      x: 900,
      y: 700,
      width: 1400,
      height: 900,
    })
  })

  it('shrinks a window that no longer fits the display it reopens on', () => {
    const small: WindowBounds = { x: 0, y: 0, width: 1280, height: 720 }

    expect(resolveBounds({ x: 40, y: 40, width: 1600, height: 1000 }, [small])).toEqual({
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
    })
  })

  it('never shrinks below the window minimum, even on a smaller display', () => {
    const tiny: WindowBounds = { x: 0, y: 0, width: 800, height: 500 }

    expect(resolveBounds({ x: 0, y: 0, width: 1400, height: 900 }, [tiny])).toEqual({
      x: 0,
      y: 0,
      width: WINDOW_MIN_WIDTH,
      height: WINDOW_MIN_HEIGHT,
    })
  })

  it('raises stored bounds smaller than the minimum up to it', () => {
    expect(resolveBounds({ x: 100, y: 100, width: 400, height: 300 }, [primary])).toEqual({
      x: 100,
      y: 100,
      width: WINDOW_MIN_WIDTH,
      height: WINDOW_MIN_HEIGHT,
    })
  })

  it('drops the position when no displays are reported at all', () => {
    expect(resolveBounds({ x: 100, y: 100, width: 1400, height: 900 }, [])).toEqual({
      width: 1400,
      height: 900,
    })
  })

  it('leaves a window straddling two displays alone', () => {
    expect(
      resolveBounds({ x: -1000, y: 100, width: 1400, height: 900 }, [primary, secondary]),
    ).toEqual({ x: -1000, y: 100, width: 1400, height: 900 })
  })

  it('fits a shrunk window to the display carrying most of its title bar', () => {
    const small: WindowBounds = { x: -1280, y: 0, width: 1280, height: 720 }

    // The title bar spans both displays, but 1000px of it is on the smaller left-hand one —
    // so that is the display the window is shrunk to, and pulled wholly inside.
    expect(resolveBounds({ x: -1000, y: 100, width: 1400, height: 900 }, [primary, small])).toEqual({
      x: -1280,
      y: 0,
      width: 1280,
      height: 720,
    })
  })
})
