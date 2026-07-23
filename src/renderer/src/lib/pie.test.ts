import { describe, it, expect } from 'vitest'
import { groupTail, isResidual, toArcs, MAX_SLICES, OTHER_KEY, type PieDatum } from './pie'

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

  it('draws a lone slice as a full ring, not a zero-length arc', () => {
    const [arc] = toArcs([datum('a', 100)], 100, 100, 90, 50)
    expect(arc!.share).toBe(1)
    // Two half-arcs — a single arc from 0 to 2π would collapse to a point.
    expect(arc!.path.match(/M /g)).toHaveLength(2)
  })

  it('starts the first slice at 12 o’clock and sweeps clockwise', () => {
    const [first] = toArcs([datum('a', 1), datum('b', 1)], 100, 100, 90, 50)
    // First point is directly above the centre: (cx, cy - rOuter).
    expect(first!.path).toMatch(/^M 100 10 /)
  })
})
