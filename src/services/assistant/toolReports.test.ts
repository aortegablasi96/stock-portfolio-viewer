import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_MOVES,
  MAX_LISTED_POSITIONS,
  allocationReport,
  investorProfileReport,
  measuredDrift,
  portfolioOverviewReport,
  rebalanceGapsReport,
  type LivePortfolioResult,
} from './toolReports'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import type { AllocationPosition, AllocationReport } from '@shared/domain/allocation'
import type { Holding, PortfolioOverview } from '@shared/domain/portfolio'
import type {
  BalanceDriftReport,
  BaselineReview,
  DriftBand,
  DriftMove,
} from '@shared/domain/balanceDrift'
import { BASELINE_CHECKS, BASELINE_VERSION } from '@shared/domain/portfolioBaseline'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'

/**
 * The four reports the model may ask for (Story #326, DDR-0111).
 *
 * **This file is the Epic's largest correctness risk written down as assertions**, and most of it
 * arrived here from `renderer/src/lib/assistantContext.test.ts` with the prose it guards. ADR-0009
 * says the model never produces a figure, and that sentence is only true if something else produces
 * every one of them — which is these functions, and these assertions.
 *
 * Four properties the feature is unsafe without, each with tests below:
 *
 * 1. A report carries **no more than its declared disclosure allows** — no money in any of the four,
 *    whatever the reports underneath contain.
 * 2. **Absent is absent, never zero, and a state is never an empty report** — a gateway that is not
 *    running is a sentence the model must say, and an unconvertible holding never gets a weight
 *    (DDR-0007, DDR-0022).
 * 3. Every figure goes through the **app's own formatters**, so prose and dashboard agree.
 * 4. A report **says which store and which clock it came from**, and — new in this story — **what
 *    its percentages are a share of**, because two reports now weigh the same portfolio against two
 *    denominators by design.
 */

// ---- fixtures ---------------------------------------------------------------

function position(over: Partial<AllocationPosition> = {}): AllocationPosition {
  return {
    conid: 1,
    symbol: 'AAPL',
    description: 'APPLE INC',
    assetCategory: 'STK',
    currency: 'USD',
    issuerCountry: 'US',
    sector: 'Technology',
    industry: 'Computers',
    marketValueBase: 12_345.67,
    costBasisBase: 10_000,
    unrealizedPnlBase: 2_345.67,
    percentOfNav: 24.5,
    ...over,
  }
}

function report(over: Partial<AllocationReport> = {}): AllocationReport {
  return {
    baseCurrency: 'EUR',
    reportDate: Date.UTC(2026, 6, 31),
    totalMarketValueBase: 50_000,
    positions: [position()],
    byAssetClass: [{ key: 'STK', label: 'Stocks', marketValueBase: 40_000, percentOfNav: 80 }],
    byCurrency: [{ key: 'USD', label: 'USD', marketValueBase: 30_000, percentOfNav: 60 }],
    byCountry: [{ key: 'US', label: 'United States', marketValueBase: 30_000, percentOfNav: 60 }],
    bySector: [{ key: 'Technology', label: 'Technology', marketValueBase: 20_000, percentOfNav: 40 }],
    unclassifiedCount: 0,
    ...over,
  }
}

function holding(over: Partial<Holding> = {}): Holding {
  return {
    conid: 1,
    symbol: 'AAPL',
    description: 'AAPL',
    companyName: 'APPLE INC',
    quantity: 10,
    averageCost: 100,
    marketPrice: 150,
    marketValue: 1_500,
    unrealizedPnl: 500,
    currency: 'USD',
    displayValue: 1_200,
    displayUnrealizedPnl: 400,
    ...over,
  }
}

function overview(over: Partial<PortfolioOverview> = {}): PortfolioOverview {
  return {
    holdings: [holding()],
    balances: {
      currency: 'EUR',
      totalCashValue: 12_345.67,
      netLiquidation: 50_000,
      stockMarketValue: 37_654.33,
    },
    allocation: [],
    totalMarketValue: 1_200,
    displayCurrency: 'EUR',
    ...over,
  }
}

const live = (over: Partial<PortfolioOverview> = {}): LivePortfolioResult => ({
  status: 'ok',
  overview: overview(over),
  displayCurrency: 'EUR',
  readAt: Date.UTC(2026, 7, 28, 9, 15),
})

/**
 * The baseline `PROFILE` would actually produce (Story #315, ADR-0012).
 *
 * `PROFILE` states currency targets and a position ceiling and nothing about sectors or asset
 * classes, which is the shape almost every real profile has — so `position` defers to the owner and
 * the other three run. The fixture is that state rather than a convenient one, because "the profile
 * wins where it speaks" is the property most of these assertions are about.
 */
function baseline(over: Partial<BaselineReview> = {}): BaselineReview {
  return {
    version: BASELINE_VERSION,
    applied: ['sector', 'cash', 'coverage'],
    deferred: ['position'],
    ceilings: [
      {
        check: 'sector',
        key: 'Technology',
        label: 'Technology',
        name: null,
        actual: 41.5,
        limit: 30,
        status: 'above',
        distance: 11.5,
        bounded: false,
      },
      {
        check: 'cash',
        key: CASH_ASSET_KEY,
        label: 'Cash',
        name: null,
        actual: 5,
        limit: 15,
        status: 'inside',
        distance: 0,
        bounded: false,
      },
    ],
    absentAssetClasses: [{ key: 'BOND', label: 'Bonds' }],
    sectorsHeld: 3,
    withinBaseline: false,
    ...over,
  }
}

function drift(over: Partial<BalanceDriftReport> = {}): BalanceDriftReport {
  return {
    displayCurrency: 'EUR',
    readAt: Date.UTC(2026, 7, 28, 9, 15),
    placedValue: 50_000,
    dimensions: [
      {
        dimension: 'currency',
        bands: [
          {
            key: 'USD',
            label: 'USD',
            actual: 60,
            low: 30,
            high: 50,
            status: 'above',
            distance: 10,
            // Sized by `driftMoves` in the service; here it is the shape the report renders
            // (Story #287). Ten points out of two positions, and the band lands on its edge.
            move: {
              direction: 'trim',
              points: 10,
              contributors: [
                { symbol: 'AAPL', name: 'Apple Inc', weight: 40, points: 8, resultingWeight: 32 },
                { symbol: 'MSFT', name: null, weight: 10, points: 2, resultingWeight: 8 },
              ],
              uncovered: 0,
              ceilingLimited: false,
              candidates: 4,
            },
          },
        ],
        residuals: [{ kind: 'cash', label: 'Cash', weight: 5 }],
        untargeted: 35,
      },
    ],
    position: null,
    unplaced: { positions: 0, cashBalances: 0, currencies: [], nativeTotals: [] },
    baseline: baseline(),
    balanced: false,
    ...over,
  }
}

/** One currency band and its move, for the cases that are about the move alone. */
function bandOf(band: Partial<DriftBand>, move: DriftMove | null): BalanceDriftReport {
  return drift({
    dimensions: [
      {
        dimension: 'currency',
        bands: [
          {
            key: 'USD',
            label: 'USD',
            actual: 60,
            low: 30,
            high: 50,
            status: 'above',
            distance: 10,
            ...band,
            move,
          },
        ],
        residuals: [],
        untargeted: 0,
      },
    ],
  })
}

const PROFILE: InvestorProfile = {
  styleTags: ['dividend_income'],
  currencyTargets: [{ key: 'USD', low: 30, high: 50 }],
  sectorTargets: [],
  assetClassTargets: [],
  positionSize: { low: 0, high: 15 },
  updatedAt: Date.UTC(2026, 7, 1),
}

// ---- get_portfolio_overview -------------------------------------------------

describe('the live portfolio report', () => {
  it('names the store and the minute it was read, so two clocks are never mixed', () => {
    const text = portfolioOverviewReport(live())
    expect(text).toContain('read from the IBKR gateway at 2026-08-28 09:15 UTC')
    expect(text).toContain('never mix it with a figure out of the imported store')
  })

  /**
   * The story's own trap. This report and the rebalancing one weigh the same portfolio against two
   * different totals — one excludes cash, the other includes it (DDR-0095) — and both are right. A
   * model that met them without being told would reconcile two right answers by picking one.
   */
  it('says what its percentages are a share of, and that the other report differs', () => {
    const text = portfolioOverviewReport(live())
    expect(text).toContain('share of the total value of the holdings that could be valued in EUR')
    expect(text).toContain('Cash is not in that total')
    expect(text).toContain('the two are not comparable')
  })

  it('names each position and weighs it through the app’s own formatter', () => {
    const text = portfolioOverviewReport(
      live({
        holdings: [
          holding({ symbol: 'AAPL', displayValue: 3_000 }),
          holding({ conid: 2, symbol: 'MSFT', companyName: null, description: 'MSFT', displayValue: 1_000 }),
        ],
      }),
    )
    // `Apple`, not `APPLE INC`: the same `holdingName` shortening every view draws (DDR-0066).
    expect(text).toContain('- AAPL (Apple) · currency USD: 75.00%')
    // A description that only repeats the ticker is not a name (DDR-0066), so the row is the
    // symbol alone rather than `Msft`.
    expect(text).toContain('- MSFT · currency USD: 25.00%')
  })

  /** Largest first, so what a cap removes is what matters least — and the cut is stated. */
  it('states how many of how many it listed rather than truncating in silence', () => {
    const holdings = Array.from({ length: MAX_LISTED_POSITIONS + 5 }, (_, index) =>
      holding({ conid: index, symbol: `SYM${index}`, displayValue: 1_000 - index }),
    )
    const text = portfolioOverviewReport(live({ holdings }))

    expect(text).toContain(`The ${MAX_LISTED_POSITIONS} largest of ${MAX_LISTED_POSITIONS + 5} open positions`)
    expect(text).toContain('- SYM0 ')
    expect(text).not.toContain('- SYM44 ')
  })

  /**
   * DDR-0007 and Bug #68 in one assertion: an unconvertible holding is **unplaced**, is named
   * without a percentage, and makes every weight beside it a lower bound rather than a measurement.
   */
  it('names an unconvertible holding without weighing it, and bounds the rest', () => {
    const text = portfolioOverviewReport(
      live({
        holdings: [holding(), holding({ conid: 2, symbol: 'NESN', currency: 'CHF', displayValue: null })],
      }),
    )

    expect(text).toContain('1 holding(s) could not be valued in EUR (CHF): NESN')
    expect(text).toContain('no percentage exists for them')
    expect(text).toContain('every weight here is a lower bound')
  })

  /** An empty account is a fact, not a report with nothing in it. */
  it('says the account holds nothing rather than listing nothing', () => {
    const text = portfolioOverviewReport(live({ holdings: [] }))
    expect(text).toContain('holds no open position at all')
  })

  /**
   * The two gateway failures are **not interchangeable** (DDR-0022): one means start the gateway,
   * the other means it is running and has gone quiet. Each is a sentence the model states, never an
   * empty report it phrases as a finding.
   */
  it.each([
    ['not_connected', 'the IBKR gateway is not running'],
    ['not_responding', 'stopped answering'],
  ] as const)('reports %s as its own state', (status, phrase) => {
    const text = portfolioOverviewReport({ status, message: 'x' })
    expect(text).toContain(phrase)
    // Never a report with nothing in it: the state is what the model must say (DDR-0022).
    expect(text).not.toContain('- AAPL')
  })
})

// ---- get_investor_profile ---------------------------------------------------

describe('the investor profile report', () => {
  it('separates what the owner set from whether they meet it', () => {
    const text = investorProfileReport(PROFILE)
    expect(text).toContain('their own standard, not the app’s')
    expect(text).toContain('that is the rebalancing report')
    expect(text).toContain('never suggest a target for the owner to set')
  })

  it('writes every target as a range, by its label rather than its stored key', () => {
    const text = investorProfileReport({
      ...PROFILE,
      assetClassTargets: [{ key: CASH_ASSET_KEY, low: 1, high: 5 }],
    })

    expect(text).toContain('- Currency USD: 30.00%–50.00%')
    expect(text).toContain('- Any single position: 0.00%–15.00%')
    // The stored sentinel means nothing to a model; the label is what the owner wrote (DDR-0094).
    expect(text).toContain('- Asset class Cash: 1.00%–5.00%')
    expect(text).not.toContain(CASH_ASSET_KEY)
  })

  it('names the owner’s stated investing style', () => {
    expect(investorProfileReport(PROFILE)).toContain(
      'Investing style the owner states: Dividend income',
    )
  })

  /**
   * An untargeted dimension **absent from a report reads as one that came back clean** (DDR-0095).
   * `PROFILE` states currencies and a position ceiling and nothing else, so sectors and asset
   * classes have to be named as untargeted in as many words.
   */
  it('says out loud which dimensions carry no target of the owner’s', () => {
    const text = investorProfileReport(PROFILE)
    expect(text).toContain('the owner has set no target for sector and asset class')
    expect(text).toContain('Never report them as balanced')
    expect(text).toContain('say the standard is the app’s')
  })

  it('names an absent single-position ceiling as its own untargeted dimension', () => {
    const text = investorProfileReport({ ...PROFILE, positionSize: null })
    expect(text).toContain('no single-position concentration ceiling')
  })

  /**
   * "Never written" and "cleared" are one state (DDR-0094), and the sentence is the most important
   * one the assistant carries about the profile: without it the app's baseline is a standard with no
   * owner named, which is how a default becomes a policy the model attributes to them.
   */
  it('reports an unset profile as a state, and forbids the baseline standing in for it', () => {
    const text = investorProfileReport(EMPTY_INVESTOR_PROFILE)
    expect(text).toContain('has not set an investor profile at all')
    expect(text).toContain('Assistant view’s profile section')
    expect(text).toContain('Never treat the app’s baseline as theirs')
  })
})

// ---- get_allocation ---------------------------------------------------------

describe('the allocation report', () => {
  it('names the store and the date it is as of, so two clocks are never mixed', () => {
    expect(allocationReport({ status: 'ok', report: report() }, 'position', null)).toContain(
      'From imported Flex history, as of 2026-07-31 and never as of today',
    )
  })

  /** `needs_import` is a state about the app, never an allocation that came back empty. */
  it('reports nothing imported as a state rather than as an empty breakdown', () => {
    const text = allocationReport({ status: 'needs_import' }, 'sector', null)
    expect(text).toContain('no Flex statement has been imported')
    expect(text).toContain('Never describe this as a portfolio holding nothing')
  })

  it('returns only the dimension it was asked for', () => {
    const text = allocationReport({ status: 'ok', report: report() }, 'sector', null)
    expect(text).toContain('By sector, as a share of net asset value')
    expect(text).toContain('- Technology: 40.00%')
    expect(text).not.toContain('By currency')
    expect(text).not.toContain('United States')
  })

  it('carries the ticker, the name, the currency, the sector and the asset class of a position', () => {
    const text = allocationReport({ status: 'ok', report: report() }, 'position', null)
    expect(text).toContain('- AAPL (Apple) · currency USD · sector Technology · asset class STK: 24.50%')
  })

  /**
   * DDR-0015's trap, stated where the figures are: `percentOfNAV` sums to 100% **across positions**
   * and excludes cash, so a list that stops short of 100% is not a missing slice.
   */
  it('says what the position weights are a share of, and where the remainder went', () => {
    const text = allocationReport({ status: 'ok', report: report() }, 'position', null)
    expect(text).toContain('these weights do not sum to 100%')
    expect(text).toContain('the remainder is cash')
  })

  /** Largest-N by weight is here, which is why no `get_concentration` tool exists (DDR-0111). */
  it('takes the largest N by weight when asked for a count', () => {
    const positions = [
      position({ conid: 1, symbol: 'BIG', percentOfNav: 30 }),
      position({ conid: 2, symbol: 'MID', percentOfNav: 20 }),
      position({ conid: 3, symbol: 'SMALL', percentOfNav: 10 }),
    ]
    const text = allocationReport({ status: 'ok', report: report({ positions }) }, 'position', 2)

    expect(text).toContain('The 2 largest of 3 open positions')
    expect(text).toContain('- BIG')
    expect(text).not.toContain('- SMALL')
  })

  /** A count, bounded. Asking for five hundred positions is asking for all of them. */
  it.each([
    [0, MAX_LISTED_POSITIONS],
    [500, MAX_LISTED_POSITIONS],
    [null, MAX_LISTED_POSITIONS],
  ])('bounds a limit of %s at the cap', (limit, cap) => {
    const positions = Array.from({ length: cap + 5 }, (_, index) =>
      position({ conid: index, symbol: `SYM${index}`, percentOfNav: 100 - index }),
    )
    const text = allocationReport({ status: 'ok', report: report({ positions }) }, 'position', limit)
    expect(text).toContain(`The ${cap} largest of ${cap + 5} open positions`)
  })

  /** Beside the breakdown it qualifies, because a breakdown is quoted on its own. */
  it('says what a currency weight is, beside the currency breakdown', () => {
    const text = allocationReport({ status: 'ok', report: report() }, 'currency', null)
    expect(text).toContain('not the currency the underlying business earns its revenue in')
  })

  /** The sector universe is open (ADR-0012, Option D), so a missing sector cannot be named. */
  it('carries the sector caveat and the unclassified count', () => {
    const text = allocationReport(
      { status: 'ok', report: report({ unclassifiedCount: 3 }) },
      'sector',
      null,
    )
    expect(text).toContain('never name a missing sector')
    expect(text).toContain('3 position(s) have no sector in the local classification cache')
    expect(text).toContain('They are not a sector')
  })

  /** An attribute the statement does not carry is absent, not a set of zero weights. */
  it('reports an empty breakdown as an absent attribute', () => {
    const text = allocationReport({ status: 'ok', report: report({ byCountry: [] }) }, 'country', null)
    expect(text).toContain('carries no issuer country breakdown at all')
    expect(text).toContain('not a set of zero weights')
  })
})

// ---- get_rebalance_gaps -----------------------------------------------------

describe('the rebalancing gaps report', () => {
  it('names the live reading, its clock and the total its weights are a share of', () => {
    const text = rebalanceGapsReport({ status: 'ok', report: drift() })
    expect(text).toContain('measured against the live portfolio, read 2026-08-28 09:15 UTC')
    expect(text).toContain('cash included')
    expect(text).toContain('a different total from the live holdings report')
  })

  it('carries each band’s verdict against the owner’s own range', () => {
    const text = rebalanceGapsReport({ status: 'ok', report: drift() })
    expect(text).toContain('- USD: 60.00% against 30.00%–50.00% — above the range by +10.00%')
  })

  /** Surfaced, never redistributed (DDR-0095). */
  it('surfaces a residual and whatever carries no target at all', () => {
    const text = rebalanceGapsReport({ status: 'ok', report: drift() })
    expect(text).toContain('- Cash (no target applies): 5.00%')
    expect(text).toContain('- Held in categories with no target: 35.00%')
  })

  /**
   * The untargeted dimensions are derived from the report itself rather than from a second read of
   * the profile, which is what keeps this tool on **one** service method (DDR-0111). The fixture
   * carries currency bands and nothing else, so sectors and asset classes must still be named.
   */
  it('names the untargeted dimensions without reading the profile again', () => {
    const text = rebalanceGapsReport({ status: 'ok', report: drift() })
    expect(text).toContain('the owner has set no target for sector and asset class')
    expect(text).toContain('no single-position concentration ceiling')
  })

  /** `balanced` is nullable because a vacuous `true` is what a model calls balanced (ADR-0012). */
  it('refuses to call a portfolio with no targets balanced', () => {
    const text = rebalanceGapsReport({
      status: 'ok',
      report: drift({ dimensions: [], balanced: null }),
    })
    expect(text).toContain('nothing of theirs to be inside or outside')
    expect(text).not.toContain('Every target the owner set is currently inside')
  })

  it.each([
    ['not_connected', 'the IBKR gateway is not running'],
    ['not_responding', 'stopped answering'],
  ] as const)('reports %s as its own state, never as a balanced portfolio', (status, phrase) => {
    const text = rebalanceGapsReport({ status, message: 'x' })
    expect(text).toContain(phrase)
    expect(text).not.toContain('inside its range')
  })

  it('reports nothing valuable as a state rather than as balance', () => {
    const text = rebalanceGapsReport({ status: 'no_data' })
    expect(text).toContain('no gap can be measured')
    expect(text).toContain('never report this as a balanced portfolio')
  })
})

// ---- the moves, and the arithmetic that arrives done -------------------------

describe('the drift-closing moves', () => {
  it('states that the arithmetic is the app’s and that a move shifts weight, not money', () => {
    const text = measuredDrift(drift())
    expect(text).toContain('never size a move of your own')
    expect(text).toContain('nothing paid in and nothing taken out')
    expect(text).toContain('No amount of money is available for any of them')
  })

  it('sizes a move, names the positions carrying it and states where the band lands', () => {
    const text = measuredDrift(drift())
    expect(text).toContain('Move: trim 10.00 percentage points out of USD to reach 50.00%')
    expect(text).toContain('Positions carrying it (the 2 largest of 4 held in USD)')
    expect(text).toContain('· AAPL (Apple Inc): 40.00% of the portfolio now, giving up 8.00 percentage points, leaving it at 32.00%')
    expect(text).toContain('After this move USD sits at 50.00%, inside its range')
  })

  /** What a move cannot carry is named, never spread over the positions that exist (DDR-0103). */
  it('names an uncovered remainder rather than placing it on a position', () => {
    const text = measuredDrift(
      bandOf(
        {},
        {
          direction: 'trim',
          points: 10,
          contributors: [
            { symbol: 'AAPL', name: null, weight: 40, points: 6, resultingWeight: 34 },
          ],
          uncovered: 4,
          ceilingLimited: true,
          candidates: 1,
        },
      ),
    )

    expect(text).toContain('4.00 percentage points of this move is still not carried by anything listed above')
    expect(text).toContain('single-position ceiling is what stops it')
    expect(text).toContain('do not place it on a position yourself')
  })

  /** A band the owner targets and holds nothing in cannot be closed from the book. */
  it('says a band with nothing held in it needs an instrument the owner does not hold', () => {
    const text = measuredDrift(
      bandOf(
        { status: 'below', actual: 10, distance: -20 },
        {
          direction: 'add',
          points: 20,
          contributors: [],
          uncovered: 20,
          ceilingLimited: false,
          candidates: 0,
        },
      ),
    )

    expect(text).toContain('No position currently held sits in USD')
    expect(text).toContain('do not name one from the positions above')
  })

  /** The budget is shared across dimensions, largest gap first, and says what it did not size. */
  it('sizes the widest gaps only, and says how many it left', () => {
    const bands: DriftBand[] = Array.from({ length: MAX_LISTED_MOVES + 3 }, (_, index) => ({
      key: `CUR${index}`,
      label: `CUR${index}`,
      actual: 60 + index,
      low: 10,
      high: 20,
      status: 'above',
      distance: 40 + index,
      move: {
        direction: 'trim',
        points: 40 + index,
        contributors: [],
        uncovered: 0,
        ceilingLimited: false,
        candidates: 0,
      },
    }))
    const text = measuredDrift(
      drift({
        dimensions: [{ dimension: 'currency', bands, residuals: [], untargeted: 0 }],
      }),
    )

    expect(text).toContain(
      `${MAX_LISTED_MOVES + 3} band(s) are outside their range; the ${MAX_LISTED_MOVES} with the largest gaps`,
    )
    expect(text).toContain('say a move for them is not available rather than sizing it')
  })

  /** The ceiling is a lower bound where something could not be valued, and says so (Bug #68). */
  it('marks a bounded concentration figure as the lower bound it is', () => {
    const text = measuredDrift(
      drift({
        position: {
          symbol: 'AAPL',
          name: 'Apple Inc',
          actual: 18.75,
          low: 0,
          high: 15,
          status: 'above',
          distance: 3.75,
          bounded: true,
        },
      }),
    )

    expect(text).toContain('Largest single position: AAPL (Apple Inc) at 18.75%')
    expect(text).toContain('This is a lower bound')
  })

  /** Counts and currencies, never an amount: there is no rate with which to compute one. */
  it('reports unplaced holdings as counts, never as weights or amounts', () => {
    const text = measuredDrift(
      drift({
        unplaced: {
          positions: 2,
          cashBalances: 1,
          currencies: ['CHF', 'JPY'],
          nativeTotals: [
            { currency: 'CHF', amount: 1_234 },
            { currency: 'JPY', amount: 90_000 },
          ],
        },
      }),
    )

    expect(text).toContain('2 holding(s) and 1 cash balance(s) could not be valued in EUR (CHF, JPY)')
    expect(text).toContain('no percentage exists for them')
    expect(text).not.toContain('1,234')
    expect(text).not.toContain('90,000')
  })
})

// ---- the app's own standard, and saying so ----------------------------------

/**
 * The baseline block (Story #315, ADR-0012), carried into the tool that reports it.
 *
 * The record traded ADR-0009's clean claim — *the standard is only ever the owner's* — for the
 * capability, and what it bought back is the **marking**: a judgement against a target the owner
 * wrote and a judgement against a default the app ships read identically once they are prose, and
 * only one of them carries the owner's authority. Every assertion here is about that distinction
 * surviving into the text, because the prompt is the only line of defence for phrasing (DDR-0104)
 * and a rule can be asserted present but never asserted obeyed.
 */
describe('the app’s baseline is marked apart from the owner’s own standard', () => {
  const gaps = (report: BalanceDriftReport): string =>
    rebalanceGapsReport({ status: 'ok', report })

  it('names whose standard it is, beside the claim rather than once at the end', () => {
    const text = gaps(drift())
    expect(text).toContain('The app’s default baseline, version 1')
    expect(text).toContain('say the standard is the app’s default and not theirs')
    expect(text).toContain('against the app’s default 30%')
  })

  it('says which checks the owner’s own targets govern, and stands aside on them', () => {
    const text = gaps(drift())
    expect(text).toContain('Not applied, the owner’s own targets govern them: single-position size')
    expect(text).toContain('Judge those against their targets above, never against a default')
  })

  it('forbids the baseline being offered as a profile to adopt', () => {
    const text = gaps(drift())
    expect(text).toContain('not a profile for them to adopt')
    expect(text).toContain('never suggest they set one')
  })

  it('states that currency is covered by no default at all', () => {
    const text = gaps(drift())
    expect(text).toContain('The baseline covers no currency')
    expect(text).toContain('Judge currency against the owner’s targets or not at all')
  })

  it('gives the sector count and forbids naming a sector as missing', () => {
    const text = gaps(drift())
    expect(text).toContain('Holdings carry 3 distinct sector name(s)')
    expect(text).toContain('never name a missing sector')
  })

  it('names an absent asset class as a fact about shape rather than a fault', () => {
    const text = gaps(drift())
    expect(text).toContain('holds no weight at all in Bonds')
    expect(text).toContain('absence is a fact about shape, not a fault')
    expect(text).toContain('Never say what to buy to close it')
  })

  /**
   * A fully-targeted profile gets one sentence rather than a section. There is no baseline figure on
   * offer, so there is nothing to mark, nothing to misapply to currency and no headings to earn.
   */
  it('shrinks to a single sentence when the owner has targeted everything', () => {
    const text = gaps(
      drift({ baseline: baseline({ applied: [], deferred: [...BASELINE_CHECKS], ceilings: [] }) }),
    )

    expect(text).toContain('None of the app’s default baseline applies here')
    expect(text).not.toContain('against the app’s default')
    expect(text).not.toContain('The baseline covers no currency')
  })
})

// ---- the disclosure, enforced ------------------------------------------------

/**
 * The disclosure's own promise, over every report a tool can return (DDR-0098, DDR-0111).
 *
 * All four tools declare `holdings`, `weights` or `profile`, which are names and percentages — and
 * `weights` says *"No amounts of money"* in as many words. So **no amount of money may appear in any
 * of them**, however useful one would be to an answer. A tool result never crosses the IPC boundary
 * where `pickDisclosedSections` bounds a context, so this assertion is the enforcement rather than a
 * second opinion about it.
 */
describe('no report carries an amount of money', () => {
  const reports = (): [string, string][] => [
    ['get_portfolio_overview', portfolioOverviewReport(live())],
    ['get_investor_profile', investorProfileReport(PROFILE)],
    ['get_allocation (position)', allocationReport({ status: 'ok', report: report() }, 'position', null)],
    ['get_allocation (assetClass)', allocationReport({ status: 'ok', report: report() }, 'assetClass', null)],
    ['get_rebalance_gaps', rebalanceGapsReport({ status: 'ok', report: drift() })],
  ]

  it.each(reports())('%s carries no currency symbol and no grouped figure', (_name, text) => {
    expect(text).not.toMatch(/[€$£¥]/)
    // The amounts in the fixtures — 12,345.67, 50,000, 1,200 — must not have survived.
    expect(text).not.toContain('12,345')
    expect(text).not.toContain('50,000')
    expect(text).not.toMatch(/\d{1,3}(,\d{3})+(\.\d+)?(?!%)/)
  })
})
