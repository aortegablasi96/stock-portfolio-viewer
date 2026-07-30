import { describe, expect, it } from 'vitest'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { centroidFor } from './worldGeo'
import { sectorPalette } from './sectorMap'
import {
  countryDonuts,
  donutPath,
  normalizedShares,
  REST_KEY,
  WEIGHT_COLOR_CLASS,
  WEIGHT_KEY,
} from './countryDonuts'

/**
 * Pure transforms behind the per-country donut pairs (Story #122, DDR-0030). The component isn't
 * unit-tested (Vitest runs Node with no DOM), so the two donuts' composition, the absolute weight
 * scale, share normalization, radius scaling, disc degradation, ordering and unknown-bucket folding
 * are what carry the logic.
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
const R_MAX = 25
const DOT_MAX_RADIUS = 8
const FULL_TURN = 2 * Math.PI

const techPalette = (): ReturnType<typeof sectorPalette> =>
  sectorPalette([sectorSlice('Technology', 100)])

const manySectorPalette = (): ReturnType<typeof sectorPalette> =>
  sectorPalette(
    ['Technology', 'Healthcare', 'Financials', 'Energy', 'Materials', 'Utilities'].map((s, i) =>
      sectorSlice(s, 100 - i * 10),
    ),
  )

describe('normalizedShares', () => {
  it('returns plain value shares when every slice clears the floor', () => {
    expect(normalizedShares([60, 40])).toEqual([0.6, 0.4])
  })

  it('always sums to one', () => {
    for (const values of [[1], [5, 5], [99, 1], [1000, 1, 1, 1], [0, 0, 7]]) {
      expect(normalizedShares(values).reduce((sum, s) => sum + s, 0)).toBeCloseTo(1, 10)
    }
  })

  it('lifts a negligible sector to a hoverable floor', () => {
    const [big, tiny] = normalizedShares([9990, 10])
    expect(tiny).toBeGreaterThanOrEqual(0.019)
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
  it('draws a full turn as two half-arcs, so a single-sector country is not erased', () => {
    expect(donutPath(0, 10, 5, 0, FULL_TURN).match(/M /g)).toHaveLength(2)
  })

  it('draws a partial ring as one arc', () => {
    expect(donutPath(0, 10, 5, 0, Math.PI / 2).match(/M /g)).toHaveLength(1)
  })

  it('centres the ring on the offset it is given, so the pair sits side by side', () => {
    expect(donutPath(-20, 10, 5, 0, Math.PI)).not.toEqual(donutPath(20, 10, 5, 0, Math.PI))
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
    const us = countryDonuts([position({})], techPalette()).countries[0]!
    expect(us.cx).toBeGreaterThan(us.r)
    expect(us.weight[0]!.path).not.toEqual(us.sectors[0]!.path)
  })

  it('draws the weight donut as a blue share against the rest of the portfolio', () => {
    const us = countryDonuts(
      [position({ issuerCountry: 'US', marketValueBase: 100, percentOfNav: 25 })],
      techPalette(),
    ).countries[0]!

    expect(us.weight.map((s) => s.key)).toEqual([WEIGHT_KEY, REST_KEY])
    const [country, rest] = us.weight
    expect(country!.colorClass).toBe(WEIGHT_COLOR_CLASS)
    expect(country!.label).toBe('United States')
    expect(country!.percentOfNav).toBe(25)
    // A quarter of NAV sweeps a quarter turn, and the remainder takes the other three quarters.
    expect(country!.path).toEqual(donutPath(-us.cx, us.r, us.rHole, 0, FULL_TURN / 4))
    expect(rest!.percentOfNav).toBe(75)
    expect(rest!.label).toBe('Rest of portfolio')
  })

  it('keeps the weight scale absolute, so a small country draws a small arc', () => {
    // The slice floor that protects sector slices must NOT apply here: overstating a 1% country is
    // exactly what this chart exists not to do.
    const us = countryDonuts(
      [position({ issuerCountry: 'US', marketValueBase: 10, percentOfNav: 1 })],
      techPalette(),
    ).countries[0]!
    expect(us.weight[0]!.path).toEqual(donutPath(-us.cx, us.r, us.rHole, 0, FULL_TURN * 0.01))
  })

  it('gives two countries the same weight scale, so they can be compared by eye', () => {
    const { countries } = countryDonuts(
      [
        position({ issuerCountry: 'US', marketValueBase: 900, percentOfNav: 90 }),
        position({ issuerCountry: 'JP', marketValueBase: 100, percentOfNav: 10 }),
      ],
      techPalette(),
    )
    const [us, jp] = countries
    expect(us!.r).toBeGreaterThan(jp!.r)
    expect(us!.weight[0]!.percentOfNav).toBe(90)
    expect(jp!.weight[0]!.percentOfNav).toBe(10)
  })

  it('clamps a weight over 100% rather than wrapping the slice onto itself', () => {
    const us = countryDonuts(
      [position({ issuerCountry: 'US', marketValueBase: 10, percentOfNav: 100.4 })],
      techPalette(),
    ).countries[0]!
    // A full turn is drawn as two half-arcs; anything more would wrap.
    expect(us.weight[0]!.path.match(/M /g)).toHaveLength(2)
  })

  it('gives each sector its own slice and its own colour, largest first', () => {
    const palette = manySectorPalette()
    const us = countryDonuts(
      [
        position({ sector: 'Technology', marketValueBase: 500 }),
        position({ sector: 'Healthcare', marketValueBase: 300 }),
        position({ sector: 'Energy', marketValueBase: 200 }),
      ],
      palette,
    ).countries[0]!

    expect(us.sectors.map((s) => s.label)).toEqual(['Technology', 'Healthcare', 'Energy'])
    expect(us.sectors[0]!.colorClass).toBe(palette.colorClassOf('Technology'))
    expect(us.sectors[1]!.colorClass).toBe(palette.colorClassOf('Healthcare'))
    expect(new Set(us.sectors.map((s) => s.colorClass)).size).toBe(3)
  })

  it('shows every sector, however many the country holds', () => {
    // The radial round capped rings by available pixels; a donut has no such limit.
    const six = ['Technology', 'Healthcare', 'Financials', 'Energy', 'Materials', 'Utilities'].map(
      (s, i) => position({ sector: s, conid: i, marketValueBase: 60 - i * 5 }),
    )
    const us = countryDonuts(six, manySectorPalette()).countries[0]!
    expect(us.sectors).toHaveLength(6)
    expect(us.sectors.reduce((t, s) => t + s.marketValueBase, 0)).toBe(us.marketValueBase)
  })

  it('splits the same country two ways, over the same total', () => {
    const us = countryDonuts(
      [
        position({ sector: 'Technology', marketValueBase: 750, percentOfNav: 7.5 }),
        position({ sector: 'Energy', marketValueBase: 250, percentOfNav: 2.5 }),
      ],
      manySectorPalette(),
    ).countries[0]!

    expect(us.marketValueBase).toBe(1000)
    expect(us.sectors.reduce((t, s) => t + s.marketValueBase, 0)).toBe(1000)
    expect(us.weight[0]!.marketValueBase).toBe(1000)
    expect(us.sectors[0]!.percentOfCountry).toBeCloseTo(75, 10)
    expect(us.sectors[1]!.percentOfCountry).toBeCloseTo(25, 10)
    expect(us.sectors[0]!.holdingCount).toBe(1)
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

  it('orders countries largest first, which is also draw and hit-test order', () => {
    const { countries } = countryDonuts(
      [
        position({ issuerCountry: 'NL', marketValueBase: 10 }),
        position({ issuerCountry: 'US', marketValueBase: 900 }),
        position({ issuerCountry: 'JP', marketValueBase: 400 }),
      ],
      techPalette(),
    )
    expect(countries.map((c) => c.code)).toEqual(['US', 'JP', 'NL'])
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
    expect(us!.weight[0]!.path).not.toBe('')

    expect(nl!.r).toBeLessThan(DOT_MAX_RADIUS)
    expect(nl!.dot).toBe(true)
    expect(nl!.weight[0]!.path).toBe('')
    expect(nl!.sectors[0]!.path).toBe('')
    // A disc takes its largest sector's hue, not the weight blue: it says what is held.
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

  it('aggregates returns per sector and nets them at the country', () => {
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
      manySectorPalette(),
    ).countries[0]!

    expect(us.sectors.find((s) => s.label === 'Technology')!.returnPercent).toBeCloseTo(20, 10)
    expect(us.sectors.find((s) => s.label === 'Energy')!.returnPercent).toBeCloseTo(-20, 10)
    expect(us.unrealizedPnlBase).toBe(50)
    expect(us.returnPercent).toBeCloseTo((50 / 750) * 100, 10)
    // The weight slice measures the country, so it carries the country's return.
    expect(us.weight[0]!.returnPercent).toBeCloseTo(us.returnPercent!, 10)
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
