import { describe, expect, it } from 'vitest'
import { centroidFor, MAP_HEIGHT, MAP_WIDTH, projectEquirectangular } from './worldGeo'

/**
 * Pure geography behind the Allocation world map (Story #46): the equirectangular projection
 * and the centroid lookup. The React component isn't unit-tested (Vitest runs Node with no
 * DOM), and the data → bubbles transform now lives in `lib/sectorMap` (Story #71).
 */

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
