import { describe, expect, it } from 'vitest'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { centroidFor } from './worldGeo'
import { sectorPalette } from './sectorMap'
import { countryDonuts, donutPath, normalizedShares } from './countryDonuts'

/**
 * Pure transforms behind the per-country donut pairs (Story #122, DDR-0030). The component isn't
 * unit-tested (Vitest runs Node with no DOM), so the two donuts' composition, share normalization,
 * radius scaling, dot degradation, ordering and unknown-bucket folding are what carry the logic.
 *
 * Inherits the coverage the retired `positionBubbles` suite carried — unknown folding, √value radius
 * scaling, centroid anchoring and the empty case.
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
const R_MIN = 5
const R_MAX = 24
const DOT_MAX_RADIUS = 9

const techPalette = (): ReturnType<typeof sectorPalette> =>
  sectorPalette([sectorSlice('Technology', 100)])

const twoSectorPalette = (): ReturnType<typeof sectorPalette> =>
  sectorPalette([sectorSlice('Technology', 100), sectorSlice('Energy', 50)])

describe('normalizedShares', () => {
  it('returns plain value shares when every slice clears the floor', () => {
    expect(normalizedShares([60, 40])).toEqual([0.6, 0.4])
  })

  it('always sums to one', () => {
    for (const values of [[1], [5, 5], [99, 1], [1000, 1, 1, 1], [0, 0, 7]]) {
      const total = normalizedShares(values).reduce((sum, s) => sum + s, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })

  it('lifts a negligible holding to a hoverable floor', () => {
    const [big, tiny] = normalizedShares([9990, 10])
    expect(tiny).toBeGreaterThanOrEqual(0.019)
    // The distortion is bounded — the dominant holding still takes the overwhelming majority.
    expect(big).toBeGreaterThan(0.97)
  })

  it('gives a short (value <= 0) a reachable slice rather than none', () => {
    const [, short] = normalizedShares([1000, -50])
    expect(short).toBeGreaterThan(0)
  })

  it('splits evenly when nothing in the donut has positive value', () => {
    expect(normalizedShares([0, 0, 0])).toEqual([1 / 3, 1 / 3, 1 / 3])
    expect(normalizedShares([-10, -30])).toEqual([0.5, 0.5])
  })

  it('shrinks the floor so floors can never claim more than half a busy donut', () => {
    const shares = normalizedShares([1000, ...Array.from({ length: 49 }, () => 0.0001)])
    expect(shares.reduce((sum, s) => sum + s, 0)).toBeCloseTo(1, 10)
    expect(shares[0]).toBeGreaterThan(0.45)
  })

  it('has no shares for an empty donut', () => {
    expect(normalizedShares([])).toEqual([])
  })
})

describe('donutPath', () => {
  it('draws a full turn as two half-arcs, so a single-holding country is not erased', () => {
    expect(donutPath(0, 10, 4, 0, 2 * Math.PI).match(/M /g)).toHaveLength(2)
  })

  it('draws a partial ring as one arc', () => {
    expect(donutPath(0, 10, 4, 0, Math.PI / 2).match(/M /g)).toHaveLength(1)
  })

  it('centres the ring on the offset it is given, so the pair sits side by side', () => {
    // The two donuts differ only by the sign of their centre offset.
    expect(donutPath(-20, 10, 4, 0, Math.PI / 2)).not.toEqual(
      donutPath(20, 10, 4, 0, Math.PI / 2),
    )
  })
})

describe('countryDonuts', () => {
  it('draws one mark per issuer country, anchored on the country centroid', () => {
    const { countries } = countryDonuts(
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

  it('places the two donuts either side of the mark origin', () => {
    const { countries } = countryDonuts([position({ issuerCountry: 'US' })], techPalette())
    const us = countries[0]!
    // Left donut is drawn at −cx, right at +cx, so the paths differ and the pair is symmetric.
    expect(us.cx).toBeGreaterThan(us.r)
    expect(us.holdings[0]!.path).not.toEqual(us.sectors[0]!.path)
  })

  it('orders countries largest first, which is also draw and hit-test order', () => {
    const { countries } = countryDonuts(
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
    const { countries } = countryDonuts(
      [
        position({ issuerCountry: 'US', marketValueBase: 400 }),
        position({ issuerCountry: 'JP', marketValueBase: 100 }),
      ],
      techPalette(),
    )
    expect(countries[0]!.r).toBeCloseTo(R_MAX, 10)
    expect(countries[1]!.r).toBeCloseTo(R_MIN + (R_MAX - R_MIN) * 0.5, 10)
  })

  it('gives every holding in the left donut its own colour', () => {
    // The defect this design replaced: holdings tinted with their sector's hue read as one block.
    const { countries } = countryDonuts(
      [
        position({ symbol: 'AAPL', sector: 'Technology', marketValueBase: 600 }),
        position({ symbol: 'MSFT', sector: 'Technology', marketValueBase: 300 }),
        position({ symbol: 'NVDA', sector: 'Technology', marketValueBase: 100 }),
      ],
      techPalette(),
    )
    const classes = countries[0]!.holdings.map((h) => h.colorClass)
    expect(new Set(classes).size).toBe(3)
    expect(classes).toEqual(['pie-series-1', 'pie-series-2', 'pie-series-3'])
  })

  it('colours the right donut from the shared sector palette, so the legend explains it', () => {
    const palette = twoSectorPalette()
    const { countries } = countryDonuts(
      [
        position({ symbol: 'AAPL', sector: 'Technology', marketValueBase: 600 }),
        position({ symbol: 'XOM', sector: 'Energy', marketValueBase: 200 }),
      ],
      palette,
    )
    const sectors = countries[0]!.sectors
    expect(sectors.map((s) => s.label)).toEqual(['Technology', 'Energy'])
    expect(sectors[0]!.colorClass).toBe(palette.colorClassOf('Technology'))
    expect(sectors[1]!.colorClass).toBe(palette.colorClassOf('Energy'))
  })

  it('splits the same country two ways, over the same total', () => {
    const { countries } = countryDonuts(
      [
        position({ symbol: 'AAPL', sector: 'Technology', marketValueBase: 600, percentOfNav: 6 }),
        position({ symbol: 'MSFT', sector: 'Technology', marketValueBase: 200, percentOfNav: 2 }),
        position({ symbol: 'XOM', sector: 'Energy', marketValueBase: 200, percentOfNav: 2 }),
      ],
      twoSectorPalette(),
    )
    const us = countries[0]!
    const sum = (slices: { marketValueBase: number }[]): number =>
      slices.reduce((t, s) => t + s.marketValueBase, 0)

    expect(us.holdings).toHaveLength(3)
    expect(us.sectors).toHaveLength(2)
    expect(sum(us.holdings)).toBe(1000)
    expect(sum(us.sectors)).toBe(1000)
    expect(us.marketValueBase).toBe(1000)
    // Each slice reports its share of the country — what its angle encodes.
    expect(us.holdings[0]!.percentOfCountry).toBeCloseTo(60, 10)
    expect(us.sectors[0]!.percentOfCountry).toBeCloseTo(80, 10)
    expect(us.sectors[0]!.holdingCount).toBe(2)
  })

  it('folds the left donut past eight slices into an aggregated Other', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      position({ symbol: `H${i}`, conid: i, marketValueBase: 100 - i }),
    )
    const us = countryDonuts(many, techPalette()).countries[0]!

    expect(us.holdings).toHaveLength(8)
    const tail = us.holdings[7]!
    expect(tail.label).toBe('Other (5)')
    expect(tail.holdingCount).toBe(5)
    // Nothing is lost: the tail carries the value of every holding it covers.
    expect(us.holdings.reduce((t, h) => t + h.marketValueBase, 0)).toBe(
      many.reduce((t, p) => t + p.marketValueBase, 0),
    )
    // The country still knows how many positions it really holds.
    expect(us.holdingCount).toBe(12)
  })

  it('keeps a short as its own slice rather than filtering it out', () => {
    const us = countryDonuts(
      [
        position({ symbol: 'LONG', conid: 1, marketValueBase: 1000 }),
        position({ symbol: 'SHORT', conid: 2, marketValueBase: -40 }),
      ],
      techPalette(),
    ).countries[0]!
    expect(us.holdings.map((h) => h.label)).toEqual(['LONG', 'SHORT'])
    expect(us.holdings[1]!.path).not.toBe('')
  })

  it('aggregates returns per slice and nets them at the country', () => {
    const us = countryDonuts(
      [
        position({
          sector: 'Technology',
          marketValueBase: 600,
          costBasisBase: 500,
          unrealizedPnlBase: 100,
        }),
        position({
          sector: 'Energy',
          marketValueBase: 200,
          costBasisBase: 250,
          unrealizedPnlBase: -50,
        }),
      ],
      twoSectorPalette(),
    ).countries[0]!

    expect(us.sectors.find((s) => s.label === 'Technology')!.returnPercent).toBeCloseTo(20, 10)
    expect(us.sectors.find((s) => s.label === 'Energy')!.returnPercent).toBeCloseTo(-20, 10)
    expect(us.unrealizedPnlBase).toBe(50)
    expect(us.returnPercent).toBeCloseTo((50 / 750) * 100, 10)
  })

  it('degrades a country too small to draw as a pair to a single disc', () => {
    const { countries } = countryDonuts(
      [
        position({ issuerCountry: 'US', marketValueBase: 10_000 }),
        position({ issuerCountry: 'NL', marketValueBase: 50 }),
      ],
      techPalette(),
    )
    const [us, nl] = countries
    expect(us!.dot).toBe(false)
    expect(us!.holdings[0]!.path).not.toBe('')

    expect(nl!.r).toBeLessThan(DOT_MAX_RADIUS)
    expect(nl!.dot).toBe(true)
    // The slices still exist — the popup and totals need them — but carry no path to draw.
    expect(nl!.holdings[0]!.path).toBe('')
    expect(nl!.sectors[0]!.path).toBe('')
    // A disc takes its largest sector's hue, which is the one the legend can explain.
    expect(nl!.colorClass).toBe(nl!.sectors[0]!.colorClass)
  })

  it('keeps a mark above the floor radius however small the country', () => {
    const { countries } = countryDonuts(
      [
        position({ issuerCountry: 'US', marketValueBase: 1_000_000 }),
        position({ issuerCountry: 'JP', marketValueBase: 0.01 }),
      ],
      techPalette(),
    )
    expect(countries[1]!.r).toBeGreaterThanOrEqual(R_MIN)
  })

  it('names a tail sector honestly on the holding while grouping it in the sector donut', () => {
    const slices = Array.from({ length: 9 }, (_, i) => sectorSlice(`S${i}`, 100 - i))
    const { countries } = countryDonuts(
      [position({ issuerCountry: 'US', sector: 'S8', symbol: 'TAIL' })],
      sectorPalette(slices),
    )
    const us = countries[0]!
    // The holding slice names the company's actual sector...
    expect(us.holdings[0]!.sectorLabel).toBe('S8')
    // ...while the sector donut shows the grouped display key, and says so.
    expect(us.sectors[0]!.label).toMatch(/^Other/)
  })

  it('folds positions with no locatable country into the unknown bucket, one count per country', () => {
    const { countries, unknown } = countryDonuts(
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
    const { countries } = countryDonuts(
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
    const us = countryDonuts(
      [position({ issuerCountry: 'US', costBasisBase: 0, unrealizedPnlBase: 0 })],
      techPalette(),
    ).countries[0]!
    expect(us.returnPercent).toBeNull()
    // The neutral step means 'flat or unknown' — which is why the popup states the figure.
    expect(us.gainLossClass).toBe('map-diverge-4')
  })

  it('has nothing to draw for an empty portfolio', () => {
    expect(countryDonuts([], techPalette())).toEqual({
      countries: [],
      unknown: { value: 0, percent: 0, count: 0 },
    })
  })
})
