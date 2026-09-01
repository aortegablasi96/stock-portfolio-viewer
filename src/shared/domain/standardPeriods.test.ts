import { describe, expect, it } from 'vitest'
import {
  ANNUALISATION_MIN_DAYS,
  MAX_LISTED_QUARTERS,
  MAX_LISTED_YEARS,
  calendarQuarters,
  calendarYears,
  findPeriod,
  flowWindow,
  periodComposition,
  periodDailyReturns,
  periodDays,
  periodFlows,
  periodSpan,
  periodValueSeries,
  standardPeriods,
  type PeriodSet,
  type StandardPeriod,
} from './standardPeriods'
import { chainLink } from './performanceWindow'
import type { NavPeriod, PerformanceReport } from './performance'

/**
 * Every standard period, precomputed (Story #287, DDR-0103; moved and widened by Story #327).
 *
 * The set replaces a control the owner used to click (DDR-0102), so what these tests guard is what
 * the control used to guarantee and now nothing else does: that a window means the same thing it
 * meant on a chart, that it is anchored to the imported history rather than to the clock, and that
 * a window with nothing in it is a **state** rather than a calm zero.
 *
 * The consecutive differences get their own block because they are the one figure this module
 * *derives*. Deriving it here is the point — subtracting two returns is arithmetic, and the model
 * is forbidden it (ADR-0009) — so it has to be right.
 *
 * **The blocks after the set were `periodChange.test.ts`'s**, and they moved with the functions they
 * are about (Story #327). What did *not* move is the aggregate those functions used to be called
 * from: four tools each take one slice of a period, so there is no longer a shape that carries a
 * return and a value and a composition together — which is the shape DDR-0013 says must not exist.
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

const find = (set: PeriodSet | null, id: string): StandardPeriod | undefined =>
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

/**
 * The key a tool takes, resolved (Story #327, DDR-0111).
 *
 * **Exact, or nothing.** Every softening — a prefix, a case fold, a nearest match — turns *"this app
 * does not hold that window"* into a right-looking figure under the wrong heading, which is the one
 * failure the precomputed set exists to make impossible (DDR-0102).
 */
describe('findPeriod', () => {
  const set = standardPeriods(REPORT)!

  it('resolves a key the set holds', () => {
    expect(findPeriod(set, 'year:2025')?.label).toBe('2025')
    expect(findPeriod(set, 'quarter:Q1 2026')?.label).toBe('Q1 2026')
    expect(findPeriod(set, 'all')?.label).toBe('Full history')
  })

  it('resolves nothing at all for a window the set does not hold', () => {
    for (const key of ['year:2019', '2025', 'YEAR:2025', 'year:2025 ', 'march-to-july', '']) {
      expect(findPeriod(set, key), key).toBeNull()
    }
  })
})

describe('periodFlows', () => {
  const periods: NavPeriod[] = [
    {
      fromDate: Date.UTC(2026, 4, 1),
      toDate: Date.UTC(2026, 4, 31),
      startingValue: 95_000,
      endingValue: 100_000,
      mtm: 5_000,
      depositsWithdrawals: 0,
      dividends: 300,
      withholdingTax: -45,
      interest: 5,
      commissions: 12,
      twr: 5,
    },
    {
      fromDate: Date.UTC(2026, 5, 1),
      toDate: Date.UTC(2026, 5, 30),
      startingValue: 100_000,
      endingValue: 124_500,
      mtm: 4_500,
      depositsWithdrawals: 20_000,
      dividends: 900,
      withholdingTax: -135,
      interest: 5,
      commissions: 33,
      twr: 2,
    },
  ]

  it('sums every statement row when the window is the whole history', () => {
    const flows = periodFlows(periods, null)
    expect(flows.count).toBe(2)
    expect(flows.depositsWithdrawals).toBe(20_000)
    expect(flows.dividends).toBe(1_200)
    expect(flows.withholdingTax).toBe(-180)
    expect(flows.partial).toBe(false)
  })

  /**
   * A window that cuts a statement row takes the row whole rather than pro-rating it — there is no
   * pro-rated deposit in any report the app holds, and inventing one is the single thing this
   * Epic's grounding exists to prevent. What it owes the reader instead is the span it really
   * measured.
   */
  it('takes an overlapping statement row whole and reports the span it really covers', () => {
    const flows = periodFlows(periods, { from: Date.UTC(2026, 5, 2), to: Date.UTC(2026, 5, 3) })
    expect(flows.count).toBe(1)
    expect(flows.depositsWithdrawals).toBe(20_000)
    expect(flows.covered).toEqual({ from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 5, 30) })
    expect(flows.partial).toBe(true)
  })

  it('is not partial when the rows it summed sit inside the window', () => {
    const flows = periodFlows(periods, { from: Date.UTC(2026, 4, 1), to: Date.UTC(2026, 5, 30) })
    expect(flows.count).toBe(2)
    expect(flows.partial).toBe(false)
  })

  it('reports no covered span at all when the window touches no statement', () => {
    const flows = periodFlows(periods, { from: Date.UTC(2020, 0, 1), to: Date.UTC(2020, 0, 2) })
    expect(flows.count).toBe(0)
    expect(flows.covered).toBeNull()
    expect(flows.partial).toBe(false)
  })

  /**
   * The whole history restricts nothing, which is **not** the same as windowing to the extent: a
   * statement row can open before the first day the value series holds, and the full history should
   * carry it rather than drop it for landing outside a window nobody chose.
   */
  it('restricts nothing for the whole history and the period itself for every other window', () => {
    const set = standardPeriods(REPORT)!
    expect(flowWindow(findPeriod(set, 'all')!)).toBeNull()
    expect(flowWindow(findPeriod(set, 'year:2025')!)).toEqual({
      from: day(2025, 1, 1),
      to: day(2025, 12, 31),
    })
  })
})

/**
 * How long the period is (Story #286).
 *
 * The one fact a summary has to have in order to *refuse* to annualise. It is not a licence to —
 * the app computes no annualised figure at all — but the boundary at a year is what separates a
 * period a yearly word could describe from one where it is meaningless, and the report says a
 * different sentence on each side of it.
 */
describe('periodSpan', () => {
  const at = (n: number): number => Date.UTC(2026, 0, 1) + n * 86_400_000
  const history = { from: at(0), to: at(999) }

  /** Both ends included: a period that opens and closes on one day is one day long, not zero. */
  it('counts a one-day window as one day', () => {
    expect(periodSpan({ from: at(5), to: at(5) }, history).periodDays).toBe(1)
  })

  it('counts both ends of a longer window', () => {
    expect(periodSpan({ from: at(0), to: at(9) }, history).periodDays).toBe(10)
  })

  it('measures the history independently of the window', () => {
    expect(periodSpan({ from: at(5), to: at(6) }, history).historyDays).toBe(1000)
  })

  /**
   * The boundary itself, asserted from both sides. One day short of a year is where a summary is
   * most tempted to round up, and rounding up is the overclaim.
   */
  it('turns over at exactly a year, and not before', () => {
    expect(periodSpan({ from: at(0), to: at(ANNUALISATION_MIN_DAYS - 2) }, history).coversAYear).toBe(
      false,
    )
    expect(periodSpan({ from: at(0), to: at(ANNUALISATION_MIN_DAYS - 1) }, history).coversAYear).toBe(
      true,
    )
  })

  /** A window resolved outside the history collapses rather than going negative. */
  it('never reports a negative length', () => {
    expect(periodSpan({ from: at(9), to: at(0) }, history).periodDays).toBeGreaterThan(0)
  })
})

describe('periodDays', () => {
  it('splits the days by sign and finds both extremes', () => {
    const days = periodDays([
      { date: 1, value: 1.5 },
      { date: 2, value: -2.5 },
      { date: 3, value: 0 },
      { date: 4, value: 0.5 },
    ])
    expect(days).toMatchObject({ count: 4, up: 2, down: 1, flat: 1 })
    expect(days.best).toEqual({ date: 1, value: 1.5 })
    expect(days.worst).toEqual({ date: 2, value: -2.5 })
  })

  /** No days, no extremes — never a zero standing in for a day that was not observed. */
  it('has no extremes at all when there are no days', () => {
    expect(periodDays([])).toEqual({
      count: 0,
      up: 0,
      down: 0,
      flat: 0,
      best: null,
      worst: null,
    })
  })
})

/**
 * DDR-0049: the daily steps are chain-linked from the return curve and take the **unwindowed**
 * series, so a window's opening step measures against the trading day that really preceded it
 * rather than against a synthetic point at the edge.
 */
describe('periodDailyReturns', () => {
  const report = performance([
    { date: day(2026, 1, 1), value: 100_000, twr: 0 },
    { date: day(2026, 2, 1), value: 101_000, twr: 1 },
    { date: day(2026, 3, 1), value: 121_000, twr: 0.5 },
    { date: day(2026, 4, 1), value: 124_500, twr: 2 },
  ])

  it('measures the first step of a window against the day outside it that preceded it', () => {
    const set = standardPeriods(report)!
    const steps = periodDailyReturns(report, findPeriod(set, 'quarter:Q2 2026')!)

    expect(steps).toHaveLength(1)
    expect(steps[0]?.date).toBe(day(2026, 4, 1))
    // 2% chain-linked onto March's 0.5%, not 2% minus 0.5%.
    expect(steps[0]?.value).toBeCloseTo(chainLink(2, 0.5), 9)
  })

  it('emits nothing for a window holding no day at all', () => {
    const set = standardPeriods(report)!
    expect(periodDailyReturns(report, findPeriod(set, 'year:2026')!)).toHaveLength(3)
    expect(periodDailyReturns(performance([]), findPeriod(set, 'all')!)).toHaveLength(0)
  })
})

describe('periodComposition', () => {
  const DAY = [
    Date.UTC(2026, 4, 29),
    Date.UTC(2026, 5, 1),
    Date.UTC(2026, 5, 2),
    Date.UTC(2026, 5, 3),
  ] as const

  const shaped = (points: PerformanceReport['compositionSeries']): PerformanceReport => ({
    ...performance([
      { date: DAY[0], value: 100_000, twr: 0 },
      { date: DAY[3], value: 124_500, twr: 2 },
    ]),
    compositionSeries: points,
  })

  const report = shaped({
    bands: [
      { key: 'stock', label: 'Stocks' },
      { key: 'cash', label: 'Cash' },
    ],
    points: [
      { date: DAY[0], total: 100_000, values: [90_000, 10_000] },
      { date: DAY[2], total: 121_000, values: [108_000, 13_000] },
      { date: DAY[3], total: 124_500, values: [110_000, 14_500] },
    ],
  })

  it('reads the two ends of the window and the shift between them', () => {
    const composition = periodComposition(report, { from: DAY[0], to: DAY[3] })
    expect(composition.days).toBe(3)
    expect(composition.firstDate).toBe(DAY[0])
    expect(composition.lastDate).toBe(DAY[3])
    expect(composition.navChange).toBe(24_500)
    expect(composition.bands.map((b) => [b.band.key, b.first, b.last, b.change])).toEqual([
      ['stock', 90_000, 110_000, 20_000],
      ['cash', 10_000, 14_500, 4_500],
    ])
  })

  /** The days themselves, for the history report that lists them rather than only their ends. */
  it('carries the days inside the window, oldest first', () => {
    const composition = periodComposition(report, { from: DAY[1], to: DAY[3] })
    expect(composition.points.map((point) => point.date)).toEqual([DAY[2], DAY[3]])
  })

  /**
   * Sliced, never carried forward (DDR-0052): each point is one day's simultaneous observation of
   * every band, and carrying one forward would pair one day's stocks with another day's cash. A
   * window holding one point therefore has both ends on that point.
   */
  it('puts both ends on the same day when the window holds one', () => {
    const composition = periodComposition(report, { from: DAY[2], to: DAY[2] })
    expect(composition.days).toBe(1)
    expect(composition.firstDate).toBe(composition.lastDate)
    expect(composition.navChange).toBe(0)
  })

  /** The optional NAV-in-base Flex section degrades, never fails (DDR-0050). */
  it('has no shape at all when the section was never exported', () => {
    const composition = periodComposition(shaped({ bands: [], points: [] }), {
      from: DAY[0],
      to: DAY[3],
    })
    expect(composition.days).toBe(0)
    expect(composition.bands).toEqual([])
    expect(composition.firstNav).toBeNull()
    expect(composition.points).toEqual([])
  })
})

/**
 * The value points really inside a period — filtered, never anchored.
 *
 * A history report lists days the app observed. `sliceSeries`' synthetic endpoints are right for a
 * plotted line, which has to meet the edges of its own plot, and wrong for a list, where an anchored
 * point is a day the portfolio was never measured on.
 */
describe('periodValueSeries', () => {
  it('lists the days inside the window and no others', () => {
    const set = standardPeriods(REPORT)!
    const year = periodValueSeries(REPORT, findPeriod(set, 'year:2025')!)

    expect(year).toHaveLength(12)
    expect(year[0]?.date).toBe(day(2025, 1, 1))
    expect(year[11]?.date).toBe(day(2025, 12, 1))
  })

  it('lists nothing for a window the history has no day in', () => {
    const report = performance([
      { date: day(2024, 1, 15), value: 100_000, twr: 0 },
      { date: day(2024, 11, 15), value: 120_000, twr: 8 },
    ])
    const set = standardPeriods(report)!

    expect(periodValueSeries(report, findPeriod(set, 'quarter:Q2 2024')!)).toEqual([])
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
