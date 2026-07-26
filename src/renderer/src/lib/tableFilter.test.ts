import { describe, it, expect } from 'vitest'
import { distinctTypes, filterByTypes } from './tableFilter'

interface Row {
  type: string
  n: number
}

const rows: Row[] = [
  { type: 'Dividends', n: 1 },
  { type: 'Withholding Tax', n: 2 },
  { type: 'Dividends', n: 3 },
  { type: 'Payment In Lieu Of Dividends', n: 4 },
]
const typeOf = (r: Row): string => r.type

describe('distinctTypes', () => {
  it('returns each type once, in first-seen order', () => {
    expect(distinctTypes(rows, typeOf)).toEqual([
      'Dividends',
      'Withholding Tax',
      'Payment In Lieu Of Dividends',
    ])
  })

  it('is empty for no rows', () => {
    expect(distinctTypes([], typeOf)).toEqual([])
  })
})

describe('filterByTypes', () => {
  it('returns all rows for an empty selection (no filter)', () => {
    const result = filterByTypes(rows, typeOf, new Set())
    expect(result).toHaveLength(4)
    expect(result).not.toBe(rows) // fresh array, not the input aliased
  })

  it('keeps only rows matching a single selected type', () => {
    expect(filterByTypes(rows, typeOf, new Set(['Dividends'])).map((r) => r.n)).toEqual([1, 3])
  })

  it('keeps rows matching any of several selected types (union)', () => {
    const selected = new Set(['Dividends', 'Withholding Tax'])
    expect(filterByTypes(rows, typeOf, selected).map((r) => r.n)).toEqual([1, 2, 3])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterByTypes(rows, typeOf, new Set(['Interest']))).toEqual([])
  })
})
