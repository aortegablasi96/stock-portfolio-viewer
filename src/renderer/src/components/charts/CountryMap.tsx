import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { formatSignedPercent } from '../../lib/format'
import { sectorPalette } from '../../lib/sectorMap'
import {
  countryDonuts,
  REST_KEY,
  type CountryDonuts,
  type DonutSlice,
} from '../../lib/countryDonuts'
import { DIVERGING_CLASSES, RETURN_BOUND } from '../../lib/gainLoss'

/**
 * Geographic map of holdings by issuer country (Milestone M4, Story #122; DDR-0030, superseding
 * DDR-0020 on the map's unit and on how the data is drawn; earlier rounds #46, #70, #71, #89, #95).
 *
 * Each country carries **two donuts side by side**, the same form the Allocation view's own
 * breakdown charts use, so the map and the panels below it read as one chart language:
 *
 * - **Left, the country's weight in the portfolio:** its share of NAV in blue against the rest of
 *   the portfolio, on an absolute 0–100% scale, so the same arc means the same weight in every
 *   country and in every session.
 * - **Right, the country split by sector:** one slice per sector, each in its own hue from the
 *   shared `sectorPalette`, which the map's legend explains.
 *
 * **Neither donut needs a colour it cannot afford**, which is why this form works where two earlier
 * rounds of this story did not. A nested sunburst forced every holding to wear its sector's hue and
 * rendered as one solid block; a donut split by holding needed eight distinguishable categorical
 * hues on a 40px mark. Here the left donut shows one number, so it needs one colour, and the right
 * shows sectors, which already have a palette.
 *
 * **Holdings are not on the map.** This retires the per-holding granularity DDR-0020 introduced. The
 * map answers *where, and in what* — the Positions table below is where a single company's figures
 * are read, and the map's `aria-label` points at it.
 *
 * **Drawn over the map, not into it.** DDR-0020 moved the data into a Mapbox circle layer for
 * data-driven paint expressions. A circle layer paints one flat fill per feature, so donut slices
 * have no canvas equivalent, and the marks are SVG carried by `mapboxgl.Marker`. Two things follow.
 * Colour stops needing `getComputedStyle`: a palette class on a `<path>` *is* the fill, so `:root`
 * remains the single source of truth with no resolution step in between (the reason `lib/pie` and
 * `lib/sectorMap` have always emitted classes). And switching colour mode is a re-render rather than
 * a `setPaintProperty` call — the geometry is memoized and unchanged, so only fills move.
 *
 * **No holding data leaves the machine.** Marks are built in the renderer from imported Flex data
 * and positioned by a bundled centroid table — never a network request. Only tiles and styles are
 * fetched, from the one origin the CSP admits, with Mapbox's telemetry endpoint deliberately
 * excluded (ADR-0007).
 *
 * When the token is unset or tiles can't be reached, the panel degrades to a message in place of the
 * basemap rather than erroring — the rest of the Allocation view is unaffected, and the geography
 * donut below still carries the exact values.
 */

/** Public `pk.` token, inlined at build time. Empty when unconfigured — a first-class state. */
const MAPBOX_TOKEN = import.meta.env.RENDERER_VITE_MAPBOX_TOKEN ?? ''

/**
 * A muted monochrome basemap, chosen for legibility rather than taste (DDR-0019): the sector
 * palette is categorical, so the mark hues must stay the only strongly saturated thing on screen.
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

/** Gap between a mark's edge and its popup, so the popup never covers what it describes. */
const POPUP_GAP_PX = 6

type MapStatus = 'pending' | 'ready' | 'no-token' | 'unavailable'

/** What the marks' colour encodes. Sector is the default; the owner switches (Story #95). */
export type MapColorMode = 'sector' | 'gainLoss'

/**
 * What the cursor is over: one sector's slice, or the country — from the weight donut, which
 * measures the country, or from a disc too small to draw as a pair.
 */
type Subject =
  | { kind: 'sector'; country: CountryDonuts; slice: DonutSlice }
  | { kind: 'country'; country: CountryDonuts }

/** Tone class for a figure — the app's existing `--pos` / `--neg` treatment. */
function toneFor(value: number): string {
  return value === 0 ? '' : value > 0 ? 'stat-positive' : 'stat-negative'
}

/**
 * Build the popup body for whichever bar — or country — is hovered.
 *
 * Imperative DOM rather than JSX because `mapboxgl.Popup` owns its content element. Every string is
 * set with `textContent`, never `innerHTML` — sector names and countries originate from broker data.
 *
 * The layout keeps a Positions table row's fields, order and formatters, so the owner learns one
 * layout rather than two. A sector slice adds the two figures an aggregate has and a single position
 * does not: how many holdings it covers, and the share of the country its angle encodes.
 */
function createPopupContent(
  subject: Subject,
  formatValue: (v: number) => string,
  formatSigned: (v: number) => string,
): HTMLDivElement {
  const root = document.createElement('div')
  root.className = 'map-popup'

  const { country } = subject
  const isSector = subject.kind === 'sector'
  const source = isSector ? subject.slice : country
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

  const title = document.createElement('p')
  title.className = 'map-popup-title'
  title.textContent = isSector ? subject.slice.label : country.countryName
  root.appendChild(title)

  const meta = document.createElement('p')
  meta.className = 'map-popup-meta'
  const swatch = document.createElement('span')
  swatch.className = `legend-swatch ${isSector ? subject.slice.colorClass : country.colorClass}`
  swatch.setAttribute('aria-hidden', 'true')
  const metaText = document.createElement('span')
  metaText.textContent = isSector
    ? country.countryName
    : `${plural(country.holdingCount, 'holding')} · ${plural(country.sectors.length, 'sector')}`
  meta.append(swatch, metaText)
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
  addRow('Market value', formatValue(source.marketValueBase))
  // What the *left* chart sweeps, for a country; for a sector, its slice of the portfolio.
  addRow('% of NAV', `${source.percentOfNav.toFixed(1)}%`)
  if (isSector) {
    // What the sector bar's own sweep encodes — a share of this country, not of the portfolio.
    addRow(`% of ${country.countryName}`, `${subject.slice.percentOfCountry.toFixed(1)}%`)
    addRow('Holdings', String(subject.slice.holdingCount))
  }
  const tone = toneFor(source.unrealizedPnlBase)
  addRow('Unrealized P&L', formatSigned(source.unrealizedPnlBase), tone)
  // The figure the tint encodes, stated in text: the neutral tint means "flat *or* unknown", and
  // colour alone cannot tell those apart. '—' rather than a fabricated 0.0% when there is no cost
  // basis to measure against.
  addRow(
    'Return',
    source.returnPercent === null ? '—' : formatSignedPercent(source.returnPercent),
    source.returnPercent === null ? '' : tone,
  )
  root.appendChild(rows)

  return root
}

/** The popup's tint class for a return — green up, red down, untinted when flat or unknown. */
function tintClassFor(returnPercent: number | null): string | null {
  if (returnPercent === null || returnPercent === 0) return null
  return returnPercent > 0 ? 'map-popup-pos' : 'map-popup-neg'
}

const TINT_CLASSES = ['map-popup-pos', 'map-popup-neg']

/** The return the popup's tint reflects — whichever subject is hovered. */
function returnOf(subject: Subject): number | null {
  return subject.kind === 'sector' ? subject.slice.returnPercent : subject.country.returnPercent
}

/**
 * One country's mark — a weight donut and a sector donut — rendered into its Mapbox marker element
 * by a portal.
 *
 * Hover is `onMouseEnter` per slice and a single `onMouseLeave` on the mark as a whole: leaving one
 * slice for its neighbour must re-fill the popup, never close and reopen it, or a dense mark flickers
 * under the cursor — exactly where a concentrated portfolio is read.
 */
function CountryMark({
  country,
  colorMode,
  onEnter,
  onLeave,
}: {
  country: CountryDonuts
  colorMode: MapColorMode
  onEnter: (subject: Subject) => void
  onLeave: () => void
}): React.JSX.Element {
  const { r, cx, dot } = country
  // The pair spans both donuts plus the gap between them; height is one donut.
  const halfWidth = dot ? r : cx + r
  const fillOf = (slice: DonutSlice): string =>
    colorMode === 'sector' ? slice.colorClass : slice.gainLossClass

  return (
    <svg
      className="country-mark"
      width={halfWidth * 2}
      height={r * 2}
      viewBox={`${-halfWidth} ${-r} ${halfWidth * 2} ${r * 2}`}
      aria-hidden="true"
      onMouseLeave={onLeave}
    >
      {dot ? (
        <circle
          className={`country-mark-dot ${
            colorMode === 'sector' ? country.colorClass : country.gainLossClass
          }`}
          r={r}
          onMouseEnter={() => onEnter({ kind: 'country', country })}
        />
      ) : (
        <>
          {/* Left: the country's share of NAV against the rest of the portfolio. Both slices open
              the country — the remainder is context for the blue one, not a subject of its own. */}
          {country.weight.map((slice) => (
            <path
              key={slice.key}
              className={`country-mark-slice ${
                slice.key === REST_KEY ? 'country-mark-rest' : fillOf(slice)
              }`}
              d={slice.path}
              onMouseEnter={() => onEnter({ kind: 'country', country })}
            />
          ))}
          {/* Right: one slice per sector. */}
          {country.sectors.map((slice) => (
            <path
              key={slice.key}
              className={`country-mark-slice ${fillOf(slice)}`}
              d={slice.path}
              onMouseEnter={() => onEnter({ kind: 'sector', country, slice })}
            />
          ))}
        </>
      )}
    </svg>
  )
}

export function CountryMap({
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
  const { countries, unknown, legend } = useMemo(() => {
    const palette = sectorPalette(bySector)
    const split = countryDonuts(positions, palette)
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
   * from rebuilding the markers on every render.
   */
  const formatValueRef = useRef(formatValue)
  const formatSignedRef = useRef(formatSigned)
  formatValueRef.current = formatValue
  formatSignedRef.current = formatSigned

  const [status, setStatus] = useState<MapStatus>(MAPBOX_TOKEN ? 'pending' : 'no-token')
  const [zoomed, setZoomed] = useState(false)
  /**
   * The marker elements the donut pairs portal into. Mapbox owns each element's position — it keeps
   * them pinned to their coordinates through pan, zoom and world-copy wrapping — while React owns
   * what is drawn inside, so colour mode is an ordinary re-render.
   */
  const [hosts, setHosts] = useState<Array<{ code: string; el: HTMLDivElement }>>([])

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

    // One popup for the whole map, moved and re-filled as the cursor crosses bars.
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

  // --- Markers -------------------------------------------------------------
  // One marker per country, created when the data changes and torn down with it. Only the hosting
  // elements are made here; what goes inside them is React's, via the portals below.
  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return

    const created = countries.map((c) => {
      const el = document.createElement('div')
      el.className = 'country-marker'
      const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
        .setLngLat([c.lon, c.lat])
        .addTo(map)
      return { code: c.code, el, marker }
    })
    setHosts(created.map(({ code, el }) => ({ code, el })))

    return () => {
      popupRef.current?.remove()
      created.forEach(({ marker }) => marker.remove())
      setHosts([])
    }
  }, [countries, status])

  const showPopup = useCallback((subject: Subject) => {
    const map = mapRef.current
    const popup = popupRef.current
    if (!map || !popup) return

    const { country } = subject
    const tint = tintClassFor(returnOf(subject))
    TINT_CLASSES.forEach((c) => {
      if (c !== tint) popup.removeClassName(c)
    })
    if (tint) popup.addClassName(tint)

    popup
      .setLngLat([country.lon, country.lat])
      // Vertical clearance only: the pair is wider than it is tall, and Mapbox flips the popup
      // above or below the mark, so the radius is the extent that has to be cleared.
      .setOffset(country.r + POPUP_GAP_PX)
      .setDOMContent(createPopupContent(subject, formatValueRef.current, formatSignedRef.current))
      .addTo(map)
  }, [])

  const hidePopup = useCallback(() => {
    popupRef.current?.remove()
  }, [])

  const zoomBy = useCallback((delta: number) => {
    const map = mapRef.current
    if (!map) return
    map.easeTo({ zoom: map.getZoom() + delta })
  }, [])

  const resetView = useCallback(() => {
    mapRef.current?.fitBounds(WORLD_BOUNDS, { padding: 0, duration: 300, linear: true })
  }, [])

  if (countries.length === 0 && unknown.count === 0) {
    return <p className="chart-empty">{emptyMessage}</p>
  }

  const degraded = status === 'no-token' || status === 'unavailable'
  const byCode = new Map(countries.map((c) => [c.code, c]))

  return (
    <figure className="chart-figure country-map-figure">
      <div className="country-map-frame">
        {degraded ? (
          <div className="country-map-unavailable" role="status">
            <p className="chart-empty">
              {status === 'no-token'
                ? 'Map unavailable — no Mapbox token configured.'
                : 'Map unavailable — couldn’t reach the map service.'}
            </p>
            <p className="chart-empty country-map-unavailable-hint">
              {status === 'no-token'
                ? 'Set RENDERER_VITE_MAPBOX_TOKEN in .env to enable the map.'
                : 'Check your connection; your allocation data is unaffected.'}
            </p>
            <p className="chart-empty country-map-unavailable-hint">
              Country and sector values are unchanged — see the breakdown below.
            </p>
          </div>
        ) : (
          <>
            <div ref={containerRef} className="country-map" role="img" aria-label={ariaLabel} />
            {hosts.map(({ code, el }) => {
              const country = byCode.get(code)
              return country
                ? createPortal(
                    <CountryMark
                      country={country}
                      colorMode={colorMode}
                      onEnter={showPopup}
                      onLeave={hidePopup}
                    />,
                    el,
                    code,
                  )
                : null
            })}
            <div className="country-map-controls" role="group" aria-label="Map zoom">
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
      <figcaption className="chart-legend country-map-legend">
        {colorMode === 'sector' ? (
          <ul className="country-map-sectors" aria-label="Sector colours">
            <li className="country-map-sector">
              {/* The gauge's blue is the one hue on the mark that is not a sector, so the legend
                  has to name it or the left chart is unexplained. */}
              <span className="legend-swatch pie-series-1" aria-hidden="true" />
              Country weight
            </li>
            {legend.map((s) => (
              <li key={s.key} className="country-map-sector">
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
        <span className="country-map-pan-hint">
          {colorMode === 'sector'
            ? 'Each country: left donut = its weight in the portfolio (share of NAV), right donut = one slice per sector · size ∝ country value · positioned by issuer country · scroll to zoom · drag to pan'
            : `Colour = unrealized return on cost · left donut for the country, right per sector · beyond ±${RETURN_BOUND}% saturates · gray means flat or unknown`}
        </span>
        {unknown.count > 0 && (
          <span
            className="country-map-unknown"
            title={`${unknown.count} country group(s) with no locatable country`}
          >
            Unknown location — {formatValue(unknown.value)} ({unknown.percent.toFixed(1)}% of NAV)
          </span>
        )}
      </figcaption>
    </figure>
  )
}
