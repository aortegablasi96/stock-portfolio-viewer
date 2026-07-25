/**
 * Pure viewport maths for the Allocation world map's pan/zoom (Story #70). Kept out of the
 * component so the zoom-around-focus, pan, and clamping logic is unit-tested directly, the way
 * the other renderer helpers in this folder are.
 *
 * Pan/zoom is expressed as a *view rectangle* over the map's fixed equirectangular frame
 * (`WORLD`, the `MAP_WIDTH`×`MAP_HEIGHT` box the bubbles are projected into). The component
 * feeds this rectangle straight to the SVG `viewBox`, so nothing is re-projected and the map
 * still renders offline from imported data — only what's visible changes.
 *
 * Coordinates are all in world units. The rectangle can never zoom out past the full world or
 * pan a gap in beyond its edges (`clamp`), so the land silhouette always fills the frame.
 */
import { MAP_HEIGHT, MAP_WIDTH } from './worldGeo'

/** A view rectangle over the world frame, in world units — fed directly to the SVG `viewBox`. */
export interface Viewport {
  x: number
  y: number
  w: number
  h: number
}

/** The full map frame; the zoomed-all-the-way-out viewport and the clamp bounds. */
export const WORLD: Viewport = { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT }

/** Deepest zoom: the view can shrink to 1/MAX_ZOOM of the world before it stops. */
export const MAX_ZOOM = 12
/** Per step (button or wheel notch) the view scales by this factor. */
export const ZOOM_STEP = 1.5

/** The full-world viewport — the initial and reset state. */
export function initialViewport(): Viewport {
  return { ...WORLD }
}

/** Current zoom level: 1 at full world, MAX_ZOOM at the deepest allowed zoom. */
export function zoomLevel(vp: Viewport): number {
  return WORLD.w / vp.w
}

/**
 * Clamp a candidate rectangle back into a valid view: never larger than the world (so you can't
 * zoom out past it) nor smaller than 1/MAX_ZOOM of it, and never panned past an edge (so no gap
 * of empty frame shows). Width and height are clamped together to keep the world's aspect ratio.
 */
export function clamp(vp: Viewport): Viewport {
  const minW = WORLD.w / MAX_ZOOM
  const minH = WORLD.h / MAX_ZOOM
  const w = Math.min(Math.max(vp.w, minW), WORLD.w)
  const h = Math.min(Math.max(vp.h, minH), WORLD.h)
  const x = Math.min(Math.max(vp.x, WORLD.x), WORLD.x + WORLD.w - w)
  const y = Math.min(Math.max(vp.y, WORLD.y), WORLD.y + WORLD.h - h)
  return { x, y, w, h }
}

/**
 * Zoom by `factor` (>1 zooms in) while keeping the world point `focus` fixed under the same
 * screen spot — so wheel-zoom homes in on the cursor and button-zoom on the centre. The focal
 * point's fractional position in the view is preserved across the scale, then the result is
 * clamped back into bounds.
 */
export function zoomAt(vp: Viewport, factor: number, focus: { x: number; y: number }): Viewport {
  const w = vp.w / factor
  const h = vp.h / factor
  const fx = (focus.x - vp.x) / vp.w
  const fy = (focus.y - vp.y) / vp.h
  return clamp({ x: focus.x - fx * w, y: focus.y - fy * h, w, h })
}

/** Zoom a step in/out around the view's own centre — for the +/- buttons. */
export function zoomByStep(vp: Viewport, direction: 'in' | 'out'): Viewport {
  const factor = direction === 'in' ? ZOOM_STEP : 1 / ZOOM_STEP
  return zoomAt(vp, factor, { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 })
}

/** Pan the view by a world-unit delta (drag), clamped so it stays over the world. */
export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return clamp({ ...vp, x: vp.x + dx, y: vp.y + dy })
}

/** Serialise a viewport as an SVG `viewBox` string (`"x y w h"`). */
export function viewBox(vp: Viewport): string {
  return `${vp.x} ${vp.y} ${vp.w} ${vp.h}`
}
