import { describe, expect, it } from 'vitest'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { centroidFor } from './worldGeo'
import { sectorPalette } from './sectorMap'
import { countrySunbursts, normalizedShares, ringPath } from './countrySunbursts'

/**
 * Pure transforms behind the per-country Allocation sunbursts (Story #122, DDR-0030). The component
 * isn't unit-tested (Vitest runs Node with no DOM), so the nesting, share normalization, radius
 * scaling, dot degradation, ordering and unknown-bucket folding are what carry the logic.
 *
 * Inherits the coverage the retired `positionBubbles` suite carried — unknown folding, √value radius
 * scaling, centroid anchoring and the empty case — and adds the nesting invariant that is new here.
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

/** R_MIN / R_MAX / DOT_MAX_RADIUS in the module. */
const R_MIN = 6
const R_MAX = 32
const DOT_MAX_RADIUS = 14

const techPalette = (): ReturnType<typeof sectorPalette> =>
  sectorPalette([sectorSlice('Technology', 100)])

const twoSectorPalette = (): ReturnType<typeof sectorPalette> =>
  sectorPalette([sectorSlice('Technology', 100), sectorSlice('Energy', 50)])

describe('normalizedShares', () => {
  it('returns plain value shares when every wedge clears the floor', () => {
    expect(normalizedShares([60, 40])).toEqual([0.6, 0.4])
  })

  it('always sums to one', () => {
    for (const values of [[1], [5, 5], [99, 1], [1000, 1, 1, 1], [0, 0, 7]]) {
      const total = normalizedShares(values).reduce((sum, s) => sum + s, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })

  it('lifts a negligible holding to a hoverable floor', () => {
    // 0.1% of the ring would be a sub-pixel sliver; it is lifted to the 2% floor.
    const [big, tiny] = normalizedShares([9990, 10])
    expect(tiny).toBeGreaterThanOrEqual(0.019)
    // The distortion is bounded — the dominant holding still takes the overwhelming majority.
    expect(big).toBeGreaterThan(0.97)
  })

  it('gives a short (value <= 0) a reachable wedge rather than none', () => {
    const [, short] = normalizedShares([1000, -50])
    expect(short).toBeGreaterThan(0)
  })

  it('splits evenly when nothing in the ring has positive value', () => {
    expect(normalizedShares([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(normalizedShares([-10, -30])).toEqual([0.5, 0.5])
  })

  it('shrinks the floor so floors can never claim more than half a busy ring', () => {
    // 50 holdings x a 2% floor would be 100% of the ring; the floor drops to 0.5/n instead.
    const shares = normalizedShares([1000, ...Array.from({ length: 49 }, () => 0.0001)])
    expect(shares.reduce((sum, s) => sum + s, 0)).toBeCloseTo(1, 10)
    expect(shares[0]).toBeGreaterThan(0.45)
  })

  it('has no shares for an empty ring', () => {
    expect(normalizedShares([])).toEqual([])
  })
})

describe('ringPath', () => {
  it('draws a full turn as two half-arcs, so a single-holding country is not erased', () => {
    const full = ringPath(10, 4, 0, 2 * Math.PI)
    // One arc whose start and end coincide would render nothing; two 'M' commands means two arcs.
    expect(full.match(/M /g)).toHaveLength(2)
  })

  it('draws a partial ring as one arc', () => {
    expect(ringPath(10, 4, 0, Math.PI / 2).match(/M /g)).toHaveLength(1)
  })
})

describe('countrySunbursts', () => {
  it('draws one mark per issuer country, anchored on the country centroid', () => {
    const { countries } = countrySunbursts(
      [
        position({ symbol: 'AAPL', issuerCountry: 'US' }),
        position({ symbol: 'MSFT', issuerCountry: 'US' }),
        position({ symbol: 'ASML', issuerCountry: 'NL' }),
      ],
      techPalette(),
    )

    expect(countries.map((c) => c.code)).toEqual(['US', 'NL'])
    const us = countries[0]!
    expect(us.holdingCount).toBe(2)
    expect(us.lat).toBe(centroidFor('US')!.lat)
    expect(us.lon).toBe(centroidFor('US')!.lon)
    expect(us.countryName).toBe('United States')
  })

  it('orders countries largest first, which is also draw and hit-test order', () => {
    const { countries } = countrySunbursts(
      [
        position({ symbol: 'SMALL', issuerCountry: 'NL', marketValueBase: 10 }),
        position({ symbol: 'BIG', issuerCountry: 'US', marketValueBase: 900 }),
        position({ symbol: 'MID', issuerCountry: 'JP', marketValueBase: 400 }),
      ],
      techPalette(),
    )
    expect(countries.map((c) => c.code)).toEqual(['US', 'JP', 'NL'])
  })

  it('sizes marks by area (r proportional to sqrt of value)', () => {
    const { countries } = countrySunbursts(
      [
        position({ issuerCountry: 'US', marketValueBase: 400 }),
        position({ issuerCountry: 'JP', marketValueBase: 100 }),
      ],
      techPalette(),
    )
    const [us, jp] = countries
    expect(us!.r).toBeCloseTo(R_MAX, 10)
    // A quarter of the value is half the radius of the range above the floor.
    expect(jp!.r).toBeCloseTo(R_MIN + (R_MAX - R_MIN) * 0.5, 10)
  })

  it('nests every holding wedge inside its own sector, and fills the full turn', () => {
    const { countries } = countrySunbursts(
      [
        position({ symbol: 'AAPL', issuerCountry: 'US', sector: 'Technology', marketValueBase: 600 }),
        position({ symbol: 'MSFT', issuerCountry: 'US', sector: 'Technology', marketValueBase: 200 }),
        position({ symbol: 'XOM', issuerCountry: 'US', sector: 'Energy', marketValueBase: 200 }),
      ],
      twoSectorPalette(),
    )
    const us = countries[0]!

    // Sectors are largest-first and cover the whole ring.
    expect(us.sectors.map((s) => s.key)).toEqual(['Technology', 'Energy'])
    expect(us.sectors[0]!.holdingCount).toBe(2)
    expect(us.sectors[1]!.holdingCount).toBe(1)

    // Holdings appear grouped by sector, largest first within each — that ordering is the nesting.
    expect(us.holdings.map((h) => h.ticker)).toEqual(['AAPL', 'MSFT', 'XOM'])
    // A holding wears its sector's hue, so the two rings read as one hierarchy.
    expect(us.holdings[0]!.sectorClass).toBe(us.sectors[0]!.sectorClass)
    expect(us.holdings[2]!.sectorClass).toBe(us.sectors[1]!.sectorClass)
  })

  it('aggregates a sector wedge over its own holdings only', () => {
    const { countries } = countrySunbursts(
      [
        position({
          issuerCountry: 'US',
          sector: 'Technology',
          marketValueBase: 600,
          costBasisBase: 500,
          unrealizedPnlBase: 100,
          percentOfNav: 6,
        }),
        position({
          issuerCountry: 'US',
          sector: 'Energy',
          marketValueBase: 200,
          costBasisBase: 250,
          unrealizedPnlBase: -50,
          percentOfNav: 2,
        }),
      ],
      twoSectorPalette(),
    )
    const us = countries[0]!
    const tech = us.sectors.find((s) => s.key === 'Technology')!
    const energy = us.sectors.find((s) => s.key === 'Energy')!

    expect(tech.marketValueBase).toBe(600)
    expect(tech.percentOfNav).toBe(6)
    expect(tech.returnPercent).toBeCloseTo(20, 10)
    expect(energy.returnPercent).toBeCloseTo(-20, 10)
    // The country aggregates both — a gain and a loss net out rather than being averaged.
    expect(us.marketValueBase).toBe(800)
    expect(us.unrealizedPnlBase).toBe(50)
    expect(us.returnPercent).toBeCloseTo((50 / 750) * 100, 10)
  })

  it('degrades a country too small to split into rings to a plain dot', () => {
    const { countries } = countrySunbursts(
      [
        position({ issuerCountry: 'US', marketValueBase: 10_000 }),
        position({ issuerCountry: 'NL', marketValueBase: 50 }),
      ],
      techPalette(),
    )
    const [us, nl] = countries
    expect(us!.dot).toBe(false)
    expect(us!.sectors[0]!.path).not.toBe('')

    expect(nl!.r).toBeLessThan(DOT_MAX_RADIUS)
    expect(nl!.dot).toBe(true)
    // The wedges still exist — the popup and totals need them — but carry no path to draw.
    expect(nl!.sectors).toHaveLength(1)
    expect(nl!.sectors[0]!.path).toBe('')
    expect(nl!.holdings[0]!.path).toBe('')
    // A dot still has to choose one fill: its largest sector's.
    expect(nl!.sectorClass).toBe(nl!.sectors[0]!.sectorClass)
  })

  it('keeps a mark above the floor radius however small the country', () => {
    const { countries } = countrySunbursts(
      [
        position({ issuerCountry: 'US', marketValueBase: 1_000_000 }),
        position({ issuerCountry: 'JP', marketValueBase: 0.01 }),
      ],
      techPalette(),
    )
    expect(countries[1]!.r).toBeGreaterThanOrEqual(R_MIN)
  })

  it('names a tail sector honestly on the holding while colouring it by the grouped key', () => {
    // Nine sectors: the palette keeps eight slots, so the ninth folds into a neutral 'Other'.
    const slices = Array.from({ length: 9 }, (_, i) => sectorSlice(`S${i}`, 100 - i))
    const palette = sectorPalette(slices)
    const { countries } = countrySunbursts(
      [position({ issuerCountry: 'US', sector: 'S8', symbol: 'TAIL' })],
      palette,
    )
    const holding = countries[0]!.holdings[0]!
    expect(holding.sectorLabel).toBe('S8')
    expect(holding.sectorClass).toBe('pie-series-neutral')
    // The wedge it sits in is the grouped display key, and says so.
    expect(countries[0]!.sectors[0]!.label).toMatch(/^Other/)
  })

  it('folds positions with no locatable country into the unknown bucket, one count per country', () => {
    const { countries, unknown } = countrySunbursts(
      [
        position({ issuerCountry: 'US', marketValueBase: 100, percentOfNav: 10 }),
        position({ issuerCountry: '', marketValueBase: 40, percentOfNav: 4 }),
        position({ issuerCountry: 'ZZ', marketValueBase: 20, percentOfNav: 2 }),
        position({ issuerCountry: 'ZZ', marketValueBase: 10, percentOfNav: 1 }),
      ],
      techPalette(),
    )
    expect(countries.map((c) => c.code)).toEqual(['US'])
    expect(unknown).toEqual({ value: 70, percent: 7, count: 2 })
  })

  it('scales against the largest placeable country, so an unmappable giant cannot flatten the map', () => {
    const { countries } = countrySunbursts(
      [
        position({ issuerCountry: 'ZZ', marketValueBase: 1_000_000 }),
        position({ issuerCountry: 'US', marketValueBase: 400 }),
        position({ issuerCountry: 'JP', marketValueBase: 100 }),
      ],
      techPalette(),
    )
    expect(countries[0]!.r).toBeCloseTo(R_MAX, 10)
  })

  it('reports no return when there is no cost basis to measure against', () => {
    const { countries } = countrySunbursts(
      [position({ issuerCountry: 'US', costBasisBase: 0, unrealizedPnlBase: 0 })],
      techPalette(),
    )
    expect(countries[0]!.returnPercent).toBeNull()
    // The neutral step means 'flat or unknown' — which is why the popup states the figure.
    expect(countries[0]!.gainLossClass).toBe('map-diverge-4')
  })

  it('has nothing to draw for an empty portfolio', () => {
    expect(countrySunbursts([], techPalette())).toEqual({
      countries: [],
      unknown: { value: 0, percent: 0, count: 0 },
    })
  })
})
