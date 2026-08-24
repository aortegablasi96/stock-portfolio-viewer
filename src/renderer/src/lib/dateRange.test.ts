import { describe, expect, it } from 'vitest'
import type { RangeId } from './dateRange'
import {
  RANGE_OPTIONS,
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

/**
 * YTD is the app's one calendar-anchored preset (Story #256, DDR-0085). Its anchor is the same as
 * every trailing preset's — the latest data point, never `Date.now()` — which is why every case
 * below is a plain assertion with no clock to freeze. All UTC, like every timestamp in the app.
 */
describe('boundsFor — ytd', () => {
  const custom = { from: day(2024, 3, 1), to: day(2024, 9, 1) }

  it('runs from 1 January of the anchor’s year through the anchor', () => {
    const extent = { from: day(2022, 5, 9), to: day(2025, 8, 24) }
    expect(boundsFor('ytd', extent, custom)).toEqual({
      from: day(2025, 1, 1),
      to: day(2025, 8, 24),
    })
  })

  it('collapses to the single day when the anchor is 1 January', () => {
    // Not December: "the year so far" on 1 January is one day, and the preceding year is `1Y`'s.
    const extent = { from: day(2022, 5, 9), to: day(2025, 1, 1) }
    expect(boundsFor('ytd', extent, custom)).toEqual({
      from: day(2025, 1, 1),
      to: day(2025, 1, 1),
    })
  })

  it('clamps to the data’s start where the history begins later in that year', () => {
    const extent = { from: day(2025, 3, 14), to: day(2025, 8, 24) }
    expect(boundsFor('ytd', extent, custom)).toEqual({
      from: day(2025, 3, 14),
      to: day(2025, 8, 24),
    })
  })

  it('takes the anchor’s year, not this one, when the history ends in an earlier year', () => {
    // The defined outcome, and the reason the anchor is the data: it is the tail of the last year
    // that has data. Anchored to today this window would be empty and the chart would draw nothing.
    const extent = { from: day(2021, 2, 1), to: day(2023, 11, 30) }
    expect(boundsFor('ytd', extent, custom)).toEqual({
      from: day(2023, 1, 1),
      to: day(2023, 11, 30),
    })
  })

  it('starts at midnight of 1 January regardless of the anchor’s time of day', () => {
    const extent = { from: day(2024, 6, 1), to: at(2025, 8, 24, 17) }
    expect(boundsFor('ytd', extent, custom)).toEqual({
      from: day(2025, 1, 1),
      to: at(2025, 8, 24, 17),
    })
  })

  it('is not the trailing year: a mid-year anchor windows less than 1Y does', () => {
    const extent = { from: day(2020, 1, 1), to: day(2025, 8, 24) }
    expect(boundsFor('ytd', extent, custom).from).toBeGreaterThan(
      boundsFor('1y', extent, custom).from,
    )
  })

  it('leaves every other preset’s window exactly where it was', () => {
    const extent = { from: day(2024, 1, 1), to: day(2025, 1, 1) }
    expect(boundsFor('1m', extent, custom)).toEqual({ from: day(2024, 12, 1), to: day(2025, 1, 1) })
    expect(boundsFor('3m', extent, custom)).toEqual({ from: day(2024, 10, 1), to: day(2025, 1, 1) })
    expect(boundsFor('1y', extent, custom)).toEqual({ from: day(2024, 1, 1), to: day(2025, 1, 1) })
    expect(boundsFor('all', extent, custom)).toEqual(extent)
  })
})

describe('the range vocabulary', () => {
  /**
   * One list, rendered unfiltered by the one `RangeFilter` all three views share — so this is also
   * the assertion that YTD reached Dividends and Trades and not only Performance.
   */
  it('offers YTD after 1Y, in the one order every view renders', () => {
    expect(RANGE_OPTIONS.map((o) => o.id)).toEqual(['1m', '3m', '1y', 'ytd', 'all', 'custom'])
  })

  it('gives every preset a tooltip, YTD’s naming the calendar anchor', () => {
    for (const option of RANGE_OPTIONS) expect(option.title).toBeTruthy()
    expect(RANGE_OPTIONS.find((o) => o.id === 'ytd')?.title).toBe('Since 1 January')
  })

  /**
   * `boundsFor`'s `switch` carries no `default`, so the declared return type makes a missing case a
   * compile error rather than a window over everything. This is the runtime half of the same claim:
   * every id in the vocabulary resolves to a window inside the extent, and none of them silently
   * resolves to the full extent the way an `all` fallthrough would.
   */
  it('resolves every id to a window inside the extent, with no id falling through to "all"', () => {
    const extent = { from: day(2020, 1, 1), to: day(2025, 8, 24) }
    const custom = { from: day(2024, 3, 1), to: day(2024, 9, 1) }
    const windowed: RangeId[] = ['1m', '3m', '1y', 'ytd', 'custom']

    for (const id of RANGE_OPTIONS.map((o) => o.id)) {
      const bounds = boundsFor(id, extent, custom)
      expect(bounds.from).toBeGreaterThanOrEqual(extent.from)
      expect(bounds.to).toBeLessThanOrEqual(extent.to)
      expect(bounds.from).toBeLessThanOrEqual(bounds.to)
    }

    for (const id of windowed) expect(boundsFor(id, extent, custom)).not.toEqual(extent)
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

  /**
   * The second consumer (Story #256): a chart slices a series with `boundsFor`, a table filters
   * rows with `windowFor`. YTD has to be right in both, and it is a *window* in this path — only
   * `all` means "no restriction", so a `null` here would show a table its whole history.
   */
  it('windows rows for ytd rather than returning "no restriction"', () => {
    const spanning = { from: day(2023, 5, 1), to: day(2025, 8, 24) }
    expect(windowFor('ytd', spanning, null)).toEqual({
      from: day(2025, 1, 1),
      to: day(2025, 8, 24),
    })
  })

  it('filters a table’s rows to the anchor’s year', () => {
    const spanning = { from: day(2023, 5, 1), to: day(2025, 8, 24) }
    const rows = [
      { d: day(2023, 5, 1) as number | null, id: 'before' },
      { d: day(2024, 12, 31) as number | null, id: 'last-year' },
      { d: day(2025, 1, 1) as number | null, id: 'new-year' },
      { d: day(2025, 8, 24) as number | null, id: 'latest' },
      { d: null as number | null, id: 'undated' },
    ]
    const bounds = windowFor('ytd', spanning, null)
    expect(filterByRange(rows, (r) => r.d, bounds).map((r) => r.id)).toEqual(['new-year', 'latest'])
  })

  /**
   * Only `custom` runs to the close of its end day — its edges are days the owner typed, where a
   * preset's `to` is a real timestamp off the data. Extending YTD would push its end past the
   * latest row and claim a window the history does not cover.
   */
  it('does not extend ytd’s end to the close of the day', () => {
    const intraday = { from: day(2024, 1, 1), to: at(2025, 8, 24, 17) }
    expect(windowFor('ytd', intraday, null)?.to).toBe(at(2025, 8, 24, 17))
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
