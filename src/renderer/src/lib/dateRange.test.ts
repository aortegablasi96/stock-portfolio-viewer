import { describe, expect, it } from 'vitest'
import {
  boundsFor,
  datedExtent,
  filterByRange,
  fromDateInput,
  toDateInput,
  windowFor,
} from './dateRange'

const day = (y: number, m: number, d: number): number => Date.UTC(y, m - 1, d)
const at = (y: number, m: number, d: number, h: number): number => Date.UTC(y, m - 1, d, h)

describe('boundsFor', () => {
  const extent = { from: day(2024, 1, 1), to: day(2025, 1, 1) }
  const custom = { from: day(2024, 3, 1), to: day(2024, 9, 1) }

  it('all uses the full extent', () => {
    expect(boundsFor('all', extent, custom)).toEqual(extent)
  })

  it('1m / 3m / 1y trail back from the latest point', () => {
    expect(boundsFor('1m', extent, custom)).toEqual({ from: day(2024, 12, 1), to: day(2025, 1, 1) })
    expect(boundsFor('3m', extent, custom)).toEqual({ from: day(2024, 10, 1), to: day(2025, 1, 1) })
    expect(boundsFor('1y', extent, custom)).toEqual({ from: day(2024, 1, 1), to: day(2025, 1, 1) })
  })

  it('clamps a trailing window that predates the first point to the extent start', () => {
    const shallow = { from: day(2024, 12, 20), to: day(2025, 1, 1) }
    // A one-month window would start 2024-12-01, before the data begins.
    expect(boundsFor('1m', shallow, custom)).toEqual({ from: day(2024, 12, 20), to: day(2025, 1, 1) })
  })

  it('custom is clamped into the data span', () => {
    const wide = { from: day(2020, 1, 1), to: day(2030, 1, 1) }
    expect(boundsFor('custom', extent, wide)).toEqual(extent)
  })

  it('custom swaps reversed dates into order', () => {
    const reversed = { from: day(2024, 9, 1), to: day(2024, 3, 1) }
    expect(boundsFor('custom', extent, reversed)).toEqual({ from: day(2024, 3, 1), to: day(2024, 9, 1) })
  })
})

describe('windowFor', () => {
  const extent = { from: day(2024, 1, 1), to: day(2025, 1, 1) }

  it('returns null for "all" — no restriction, rather than a window over everything', () => {
    expect(windowFor('all', extent, null)).toBeNull()
  })

  it('returns null when nothing is dated', () => {
    expect(windowFor('1m', null, null)).toBeNull()
  })

  it('resolves a trailing preset like boundsFor does', () => {
    expect(windowFor('3m', extent, null)).toEqual(boundsFor('3m', extent, extent))
  })

  it('runs a custom window to the close of the chosen end day', () => {
    const custom = { from: day(2024, 3, 1), to: day(2024, 9, 1) }
    const bounds = windowFor('custom', extent, custom)
    expect(bounds?.from).toBe(day(2024, 3, 1))
    expect(bounds?.to).toBe(Date.UTC(2024, 8, 1, 23, 59, 59, 999))
    // So a trade timestamped during the chosen end day is inside the window.
    expect(filterByRange([{ d: at(2024, 9, 1, 14) }], (r) => r.d, bounds)).toHaveLength(1)
  })
})

describe('datedExtent', () => {
  it('spans earliest to latest regardless of row order', () => {
    const rows = [{ d: day(2025, 1, 1) }, { d: day(2024, 1, 1) }, { d: day(2024, 6, 1) }]
    expect(datedExtent(rows, (r) => r.d)).toEqual({ from: day(2024, 1, 1), to: day(2025, 1, 1) })
  })

  it('ignores undated rows', () => {
    const rows = [{ d: null }, { d: day(2024, 6, 1) }, { d: null }]
    expect(datedExtent(rows, (r) => r.d)).toEqual({ from: day(2024, 6, 1), to: day(2024, 6, 1) })
  })

  it('returns null when no row carries a date', () => {
    expect(datedExtent([{ d: null }], (r) => r.d)).toBeNull()
    expect(datedExtent([], (r: { d: number | null }) => r.d)).toBeNull()
  })
})

describe('filterByRange', () => {
  const rows = [
    { d: day(2024, 1, 15) as number | null, id: 'jan' },
    { d: day(2024, 6, 15) as number | null, id: 'jun' },
    { d: null as number | null, id: 'undated' },
  ]

  it('returns every row, undated ones included, when there is no window', () => {
    expect(filterByRange(rows, (r) => r.d, null).map((r) => r.id)).toEqual([
      'jan',
      'jun',
      'undated',
    ])
  })

  it('keeps only rows inside the window, edges included', () => {
    const bounds = { from: day(2024, 1, 15), to: day(2024, 3, 1) }
    expect(filterByRange(rows, (r) => r.d, bounds).map((r) => r.id)).toEqual(['jan'])
  })

  it('drops undated rows while a window is active', () => {
    const bounds = { from: day(2023, 1, 1), to: day(2025, 1, 1) }
    expect(filterByRange(rows, (r) => r.d, bounds).map((r) => r.id)).toEqual(['jan', 'jun'])
  })

  it('does not alias the input array', () => {
    expect(filterByRange(rows, (r) => r.d, null)).not.toBe(rows)
  })
})

describe('date-input conversion', () => {
  it('formats epoch-ms as YYYY-MM-DD in UTC', () => {
    expect(toDateInput(day(2024, 3, 7))).toBe('2024-03-07')
  })

  it('round-trips through fromDateInput', () => {
    expect(fromDateInput('2024-03-07')).toBe(day(2024, 3, 7))
  })

  it('returns null for a malformed value', () => {
    expect(fromDateInput('')).toBeNull()
    expect(fromDateInput('2024/03/07')).toBeNull()
  })
})
