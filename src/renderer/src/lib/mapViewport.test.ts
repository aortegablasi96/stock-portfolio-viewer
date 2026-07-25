import { describe, expect, it } from 'vitest'
import {
  clamp,
  initialViewport,
  MAX_ZOOM,
  panBy,
  viewBox,
  WORLD,
  zoomAt,
  zoomByStep,
  zoomLevel,
} from './mapViewport'

describe('initialViewport / zoomLevel', () => {
  it('starts at the full world with zoom level 1', () => {
    const vp = initialViewport()
    expect(vp).toEqual(WORLD)
    expect(zoomLevel(vp)).toBe(1)
  })
})

describe('clamp', () => {
  it('never lets the view grow past the world', () => {
    expect(clamp({ x: -50, y: -50, w: WORLD.w * 2, h: WORLD.h * 2 })).toEqual(WORLD)
  })

  it('never lets the view shrink past the max zoom', () => {
    const tiny = clamp({ x: 0, y: 0, w: 1, h: 1 })
    expect(tiny.w).toBeCloseTo(WORLD.w / MAX_ZOOM)
    expect(tiny.h).toBeCloseTo(WORLD.h / MAX_ZOOM)
  })

  it('keeps a panned view from exposing a gap past an edge', () => {
    // A half-size view pushed far past the bottom-right corner snaps back to the corner.
    const half = { x: WORLD.w, y: WORLD.h, w: WORLD.w / 2, h: WORLD.h / 2 }
    expect(clamp(half)).toEqual({ x: WORLD.w / 2, y: WORLD.h / 2, w: WORLD.w / 2, h: WORLD.h / 2 })
  })
})

describe('zoomAt', () => {
  it('keeps the focal point fixed under the cursor when zooming in', () => {
    const vp = initialViewport()
    const focus = { x: 90, y: 45 }
    const zoomed = zoomAt(vp, 2, focus)
    expect(zoomed.w).toBeCloseTo(WORLD.w / 2)
    // The focal point sits at the same fraction (1/4, 1/4) of the new view as the old.
    expect((focus.x - zoomed.x) / zoomed.w).toBeCloseTo(0.25)
    expect((focus.y - zoomed.y) / zoomed.h).toBeCloseTo(0.25)
  })

  it('cannot zoom out beyond the full world', () => {
    expect(zoomAt(initialViewport(), 0.5, { x: 180, y: 90 })).toEqual(WORLD)
  })

  it('stops at the max zoom when zoomed in repeatedly', () => {
    let vp = initialViewport()
    for (let i = 0; i < 20; i++) vp = zoomAt(vp, 2, { x: 180, y: 90 })
    expect(zoomLevel(vp)).toBeCloseTo(MAX_ZOOM)
  })
})

describe('zoomByStep', () => {
  it('zooms in around the view centre', () => {
    const zoomed = zoomByStep(initialViewport(), 'in')
    expect(zoomLevel(zoomed)).toBeGreaterThan(1)
    // Centre of the world stays centred.
    expect(zoomed.x + zoomed.w / 2).toBeCloseTo(WORLD.w / 2)
    expect(zoomed.y + zoomed.h / 2).toBeCloseTo(WORLD.h / 2)
  })

  it('zooming out from full world is a no-op (already clamped)', () => {
    expect(zoomByStep(initialViewport(), 'out')).toEqual(WORLD)
  })
})

describe('panBy', () => {
  it('shifts a zoomed-in view by the world-unit delta', () => {
    const zoomed = zoomByStep(zoomByStep(initialViewport(), 'in'), 'in')
    const panned = panBy(zoomed, 10, 5)
    expect(panned.x).toBeCloseTo(zoomed.x + 10)
    expect(panned.y).toBeCloseTo(zoomed.y + 5)
  })

  it('clamps a pan that would run off the left/top edge', () => {
    const zoomed = zoomByStep(initialViewport(), 'in')
    const panned = panBy(zoomed, -1000, -1000)
    expect(panned.x).toBe(0)
    expect(panned.y).toBe(0)
  })

  it('does nothing at full world (no room to pan)', () => {
    expect(panBy(initialViewport(), 50, 50)).toEqual(WORLD)
  })
})

describe('viewBox', () => {
  it('serialises to an SVG viewBox string', () => {
    expect(viewBox({ x: 10, y: 20, w: 180, h: 90 })).toBe('10 20 180 90')
  })
})
