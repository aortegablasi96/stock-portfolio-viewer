import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_QUARTERS,
  MAX_LISTED_YEARS,
  calendarQuarters,
  calendarYears,
  standardPeriods,
  type StandardPeriod,
} from './periodSet'
import { chainLink } from './performanceRange'
import type { PerformanceReport } from '@shared/domain/performance'

/**
 * Every standard period, precomputed (Story #287, DDR-0103).
 *
 * The set replaces a control the owner used to click (DDR-0102), so what these tests guard is what
 * the control used to guarantee and now nothing else does: that a window means the same thing it
 * meant on a chart, that it is anchored to the imported history rather than to the clock, and that
 * a window with nothing in it is a **state** rather than a calm zero.
 *
 * The consecutive differences get their own block because they are the one figure this module
 * *derives*. Deriving it here is the point — subtracting two returns is arithmetic, and the model
 * is forbidden it (ADR-0009) — so it has to be right.
 */

const day = (year: number, month: number, date: number): number => Date.UTC(year, month - 1, date)

/** A report whose points are the first of each month, so every window's endpoints are exact. */
function monthly(startYear: number, months: number): PerformanceReport {
  const points = Array.from({ length: months }, (_, index) => ({
    date: Date.UTC(startYear, index, 1),
    value: 100_000 + index * 1_000,
    twr: index,
  }))
  return performance(points)
}

function performance(
  points: readonly { date: number; value: number; twr: number }[],
): PerformanceReport {
  const last = points[points.length - 1]
  return {
    baseCurrency: 'EUR',
    valueSeries: points.map((p) => ({ date: p.date, value: p.value })),
    returnSeries: points.map((p) => ({ date: p.date, value: p.twr })),
    compositionSeries: { bands: [], points: [] },
    periods: [],
    startingValue: points[0]?.value ?? 0,
    endingValue: last?.value ?? 0,
    cumulativeTwr: last?.twr ?? 0,
    totalDepositsWithdrawals: 0,
    totalRealizedPnl: 0,
    totalUnrealizedPnl: 0,
  }
}

const find = (set: { periods: StandardPeriod[] } | null, id: string): StandardPeriod | undefined =>
  set?.periods.find((period) => period.id === id)

// Thirty months: January 2024 through June 2026. Three calendar years and ten quarters, which puts
// the quarter cap in play and leaves the year cap slack — the two are asserted apart.
const REPORT = monthly(2024, 30)
const EXTENT = { from: day(2024, 1, 1), to: day(2026, 6, 1) }

describe('standardPeriods', () => {
  it('has nothing to window where the history holds no dated value', () => {
    expect(standardPeriods(performance([]))).toBeNull()
  })

  describe('the set is derived from the history, never from the clock', () => {
    it('anchors every trailing window to the last day the history holds', () => {
      const set = standardPeriods(REPORT)

      expect(set?.extent).toEqual(EXTENT)
      for (const period of set?.periods ?? []) {
        expect(period.bounds.to).toBeLessThanOrEqual(EXTENT.to)
        expect(period.bounds.from).toBeGreaterThanOrEqual(EXTENT.from)
      }
      expect(find(set, 'trailing:1y')?.bounds).toEqual({ from: day(2025, 6, 1), to: EXTENT.to })
      expect(find(set, 'all')?.bounds).toEqual(EXTENT)
    })

    it('yields a stale history its own periods rather than empty ones', () => {
      // A history that stopped in 2019 still has a "last 12 months". Anchored to today every
      // trailing window would be empty, and an empty period reads as a flat one.
      const set = standardPeriods(monthly(2018, 24))

      expect(find(set, 'trailing:1y')?.days).toBeGreaterThan(0)
      expect(find(set, 'year:2019')?.days).toBeGreaterThan(0)
      expect(set?.periods.some((period) => period.label === '2026')).toBe(false)
    })

    it('clamps a part-year and a part-quarter to the history at both ends', () => {
      const set = standardPeriods(REPORT)

      // 2026 has only run to June in this history, and that part of it is a real period.
      expect(find(set, 'year:2026')?.bounds).toEqual({ from: day(2026, 1, 1), to: EXTENT.to })
      expect(find(set, 'year:2025')?.bounds).toEqual({ from: day(2025, 1, 1), to: day(2025, 12, 31) })
      expect(find(set, 'quarter:Q2 2026')?.bounds).toEqual({ from: day(2026, 4, 1), to: EXTENT.to })
      expect(find(set, 'quarter:Q4 2025')?.bounds).toEqual({
        from: day(2025, 10, 1),
        to: day(2025, 12, 31),
      })
    })
  })

  describe('a period is named in the words an owner would use', () => {
    it('names the trailing year by its length, so it cannot be read as a calendar year', () => {
      const set = standardPeriods(REPORT)

      expect(find(set, 'trailing:1y')?.label).toBe('Last 12 months')
      expect(find(set, 'year:2025')?.label).toBe('2025')
      // Both are present, and neither is called "Last year": one row per window, one name per row.
      expect(set?.periods.filter((period) => period.label === 'Last year')).toEqual([])
    })

    it('names quarters and lists them newest first', () => {
      const quarters = (standardPeriods(REPORT)?.periods ?? []).filter((p) => p.kind === 'quarter')

      expect(quarters[0]?.label).toBe('Q2 2026')
      expect(quarters[1]?.label).toBe('Q1 2026')
      expect(quarters[0]!.bounds.from).toBeGreaterThan(quarters[1]!.bounds.from)
    })
  })

  describe('return and value stay apart', () => {
    it('keeps the window return in its own field, rebased to the period start', () => {
      const year = find(standardPeriods(REPORT), 'year:2025')

      // 2025 opens on the last point at or before 1 January (December 2024's, at 12%) and closes
      // on December 2025's, at 23% — chain-linked, not subtracted.
      expect(year?.twr).toBeCloseTo(chainLink(23, 12), 9)
      expect(year?.twr).not.toBeCloseTo(11, 6)
    })

    it('keeps value in fields of its own, which the return never touches', () => {
      const year = find(standardPeriods(REPORT), 'year:2025')

      expect(year?.startValue).toBe(112_000)
      expect(year?.endValue).toBe(123_000)
      expect(year?.changeAbs).toBe(11_000)
      expect(year?.changePct).toBeCloseTo((11_000 / 112_000) * 100, 9)
    })

    it('measures a period by the calendar and by the data separately', () => {
      const year = find(standardPeriods(REPORT), 'year:2025')

      expect(year?.calendarDays).toBe(365)
      expect(year?.days).toBe(12)
    })
  })

  describe('consecutive differences are computed, not derived', () => {
    it('carries each year against the year before it, in percentage points', () => {
      const set = standardPeriods(REPORT)
      const y2025 = find(set, 'year:2025')
      const y2024 = find(set, 'year:2024')

      expect(y2025?.previous?.label).toBe('2024')
      expect(y2025?.previous?.points).toBeCloseTo(y2025!.twr - y2024!.twr, 9)
    })

    it('carries each quarter against the quarter before it', () => {
      const set = standardPeriods(REPORT)
      const q1 = find(set, 'quarter:Q1 2026')

      expect(q1?.previous?.label).toBe('Q4 2025')
      expect(q1?.previous?.points).toBeCloseTo(q1!.twr - find(set, 'quarter:Q4 2025')!.twr, 9)
    })

    it('compares nothing across kinds, and nothing to the whole history', () => {
      const set = standardPeriods(REPORT)

      expect(find(set, 'all')?.previous).toBeNull()
      expect(find(set, 'trailing:1y')?.previous).toBeNull()
      expect(find(set, 'trailing:3m')?.previous).toBeNull()
    })

    it('leaves the oldest listed period without a comparison rather than inventing one', () => {
      const set = standardPeriods(REPORT)

      expect(find(set, 'year:2024')?.previous).toBeNull()
    })
  })

  describe('a period holding no day of history is a state', () => {
    it('reports no data rather than a flat zero for an empty window', () => {
      // Two clusters with a year between them: 2024's middle quarters hold nothing at all.
      const set = standardPeriods(
        performance([
          { date: day(2024, 1, 15), value: 100_000, twr: 0 },
          { date: day(2024, 2, 15), value: 101_000, twr: 1 },
          { date: day(2024, 11, 15), value: 120_000, twr: 8 },
          { date: day(2024, 12, 15), value: 121_000, twr: 9 },
        ]),
      )

      expect(find(set, 'quarter:Q2 2024')?.days).toBe(0)
      expect(find(set, 'quarter:Q3 2024')?.days).toBe(0)
      expect(find(set, 'quarter:Q1 2024')?.days).toBe(2)
    })

    it('takes an empty period out of every comparison, on both sides', () => {
      const set = standardPeriods(
        performance([
          { date: day(2024, 1, 15), value: 100_000, twr: 0 },
          { date: day(2024, 2, 15), value: 101_000, twr: 1 },
          { date: day(2024, 11, 15), value: 120_000, twr: 8 },
        ]),
      )

      // Q3 held nothing, so neither it nor the quarter after it has a difference to state.
      expect(find(set, 'quarter:Q3 2024')?.previous).toBeNull()
      expect(find(set, 'quarter:Q4 2024')?.previous).toBeNull()
    })
  })

  describe('each cap states what it left out', () => {
    it('lists the most recent years and reports how many the history covers', () => {
      const set = standardPeriods(monthly(2005, 12 * 20))

      expect(set?.yearsTotal).toBe(20)
      expect(set?.yearsListed).toBe(MAX_LISTED_YEARS)
      const years = (set?.periods ?? []).filter((period) => period.kind === 'year')
      expect(years).toHaveLength(MAX_LISTED_YEARS)
      expect(years[0]?.label).toBe('2024')
      expect(years[years.length - 1]?.label).toBe('2017')
    })

    it('lists the most recent quarters and reports how many there are', () => {
      const set = standardPeriods(REPORT)

      expect(set?.quartersTotal).toBe(10)
      expect(set?.quartersListed).toBe(MAX_LISTED_QUARTERS)
      expect((set?.periods ?? []).filter((p) => p.kind === 'quarter')).toHaveLength(
        MAX_LISTED_QUARTERS,
      )
    })
  })
})

describe('calendarYears', () => {
  it('covers every year the history touches, oldest first', () => {
    expect(calendarYears({ from: day(2023, 6, 4), to: day(2025, 2, 9) }).map((y) => y.label)).toEqual(
      ['2023', '2024', '2025'],
    )
  })

  it('clamps the first and last to the history rather than to the calendar', () => {
    const years = calendarYears({ from: day(2023, 6, 4), to: day(2025, 2, 9) })

    expect(years[0]?.bounds).toEqual({ from: day(2023, 6, 4), to: day(2023, 12, 31) })
    expect(years[2]?.bounds).toEqual({ from: day(2025, 1, 1), to: day(2025, 2, 9) })
  })
})

describe('calendarQuarters', () => {
  it('walks quarter by quarter across a year boundary', () => {
    expect(
      calendarQuarters({ from: day(2024, 11, 2), to: day(2025, 5, 6) }).map((q) => q.label),
    ).toEqual(['Q4 2024', 'Q1 2025', 'Q2 2025'])
  })

  it('ends a quarter on its real last day, leap year included', () => {
    const quarters = calendarQuarters({ from: day(2024, 1, 1), to: day(2024, 12, 31) })

    expect(quarters[0]?.bounds.to).toBe(day(2024, 3, 31))
    expect(quarters[1]?.bounds.to).toBe(day(2024, 6, 30))
  })
})
