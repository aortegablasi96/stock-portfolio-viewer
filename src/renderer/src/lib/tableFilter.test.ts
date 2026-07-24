import { describe, it, expect } from 'vitest'
import { ALL_TYPES, distinctTypes, filterByType } from './tableFilter'

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

describe('filterByType', () => {
  it('returns all rows for the ALL_TYPES sentinel', () => {
    const result = filterByType(rows, typeOf, ALL_TYPES)
    expect(result).toHaveLength(4)
    expect(result).not.toBe(rows) // fresh array, not the input aliased
  })

  it('keeps only rows matching the selected type', () => {
    expect(filterByType(rows, typeOf, 'Dividends').map((r) => r.n)).toEqual([1, 3])
  })

  it('returns an empty array when nothing matches', () => {
    expect(filterByType(rows, typeOf, 'Interest')).toEqual([])
  })
})
