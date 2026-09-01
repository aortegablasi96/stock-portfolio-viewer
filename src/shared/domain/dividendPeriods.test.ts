import { describe, expect, it } from 'vitest'
import { dividendExtent, dividendIncome, dividendWindows, undatedEvents } from './dividendPeriods'
import { standardWindows } from './standardPeriods'
import type { DividendEvent, DividendReport } from './dividends'

/**
 * Windowing the dividend history by the same keys the period set uses (Story #329).
 *
 * Three properties, each of which a report is wrong without:
 *
 * 1. **Gross and withholding stay two series** (DDR-0080), with withholding carried as a magnitude —
 *    a net figure that swallowed the tax is a third number neither of the two can be recovered from.
 * 2. **An undated event is inside no window**, `all` included, and is counted so a report can say
 *    what its totals do not cover. Absent is not zero.
 * 3. **The extent is the dividend history's own.** A window here can end before the value history
 *    does, which is a fact reports carry rather than a bug to reconcile away.
 */

function event(over: Partial<DividendEvent> = {}): DividendEvent {
  return {
    date: Date.UTC(2025, 2, 10),
    symbol: 'AAA',
    description: 'ALPHA CORP',
    type: 'Dividends',
    currency: 'USD',
    amountNative: 100,
    amountBase: 90,
    sharesHeld: 100,
    perShareNative: 1,
    ...over,
  }
}

function report(events: DividendEvent[]): DividendReport {
  return {
    baseCurrency: 'EUR',
    totalGrossBase: 0,
    totalWithholdingBase: 0,
    totalNetBase: 0,
    bySymbol: [],
    byMonth: [],
    events,
    upcoming: {
      asOf: null,
      sectionPresent: false,
      totalGrossBase: 0,
      totalWithholdingBase: 0,
      totalNetBase: 0,
      items: [],
    },
  }
}

const WHOLE = { from: Date.UTC(2000, 0, 1), to: Date.UTC(2030, 0, 1) }

describe('dividendExtent', () => {
  it('spans the first and last dated event', () => {
    expect(
      dividendExtent(
        report([
          event({ date: Date.UTC(2025, 5, 1) }),
          event({ date: Date.UTC(2024, 0, 15) }),
          event({ date: Date.UTC(2025, 1, 3) }),
        ]),
      ),
    ).toEqual({ from: Date.UTC(2024, 0, 15), to: Date.UTC(2025, 5, 1) })
  })

  /** Dividends with no date are not a shorter history; they are no history to window at all. */
  it('is null where nothing carries a date, whatever else the report holds', () => {
    expect(dividendExtent(report([]))).toBeNull()
    expect(dividendExtent(report([event({ date: null }), event({ date: null })]))).toBeNull()
    expect(dividendWindows(report([event({ date: null })]))).toBeNull()
  })
})

describe('dividendWindows', () => {
  /**
   * The keys are the period set's, and they have to be: a model reads one out of
   * `get_performance_periods` and hands it here. One definition of what a window is called, cut
   * from a second history.
   */
  it('names its windows exactly as the standard period set does', () => {
    const events = [event({ date: Date.UTC(2024, 0, 15) }), event({ date: Date.UTC(2025, 5, 1) })]
    const extent = { from: Date.UTC(2024, 0, 15), to: Date.UTC(2025, 5, 1) }

    expect(dividendWindows(report(events))!.windows.map((window) => window.id)).toEqual(
      standardWindows(extent).windows.map((window) => window.id),
    )
  })

  /** Anchored to the last *dividend*, never the clock and never another store's last day. */
  it('anchors its trailing windows to the last dated dividend', () => {
    const windows = dividendWindows(
      report([event({ date: Date.UTC(2023, 0, 10) }), event({ date: Date.UTC(2024, 2, 31) })]),
    )!

    expect(windows.extent.to).toBe(Date.UTC(2024, 2, 31))
    expect(windows.windows.find((window) => window.id === 'trailing:1y')!.bounds.to).toBe(
      Date.UTC(2024, 2, 31),
    )
  })
})

describe('dividendIncome', () => {
  it('keeps gross and withholding apart, withholding as a magnitude', () => {
    const income = dividendIncome(
      report([
        event({ amountBase: 90 }),
        event({ type: 'Payment In Lieu Of Dividends', amountBase: 10 }),
        event({ type: 'Withholding Tax', amountBase: -15 }),
      ]),
      WHOLE,
    )

    expect(income.grossBase).toBe(100)
    expect(income.withholdingBase).toBe(15)
    expect(income.netBase).toBe(85)
    expect(income.events).toBe(3)
  })

  it('counts only the events inside the window', () => {
    const events = [
      event({ date: Date.UTC(2024, 11, 31), amountBase: 50 }),
      event({ date: Date.UTC(2025, 0, 2), amountBase: 40 }),
      event({ date: Date.UTC(2025, 11, 31), amountBase: 30 }),
      event({ date: Date.UTC(2026, 0, 1), amountBase: 20 }),
    ]
    const year = { from: Date.UTC(2025, 0, 1), to: Date.UTC(2025, 11, 31) }

    const income = dividendIncome(report(events), year)
    expect(income.events).toBe(2)
    expect(income.grossBase).toBe(70)
  })

  /**
   * **An undated event is in no window, including `all`.** The whole-history window is cut from the
   * extent like every other, so a report's totals genuinely do not cover these — which is why the
   * count exists rather than the events being quietly folded in somewhere.
   */
  it('leaves an undated event out of every window and counts it separately', () => {
    const held = report([event({ amountBase: 90 }), event({ date: null, amountBase: 60 })])
    const windows = dividendWindows(held)!

    const all = dividendIncome(held, windows.windows.find((window) => window.id === 'all')!.bounds)
    expect(all.grossBase).toBe(90)
    expect(undatedEvents(held)).toBe(1)
  })

  it('groups by instrument, largest net first, and nets each row the same way', () => {
    const income = dividendIncome(
      report([
        event({ symbol: 'AAA', amountBase: 100 }),
        event({ symbol: 'AAA', type: 'Withholding Tax', amountBase: -30 }),
        event({ symbol: 'BBB', description: 'BETA PLC', amountBase: 80 }),
      ]),
      WHOLE,
    )

    expect(income.bySymbol.map((group) => group.symbol)).toEqual(['BBB', 'AAA'])
    const aaa = income.bySymbol.find((group) => group.symbol === 'AAA')!
    expect(aaa.grossBase).toBe(100)
    expect(aaa.withholdingBase).toBe(30)
    expect(aaa.netBase).toBe(70)
  })

  /** A window with nothing in it is zeros the caller reports as a *state*, never as income of nil. */
  it('returns an empty window rather than inventing a figure for it', () => {
    const income = dividendIncome(report([event()]), {
      from: Date.UTC(2019, 0, 1),
      to: Date.UTC(2019, 11, 31),
    })

    expect(income.events).toBe(0)
    expect(income.bySymbol).toEqual([])
  })
})
