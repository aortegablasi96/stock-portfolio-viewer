import { describe, expect, it } from 'vitest'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { centroidFor, projectEquirectangular } from './worldGeo'
import { OTHER_KEY } from './pie'
import { sectorPalette, splitSectorBubbles } from './sectorMap'

/**
 * Pure transforms behind the sector-segmented world map (Story #71). The React component
 * isn't unit-tested (Vitest runs Node with no DOM); the palette matching, per-country wedge
 * aggregation, unknown-bucket folding and radius scaling carry the logic worth testing.
 */

const sectorSlice = (key: string, marketValueBase: number, percentOfNav = 0): AllocationSlice => ({
  key,
  label: key || 'Unclassified',
  marketValueBase,
  percentOfNav,
})

const position = (over: Partial<AllocationPosition>): AllocationPosition => ({
  conid: null,
  symbol: 'SYM',
  description: '',
  assetCategory: 'STK',
  currency: 'USD',
  issuerCountry: 'US',
  sector: 'Technology',
  industry: '',
  marketValueBase: 100,
  costBasisBase: 0,
  unrealizedPnlBase: 0,
  percentOfNav: 0,
  ...over,
})

describe('sectorPalette', () => {
  it('assigns categorical hues to named sectors and neutral to unclassified', () => {
    const palette = sectorPalette([
      sectorSlice('Technology', 100, 50),
      sectorSlice('Financials', 40, 20),
      sectorSlice('', 10, 5), // unclassified
    ])

    expect(palette.colorClassOf('Technology')).toBe('pie-series-1')
    expect(palette.colorClassOf('Financials')).toBe('pie-series-2')
    // The empty (unclassified) key is a residual — neutral, never a categorical hue.
    expect(palette.colorClassOf('')).toBe('pie-series-neutral')
    expect(palette.legend.map((e) => e.key)).toEqual(['Technology', 'Financials', ''])
  })

  it('folds sectors past the palette into a neutral Other, matching the donut tail', () => {
    // Nine named sectors → the eighth+ collapse into a single "Other" slice.
    const slices = Array.from({ length: 9 }, (_, i) => sectorSlice(`S${i}`, 100 - i))
    const palette = sectorPalette(slices)

    // Eight legend entries: seven named + Other.
    expect(palette.legend).toHaveLength(8)
    expect(palette.legend[7]!.key).toBe(OTHER_KEY)
    expect(palette.colorClassOf(OTHER_KEY)).toBe('pie-series-neutral')
    // A tail sector displays as Other and inherits the neutral colour.
    expect(palette.displayKeyOf('S8')).toBe(OTHER_KEY)
    expect(palette.displayKeyOf('S0')).toBe('S0')
    expect(palette.labelOf(OTHER_KEY)).toBe('Other (2)')
  })
})

describe('splitSectorBubbles', () => {
  it('groups positions by country and splits each bubble into sector wedges', () => {
    const bySector = [sectorSlice('Technology', 150, 60), sectorSlice('Financials', 50, 20)]
    const palette = sectorPalette(bySector)
    const { bubbles, unknown } = splitSectorBubbles(
      [
        position({ issuerCountry: 'US', sector: 'Technology', marketValueBase: 100 }),
        position({ issuerCountry: 'US', sector: 'Financials', marketValueBase: 50 }),
        position({ issuerCountry: 'DE', sector: 'Technology', marketValueBase: 50 }),
      ],
      palette,
    )

    // Two mappable countries, largest total first (US = 150, DE = 50).
    expect(bubbles.map((b) => b.code)).toEqual(['US', 'DE'])
    const us = bubbles[0]!
    expect(us.value).toBe(150)
    // US splits into two wedges (Tech + Financials); DE into one (Tech only).
    expect(us.wedges.map((w) => w.key).sort()).toEqual(['Financials', 'Technology'])
    expect(bubbles[1]!.wedges.map((w) => w.key)).toEqual(['Technology'])
    // Every wedge carries a colour class matching the palette.
    expect(us.wedges.find((w) => w.key === 'Technology')!.colorClass).toBe('pie-series-1')
    expect(unknown).toEqual({ value: 0, percent: 0, count: 0 })
  })

  it('folds positions with no mappable country into the unknown bucket', () => {
    const palette = sectorPalette([sectorSlice('Technology', 100)])
    const { bubbles, unknown } = splitSectorBubbles(
      [
        position({ issuerCountry: 'US', marketValueBase: 100, percentOfNav: 40 }),
        position({ issuerCountry: '', marketValueBase: 10, percentOfNav: 4 }), // no country
        position({ issuerCountry: 'ZZ', marketValueBase: 5, percentOfNav: 2 }), // no centroid
      ],
      palette,
    )

    expect(bubbles.map((b) => b.code)).toEqual(['US'])
    // Both the '' group and the unmappable 'ZZ' group aggregate — one count each.
    expect(unknown).toEqual({ value: 15, percent: 6, count: 2 })
  })

  it('scales bubble radius by area (r proportional to sqrt of country total)', () => {
    const palette = sectorPalette([sectorSlice('Technology', 125)])
    const { bubbles } = splitSectorBubbles(
      [
        position({ issuerCountry: 'US', marketValueBase: 100 }),
        position({ issuerCountry: 'DE', marketValueBase: 25 }),
      ],
      palette,
    )
    const us = bubbles.find((b) => b.code === 'US')!
    const de = bubbles.find((b) => b.code === 'DE')!
    // A quarter of the value → half the radius delta above the minimum.
    expect(de.r - 3).toBeCloseTo((us.r - 3) / 2, 5)
  })

  it('positions a bubble at its centroid projection', () => {
    const palette = sectorPalette([sectorSlice('Technology', 100)])
    const { bubbles } = splitSectorBubbles([position({ issuerCountry: 'US' })], palette)
    const us = centroidFor('US')!
    expect(bubbles[0]).toMatchObject(projectEquirectangular(us.lon, us.lat))
  })

  it('orders wedges with categorical hues first and the neutral bucket last', () => {
    const palette = sectorPalette([sectorSlice('Technology', 100), sectorSlice('', 200)])
    const { bubbles } = splitSectorBubbles(
      [
        // Unclassified is larger by value, but should still render after the coloured wedge.
        position({ issuerCountry: 'US', sector: '', marketValueBase: 200 }),
        position({ issuerCountry: 'US', sector: 'Technology', marketValueBase: 100 }),
      ],
      palette,
    )
    const wedges = bubbles[0]!.wedges
    expect(wedges[0]!.key).toBe('Technology')
    expect(wedges[1]!.colorClass).toBe('pie-series-neutral')
  })

  it('returns an empty, well-formed result when there is nothing to place', () => {
    const palette = sectorPalette([])
    expect(splitSectorBubbles([], palette)).toEqual({
      bubbles: [],
      unknown: { value: 0, percent: 0, count: 0 },
    })
  })
})
