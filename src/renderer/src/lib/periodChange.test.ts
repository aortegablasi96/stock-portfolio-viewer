import { describe, expect, it } from 'vitest'
import {
  PERIOD_LABELS,
  periodChange,
  periodComposition,
  periodDays,
  periodFlows,
} from './periodChange'
import { RANGE_OPTIONS } from './dateRange'
import type { NavPeriod, PerformanceReport } from '@shared/domain/performance'

/**
 * What changed over a period, as arithmetic (Story #285).
 *
 * The story's trap is that **a portfolio can be worth 20% more and have returned 2%**, and an
 * explanation that conflates the two is wrong in the flattering direction. So the fixture below is
 * built to make them disagree: a €20,000 deposit lands mid-history, value rises 24.5%, and the
 * time-weighted return rises 2%. Every assertion about the pair is really the same assertion —
 * that a flow moves one field and never the other.
 *
 * The second thing pinned here is the **anchor**. Every preset ends at the last day the imported
 * history holds, never at the clock (DDR-0085), which is what lets this whole file run without a
 * fake timer and what keeps a history that stopped last year from resolving to an empty "1Y".
 */

const DAY = [
  Date.UTC(2026, 4, 29),
  Date.UTC(2026, 5, 1),
  Date.UTC(2026, 5, 2),
  Date.UTC(2026, 5, 3),
] as const

function navPeriod(over: Partial<NavPeriod> = {}): NavPeriod {
  return {
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
    ...over,
  }
}

function report(over: Partial<PerformanceReport> = {}): PerformanceReport {
  return {
    baseCurrency: 'EUR',
    valueSeries: [
      { date: DAY[0], value: 100_000 },
      { date: DAY[1], value: 101_000 },
      { date: DAY[2], value: 121_000 },
      { date: DAY[3], value: 124_500 },
    ],
    returnSeries: [
      { date: DAY[0], value: 0 },
      { date: DAY[1], value: 1 },
      { date: DAY[2], value: 0.5 },
      { date: DAY[3], value: 2 },
    ],
    compositionSeries: {
      bands: [
        { key: 'stock', label: 'Stocks' },
        { key: 'cash', label: 'Cash' },
      ],
      points: [
        { date: DAY[0], total: 100_000, values: [90_000, 10_000] },
        { date: DAY[2], total: 121_000, values: [108_000, 13_000] },
        { date: DAY[3], total: 124_500, values: [110_000, 14_500] },
      ],
    },
    periods: [
      navPeriod(),
      navPeriod({
        fromDate: Date.UTC(2026, 5, 1),
        toDate: Date.UTC(2026, 5, 30),
        startingValue: 100_000,
        endingValue: 124_500,
        mtm: 4_500,
        depositsWithdrawals: 20_000,
        dividends: 900,
        withholdingTax: -135,
        commissions: 33,
        twr: 2,
      }),
    ],
    startingValue: 100_000,
    endingValue: 124_500,
    cumulativeTwr: 2,
    totalDepositsWithdrawals: 20_000,
    totalRealizedPnl: 4_300,
    totalUnrealizedPnl: 12_000,
    ...over,
  }
}

describe('periodChange', () => {
  it('is null when the history holds no dated value at all', () => {
    expect(periodChange(report({ valueSeries: [] }), { range: 'all', custom: null })).toBeNull()
  })

  /**
   * The story's defining pair. Both figures come out of the same window; neither is derived from
   * the other, and the 22.5-point gap between them is the deposit.
   */
  it('reports the return and the value change as two different figures', () => {
    const change = periodChange(report(), { range: 'all', custom: null })!
    expect(change.twr).toBeCloseTo(2, 10)
    expect(change.startValue).toBe(100_000)
    expect(change.endValue).toBe(124_500)
    expect(change.changeAbs).toBe(24_500)
    expect(change.changePct).toBeCloseTo(24.5, 10)
  })

  /**
   * DDR-0013's property, asserted rather than assumed: the deposit is the only thing that changes,
   * and only the value fields move. A model handed one figure that silently absorbed the other
   * would have nothing to tell them apart with.
   */
  it('leaves the return untouched when a deposit moves the value', () => {
    const withoutDeposit = periodChange(
      report({
        valueSeries: [
          { date: DAY[0], value: 100_000 },
          { date: DAY[1], value: 101_000 },
          { date: DAY[2], value: 101_000 },
          { date: DAY[3], value: 102_000 },
        ],
      }),
      { range: 'all', custom: null },
    )!
    const withDeposit = periodChange(report(), { range: 'all', custom: null })!

    expect(withDeposit.twr).toBe(withoutDeposit.twr)
    expect(withDeposit.changeAbs).not.toBe(withoutDeposit.changeAbs)
  })

  /**
   * The anchor, and the reason this file needs no clock. A "1M" window over a history that ends on
   * 3 June resolves to 3 May → 3 June — which, in a history four days long, is the whole of it.
   * Anchored to today it would be empty, and an empty period reads as a flat one.
   */
  it('anchors every preset to the last day of the history, not to today', () => {
    for (const option of RANGE_OPTIONS) {
      if (option.id === 'custom') continue
      const change = periodChange(report(), { range: option.id, custom: null })!
      expect(change.bounds.to, option.id).toBe(DAY[3])
    }
  })

  it('carries the preset label the control shows, so both name one period', () => {
    expect(periodChange(report(), { range: '3m', custom: null })!.label).toBe('Last 3 months')
  })

  /**
   * A custom window can land outside the history entirely. `valueAt` carries a value forward, so
   * the figures below are *not* the guard — `days` is, and zero is a state the caller reports
   * instead of a flat period it describes.
   */
  it('reports a window holding no day as zero days rather than as a flat period', () => {
    const change = periodChange(report(), {
      range: 'custom',
      custom: { from: Date.UTC(2020, 0, 1), to: Date.UTC(2020, 0, 2) },
    })!
    expect(change.days).toBe(0)
  })

  it('counts only the real points inside the window', () => {
    const change = periodChange(report(), { range: 'custom', custom: { from: DAY[2], to: DAY[3] } })!
    expect(change.days).toBe(2)
  })

  /**
   * DDR-0049: daily returns are chain-linked from the return curve and take the **unwindowed**
   * series, so the window's opening bar measures against the trading day that really preceded it.
   * Here the window opens on 2 June, whose −0.50% is measured against 1 June — a day outside it.
   */
  it('measures the first day of a window against the day that really preceded it', () => {
    const change = periodChange(report(), { range: 'custom', custom: { from: DAY[2], to: DAY[3] } })!
    expect(change.daily.count).toBe(2)
    expect(change.daily.worst?.value).toBeCloseTo(-0.4950495, 5)
    expect(change.daily.worst?.date).toBe(DAY[2])
  })

  it('hands the whole-history rollups through untouched, under their own key', () => {
    const change = periodChange(report(), { range: 'custom', custom: { from: DAY[2], to: DAY[3] } })!
    expect(change.history).toEqual({
      cumulativeTwr: 2,
      depositsWithdrawals: 20_000,
      realizedPnl: 4_300,
      unrealizedPnl: 12_000,
    })
  })
})

describe('periodFlows', () => {
  const periods = report().periods

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
    const flows = periodFlows(periods, { from: DAY[1], to: DAY[3] })
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

describe('periodComposition', () => {
  it('reads the two ends of the window and the shift between them', () => {
    const composition = periodComposition(report(), { from: DAY[0], to: DAY[3] })
    expect(composition.days).toBe(3)
    expect(composition.firstDate).toBe(DAY[0])
    expect(composition.lastDate).toBe(DAY[3])
    expect(composition.navChange).toBe(24_500)
    expect(composition.bands.map((b) => [b.band.key, b.first, b.last, b.change])).toEqual([
      ['stock', 90_000, 110_000, 20_000],
      ['cash', 10_000, 14_500, 4_500],
    ])
  })

  /**
   * Sliced, never carried forward (DDR-0052): each point is one day's simultaneous observation of
   * every band, and carrying one forward would pair one day's stocks with another day's cash. A
   * window holding one point therefore has both ends on that point.
   */
  it('puts both ends on the same day when the window holds one', () => {
    const composition = periodComposition(report(), { from: DAY[2], to: DAY[2] })
    expect(composition.days).toBe(1)
    expect(composition.firstDate).toBe(composition.lastDate)
    expect(composition.navChange).toBe(0)
  })

  /** The optional NAV-in-base Flex section degrades, never fails (DDR-0050). */
  it('has no shape at all when the section was never exported', () => {
    const composition = periodComposition(report({ compositionSeries: { bands: [], points: [] } }), {
      from: DAY[0],
      to: DAY[3],
    })
    expect(composition.days).toBe(0)
    expect(composition.bands).toEqual([])
    expect(composition.firstNav).toBeNull()
  })
})

describe('PERIOD_LABELS', () => {
  /**
   * One vocabulary or none (DDR-0085). `RangeFilter` renders `RANGE_OPTIONS` unfiltered, so a
   * preset that reached the control without reaching this map would be a period the owner can
   * pick and the assistant cannot name.
   */
  it('names every preset the control offers', () => {
    for (const option of RANGE_OPTIONS) {
      expect(PERIOD_LABELS[option.id], option.id).toBeTruthy()
    }
    expect(Object.keys(PERIOD_LABELS).sort()).toEqual(RANGE_OPTIONS.map((o) => o.id).sort())
  })

  /** The same words the control shows, so a click and an answer describe one period. */
  it("uses the control's own titles", () => {
    for (const option of RANGE_OPTIONS) {
      expect(PERIOD_LABELS[option.id], option.id).toBe(option.title)
    }
  })
})
