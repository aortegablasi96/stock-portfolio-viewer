import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { Feature, Point } from 'geojson'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { formatCompanyName, formatSignedPercent } from '../../lib/format'
import { sectorPalette } from '../../lib/sectorMap'
import { positionBubbles, type PositionBubble } from '../../lib/mapBubbles'
import { DIVERGING_CLASSES, RETURN_BOUND } from '../../lib/gainLoss'

/**
 * Geographic map of holdings by company (Milestone M3, Stories #46, #70, #71, #89 & #92;
 * DDR-0020, superseding DDR-0019 on how the data is drawn).
 *
 * Each holding is one circle, area proportional to its base-currency market value, coloured from
 * the same palette the Sector donut uses — so a sector wears one hue on the map, in the donut, and
 * in the map's legend. Hovering a circle opens a popup with the figures the Positions table would
 * otherwise have to be consulted for.
 *
 * **Drawn into the map canvas, not over it.** DDR-0019 kept bubbles as an SVG overlay precisely to
 * preserve native `<title>` tooltips; #92 reverses that for data-driven sizing and colouring that a
 * later story can re-express (gain/loss colouring, filtering, clustering) without restructuring how
 * the map is drawn. The cost is real: a canvas circle carries no `<title>`, cannot take focus, and
 * cannot be hovered by a keyboard. The Positions table below is the accessible equivalent — it
 * carries every field this popup shows, for every holding, in semantic markup (DDR-0020).
 *
 * Colour crosses from CSS into the canvas here, and only here. `lib/mapBubbles` emits palette
 * *classes*; resolving one to a value needs `getComputedStyle`, which does not exist in Vitest's
 * Node environment. Keeping the resolution in the component is what leaves every bit of the map's
 * geometry unit-testable.
 *
 * **No holding data leaves the machine.** Features are built in the renderer from imported Flex
 * data and handed to a client-side GeoJSON source — never a network request. Only tiles and styles
 * are fetched, from the one origin the CSP admits, with Mapbox's telemetry endpoint deliberately
 * excluded (ADR-0007).
 *
 * When the token is unset or tiles can't be reached, the panel degrades to a message in place of
 * the basemap rather than erroring — the rest of the Allocation view is unaffected, and the
 * geography donut below still carries the exact values.
 */

/** Public `pk.` token, inlined at build time. Empty when unconfigured — a first-class state. */
const MAPBOX_TOKEN = import.meta.env.RENDERER_VITE_MAPBOX_TOKEN ?? ''

/**
 * A muted monochrome basemap, chosen for legibility rather than taste (DDR-0019): the sector
 * palette is categorical, so the circle hues must stay the only strongly saturated thing on screen.
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

const SOURCE_ID = 'holdings'
const LAYER_ID = 'holding-bubbles'

/** Gap between a circle's edge and its popup, so the popup never covers what it describes. */
const POPUP_GAP_PX = 6

type MapStatus = 'pending' | 'ready' | 'no-token' | 'unavailable'

/** What the circles' colour encodes. Sector is the default; the owner switches (Story #95). */
export type MapColorMode = 'sector' | 'gainLoss'

/** The feature properties the layer paints from and the popup reads back. */
interface BubbleProperties {
  ticker: string
  name: string
  countryName: string
  sectorLabel: string
  sectorClass: string
  /**
   * Both modes' colours ride on every feature, so switching modes is a `setPaintProperty` call
   * against the same source — nothing moves, resizes, reorders, or re-uploads.
   */
  sectorColor: string
  gainLossColor: string
  r: number
  marketValue: number
  unrealizedPnl: number
  percentOfNav: number
  /** `null` when there is no cost basis to measure against — rendered as unknown, not 0%. */
  returnPercent: number | null
}

/**
 * Resolve a palette class (`pie-series-3`, `map-diverge-6`) to the colour value behind it.
 *
 * `:root` stays the single source of truth: duplicating the hexes into TypeScript would create a
 * second palette to keep in sync with the donut, which is the drift DDR-0019 exists to prevent.
 * The app is dark-only today, so resolving once when the layer is built is enough — a light theme
 * would need this re-run on theme change.
 */
function resolveColor(styles: CSSStyleDeclaration, colorClass: string): string {
  const cssVar = colorClass.startsWith('map-diverge-')
    ? `--diverge-${colorClass.replace('map-diverge-', '')}`
    : `--series-${colorClass.replace('pie-series-', '')}`
  const value = styles.getPropertyValue(cssVar).trim()
  // A missing variable would otherwise paint circles transparent and look like missing data.
  return value === '' ? styles.getPropertyValue('--series-neutral').trim() || '#898781' : value
}

/** The paint expression for a mode — data-driven, so switching never touches the source. */
function colorExpressionFor(mode: MapColorMode): mapboxgl.ExpressionSpecification {
  return ['get', mode === 'sector' ? 'sectorColor' : 'gainLossColor']
}

/** One holding as a GeoJSON point feature, carrying everything the layer and popup need. */
function toFeature(
  bubble: PositionBubble,
  styles: CSSStyleDeclaration,
): Feature<Point, BubbleProperties> {
  return {
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [bubble.lon, bubble.lat] },
    properties: {
      ticker: bubble.ticker,
      name: bubble.name,
      countryName: bubble.countryName,
      sectorLabel: bubble.sectorLabel,
      sectorClass: bubble.sectorClass,
      sectorColor: resolveColor(styles, bubble.sectorClass),
      gainLossColor: resolveColor(styles, bubble.gainLossClass),
      r: bubble.r,
      marketValue: bubble.marketValueBase,
      unrealizedPnl: bubble.unrealizedPnlBase,
      percentOfNav: bubble.percentOfNav,
      returnPercent: bubble.returnPercent,
    },
  }
}

/**
 * Build the popup body.
 *
 * Imperative DOM rather than JSX because `mapboxgl.Popup` owns its content element. Every string
 * is set with `textContent`, never `innerHTML` — tickers, company names, sectors and countries all
 * originate from broker data.
 *
 * The layout mirrors a Positions table row on purpose: same fields, same order, same formatters, so
 * the owner learns one layout rather than two and the two surfaces can be read against each other.
 */
function createPopupContent(
  props: BubbleProperties,
  formatValue: (v: number) => string,
  formatSigned: (v: number) => string,
): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'map-popup'

  const ticker = document.createElement('p')
  ticker.className = 'map-popup-ticker'
  ticker.textContent = props.ticker
  root.appendChild(ticker)

  if (props.name !== '') {
    const name = document.createElement('p')
    name.className = 'map-popup-name'
    // The same readable treatment the dividend tables give raw broker names.
    name.textContent = formatCompanyName(props.name)
    root.appendChild(name)
  }

  const meta = document.createElement('p')
  meta.className = 'map-popup-meta'
  const swatch = document.createElement('span')
  swatch.className = `legend-swatch ${props.sectorClass}`
  swatch.setAttribute('aria-hidden', 'true')
  meta.appendChild(swatch)
  const metaText = document.createElement('span')
  // An unclassified holding reads '—', exactly as its row in the Positions table does.
  metaText.textContent = `${props.sectorLabel || '—'} · ${props.countryName}`
  meta.appendChild(metaText)
  root.appendChild(meta)

  const rows = document.createElement('dl')
  rows.className = 'map-popup-rows'
  const addRow = (label: string, value: string, toneClass = ''): void => {
    const row = document.createElement('div')
    row.className = 'map-popup-row'
    const dt = document.createElement('dt')
    dt.textContent = label
    const dd = document.createElement('dd')
    dd.className = toneClass
    dd.textContent = value
    row.append(dt, dd)
    rows.appendChild(row)
  }
  addRow('Market value', formatValue(props.marketValue))
  addRow('% of NAV', `${props.percentOfNav.toFixed(1)}%`)
  const tone =
    props.unrealizedPnl === 0 ? '' : props.unrealizedPnl > 0 ? 'stat-positive' : 'stat-negative'
  addRow('Unrealized P&L', formatSigned(props.unrealizedPnl), tone)
  // The figure the gain/loss colour encodes, stated in text: the neutral step means "flat *or*
  // unknown", and colour alone cannot tell those apart (Story #95). '—' rather than a fabricated
  // 0.0% when there is no cost basis to measure against.
  addRow(
    'Return',
    props.returnPercent === null ? '—' : formatSignedPercent(props.returnPercent),
    props.returnPercent === null ? '' : tone,
  )
  root.appendChild(rows)

  return root
}

export function BubbleMap({
  positions,
  bySector,
  formatValue,
  formatSigned,
  colorMode,
  ariaLabel,
  emptyMessage = 'No country data to map yet.',
}: {
  positions: AllocationPosition[]
  bySector: AllocationSlice[]
  formatValue: (v: number) => string
  formatSigned: (v: number) => string
  colorMode: MapColorMode
  ariaLabel: string
  emptyMessage?: string
}): React.JSX.Element {
  const { bubbles, unknown, legend } = useMemo(() => {
    const palette = sectorPalette(bySector)
    const split = positionBubbles(positions, palette)
    return { ...split, legend: palette.legend }
  }, [positions, bySector])

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const popupRef = useRef<mapboxgl.Popup | null>(null)
  /** The zoom `fitBounds` settled on for the current frame size — the "not zoomed" baseline. */
  const baseZoomRef = useRef<number | null>(null)
  const zoomedRef = useRef(false)
  /**
   * Formatters are read at hover time only. Holding them in refs keeps a new function identity
   * from rebuilding the whole source on every render.
   */
  const formatValueRef = useRef(formatValue)
  const formatSignedRef = useRef(formatSigned)
  formatValueRef.current = formatValue
  formatSignedRef.current = formatSigned
  /** Read once when the layer is first created; thereafter the effect below drives it. */
  const colorModeRef = useRef(colorMode)
  colorModeRef.current = colorMode

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

    // One popup for the whole map, moved and re-filled as the cursor crosses circles. Creating one
    // per hover flickers visibly when sliding between neighbours in a dense rosette — which is
    // exactly where a concentrated portfolio is read.
    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      // `anchor` is deliberately unset: Mapbox then flips the popup to keep it inside the frame,
      // which is the edge-visibility requirement handled for free.
      maxWidth: '15rem',
      className: 'map-popup-shell',
    })
    popupRef.current = popup

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
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          // Data-driven throughout, so a later story can re-express size or colour (gain/loss,
          // filtering) by changing an expression rather than how the map is drawn.
          'circle-radius': ['get', 'r'],
          'circle-color': colorExpressionFor(colorModeRef.current),
          'circle-opacity': 0.85,
          // A dark ring against a light basemap guarantees figure/ground separation whatever the
          // categorical hue — the palette was validated against the dark panel surface, not tiles.
          'circle-stroke-width': 1,
          'circle-stroke-color': getComputedStyle(document.documentElement)
            .getPropertyValue('--card')
            .trim(),
        },
      })

      map.on('mousemove', LAYER_ID, (e) => {
        const feature = e.features?.[0]
        if (!feature || feature.geometry.type !== 'Point' || !feature.properties) return
        const props = feature.properties as BubbleProperties
        const [lon, lat] = feature.geometry.coordinates as [number, number]
        // The world repeats when panned past the antimeridian; without this the popup would open
        // on the copy of the globe the cursor is not over.
        let lng = lon
        while (Math.abs(e.lngLat.lng - lng) > 180) lng += e.lngLat.lng > lng ? 360 : -360

        map.getCanvas().style.cursor = 'pointer'
        popup
          .setLngLat([lng, lat])
          .setOffset(props.r + POPUP_GAP_PX)
          .setDOMContent(
            createPopupContent(props, formatValueRef.current, formatSignedRef.current),
          )
          .addTo(map)
      })

      map.on('mouseleave', LAYER_ID, () => {
        map.getCanvas().style.cursor = ''
        popup.remove()
      })

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
    //
    // A zero-size frame is ignored rather than fitted: since Story #109 the Allocation view stays
    // mounted while another tab is open, and a hidden panel measures 0×0. Fitting the world into
    // no width would throw the camera away, and the observer fires again with the real size the
    // moment the tab is shown — which is the resize that matters.
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect
      if (!rect || rect.width === 0 || rect.height === 0) return
      map.resize()
      if (!zoomedRef.current) fitWorld(0)
    })
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      popup.remove()
      popupRef.current = null
      mapRef.current = null
      map.remove()
    }
  }, [])

  // --- Bubble data ---------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    const source = map.getSource(SOURCE_ID)
    if (!source) return
    const styles = getComputedStyle(document.documentElement)
    // `setData` rather than removing and re-adding the layer: the source is the thing that
    // changes, and swapping it out would flash the circles off and on.
    ;(source as mapboxgl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: bubbles.map((b) => toFeature(b, styles)),
    })
    popupRef.current?.remove()
  }, [bubbles, status])

  // --- Colour mode ---------------------------------------------------------
  // Only the paint expression changes. Both colours already ride on every feature, so the source
  // is never touched: nothing moves, resizes, reorders, or re-uploads, and the camera is untouched.
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready' || !map.getLayer(LAYER_ID)) return
    map.setPaintProperty(LAYER_ID, 'circle-color', colorExpressionFor(colorMode))
  }, [colorMode, status])

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
        {colorMode === 'sector' ? (
          <ul className="bubble-map-sectors" aria-label="Sector colours">
            {legend.map((s) => (
              <li key={s.key} className="bubble-map-sector">
                <span className={`legend-swatch ${s.colorClass}`} aria-hidden="true" />
                {s.label}
              </li>
            ))}
          </ul>
        ) : (
          <div
            className="map-scale"
            aria-label={`Unrealized return scale, minus ${RETURN_BOUND} percent to plus ${RETURN_BOUND} percent`}
          >
            <span className="map-scale-end">−{RETURN_BOUND}%</span>
            <span className="map-scale-swatches" aria-hidden="true">
              {DIVERGING_CLASSES.map((c) => (
                <span key={c} className={`legend-swatch ${c}`} />
              ))}
            </span>
            <span className="map-scale-end">+{RETURN_BOUND}%</span>
          </div>
        )}
        <span className="bubble-map-pan-hint">
          {colorMode === 'sector'
            ? 'Circle size ∝ holding value · positioned by issuer country · scroll to zoom · drag to pan'
            : `Colour = unrealized return on cost · beyond ±${RETURN_BOUND}% saturates · gray means flat or unknown`}
        </span>
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
