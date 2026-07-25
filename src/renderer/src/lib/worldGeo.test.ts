import { describe, expect, it } from 'vitest'
import type { AllocationSlice } from '@shared/domain/allocation'
import {
  centroidFor,
  MAP_HEIGHT,
  MAP_WIDTH,
  projectEquirectangular,
  splitCountryBubbles,
} from './worldGeo'

/**
 * Pure geo helpers behind the Allocation world map (Story #46). The React component itself
 * isn't unit-tested (Vitest runs Node with no DOM); the projection, centroid lookup, and the
 * slice → bubbles/unknown transform carry the logic worth testing.
 */

const slice = (key: string, marketValueBase: number, percentOfNav = 0): AllocationSlice => ({
  key,
  label: key || 'Unknown',
  marketValueBase,
  percentOfNav,
})

describe('projectEquirectangular', () => {
  it('maps the frame corners and centre', () => {
    expect(projectEquirectangular(-180, 90)).toEqual({ x: 0, y: 0 })
    expect(projectEquirectangular(180, -90)).toEqual({ x: MAP_WIDTH, y: MAP_HEIGHT })
    expect(projectEquirectangular(0, 0)).toEqual({ x: 180, y: 90 })
  })
})

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

describe('splitCountryBubbles', () => {
  it('places known countries and folds everything else into the unknown bucket', () => {
    const { bubbles, unknown } = splitCountryBubbles([
      slice('US', 100, 60),
      slice('DE', 25, 15),
      slice('', 10, 6), // undeterminable issuer country
      slice('ZZ', 5, 3), // a code with no centroid
    ])

    // Only the two mappable countries become bubbles, largest first.
    expect(bubbles.map((b) => b.code)).toEqual(['US', 'DE'])

    // Both the '' slice and the unmappable 'ZZ' slice are aggregated, never dropped.
    expect(unknown).toEqual({ value: 15, percent: 9, count: 2 })
  })

  it('scales radius by area (r proportional to sqrt of value)', () => {
    const { bubbles } = splitCountryBubbles([slice('US', 100), slice('DE', 25)])
    const us = bubbles.find((b) => b.code === 'US')!
    const de = bubbles.find((b) => b.code === 'DE')!

    // A quarter of the value → half the radius delta above the minimum.
    expect(us.r).toBeGreaterThan(de.r)
    expect(de.r - 3).toBeCloseTo((us.r - 3) / 2, 5)
  })

  it('positions a bubble at its centroid projection', () => {
    const { bubbles } = splitCountryBubbles([slice('US', 100)])
    const us = centroidFor('US')!
    expect(bubbles[0]).toMatchObject(projectEquirectangular(us.lon, us.lat))
  })

  it('returns an empty, well-formed result when there is nothing to place', () => {
    expect(splitCountryBubbles([])).toEqual({
      bubbles: [],
      unknown: { value: 0, percent: 0, count: 0 },
    })
  })
})
