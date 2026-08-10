import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The Allocation map's accessibility structure (#164).
 *
 * No module under test — the subject is `CountryMap.tsx` itself, the same shape as
 * `designTokens.test.ts` taking the stylesheet as its subject. It has to be a text guard: the
 * decision lives in a `.tsx`, Vitest runs in Node with no jsdom so the component cannot be
 * rendered, and the only place that *could* observe the real DOM is `e2e/` — which CI does not
 * run, because it needs a display server. A guard that runs only when someone remembers is not a
 * guard.
 *
 * What it protects is a contradiction that took an audit to notice and one line to reintroduce.
 * The container used to declare `role="img"`, which tells assistive technology "one atomic
 * graphic, nothing inside worth exploring" — while Mapbox mounted a focusable canvas and an
 * attribution control inside it. A screen reader was told not to look; a keyboard could still
 * walk in.
 */

const RAW = readFileSync(new URL('../components/charts/CountryMap.tsx', import.meta.url), 'utf8')

/**
 * The source with its comments removed.
 *
 * Not optional. This file *explains* its own decisions in prose, so `keyboard: false` and
 * `role="img"` both appear in comments as well as in code — and a scan of the raw text passes on
 * the commentary alone. Verified: deleting the real `keyboard: false` declaration left the
 * assertion green, because the sentence describing it still matched. `tokenAdoption.ts` records
 * the same trap in `app.css`, which quotes lengths in prose.
 *
 * Only block comments and whole-line `//` comments are stripped — a naive `//` rule would eat
 * `mapbox://styles/...`, which is a value this file legitimately carries.
 */
const SOURCE = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the map container', () => {
  it('is a group, never an image', () => {
    // `img` is the specific role that forbids focusable descendants, and the attribution control
    // means this container will always have some. Reintroducing it re-opens #164 exactly.
    expect(SOURCE).toMatch(/className="country-map"[^/>]*role="group"/)
    expect(SOURCE).not.toMatch(/className="country-map"[^/>]*role="img"/)
  })

  it('still carries an accessible name', () => {
    // A group with no name is worse than no group: it adds a boundary a screen reader announces
    // and cannot describe.
    expect(SOURCE).toMatch(/className="country-map"[^/>]*aria-label=\{ariaLabel\}/)
  })
})

describe('the graphics inside it are inert', () => {
  it('turns off Mapbox’s keyboard panning', () => {
    expect(SOURCE).toMatch(/keyboard:\s*false/)
  })

  it('takes the canvas out of the tab order', () => {
    expect(SOURCE).toMatch(/getCanvas\(\)\.setAttribute\('tabindex',\s*'-1'\)/)
  })

  it('takes every marker out of the tab order, before Mapbox can claim it', () => {
    // Order matters and is not obvious: Mapbox assigns its own `tabindex="0"` only when the
    // element does not already carry one, so the attribute must be set *before* the Marker is
    // constructed. Setting it afterwards would be silently undone.
    const setsTabindex = SOURCE.indexOf(`el.setAttribute('tabindex', '-1')`)
    const constructsMarker = SOURCE.indexOf('new mapboxgl.Marker(')
    expect(setsTabindex, 'markers must opt out of the tab order').toBeGreaterThan(-1)
    expect(setsTabindex, 'tabindex must be set before the Marker is constructed').toBeLessThan(
      constructsMarker,
    )
  })
})

describe('what must stay reachable', () => {
  it('keeps Mapbox’s attribution, which is required by their terms', () => {
    // This is *why* the container cannot be an `img`. If attribution were ever switched off, the
    // reasoning above would change — so the two are pinned together deliberately.
    expect(SOURCE).toMatch(/attributionControl:\s*true/)
  })

  it('keeps the zoom controls outside the map container, as real buttons', () => {
    // They are siblings, in their own labelled group, so making the map's graphics inert cannot
    // reach them. If they moved inside, they would become focusable descendants again.
    const controls = SOURCE.indexOf('country-map-controls')
    const container = SOURCE.indexOf('className="country-map"')
    expect(controls).toBeGreaterThan(container)
    expect(SOURCE).toMatch(/className="country-map-controls"\s*role="group"/)
    expect(SOURCE).toMatch(/aria-label="Zoom in"/)
  })
})
