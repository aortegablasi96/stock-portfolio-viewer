import { describe, expect, it } from 'vitest'
import { buildAssistantContext, hasProfile, type GroundingReports } from './assistantContext'
import type { PerformanceReport } from '@shared/domain/performance'
import { DISCLOSURE_CATEGORY_IDS } from '@shared/domain/assistantDisclosure'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import type { AllocationPosition, AllocationReport } from '@shared/domain/allocation'
import type { BalanceDriftReport, BaselineReview } from '@shared/domain/balanceDrift'
import { BASELINE_VERSION } from '@shared/domain/portfolioBaseline'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'

/**
 * The grounding the renderer assembles, which is now none of it (Story #284, DDR-0098; emptied by
 * Story #327).
 *
 * **This file was the Epic's largest correctness risk written down as assertions**, and all of it
 * moved rather than went away. The holdings, weights, profile and drift assertions are
 * `services/assistant/toolReports.test.ts`'s since #326; the performance and standard-period
 * assertions are `services/assistant/performanceReports.test.ts`'s since #327 — over the same prose,
 * in the process that now computes it (DDR-0111).
 *
 * What is left here is the assembly itself, asserted for what it **stops** carrying. A story that
 * re-added a section would put a figure in front of the model twice, spend the round budget the
 * tools need, and pass every test in this repository except the two below.
 */

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

function baseline(over: Partial<BaselineReview> = {}): BaselineReview {
  return {
    version: BASELINE_VERSION,
    applied: ['sector', 'cash', 'coverage'],
    deferred: ['position'],
    ceilings: [
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
    absentAssetClasses: [],
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
    dimensions: [],
    position: null,
    unplaced: { positions: 0, cashBalances: 0, currencies: [], nativeTotals: [] },
    baseline: baseline(),
    balanced: false,
    ...over,
  }
}

const PROFILE: InvestorProfile = {
  styleTags: ['dividend_income'],
  currencyTargets: [{ key: 'USD', low: 30, high: 50 }],
  sectorTargets: [],
  assetClassTargets: [],
  positionSize: { low: 0, high: 15 },
  updatedAt: Date.UTC(2026, 7, 1),
}

const DAY = [Date.UTC(2026, 4, 29), Date.UTC(2026, 5, 3)] as const

function performance(over: Partial<PerformanceReport> = {}): PerformanceReport {
  return {
    baseCurrency: 'EUR',
    valueSeries: [
      { date: DAY[0], value: 100_000 },
      { date: DAY[1], value: 124_500 },
    ],
    returnSeries: [
      { date: DAY[0], value: 0 },
      { date: DAY[1], value: 2 },
    ],
    compositionSeries: { bands: [], points: [] },
    periods: [],
    startingValue: 100_000,
    endingValue: 124_500,
    cumulativeTwr: 2,
    totalDepositsWithdrawals: 20_000,
    totalRealizedPnl: 4_300,
    totalUnrealizedPnl: 12_000,
    ...over,
  }
}

const inputs = (over: Partial<GroundingReports> = {}): GroundingReports => ({
  allocation: { status: 'ok', report: report() },
  profile: PROFILE,
  drift: { status: 'ok', report: drift() },
  performance: { status: 'ok', report: performance() },
  ...over,
})

describe('buildAssistantContext', () => {
  /**
   * **Every section is a tool, so the renderer sends none** (Epic #322, DDR-0111).
   *
   * Asserted as an exact emptiness rather than as "does not contain performance", because the point
   * is what is *no longer* here: a figure assembled here as well as behind a tool would reach the
   * model twice and spend the budget the tool rounds need. The category *list* is untouched — the
   * tools declare the same ids and are held to them by the same list, in `assistantTools.test.ts`.
   */
  it('assembles no section at all, and takes no report to decide it', () => {
    expect(buildAssistantContext()).toEqual({})
    // The reports themselves have not gone anywhere — they still decide whether a question may be
    // asked and what the view says the assistant cannot see. What has gone is their route into the
    // prompt, which is why this function no longer takes one at all.
    expect(inputs({ allocation: { status: 'needs_import' } }).allocation.status).toBe('needs_import')
  })

  /**
   * The boundary the empty assembly keeps: whatever is here is keyed by a category the disclosure
   * declares, which is what `pickDisclosedSections` enforces again at IPC. Vacuous today and
   * deliberately kept — a story that sends a section again meets the guard rather than adding it.
   */
  it('keys anything it does assemble by a category the disclosure names', () => {
    for (const key of Object.keys(buildAssistantContext())) {
      expect(DISCLOSURE_CATEGORY_IDS).toContain(key)
    }
  })
})

describe('hasProfile', () => {
  it('is false for the profile of an owner who never wrote one', () => {
    expect(hasProfile(EMPTY_INVESTOR_PROFILE)).toBe(false)
  })

  it('is true once any policy is stated, targets or style alone', () => {
    expect(hasProfile(PROFILE)).toBe(true)
    expect(hasProfile({ ...EMPTY_INVESTOR_PROFILE, styleTags: ['dividend_income'] })).toBe(true)
  })
})
