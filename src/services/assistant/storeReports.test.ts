import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_INCOME_SYMBOLS,
  MAX_LISTED_REALIZED,
  MAX_LISTED_UPCOMING,
  dataCoverageReport,
  dividendIncomeReport,
  realizedGainsReport,
} from './storeReports'
import { formatCurrency, formatSignedCurrency } from '@shared/format'
import type { DataCoverage } from '@services/dataCoverage/dataCoverageService'
import type { DividendEvent, DividendReport, UpcomingDividend } from '@shared/domain/dividends'
import type { RealizedBySymbol, RealizedGainsReport } from '@shared/domain/realizedGains'

/**
 * The three reports #329 gave the assistant, in the app's own prose.
 *
 * Four properties, and every one of them is a way the feature is unsafe without it:
 *
 * 1. **A state is never an empty report.** Nothing imported, no dated event, a window with no
 *    payment in it — each is a sentence the model must say, not a report full of zeroes it will
 *    phrase as a finding (DDR-0022).
 * 2. **Nothing here is derived.** Realised and unrealised totals are the service's own, computed
 *    with the FIFO traps handled where they are tested (#103) — this report must never re-total the
 *    rows it lists, because it lists only some of them.
 * 3. **Gross and withholding stay two figures** and withholding concludes nothing about tax.
 * 4. **Coverage always answers, names three sources apart, and carries no money at all.**
 */

// ---- fixtures ---------------------------------------------------------------

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

function upcoming(over: Partial<UpcomingDividend> = {}): UpcomingDividend {
  return {
    symbol: 'AAA',
    description: 'ALPHA CORP',
    currency: 'USD',
    exDate: Date.UTC(2026, 6, 1),
    payDate: Date.UTC(2026, 6, 20),
    quantity: 100,
    grossRate: 0.5,
    netNative: 42,
    grossBase: 50,
    withholdingBase: 8,
    netBase: 42,
    ...over,
  }
}

function dividends(over: Partial<DividendReport> = {}): DividendReport {
  return {
    baseCurrency: 'EUR',
    totalGrossBase: 90,
    totalWithholdingBase: 0,
    totalNetBase: 90,
    bySymbol: [],
    byMonth: [],
    events: [event()],
    upcoming: {
      asOf: Date.UTC(2025, 11, 31),
      sectionPresent: false,
      totalGrossBase: 0,
      totalWithholdingBase: 0,
      totalNetBase: 0,
      items: [],
    },
    ...over,
  }
}

function symbolRow(over: Partial<RealizedBySymbol> = {}): RealizedBySymbol {
  return {
    conid: 1,
    symbol: 'AAA',
    description: 'ALPHA CORP',
    realizedShortTerm: 100,
    realizedLongTerm: 0,
    totalRealized: 100,
    ...over,
  }
}

function gains(over: Partial<RealizedGainsReport> = {}): RealizedGainsReport {
  return {
    baseCurrency: 'EUR',
    totalRealized: 1_500,
    totalRealizedShortTerm: 900,
    totalRealizedLongTerm: 600,
    totalUnrealized: 2_400,
    bySymbol: [symbolRow()],
    trades: [],
    ...over,
  }
}

function coverage(over: Partial<DataCoverage> = {}): DataCoverage {
  return {
    flex: {
      statements: 2,
      from: Date.UTC(2024, 0, 1),
      to: Date.UTC(2025, 11, 31),
      latestImportedAt: Date.UTC(2026, 0, 5),
      baseCurrencies: ['EUR'],
    },
    snapshots: { captures: 4, earliest: Date.UTC(2025, 5, 1), latest: Date.UTC(2026, 5, 1) },
    readAt: Date.UTC(2026, 8, 1, 9, 30),
    ...over,
  }
}

// ---- get_dividend_income ----------------------------------------------------

describe('dividendIncomeReport', () => {
  it('reports nothing imported as a state naming the recovery', () => {
    const text = dividendIncomeReport({ status: 'needs_import' }, 'all')

    expect(text).toContain('no Flex statement has been imported')
    expect(text).toContain('Portfolio view')
    expect(text).not.toContain('€')
  })

  /**
   * Two silences, kept apart because they recover differently (DDR-0022): an account that has been
   * paid nothing, and an import whose dividend rows carry no date at all.
   */
  it('separates no dividend history from a history that cannot be placed in time', () => {
    expect(dividendIncomeReport({ status: 'ok', report: dividends({ events: [] }) }, 'all')).toContain(
      'no dividend or withholding cash transaction at all',
    )

    const undated = dividends({ events: [event({ date: null }), event({ date: null })] })
    const text = dividendIncomeReport({ status: 'ok', report: undated }, 'all')
    expect(text).toContain('not one of them carries a date')
    expect(text).toContain('do not report it as belonging to any period')
  })

  /**
   * **A window the dividend history does not hold is a named state with the alternatives**
   * (DDR-0102) — and it says the set is cut from the dividend history, because the key may well have
   * come out of `get_performance_periods`.
   */
  it('answers an unheld period with the periods it does hold', () => {
    const text = dividendIncomeReport({ status: 'ok', report: dividends() }, 'march to july')

    expect(text).toContain('no dividend period called "march to july"')
    expect(text).toContain('- all — Full history')
    expect(text).toContain("cut from the dividend history's own span")
    expect(text).toContain('Never answer about a neighbouring period')
  })

  it('keeps gross, withholding and net as three separate figures in the app’s own format', () => {
    const report = dividends({
      events: [
        event({ amountBase: 90 }),
        event({ type: 'Withholding Tax', amountBase: -15 }),
      ],
    })

    const text = dividendIncomeReport({ status: 'ok', report }, 'all')

    expect(text).toContain(`Gross dividend income: ${formatCurrency(90, 'EUR')}`)
    expect(text).toContain(`Withholding tax: ${formatCurrency(15, 'EUR')}`)
    expect(text).toContain(`Net income after withholding: ${formatCurrency(75, 'EUR')}`)
  })

  /** The story's own line: withholding is the figure it is, and nothing is concluded from it. */
  it('concludes nothing about tax from the withholding figure', () => {
    const text = dividendIncomeReport({ status: 'ok', report: dividends() }, 'all')

    expect(text).toContain('no tax treatment, no tax efficiency and no tax outcome')
    expect(text).toContain('never describe a withheld amount as recoverable')
  })

  it('names which store, which clock and which span its windows came from', () => {
    const text = dividendIncomeReport({ status: 'ok', report: dividends() }, 'all')

    expect(text).toContain('From imported Flex history')
    expect(text).toContain("cut from the dividend history's own span")
    expect(text).toContain('2025-03-10')
  })

  /** A period with no payment is a state, never a period that paid nothing. */
  it('reports an empty window as a state rather than as income of nil', () => {
    const report = dividends({ events: [event({ date: Date.UTC(2025, 2, 10) })] })
    // A calendar year the history touches but this event does not fall in cannot exist here — the
    // extent is the one event — so the empty window is exercised through a quarter of that year.
    const text = dividendIncomeReport({ status: 'ok', report }, 'quarter:Q1 2025')

    expect(text).not.toContain('never say the portfolio paid nothing')
    const empty = dividendIncomeReport(
      {
        status: 'ok',
        report: dividends({
          events: [event({ date: Date.UTC(2025, 0, 5) }), event({ date: Date.UTC(2025, 8, 5) })],
        }),
      },
      'quarter:Q2 2025',
    )
    expect(empty).toContain('No dividend cash event falls inside this period')
    expect(empty).toContain('never say the portfolio paid nothing')
  })

  it('counts undated events out of every period rather than into one', () => {
    const report = dividends({
      events: [event({ amountBase: 90 }), event({ date: null, amountBase: 60 })],
    })

    const text = dividendIncomeReport({ status: 'ok', report }, 'all')
    expect(text).toContain(`Gross dividend income: ${formatCurrency(90, 'EUR')}`)
    expect(text).toContain('1 dividend cash event(s) in the imported history carry no date')
    expect(text).toContain('not even the whole history')
  })

  it('states what its instrument list left out', () => {
    const events = Array.from({ length: MAX_LISTED_INCOME_SYMBOLS + 3 }, (_, index) =>
      event({ symbol: `SYM${index}`, description: `NAME ${index}`, amountBase: 100 - index }),
    )

    const text = dividendIncomeReport({ status: 'ok', report: dividends({ events }) }, 'all')

    expect(text).toContain(
      `The ${MAX_LISTED_INCOME_SYMBOLS} largest of ${MAX_LISTED_INCOME_SYMBOLS + 3} instruments`,
    )
    expect(text).toContain('do not say these are all of them')
  })

  /**
   * **An absent Flex section is not an absence of dividends** (DDR-0010). Some exports omit open
   * accruals entirely, and a report that quietly said none were declared would answer a question the
   * data never addressed.
   */
  it('reports a missing accruals section as a missing section', () => {
    const text = dividendIncomeReport({ status: 'ok', report: dividends() }, 'all')

    expect(text).toContain('no open-dividend-accruals section at all')
    expect(text).toContain('never say that nothing is coming')
  })

  it('carries announced-but-unpaid dividends as belonging to no period', () => {
    const items = Array.from({ length: MAX_LISTED_UPCOMING + 2 }, (_, index) =>
      upcoming({ symbol: `SYM${index}`, payDate: Date.UTC(2026, 6, 1 + index) }),
    )
    const report = dividends({
      upcoming: {
        asOf: Date.UTC(2026, 5, 30),
        sectionPresent: true,
        totalGrossBase: 350,
        totalWithholdingBase: 56,
        totalNetBase: 294,
        items,
      },
    })

    const text = dividendIncomeReport({ status: 'ok', report }, 'all')

    expect(text).toContain('ANNOUNCED BUT NOT YET PAID')
    expect(text).toContain('never call them income received')
    expect(text).toContain(formatCurrency(294, 'EUR'))
    expect(text).toContain(`The ${MAX_LISTED_UPCOMING} soonest of them`)
  })

  it('says an accrual with no pay date is declared and not scheduled', () => {
    const report = dividends({
      upcoming: {
        asOf: Date.UTC(2026, 5, 30),
        sectionPresent: true,
        totalGrossBase: 50,
        totalWithholdingBase: 8,
        totalNetBase: 42,
        items: [upcoming({ payDate: null })],
      },
    })

    expect(dividendIncomeReport({ status: 'ok', report }, 'all')).toContain(
      'with no pay date set yet',
    )
  })
})

// ---- get_realized_gains -----------------------------------------------------

describe('realizedGainsReport', () => {
  it('reports nothing imported as a state, and never from the live portfolio', () => {
    const text = realizedGainsReport({ status: 'needs_import' })

    expect(text).toContain('no Flex statement has been imported')
    expect(text).toContain('Never answer from the live portfolio')
  })

  /**
   * **The totals are the service's, and this report never re-totals what it lists** — which is the
   * shape Bug #103 took: an aggregate row and an as-of balance summed where they should not have
   * been. The service filters the `Total (All Assets)` row with `isInstrumentSummary` and scopes
   * unrealised with `fromLatestStatement`, and it is tested there. What must hold *here* is that a
   * capped list cannot change a total, so a report of ten rows out of thirty still quotes the whole.
   */
  it('quotes the service’s own totals rather than summing the rows it lists', () => {
    const rows = Array.from({ length: MAX_LISTED_REALIZED + 5 }, (_, index) =>
      symbolRow({ symbol: `SYM${index}`, totalRealized: 100 - index, realizedShortTerm: 100 - index }),
    )
    const report = gains({ bySymbol: rows, totalRealized: 12_345, totalRealizedShortTerm: 12_345 })

    const text = realizedGainsReport({ status: 'ok', report })

    expect(text).toContain(`Realised profit and loss: ${formatSignedCurrency(12_345, 'EUR')}`)
    // The listed rows come to far less than the total, and the report says the totals cover them all.
    expect(text).toContain(`${MAX_LISTED_REALIZED + 5} instrument(s) have realised profit or loss`)
    expect(text).toContain('never a sum of their own')
  })

  /**
   * A flow and a balance under one heading is an addition waiting to happen, and it is exactly the
   * pair #103 got wrong. The report says which is which and forbids the total.
   */
  it('keeps realised and unrealised apart as a flow and an as-of balance', () => {
    const text = realizedGainsReport({ status: 'ok', report: gains() })

    expect(text).toContain('summed over every imported statement')
    expect(text).toContain('as of the latest imported statement alone')
    expect(text).toContain('Never add it to the realised figure above')
    expect(text).toContain('never call either one a return')
  })

  it('says realised figures exist for no period at all', () => {
    expect(realizedGainsReport({ status: 'ok', report: gains() })).toContain(
      'not available for a chosen period',
    )
  })

  /**
   * **Both ends, because a list cut at the top shows every winner and no loser** — a shape a model
   * reads as a portfolio that only wins.
   */
  it('names the largest gains and the largest losses', () => {
    const report = gains({
      bySymbol: [
        symbolRow({ symbol: 'WIN', totalRealized: 900, realizedShortTerm: 900 }),
        symbolRow({ symbol: 'FLAT', totalRealized: 0, realizedShortTerm: 0 }),
        symbolRow({ symbol: 'LOSS', totalRealized: -400, realizedLongTerm: -400, realizedShortTerm: 0 }),
      ],
    })

    const text = realizedGainsReport({ status: 'ok', report })

    expect(text).toContain('Largest realised gains')
    expect(text).toContain('Largest realised losses')
    // Named through `instrumentName`, which is the app's own resolution — the same "Alpha" the
    // dashboards show, never the raw description and never `formatCompanyName` alone (DDR-0066).
    expect(text).toContain('WIN (Alpha)')
    expect(text).toContain('LOSS (Alpha)')
    // An instrument that closed at neither a gain nor a loss is in neither list.
    expect(text).not.toContain('FLAT')
  })

  it('says so when nothing has been closed at all', () => {
    expect(realizedGainsReport({ status: 'ok', report: gains({ bySymbol: [] }) })).toContain(
      'has any realised profit or loss',
    )
  })

  /** A list of executions is raw data for a model to derive from, which no tool may return. */
  it('carries no trade-by-trade history', () => {
    const report = gains({
      trades: [
        {
          tradeKey: 'T-1',
          dateTime: Date.UTC(2025, 3, 3),
          symbol: 'AAA',
          description: 'ALPHA CORP',
          assetCategory: 'STK',
          side: 'Sell',
          tradeType: 'Sell',
          quantity: 25,
          tradePrice: 123.45,
          currency: 'USD',
          proceedsNative: 3_086.25,
          commissionNative: -1.2,
          realizedNative: 500,
          realizedBase: 450,
          openCloseIndicator: 'C',
        },
      ],
    })

    const text = realizedGainsReport({ status: 'ok', report })

    expect(text).not.toContain('T-1')
    expect(text).not.toContain('123.45')
    expect(text).toContain('individual trades are not available')
  })
})

// ---- get_data_coverage ------------------------------------------------------

describe('dataCoverageReport', () => {
  /** The one report with no state: an empty machine is the answer, not a failure to answer. */
  it('answers an empty machine as coverage', () => {
    const text = dataCoverageReport(
      coverage({
        flex: { statements: 0, from: null, to: null, latestImportedAt: null, baseCurrencies: [] },
        snapshots: { captures: 0, earliest: null, latest: null },
      }),
    )

    expect(text).toContain('Nothing has been imported at all')
    expect(text).toContain('This is the coverage, not a failure to report it')
    expect(text).toContain('No snapshot has been captured')
  })

  it('names each store with its own span and its own clock', () => {
    const text = dataCoverageReport(coverage())

    expect(text).toContain('IMPORTED FLEX STATEMENTS')
    expect(text).toContain('Statements imported: 2')
    expect(text).toContain('2024-01-01 to 2025-12-31')
    expect(text).toContain('The most recent import ran 2026-01-05')
    expect(text).toContain('LOCAL SNAPSHOTS')
    expect(text).toContain('4 capture(s)')
    expect(text).toContain('THE LIVE PORTFOLIO')
    expect(text).toContain('2026-09-01 09:30 UTC')
  })

  /**
   * DDR-0098's pairing, which is the easiest thing in the Epic to lose once reports arrive one at a
   * time: three sources, and the instruction not to mix them.
   */
  it('says the three sources do not tick together', () => {
    const text = dataCoverageReport(coverage())

    expect(text).toContain('There are three sources and they do not tick together')
    expect(text).toContain('never answer a question from a snapshot')
    expect(text).toContain('It has no coverage and no history')
  })

  it('flags more than one base currency as figures that must not be totalled', () => {
    const text = dataCoverageReport(
      coverage({
        flex: {
          statements: 3,
          from: Date.UTC(2024, 0, 1),
          to: Date.UTC(2025, 11, 31),
          latestImportedAt: Date.UTC(2026, 0, 5),
          baseCurrencies: ['EUR', 'USD'],
        },
      }),
    )

    expect(text).toContain('more than one base currency (EUR, USD)')
    expect(text).toContain('never total two of them')
  })

  /**
   * Coverage is declared at `names`, so it may carry no money at all — not a snapshot's value and
   * not a statement's net asset value. The same assertion `toolReports.test.ts` makes of the five
   * reports written under `holdings`, `weights` and `profile` (DDR-0098).
   */
  it('carries no amount of money and no weight', () => {
    const text = dataCoverageReport(coverage())

    expect(text).not.toMatch(/[€$£¥]/)
    expect(text).not.toMatch(/\d{1,3}(,\d{3})+(\.\d+)?/)
    expect(text).not.toContain('%')
  })
})
