import { describe, expect, it } from 'vitest'
import { centroidFor } from './worldGeo'

/**
 * Pure geography behind the Allocation world map: the centroid lookup that anchors each country
 * bubble. The React component isn't unit-tested (Vitest runs Node with no DOM), and the
 * data → bubbles transform lives in `lib/sectorMap` (Story #71).
 *
 * The equirectangular projection this module used to own was retired with the SVG basemap in
 * Story #89 — Mapbox owns projection now (DDR-0019). The centroid table stayed: it is still what
 * places a bubble and names it for the tooltip.
 */

describe('centroidFor', () => {
  it('resolves a known code case-insensitively', () => {
    expect(centroidFor('US')?.name).toBe('United States')
    expect(centroidFor('us')).toEqual(centroidFor('US'))
  })

  it('returns undefined for empty or unknown codes', () => {
    expect(centroidFor('')).toBeUndefined()
    expect(centroidFor('ZZ')).toBeUndefined()
  })
})
