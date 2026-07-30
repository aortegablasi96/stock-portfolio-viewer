import { describe, expect, it } from 'vitest'
import type { AllocationSlice } from '@shared/domain/allocation'
import { OTHER_KEY } from './pie'
import { sectorPalette } from './sectorMap'

/**
 * The shared sector → colour assignment (Story #30). What matters is that it stays identical to
 * the Sector donut's own slice colouring, since the map, the map legend and the donut all read
 * from it.
 *
 * The per-country wedge geometry this module used to own moved to `lib/countryDonuts`,
 * and its coverage moved with it.
 */

const sectorSlice = (key: string, marketValueBase: number, percentOfNav = 0): AllocationSlice => ({
  key,
  label: key || 'Unclassified',
  marketValueBase,
  percentOfNav,
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
