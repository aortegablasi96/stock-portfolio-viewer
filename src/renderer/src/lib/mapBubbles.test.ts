import { describe, expect, it } from 'vitest'
import type { AllocationPosition, AllocationSlice } from '@shared/domain/allocation'
import { centroidFor } from './worldGeo'
import { sectorPalette } from './sectorMap'
import { positionBubbles, spreadOffset } from './mapBubbles'

/**
 * Pure transforms behind the per-position Allocation map (Story #92). The component isn't
 * unit-tested (Vitest runs Node with no DOM), so the bubble construction, radius scaling,
 * phyllotaxis spread, ordering and unknown-bucket folding are what carry the logic worth testing.
 *
 * Inherits the coverage the retired `splitSectorBubbles` suite carried — unknown folding, √value
 * radius scaling, centroid anchoring, and the empty case — plus the spread behaviour that is new
 * here.
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

/** R_MIN in the module — the radius floor every bubble starts from. */
const R_MIN = 4

const techPalette = (): ReturnType<typeof sectorPalette> =>
  sectorPalette([sectorSlice('Technology', 100)])

describe('spreadOffset', () => {
  it('leaves the first holding exactly on the centroid', () => {
    expect(spreadOffset(0, 51)).toEqual({ dLon: 0, dLat: 0 })
  })

  it('corrects longitude for latitude, so a polar rosette is not squashed', () => {
    // Same spiral index → same radius and angle; only the longitude correction differs.
    const equator = spreadOffset(1, 0)
    const arctic = spreadOffset(1, 65.02) // Finland's centroid latitude
    expect(Math.abs(arctic.dLon)).toBeGreaterThan(Math.abs(equator.dLon))
    // The correction is exactly 1/cos(lat) relative to the equator.
    expect(Math.abs(arctic.dLon)).toBeCloseTo(
      Math.abs(equator.dLon) / Math.cos((65.02 * Math.PI) / 180),
      5,
    )
    // Latitude is untouched by the correction.
    expect(arctic.dLat).toBeCloseTo(equator.dLat, 10)
  })

  it('clamps the spiral so an outer holding cannot wander into a neighbouring country', () => {
    // At the equator cos(lat) = 1, so the offset magnitude is the spiral radius itself.
    const far = spreadOffset(100, 0)
    expect(Math.hypot(far.dLon, far.dLat)).toBeCloseTo(7, 5)
  })

  it('grows the rosette with the number of holdings, up to the clamp', () => {
    const magnitude = (i: number): number => {
      const { dLon, dLat } = spreadOffset(i, 0)
      return Math.hypot(dLon, dLat)
    }
    const near = magnitude(1)
    const mid = magnitude(9)
    expect(mid).toBeGreaterThan(near)
    // r ∝ √i — the ninth holding sits three times as far out as the first.
    expect(mid).toBeCloseTo(near * 3, 5)
  })
})

describe('positionBubbles', () => {
  it('emits one bubble per holding, not one per country', () => {
    const palette = sectorPalette([sectorSlice('Technology', 150), sectorSlice('Financials', 50)])
    const { bubbles, unknown } = positionBubbles(
      [
        position({ symbol: 'AAA', issuerCountry: 'US', sector: 'Technology', marketValueBase: 100 }),
        position({ symbol: 'BBB', issuerCountry: 'US', sector: 'Financials', marketValueBase: 50 }),
        position({ symbol: 'CCC', issuerCountry: 'DE', sector: 'Technology', marketValueBase: 75 }),
      ],
      palette,
    )

    expect(bubbles).toHaveLength(3)
    expect(bubbles.map((b) => b.ticker)).toEqual(['AAA', 'CCC', 'BBB'])
    expect(unknown).toEqual({ value: 0, percent: 0, count: 0 })
  })

  it('orders bubbles largest-value first, so smaller ones stay on top and hoverable', () => {
    const { bubbles } = positionBubbles(
      [
        position({ symbol: 'SMALL', marketValueBase: 10 }),
        position({ symbol: 'BIG', marketValueBase: 900 }),
        position({ symbol: 'MID', marketValueBase: 200 }),
      ],
      techPalette(),
    )
    expect(bubbles.map((b) => b.ticker)).toEqual(['BIG', 'MID', 'SMALL'])
  })

  it('folds positions with no mappable country into the unknown bucket', () => {
    const { bubbles, unknown } = positionBubbles(
      [
        position({ issuerCountry: 'US', marketValueBase: 100, percentOfNav: 40 }),
        position({ issuerCountry: '', marketValueBase: 10, percentOfNav: 4 }), // no country
        position({ issuerCountry: 'ZZ', marketValueBase: 5, percentOfNav: 2 }), // no centroid
      ],
      techPalette(),
    )

    expect(bubbles).toHaveLength(1)
    // Both the '' group and the unmappable 'ZZ' group aggregate — one count each.
    expect(unknown).toEqual({ value: 15, percent: 6, count: 2 })
  })

  it('scales bubble radius by area (r proportional to sqrt of value)', () => {
    const { bubbles } = positionBubbles(
      [
        position({ symbol: 'BIG', issuerCountry: 'US', marketValueBase: 100 }),
        position({ symbol: 'SMALL', issuerCountry: 'DE', marketValueBase: 25 }),
      ],
      techPalette(),
    )
    const big = bubbles.find((b) => b.ticker === 'BIG')!
    const small = bubbles.find((b) => b.ticker === 'SMALL')!
    // A quarter of the value → half the radius delta above the minimum.
    expect(small.r - R_MIN).toBeCloseTo((big.r - R_MIN) / 2, 5)
  })

  it('gives every holding at least the minimum radius, however small', () => {
    const { bubbles } = positionBubbles(
      [
        position({ symbol: 'BIG', issuerCountry: 'US', marketValueBase: 1_000_000 }),
        position({ symbol: 'DUST', issuerCountry: 'DE', marketValueBase: 0.01 }),
      ],
      techPalette(),
    )
    expect(bubbles.find((b) => b.ticker === 'DUST')!.r).toBeGreaterThanOrEqual(R_MIN)
  })

  it('still places a short position, at the minimum radius', () => {
    // Area can't be proportional to a negative value, but the holding is real and must stay
    // reachable — and its popup must report the actual figure.
    const { bubbles } = positionBubbles(
      [
        position({ symbol: 'LONG', issuerCountry: 'US', marketValueBase: 500 }),
        position({ symbol: 'SHORT', issuerCountry: 'DE', marketValueBase: -250 }),
      ],
      techPalette(),
    )
    const short = bubbles.find((b) => b.ticker === 'SHORT')!
    expect(short.r).toBe(R_MIN)
    expect(short.marketValueBase).toBe(-250)
  })

  it('anchors a country’s only holding exactly on its centroid', () => {
    const { bubbles } = positionBubbles([position({ issuerCountry: 'US' })], techPalette())
    const us = centroidFor('US')!
    expect(bubbles[0]).toMatchObject({ lon: us.lon, lat: us.lat, countryName: 'United States' })
  })

  it('fans holdings that share a country onto distinct coordinates', () => {
    // Coincident points never separate at any zoom, so the spread is what makes each holding
    // individually reachable.
    const { bubbles } = positionBubbles(
      Array.from({ length: 6 }, (_, i) =>
        position({ symbol: `S${i}`, issuerCountry: 'US', marketValueBase: 100 - i }),
      ),
      techPalette(),
    )

    const coords = bubbles.map((b) => `${b.lon},${b.lat}`)
    expect(new Set(coords).size).toBe(6)
  })

  it('puts the largest holding of a country at the centroid and fans the rest around it', () => {
    const us = centroidFor('US')!
    const { bubbles } = positionBubbles(
      [
        position({ symbol: 'SMALL', issuerCountry: 'US', marketValueBase: 10 }),
        position({ symbol: 'BIG', issuerCountry: 'US', marketValueBase: 900 }),
      ],
      techPalette(),
    )
    expect(bubbles.find((b) => b.ticker === 'BIG')).toMatchObject({ lon: us.lon, lat: us.lat })
    expect(bubbles.find((b) => b.ticker === 'SMALL')!.lat).not.toBe(us.lat)
  })

  it('places holdings deterministically, so the map never reshuffles between renders', () => {
    const input = Array.from({ length: 8 }, (_, i) =>
      position({ symbol: `S${i}`, issuerCountry: 'US', marketValueBase: 100 - i }),
    )
    expect(positionBubbles(input, techPalette())).toEqual(positionBubbles(input, techPalette()))
  })

  it('colours a bubble from the sector palette, matching the donut', () => {
    const palette = sectorPalette([sectorSlice('Technology', 150), sectorSlice('Financials', 50)])
    const { bubbles } = positionBubbles(
      [
        position({ symbol: 'TECH', sector: 'Technology' }),
        position({ symbol: 'FIN', sector: 'Financials' }),
      ],
      palette,
    )
    expect(bubbles.find((b) => b.ticker === 'TECH')!.colorClass).toBe('pie-series-1')
    expect(bubbles.find((b) => b.ticker === 'FIN')!.colorClass).toBe('pie-series-2')
  })

  it('paints an unclassified holding neutral rather than consuming a categorical hue', () => {
    const palette = sectorPalette([sectorSlice('Technology', 100), sectorSlice('', 20)])
    const { bubbles } = positionBubbles([position({ sector: '' })], palette)
    expect(bubbles[0]!.colorClass).toBe('pie-series-neutral')
    // Empty label reaches the view, which renders it as '—' the way the Positions table does.
    expect(bubbles[0]!.sectorLabel).toBe('')
  })

  it('names a tail sector honestly even though it is coloured as Other', () => {
    // Nine sectors → the smallest fold into the palette's neutral 'Other'. The popup describes one
    // company, so it must still say which sector that company is in.
    const palette = sectorPalette(
      Array.from({ length: 9 }, (_, i) => sectorSlice(`S${i}`, 100 - i)),
    )
    const { bubbles } = positionBubbles([position({ sector: 'S8' })], palette)
    expect(bubbles[0]!.colorClass).toBe('pie-series-neutral')
    expect(bubbles[0]!.sectorLabel).toBe('S8')
  })

  it('carries the popup payload through unmodified', () => {
    const { bubbles } = positionBubbles(
      [
        position({
          conid: 265598,
          symbol: 'AAPL',
          description: 'APPLE INC',
          issuerCountry: 'US',
          sector: 'Technology',
          marketValueBase: 12_345.67,
          unrealizedPnlBase: -1_234.5,
          percentOfNav: 8.4,
        }),
      ],
      techPalette(),
    )
    expect(bubbles[0]).toMatchObject({
      id: '265598',
      ticker: 'AAPL',
      name: 'APPLE INC',
      countryName: 'United States',
      sectorLabel: 'Technology',
      marketValueBase: 12_345.67,
      unrealizedPnlBase: -1_234.5,
      percentOfNav: 8.4,
    })
  })

  it('returns an empty, well-formed result when there is nothing to place', () => {
    expect(positionBubbles([], sectorPalette([]))).toEqual({
      bubbles: [],
      unknown: { value: 0, percent: 0, count: 0 },
    })
  })
})
