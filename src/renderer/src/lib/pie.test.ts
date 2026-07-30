import { describe, it, expect } from 'vitest'
import {
  groupTail,
  isResidual,
  sliceColorClasses,
  toArcs,
  MAX_SLICES,
  OTHER_KEY,
  type PieDatum,
} from './pie'

function datum(key: string, value: number, percent = value): PieDatum {
  return { key, label: key, value, percent }
}

describe('groupTail', () => {
  it('leaves the data alone when it fits the palette', () => {
    const data = [datum('a', 3), datum('b', 2)]
    expect(groupTail(data)).toEqual(data)
  })

  it('drops non-positive slices, which have no angle to draw', () => {
    expect(groupTail([datum('a', 3), datum('b', 0), datum('c', -1)]).map((d) => d.key)).toEqual(['a'])
  })

  it('folds the tail into a single Other slice rather than generating a ninth hue', () => {
    const data = Array.from({ length: 12 }, (_, i) => datum(`s${i}`, 12 - i))
    const grouped = groupTail(data)

    expect(grouped).toHaveLength(MAX_SLICES)
    const other = grouped.at(-1)!
    expect(other.key).toBe(OTHER_KEY)
    expect(other.label).toBe('Other (5)')
    // The five smallest: 5 + 4 + 3 + 2 + 1
    expect(other.value).toBe(15)
    expect(other.percent).toBe(15)
  })
})

describe('isResidual', () => {
  it('treats the aggregated tail and the empty "no value" key as residual', () => {
    expect(isResidual(OTHER_KEY)).toBe(true)
    // Unknown country / unclassified sector — the services group those under an empty key.
    expect(isResidual('')).toBe(true)
    expect(isResidual('US')).toBe(false)
  })
})

describe('sliceColorClasses', () => {
  it('assigns categorical hues in order to named slices', () => {
    expect(sliceColorClasses([datum('a', 1), datum('b', 1), datum('c', 1)])).toEqual([
      'pie-series-1',
      'pie-series-2',
      'pie-series-3',
    ])
  })

  it('paints residual slices neutral without consuming a hue slot', () => {
    // The empty "no value" key and the aggregated tail are residual; the named slice
    // around them still takes the next categorical slot, not a skipped one.
    expect(
      sliceColorClasses([datum('', 1), datum('US', 1), { key: OTHER_KEY, label: 'Other', value: 1, percent: 1 }]),
    ).toEqual(['pie-series-neutral', 'pie-series-1', 'pie-series-neutral'])
  })

  it('matches the colours the donut assigns to the same grouped slices', () => {
    const data = Array.from({ length: 12 }, (_, i) => datum(`s${i}`, 12 - i))
    const grouped = groupTail(data)
    // Seven named hues then the neutral "Other" tail — the table reuses this exact mapping.
    expect(sliceColorClasses(grouped)).toEqual([
      'pie-series-1',
      'pie-series-2',
      'pie-series-3',
      'pie-series-4',
      'pie-series-5',
      'pie-series-6',
      'pie-series-7',
      'pie-series-neutral',
    ])
  })
})

describe('toArcs', () => {
  it('returns nothing when there is no positive total', () => {
    expect(toArcs([], 100, 100, 90, 50)).toEqual([])
    expect(toArcs([datum('a', 0)], 100, 100, 90, 50)).toEqual([])
  })

  it('gives each slice a share of the drawn total', () => {
    const arcs = toArcs([datum('a', 30), datum('b', 10)], 100, 100, 90, 50)
    expect(arcs.map((a) => a.share)).toEqual([0.75, 0.25])
    expect(arcs.every((a) => a.path.startsWith('M '))).toBe(true)
  })

  it('draws a lone slice as a seamless full ring, not a zero-length arc', () => {
    const [arc] = toArcs([datum('a', 100)], 100, 100, 90, 50)
    expect(arc!.share).toBe(1)
    // Two subpaths: the outer circle, then the inner one wound the other way to punch the hole.
    expect(arc!.path.match(/M /g)).toHaveLength(2)
    // And crucially no radial edge. A segment closes with `L` from the outer arc to the inner one,
    // and `.pie-slice` strokes that edge — which on a full circle paints a seam dividing nothing.
    expect(arc!.path).not.toContain('L ')
  })

  it('starts the first slice at 12 o’clock and sweeps clockwise', () => {
    const [first] = toArcs([datum('a', 1), datum('b', 1)], 100, 100, 90, 50)
    // First point is directly above the centre: (cx, cy - rOuter).
    expect(first!.path).toMatch(/^M 100 10 /)
  })
})
