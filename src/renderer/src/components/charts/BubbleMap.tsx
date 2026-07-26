import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { sectorPalette, splitSectorBubbles, type SectorBubble } from '../../lib/sectorMap'

/**
 * Geographic map of holdings by country, segmented by sector (Milestone M3, Stories #46, #70,
 * #71 & #89; DDR-0019, superseding DDR-0014 on the basemap).
 *
 * The basemap is Mapbox GL JS; the data is an **overlay of SVG markers on top of it**, never
 * drawn into the map canvas. That split is deliberate (DDR-0019): it keeps the native `<title>`
 * tooltips that make a bubble identifiable, and it keeps the bubbles independent of the basemap
 * provider. Each country the owner holds is one marker at its centroid, area proportional to
 * market value, split into sector wedges coloured from the same palette the Sector donut uses
 * (`lib/sectorMap` → `lib/pie`) — so a sector wears one hue on the map, in the donut, and in the
 * map's legend.
 *
 * Positioning is Mapbox's job: markers are anchored by `lon`/`lat` and their wedge paths are laid
 * out around a local origin, so the library repositions them through pan and zoom — including
 * across the antimeridian, where the world repeats — without this component re-deriving geometry.
 *
 * **No holding data leaves the machine.** Bubbles are computed in the renderer from imported Flex
 * data; only tile requests reach the network, and the CSP admits exactly one origin with Mapbox's
 * telemetry endpoint deliberately excluded (ADR-0007).
 *
 * When the token is unset or tiles can't be reached, the panel degrades to a message in place of
 * the basemap rather than erroring — the rest of the Allocation view is unaffected, and the
 * geography donut below still carries the exact values.
 */

/** Public `pk.` token, inlined at build time. Empty when unconfigured — a first-class state. */
const MAPBOX_TOKEN = import.meta.env.RENDERER_VITE_MAPBOX_TOKEN ?? ''

/**
 * A muted monochrome basemap, chosen for legibility rather than taste (DDR-0019): the sector
 * palette is categorical, so the wedge hues must stay the only strongly saturated thing on screen.
 */
const MAP_STYLE = 'mapbox://styles/mapbox/light-v11'

/**
 * Flat map, not a globe. Mapbox v3 defaults to a globe at low zoom, which spends the panel's
 * width on curvature and empty space either side of the sphere; a flat projection uses the whole
 * frame and reads the way a wall map does.
 */
const MAP_PROJECTION = 'mercator'

/**
 * The inhabited world, fitted on load and on reset. Bounds rather than a fixed centre/zoom
 * because the right zoom depends on how wide the panel is — `fitBounds` solves for it, so the map
 * fills the frame at any window size instead of leaving slack at the sides.
 * The south edge stops short of Antarctica and the north of the ice cap: Mercator stretches both
 * enormously, and neither holds investments.
 */
const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-168, -56],
  [188, 76],
]

/** Below this delta from the fitted zoom the view counts as "not zoomed" (controls disabled). */
const ZOOM_EPSILON = 0.01

type MapStatus = 'pending' | 'ready' | 'no-token' | 'unavailable'

/**
 * Build one country bubble as a marker element for Mapbox.
 *
 * Imperative DOM rather than JSX because the element is handed to `mapboxgl.Marker`, which owns
 * its lifecycle and positioning. The wedge paths already come laid out around a 0,0 origin, so the
 * viewBox is simply centred on that origin and the marker needs no per-frame transform.
 *
 * The SVG is wrapped in a `div` because `Marker` types its element as an `HTMLElement`.
 */
function createBubbleElement(
  bubble: SectorBubble,
  formatValue: (v: number) => string,
): HTMLDivElement {
  const ns = 'http://www.w3.org/2000/svg'
  const size = bubble.r * 2
  const wrapper = document.createElement('div')
  wrapper.className = 'bubble-map-bubble'
  const svg = document.createElementNS(ns, 'svg')
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  svg.setAttribute('viewBox', `${-bubble.r} ${-bubble.r} ${size} ${size}`)
  svg.setAttribute('display', 'block')
  svg.setAttribute('aria-hidden', 'true')

  for (const wedge of bubble.wedges) {
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('class', `bubble-map-wedge ${wedge.colorClass}`)
    path.setAttribute('d', wedge.path)
    const title = document.createElementNS(ns, 'title')
    // textContent, never innerHTML — country and sector strings originate from broker data.
    title.textContent = `${bubble.name} · ${wedge.label} — ${formatValue(wedge.value)} (${wedge.percent.toFixed(1)}% of NAV)`
    path.appendChild(title)
    svg.appendChild(path)
  }

  // A thin outline ring ties the wedges together as one country bubble.
  const ring = document.createElementNS(ns, 'circle')
  ring.setAttribute('class', 'bubble-map-outline')
  ring.setAttribute('cx', '0')
  ring.setAttribute('cy', '0')
  ring.setAttribute('r', String(bubble.r))
  svg.appendChild(ring)

  wrapper.appendChild(svg)
  return wrapper
}

export function BubbleMap({
  positions,
  bySector,
  formatValue,
  ariaLabel,
  emptyMessage = 'No country data to map yet.',
}: {
  positions: AllocationPosition[]
  bySector: AllocationSlice[]
  formatValue: (v: number) => string
  ariaLabel: string
  emptyMessage?: string
}): React.JSX.Element {
  const { bubbles, unknown, legend } = useMemo(() => {
    const palette = sectorPalette(bySector)
    const split = splitSectorBubbles(positions, palette)
    return { ...split, legend: palette.legend }
  }, [positions, bySector])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  /** The zoom `fitBounds` settled on for the current frame size — the "not zoomed" baseline. */
  const baseZoomRef = useRef<number | null>(null)
  const zoomedRef = useRef(false)
  const [status, setStatus] = useState<MapStatus>(MAPBOX_TOKEN ? 'pending' : 'no-token')
  const [zoomed, setZoomed] = useState(false)

  // --- Map lifecycle -------------------------------------------------------
  useEffect(() => {
    if (!MAPBOX_TOKEN || !containerRef.current) return

    mapboxgl.accessToken = MAPBOX_TOKEN
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      projection: MAP_PROJECTION,
      bounds: WORLD_BOUNDS,
      // Mapbox's own controls are suppressed: the panel keeps the app's existing zoom buttons so
      // the control language stays the design system's (DDR-0019). Attribution stays on — it is
      // required by Mapbox's terms and is not ours to hide.
      attributionControl: true,
    })
    mapRef.current = map

    /** Re-fit the world and re-baseline what "not zoomed" means at this frame size. */
    const fitWorld = (duration: number): void => {
      map.fitBounds(WORLD_BOUNDS, { padding: 0, duration, linear: true })
      map.once('idle', () => {
        baseZoomRef.current = map.getZoom()
        zoomedRef.current = false
        setZoomed(false)
      })
    }

    map.on('load', () => {
      setStatus('ready')
      fitWorld(0)
    })
    map.on('zoom', () => {
      const base = baseZoomRef.current
      const isZoomed = base !== null && map.getZoom() > base + ZOOM_EPSILON
      zoomedRef.current = isZoomed
      setZoomed(isZoomed)
    })
    // Driven by the map's own error events, never a timeout, so a slow connection can't flash
    // the degraded state while tiles are still on their way.
    map.on('error', () => setStatus((s) => (s === 'ready' ? s : 'unavailable')))

    // A canvas does not reflow with its container the way an SVG viewBox did; without this the
    // map renders letterboxed after a window resize. A wider frame also fits the world at a
    // different zoom, so an un-zoomed map re-fits rather than keeping a stale one.
    const observer = new ResizeObserver(() => {
      map.resize()
      if (!zoomedRef.current) fitWorld(0)
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      mapRef.current = null
      map.remove()
    }
  }, [])

  // --- Bubble overlay ------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    for (const marker of markersRef.current) marker.remove()
    markersRef.current = bubbles.map((bubble) =>
      new mapboxgl.Marker({ element: createBubbleElement(bubble, formatValue) })
        .setLngLat([bubble.lon, bubble.lat])
        .addTo(map),
    )

    return () => {
      for (const marker of markersRef.current) marker.remove()
      markersRef.current = []
    }
  }, [bubbles, formatValue, status])

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ zoom: map.getZoom() + delta })
  }, [])

  const resetView = useCallback(() => {
    mapRef.current?.fitBounds(WORLD_BOUNDS, { padding: 0, duration: 300, linear: true })
  }, [])

  if (bubbles.length === 0 && unknown.count === 0) {
    return <p className="chart-empty">{emptyMessage}</p>
  }

  const degraded = status === 'no-token' || status === 'unavailable'

  return (
    <figure className="chart-figure bubble-map-figure">
      <div className="bubble-map-frame">
        {degraded ? (
          <div className="bubble-map-unavailable" role="status">
            <p className="chart-empty">
              {status === 'no-token'
                ? 'Map unavailable — no Mapbox token configured.'
                : 'Map unavailable — couldn’t reach the map service.'}
            </p>
            <p className="chart-empty bubble-map-unavailable-hint">
              {status === 'no-token'
                ? 'Set RENDERER_VITE_MAPBOX_TOKEN in .env to enable the map.'
                : 'Check your connection; your allocation data is unaffected.'}
            </p>
            <p className="chart-empty bubble-map-unavailable-hint">
              Country and sector values are unchanged — see the breakdown below.
            </p>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="bubble-map" role="img" aria-label={ariaLabel} />
            <div className="bubble-map-controls" role="group" aria-label="Map zoom">
              <button
                type="button"
                className="map-zoom-btn"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => zoomBy(1)}
              >
                +
              </button>
              <button
                type="button"
                className="map-zoom-btn"
                aria-label="Zoom out"
                title="Zoom out"
                disabled={!zoomed}
                onClick={() => zoomBy(-1)}
              >
                −
              </button>
              <button
                type="button"
                className="map-zoom-btn map-zoom-reset"
                aria-label="Reset map view"
                title="Reset view"
                disabled={!zoomed}
                onClick={resetView}
              >
                ⤢
              </button>
            </div>
          </>
        )}
      </div>
      <figcaption className="chart-legend bubble-map-legend">
        <ul className="bubble-map-sectors" aria-label="Sector colours">
          {legend.map((s) => (
            <li key={s.key} className="bubble-map-sector">
              <span className={`legend-swatch ${s.colorClass}`} aria-hidden="true" />
              {s.label}
            </li>
          ))}
        </ul>
        <span className="bubble-map-pan-hint">Circle size ∝ holding value · scroll to zoom · drag to pan</span>
        {unknown.count > 0 && (
          <span
            className="bubble-map-unknown"
            title={`${unknown.count} country group(s) with no locatable country`}
          >
            Unknown location — {formatValue(unknown.value)} ({unknown.percent.toFixed(1)}% of NAV)
          </span>
        )}
      </figcaption>
    </figure>
  )
}
