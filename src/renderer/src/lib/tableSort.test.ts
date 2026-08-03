import { describe, expect, it } from 'vitest'
import {
  ariaSortFor,
  compareValues,
  defaultDirectionFor,
  directionFor,
  isMissing,
  nextSortState,
  sortGlyph,
  sortRows,
  type SortState,
} from './tableSort'

/**
 * Column sorting for the `DataTable` primitive (Story #134, DDR-0039).
 *
 * The whole of it is here rather than in the component, for the reason the rest of this folder
 * exists: Vitest runs Node-only, so a comparator inside a React component is untestable
 * (DDR-0029). The rules worth pinning are the ones a reader would notice if they broke — where a
 * missing value lands, that a negative figure is a number and not a string, that sorting twice
 * changes nothing, and that the direction is announced as well as drawn.
 */

interface Row {
  symbol: string
  value: number | null
}

const rows: Row[] = [
  { symbol: 'AAPL', value: 300 },
  { symbol: 'msft', value: -1200 },
  { symbol: 'BRK', value: null },
  { symbol: 'TSLA', value: -3 },
]

const bySymbol = (r: Row): string => r.symbol
const byValue = (r: Row): number | null => r.value
const symbols = (result: Row[]): string[] => result.map((r) => r.symbol)

describe('isMissing', () => {
  it('treats null and undefined as nothing to compare', () => {
    expect(isMissing(null)).toBe(true)
    expect(isMissing(undefined)).toBe(true)
  })

  /**
   * `NaN` comes out of arithmetic on absent figures, and every comparison against it returns 0 —
   * which would freeze rows wherever they happened to sit rather than sorting them.
   */
  it('treats NaN as missing, since it compares equal to everything', () => {
    expect(isMissing(Number.NaN)).toBe(true)
  })

  /** Zero, the empty string and a negative figure are all values. Only absence is absence. */
  it.each<[string, number | string]>([
    ['zero', 0],
    ['a negative figure', -1200],
    ['an empty string', ''],
  ])('treats %s as a value', (_label, value) => {
    expect(isMissing(value)).toBe(false)
  })
})

describe('compareValues', () => {
  /** The reason a comparator exists at all: `'-1200' < '-3'` as text, and that is wrong here. */
  it('orders numbers numerically, negatives included', () => {
    expect(compareValues(-1200, -3)).toBeLessThan(0)
    expect(compareValues(300, 42)).toBeGreaterThan(0)
    expect(compareValues(7, 7)).toBe(0)
  })

  it('orders text alphabetically and case-insensitively', () => {
    expect(compareValues('AAPL', 'msft')).toBeLessThan(0)
    expect(compareValues('msft', 'AAPL')).toBeGreaterThan(0)
    expect(compareValues('aapl', 'AAPL')).toBe(0)
  })

  /** Dates are the epoch-ms integers the domain already carries, so they need no branch. */
  it('orders dates chronologically, as the numbers they are', () => {
    const earlier = Date.UTC(2024, 0, 31)
    const later = Date.UTC(2026, 6, 1)
    expect(compareValues(earlier, later)).toBeLessThan(0)
  })

  it('keeps the order total when a column somehow yields both types', () => {
    expect(compareValues(1, 'a')).toBeLessThan(0)
    expect(compareValues('a', 1)).toBeGreaterThan(0)
  })
})

describe('sortRows', () => {
  it('sorts text ascending and descending', () => {
    expect(symbols(sortRows(rows, bySymbol, 'asc'))).toEqual(['AAPL', 'BRK', 'msft', 'TSLA'])
    expect(symbols(sortRows(rows, bySymbol, 'desc'))).toEqual(['TSLA', 'msft', 'BRK', 'AAPL'])
  })

  it('sorts figures by magnitude and sign, not by their text', () => {
    expect(symbols(sortRows(rows, byValue, 'asc'))).toEqual(['msft', 'TSLA', 'AAPL', 'BRK'])
  })

  /**
   * The asymmetry that makes the column usable. A missing value is neither large nor small, so
   * letting the direction move it would put "—" at the top of every descending sort of a column
   * where a rate was unavailable (DDR-0007), displacing the figures the owner opened it to find.
   */
  it('parks rows with no value last in both directions', () => {
    expect(symbols(sortRows(rows, byValue, 'asc')).at(-1)).toBe('BRK')
    expect(symbols(sortRows(rows, byValue, 'desc')).at(-1)).toBe('BRK')
  })

  it('is stable, so equal rows keep the order the service returned them in', () => {
    const ties: Row[] = [
      { symbol: 'first', value: 10 },
      { symbol: 'second', value: 10 },
      { symbol: 'third', value: 10 },
    ]
    expect(symbols(sortRows(ties, byValue, 'desc'))).toEqual(['first', 'second', 'third'])
  })

  it('leaves the caller’s array untouched', () => {
    const before = symbols(rows)
    sortRows(rows, byValue, 'desc')
    expect(symbols(rows)).toEqual(before)
  })

  it('reorders rather than filters, which is what keeps a “N of M shown” count correct', () => {
    expect(sortRows(rows, byValue, 'asc')).toHaveLength(rows.length)
    expect(sortRows([], byValue, 'asc')).toEqual([])
  })
})

/**
 * A figure column opens descending because that is the question being asked of it — the largest
 * position, the biggest dividend, the best trade are all at the top of a descending sort. Text
 * opens ascending, which is what A–Z means.
 */
describe('defaultDirectionFor', () => {
  it('opens figures at the largest and text at A', () => {
    expect(defaultDirectionFor(true)).toBe('desc')
    expect(defaultDirectionFor(false)).toBe('asc')
  })
})

describe('nextSortState', () => {
  it('takes the column’s own opening direction when the sort moves to it', () => {
    expect(nextSortState(null, 'value', 'desc')).toEqual({ key: 'value', direction: 'desc' })
    expect(nextSortState({ key: 'symbol', direction: 'asc' }, 'value', 'desc')).toEqual({
      key: 'value',
      direction: 'desc',
    })
  })

  it('flips the column that already holds the sort', () => {
    expect(nextSortState({ key: 'value', direction: 'desc' }, 'value', 'desc')).toEqual({
      key: 'value',
      direction: 'asc',
    })
    expect(nextSortState({ key: 'value', direction: 'asc' }, 'value', 'desc')).toEqual({
      key: 'value',
      direction: 'desc',
    })
  })

  /**
   * Two states, never three: a header a reader clicks twice is back where they started, and the
   * order on screen always has a visible explanation in the header.
   */
  it('never returns to unsorted, so a click is always a two-state toggle', () => {
    let state: SortState | null = null
    for (let i = 0; i < 4; i++) state = nextSortState(state, 'value', 'desc')
    expect(state).not.toBeNull()
    expect(nextSortState(state, 'value', 'desc')).not.toBeNull()
  })
})

describe('directionFor and ariaSortFor', () => {
  const sorted: SortState = { key: 'value', direction: 'desc' }

  it('reports the direction only for the column holding the sort', () => {
    expect(directionFor(sorted, 'value')).toBe('desc')
    expect(directionFor(sorted, 'symbol')).toBeNull()
    expect(directionFor(null, 'value')).toBeNull()
  })

  /**
   * `none` is not "no attribute": it is what tells a screen-reader user that a column *can* be
   * sorted before they activate anything.
   */
  it('announces the sorted column and marks the rest sortable-but-unsorted', () => {
    expect(ariaSortFor(sorted, 'value')).toBe('descending')
    expect(ariaSortFor({ key: 'value', direction: 'asc' }, 'value')).toBe('ascending')
    expect(ariaSortFor(sorted, 'symbol')).toBe('none')
    expect(ariaSortFor(null, 'value')).toBe('none')
  })
})

/**
 * Direction is carried by the arrow's shape, not only by the accent the sorted header wears —
 * the same rule as the tab bar's underline (DDR-0029) and the toggle group's doubled stroke
 * (DDR-0036).
 */
describe('sortGlyph', () => {
  it('gives each direction its own shape', () => {
    expect(sortGlyph('asc')).toBe('↑')
    expect(sortGlyph('desc')).toBe('↓')
  })

  it('marks an unsorted sortable column rather than showing nothing', () => {
    expect(sortGlyph(null)).toBe('↕')
  })

  it('never repeats a glyph, so no two states look alike', () => {
    const glyphs = [sortGlyph('asc'), sortGlyph('desc'), sortGlyph(null)]
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })
})
