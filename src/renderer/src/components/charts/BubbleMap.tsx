import { useCallback, useRef, useState } from 'react'
import type { AllocationSlice } from '@shared/domain/allocation'
import { splitCountryBubbles, WORLD_SILHOUETTE_PATH } from '../../lib/worldGeo'
import {
  initialViewport,
  panBy,
  viewBox,
  type Viewport,
  zoomAt,
  zoomByStep,
  zoomLevel,
} from '../../lib/mapViewport'

/**
 * Equirectangular bubble map of holdings by country (Milestone M3, Stories #46 & #70, DDR-0014).
 *
 * A faint world-land silhouette is drawn once as a single SVG path; each country the owner
 * holds is a circle placed at its centroid, with area proportional to market value. Silhouette
 * and circles share one projection (`projectEquirectangular`), so they align exactly — no
 * charting or geo dependency, matching the inline-SVG stance of the other charts (DDR-0006).
 *
 * The map is interactive (Story #70): the owner can zoom (wheel or the +/− buttons) and pan
 * (drag) to inspect crowded regions. Pan/zoom is just a moving `viewBox` over the same fixed
 * projection (`lib/mapViewport`), so nothing is re-projected or refetched — the map still
 * renders offline from imported data with the gateway closed.
 *
 * The map consumes the same `report.byCountry` slices the geography donut uses. Countries with
 * no centroid and the '' / 'Unknown' slice can't be placed, so `splitCountryBubbles` folds them
 * into an `unknown` bucket surfaced as a labelled legend chip rather than dropping them.
 */
export function BubbleMap({
  data,
  formatValue,
  ariaLabel,
  emptyMessage = 'No country data to map yet.',
}: {
  data: AllocationSlice[]
  formatValue: (v: number) => string
  ariaLabel: string
  emptyMessage?: string
}): React.JSX.Element {
  const { bubbles, unknown } = splitCountryBubbles(data)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const [view, setView] = useState<Viewport>(initialViewport)
  // Active drag: the world point grabbed at pointer-down, held fixed under the moving cursor.
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null)

  /** Map a pointer/wheel event's client position to a point in the current world viewBox. */
  const toWorld = useCallback((clientX: number, clientY: number, vp: Viewport) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    return {
      x: vp.x + ((clientX - rect.left) / rect.width) * vp.w,
      y: vp.y + ((clientY - rect.top) / rect.height) * vp.h,
    }
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      e.preventDefault()
      setView((vp) => {
        const focus = toWorld(e.clientX, e.clientY, vp) ?? { x: vp.x + vp.w / 2, y: vp.y + vp.h / 2 }
        // Wheel up (negative deltaY) zooms in; scale smoothly with the notch size.
        const factor = Math.exp(-e.deltaY * 0.0015)
        return zoomAt(vp, factor, focus)
      })
    },
    [toWorld],
  )

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origin: view }
  }, [view])

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d || d.pointerId !== e.pointerId) return
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0 || rect.height === 0) return
    // Convert the pixel drag into a world delta and pan *against* it (content follows the cursor).
    const dx = ((e.clientX - d.startX) / rect.width) * d.origin.w
    const dy = ((e.clientY - d.startY) / rect.height) * d.origin.h
    setView(panBy(d.origin, -dx, -dy))
  }, [])

  const endDrag = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null
  }, [])

  if (bubbles.length === 0 && unknown.count === 0) {
    return <p className="chart-empty">{emptyMessage}</p>
  }

  const zoomed = zoomLevel(view) > 1.0001

  return (
    <figure className="chart-figure bubble-map-figure">
      <div className="bubble-map-frame">
        <svg
          ref={svgRef}
          className={`bubble-map ${zoomed ? 'is-pannable' : ''}`}
          viewBox={viewBox(view)}
          role="img"
          aria-label={ariaLabel}
          preserveAspectRatio="xMidYMid meet"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <path className="bubble-map-land" d={WORLD_SILHOUETTE_PATH} />
          {bubbles.map((b) => (
            <circle key={b.code} className="bubble-map-dot" cx={b.x} cy={b.y} r={b.r}>
              <title>{`${b.name} — ${formatValue(b.value)} (${b.percent.toFixed(1)}% of NAV)`}</title>
            </circle>
          ))}
        </svg>
        <div className="bubble-map-controls" role="group" aria-label="Map zoom">
          <button
            type="button"
            className="map-zoom-btn"
            aria-label="Zoom in"
            title="Zoom in"
            onClick={() => setView((vp) => zoomByStep(vp, 'in'))}
          >
            +
          </button>
          <button
            type="button"
            className="map-zoom-btn"
            aria-label="Zoom out"
            title="Zoom out"
            disabled={!zoomed}
            onClick={() => setView((vp) => zoomByStep(vp, 'out'))}
          >
            −
          </button>
          <button
            type="button"
            className="map-zoom-btn map-zoom-reset"
            aria-label="Reset map view"
            title="Reset view"
            disabled={!zoomed}
            onClick={() => setView(initialViewport())}
          >
            ⤢
          </button>
        </div>
      </div>
      <figcaption className="chart-legend bubble-map-legend">
        <span className="bubble-map-hint">Circle size ∝ holding value</span>
        <span className="bubble-map-pan-hint">Scroll to zoom · drag to pan</span>
        {unknown.count > 0 && (
          <span
            className="bubble-map-unknown"
            title={`${unknown.count} country group(s) with no locatable country`}
          >
            Unknown — {formatValue(unknown.value)} ({unknown.percent.toFixed(1)}% of NAV)
          </span>
        )}
      </figcaption>
    </figure>
  )
}
