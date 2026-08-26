import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from '@playwright/test'

const mainEntry = join(__dirname, '..', 'out', 'main', 'index.js')

/**
 * A country mark never leaves the map's frame; the popup still does (Bug #272, DDR-0074).
 *
 * `allocationLayout.test.ts` asserts the stylesheet's half — that the clip, the corner, the
 * containing block and the map's own `overflow: visible` are all written where the decision says.
 * That guard existed for three stories and passed the whole time the marks were escaping: the clip
 * was declared on an element that could not perform it. `mapbox-gl.css` gives
 * `.mapboxgl-canvas-container` no `position`, and Mapbox sizes it with neither, so it resolved
 * `static` at 0px tall — and an `overflow: hidden` ancestor clips an absolutely positioned
 * descendant only when it is that descendant's **containing block**. Every marker is mounted into
 * that container and positioned `absolute`, so the box that clipped them was the map, which
 * DDR-0074 had just opened so the popup could get out. Six donut pairs drew over the KPI tiles,
 * the page title and the sidebar (the screenshot on #272).
 *
 * That is a cascade resolving against a third-party stylesheet, which is precisely what a text
 * scan cannot see — so it is pinned here, the way this app pins every other cascade it rests on.
 *
 * **Read off a probe, not the real map.** The e2e app runs on a fresh user-data directory with
 * nothing imported, so the Allocation view renders `needs_import` and no map is built; the Mapbox
 * token is a build-time inline besides. The probe is Mapbox's own DOM — its class names, its
 * marker transform, its container nesting — inside a real `.country-map-frame`, which is enough
 * because the classes are the whole subject. `mapbox-gl.css` is in the renderer bundle whether a
 * map mounts or not (`CountryMap.tsx` imports it), so both stylesheets are live here.
 *
 * Its own app instance with its own user-data directory, for the reason `tab-navigation.spec.ts`
 * gives: the single-instance lock is scoped to that directory (Story #107).
 */
let app: ElectronApplication
let page: Page
/** The probe's one reading, taken once and asserted from five angles. */
let probed: Probe

test.beforeAll(async () => {
  app = await electron.launch({
    args: [mainEntry, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'spv-e2e-mapclip-'))}`],
  })
  page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  probed = await probe()
})

test.afterAll(async () => {
  await app?.close()
})

/** A box in viewport coordinates. */
type Box = { x: number; y: number; width: number; height: number }

/** What the probe reports back: geometry, the boxes that clip, and what each point hit. */
type Probe = {
  frame: Box
  map: Box
  canvasContainer: Box
  mapOverflow: string
  containerOverflow: string
  containerPosition: string
  containerRadius: string
  mapRadius: string
  /** The nearest positioned ancestor — for an absolutely positioned box, its containing block. */
  markOffsetParent: string | null
  popupOffsetParent: string | null
  /** Whether `elementFromPoint` at each subject's own centre landed inside that subject. */
  insideMarkHit: boolean
  outsideMarkHit: boolean
  /** Where the escaped mark was probed, and whether that point was on screen to be probed at all. */
  outsideMarkPoint: [number, number]
  outsideMarkOnScreen: boolean
  outsideMarkClearsFrame: boolean
  popupHit: boolean
  attributionHit: boolean
  /** The popup's real pointer behaviour, read before the probe overrides it to be measurable. */
  popupPointerEvents: string
  /** How far the popup hangs below the map — the DDR-0074 exception, in pixels. */
  popupBelowMapPx: number
}

/**
 * Builds Mapbox's DOM under the app's own classes, then probes four points with
 * `elementFromPoint`.
 *
 * Hit-testing is the readable half of an overflow clip: a clipped box is neither painted nor
 * hit-tested outside its clipper, while `getBoundingClientRect` reports the same rectangle either
 * way — which is why the escaped marks measured as escaping both before the fix and after it. The
 * probe is fixed to the top-left of the viewport rather than parked off screen, because a point
 * outside the viewport cannot be probed at all.
 *
 * Two marks, identical but for where Mapbox put them: one over the middle of the frame, one
 * translated past its right edge, both carrying the marker transform Mapbox writes
 * (`translate(-50%, -50%)` plus the projected offset). The inside one is the control — without it
 * a clip and a mark that never drew would report the same thing.
 *
 * **The escaped mark has to land somewhere probeable**, which is why it goes right rather than
 * left: `elementFromPoint` outside the viewport returns `null`, and `null` reads as "clipped".
 * Written with the mark off the left edge, this file passed against the *unfixed* stylesheet. So
 * the point and whether it was on screen come back with the reading and are asserted too.
 */
const probe = (): Promise<Probe> =>
  page.evaluate(() => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height }
    }

    const wrapper = document.createElement('div')
    wrapper.style.cssText = 'position:fixed;top:24px;left:24px;width:600px;z-index:9999'

    const frame = document.createElement('div')
    frame.className = 'country-map-frame'

    const map = document.createElement('div')
    map.className = 'country-map mapboxgl-map'
    map.setAttribute('role', 'group')

    // Mapbox's own nesting: the canvas and every marker go in the canvas container, while the
    // control container and any popup are its siblings under the map.
    const container = document.createElement('div')
    container.className = 'mapboxgl-canvas-container mapboxgl-interactive mapboxgl-touch-drag-pan'
    const canvas = document.createElement('canvas')
    canvas.className = 'mapboxgl-canvas'
    canvas.style.cssText = 'width:100%;height:100%'
    container.append(canvas)

    /** One country mark, at the offset Mapbox would have projected it to. */
    const mark = (dx: number, dy: number): HTMLDivElement => {
      const host = document.createElement('div')
      host.className = 'mapboxgl-marker country-marker'
      host.setAttribute('tabindex', '-1')
      host.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px)`
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('class', 'country-mark')
      svg.setAttribute('width', '48')
      svg.setAttribute('height', '48')
      svg.setAttribute('viewBox', '-24 -24 48 48')
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      // `.country-mark-dot` is the app's own hit target — `pointer-events: auto` over a marker
      // host that is otherwise transparent to the pointer.
      dot.setAttribute('class', 'country-mark-dot pie-series-1')
      dot.setAttribute('r', '20')
      svg.append(dot)
      host.append(svg)
      return host
    }

    const inside = mark(300, 100)
    // Past the frame's right edge and still well inside a 1280px-wide window.
    const outside = mark(660, 100)
    container.append(inside, outside)

    // Mapbox's controls: a sibling of the canvas container, carrying the attribution links that
    // are why the map is a `group` rather than an `img` (DDR-0047).
    const controls = document.createElement('div')
    controls.className = 'mapboxgl-control-container'
    const corner = document.createElement('div')
    corner.className = 'mapboxgl-ctrl-bottom-right'
    const attrib = document.createElement('div')
    attrib.className = 'mapboxgl-ctrl mapboxgl-ctrl-attrib mapboxgl-compact-show'
    const link = document.createElement('a')
    link.href = 'https://www.mapbox.com/about/maps/'
    link.textContent = '© Mapbox'
    attrib.append(link)
    corner.append(attrib)
    controls.append(corner)

    // The popup: a direct child of the map, as `Popup.addTo` appends it, hung below the frame the
    // way Mapbox flips one under its mark.
    const popup = document.createElement('div')
    popup.className = 'mapboxgl-popup mapboxgl-popup-anchor-top map-popup-shell'
    popup.style.transform = 'translate(0, 0) translate(300px, 320px)'
    const content = document.createElement('div')
    content.className = 'mapboxgl-popup-content'
    content.style.cssText = 'width:200px;height:180px'
    popup.append(content)

    map.append(container, controls, popup)
    frame.append(map)
    wrapper.append(frame)
    document.body.append(wrapper)

    const style = getComputedStyle(popup)
    const popupPointerEvents = style.pointerEvents

    const centre = (el: Element): [number, number] => {
      const r = el.getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2]
    }
    const hits = (el: Element): boolean => {
      const [x, y] = centre(el)
      const hit = document.elementFromPoint(x, y)
      return hit !== null && el.contains(hit)
    }

    const insideMarkHit = hits(inside.firstElementChild!)
    const outsideMarkHit = hits(outside.firstElementChild!)
    const outsideMarkPoint = centre(outside.firstElementChild!)
    const outsideMarkBox = box(outside.firstElementChild!)
    const attributionHit = hits(link)

    // The popup is `pointer-events: none` so a hover card can never cover something reachable
    // (DDR-0074). That also makes it unprobeable, so the probe lifts it on this copy only — the
    // subject is whether the box *paints* outside the map, and the real declaration is asserted
    // above it rather than replaced.
    popup.style.pointerEvents = 'auto'
    content.style.pointerEvents = 'auto'
    const popupHit = hits(content)

    const mapBox = box(map)
    const popupBox = box(popup)

    const result: Probe = {
      frame: box(frame),
      map: mapBox,
      canvasContainer: box(container),
      mapOverflow: getComputedStyle(map).overflow,
      containerOverflow: getComputedStyle(container).overflow,
      containerPosition: getComputedStyle(container).position,
      containerRadius: getComputedStyle(container).borderRadius,
      mapRadius: getComputedStyle(map).borderRadius,
      markOffsetParent: (inside.offsetParent as HTMLElement | null)?.className ?? null,
      popupOffsetParent: (popup.offsetParent as HTMLElement | null)?.className ?? null,
      insideMarkHit,
      outsideMarkHit,
      outsideMarkPoint,
      outsideMarkOnScreen:
        outsideMarkPoint[0] > 0 &&
        outsideMarkPoint[1] > 0 &&
        outsideMarkPoint[0] < window.innerWidth &&
        outsideMarkPoint[1] < window.innerHeight,
      outsideMarkClearsFrame: outsideMarkBox.x > mapBox.x + mapBox.width,
      attributionHit,
      popupHit,
      popupPointerEvents,
      popupBelowMapPx: popupBox.y + popupBox.height - (mapBox.y + mapBox.height),
    }

    wrapper.remove()
    return result
  })

test('a mark inside the frame is drawn and reachable', async () => {
  // The control. A clip that swallowed every mark would satisfy the next test on its own.
  expect(probed.map.width).toBeGreaterThan(0)
  expect(probed.map.height).toBeGreaterThan(0)
  expect(probed.insideMarkHit).toBe(true)
})

test('a mark that leaves the frame is clipped at it', async () => {
  // First that there is a reading at all. A probe point off the viewport returns `null` from
  // `elementFromPoint`, which is indistinguishable from a clip — the false pass this spec shipped
  // with once, against the unfixed stylesheet.
  expect(probed.outsideMarkClearsFrame).toBe(true)
  expect(probed.outsideMarkOnScreen).toBe(true)

  // The bug, stated as the thing that can be measured: past the frame's edge the mark is not
  // painted and not hit-tested, so the point belongs to whatever the page has there — which in
  // #272's screenshot was a KPI tile, the page title and the sidebar.
  expect(probed.outsideMarkHit).toBe(false)
})

test('the clip rests on the marks’ own containing block', async () => {
  // Why the declared clip did nothing until #272: `overflow: hidden` binds an absolutely
  // positioned descendant only from its containing block, and Mapbox leaves this element static
  // and unsized. `offsetParent` names the box that actually holds the marks.
  expect(probed.containerPosition).toBe('absolute')
  expect(probed.containerOverflow).toBe('hidden')
  expect(probed.markOffsetParent).toContain('mapboxgl-canvas-container')

  // And it is the map's box, not a strip of it. Before the fix this measured 0px tall.
  expect(probed.canvasContainer.width).toBeCloseTo(probed.map.width, 0)
  expect(probed.canvasContainer.height).toBeCloseTo(probed.map.height, 0)
  expect(probed.canvasContainer.height).toBeGreaterThan(0)

  // The corner the clip cuts is the map's own, so a mark at a corner is cut by the same curve the
  // basemap is.
  expect(parseFloat(probed.containerRadius)).toBeGreaterThan(0)
  expect(probed.containerRadius).toBe(probed.mapRadius)
})

test('the popup still leaves the map, and loses nothing to the frame', async () => {
  // DDR-0074's exception, unchanged: Mapbox appends a popup to the map container, a sibling of the
  // clipper, and the map stays open.
  expect(probed.mapOverflow).toBe('visible')
  expect(probed.popupOffsetParent).toContain('country-map')
  expect(probed.popupOffsetParent).not.toContain('canvas-container')

  // It really does paint below the frame — the half the offsetParent alone would not prove.
  expect(probed.popupBelowMapPx).toBeGreaterThan(0)
  expect(probed.popupHit).toBe(true)

  // And it is still inert, so nothing it hangs over becomes unreachable.
  expect(probed.popupPointerEvents).toBe('none')
})

test('Mapbox’s attribution still paints over the basemap and stays reachable', async () => {
  // The control container is the clipper's other sibling. Its links are required by Mapbox's terms
  // and are the reason the map is a `role="group"` (DDR-0047), so a clip that buried or blocked
  // them would be a different bug in the same rule.
  expect(probed.attributionHit).toBe(true)
})
