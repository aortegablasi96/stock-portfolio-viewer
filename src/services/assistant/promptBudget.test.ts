import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, buildPrompt } from './assistantService'
import { MAX_PROMPT_CHARS } from '@repositories/assistant/aiGateway'
import {
  MAX_LISTED_POSITIONS,
  buildAssistantContext,
  type GroundingReports,
} from '@renderer/lib/assistantContext'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'
import type { AllocationPosition, AllocationReport, AllocationSlice } from '@shared/domain/allocation'
import type { BalanceDriftReport, DriftBand } from '@shared/domain/balanceDrift'
import type { PerformanceReport, ValuePoint } from '@shared/domain/performance'
import type { CategoryTarget, InvestorProfile } from '@shared/domain/investorProfileTerms'

/**
 * The prompt budget, measured at the worst case the caps allow (Story #287, DDR-0103).
 *
 * **A context truncated by the gateway is truncated arbitrarily: the last section simply stops.**
 * `aiGateway` refuses a prompt over `MAX_PROMPT_CHARS` outright — nothing is sent, which is the
 * honest failure — but a story that grows the context and never measures it ships an assistant that
 * refuses every question on a large enough portfolio. Every cap in the grounding exists to make
 * that unreachable, and this is the assertion that they still do.
 *
 * It sits on the **service** side, which is the one place the two halves of the real prompt meet:
 * the ceiling is the gateway's, the assembly is `buildPrompt`'s, and the sections are the
 * renderer's. Measuring anything less than `system + user` would be measuring a number the gateway
 * does not check.
 *
 * The fixture is deliberately larger than a portfolio is: every list at its cap, every band out of
 * range, every name long, twenty years of history, and a question at the length a person will
 * actually type. If this passes, no real reading can fail.
 */

// As long as the real vocabularies get. A fixture whose every label is the longest string anyone
// could imagine measures the fixture rather than the caps: the point is the worst case the *caps*
// allow, over data shaped like IBKR's own.
const LONG_NAME = 'INTERNATIONAL DIVERSIFIED HOLDINGS CORP'
const LONG_SECTOR = 'Communications Equipment'

const position = (index: number): AllocationPosition => ({
  conid: index,
  symbol: `SYMBOL${index}`,
  description: `${LONG_NAME} ${index}`,
  assetCategory: 'STK',
  currency: 'USD',
  issuerCountry: 'US',
  sector: LONG_SECTOR,
  industry: LONG_SECTOR,
  marketValueBase: 1_234_567.89,
  costBasisBase: 1_000_000,
  unrealizedPnlBase: 234_567.89,
  percentOfNav: 100 / MAX_LISTED_POSITIONS,
})

const slices = (count: number, prefix: string): AllocationSlice[] =>
  Array.from({ length: count }, (_, index) => ({
    key: `${prefix}${index}`,
    label: `${prefix} ${index}`,
    marketValueBase: 1_000_000,
    percentOfNav: 100 / count,
  }))

/** Every list at or beyond its cap, and every label as long as a real one gets. */
const ALLOCATION: AllocationReport = {
  baseCurrency: 'EUR',
  reportDate: Date.UTC(2026, 5, 30),
  totalMarketValueBase: 50_000_000,
  // Beyond the cap on purpose: the section must be the thing that cuts, not the fixture.
  positions: Array.from({ length: MAX_LISTED_POSITIONS + 20 }, (_, index) => position(index)),
  byAssetClass: slices(6, 'Class'),
  byCurrency: slices(12, 'CUR'),
  bySector: slices(15, 'Sector'),
  byCountry: slices(60, 'Country'),
  unclassifiedCount: 7,
}

/** Twenty years of daily points: the longest history that produces the most periods. */
function longHistory(): PerformanceReport {
  const value: ValuePoint[] = []
  const returns: ValuePoint[] = []
  const start = Date.UTC(2006, 0, 1)
  const DAY = 86_400_000
  for (let index = 0; index < 20 * 365; index++) {
    value.push({ date: start + index * DAY, value: 1_000_000 + index * 137.5 })
    returns.push({ date: start + index * DAY, value: index / 100 })
  }
  return {
    baseCurrency: 'EUR',
    valueSeries: value,
    returnSeries: returns,
    compositionSeries: {
      bands: [
        { key: 'stock', label: 'Stocks' },
        { key: 'options', label: 'Options' },
        { key: 'cash', label: 'Cash' },
        { key: 'accruals', label: 'Accruals' },
        { key: 'other', label: 'Other' },
      ],
      points: value.map((point) => ({
        date: point.date,
        total: point.value,
        values: [point.value * 0.8, point.value * 0.05, point.value * 0.1, point.value * 0.03, point.value * 0.02],
      })),
    },
    periods: Array.from({ length: 240 }, (_, index) => ({
      fromDate: Date.UTC(2006, index, 1),
      toDate: Date.UTC(2006, index + 1, 0),
      startingValue: 1_000_000,
      endingValue: 1_100_000,
      mtm: 100_000,
      depositsWithdrawals: 25_000,
      dividends: 12_345.67,
      withholdingTax: -1_851.85,
      interest: 234.56,
      commissions: 456.78,
      twr: 1.5,
    })),
    startingValue: 1_000_000,
    endingValue: 1_999_875,
    cumulativeTwr: 72.9,
    totalDepositsWithdrawals: 500_000,
    totalRealizedPnl: 345_678.9,
    totalUnrealizedPnl: 234_567.89,
  }
}

/** Thirty targets, all of them stated, none of them met. */
const TARGETS = (prefix: string, count: number): CategoryTarget[] =>
  Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, low: 40, high: 45 }))

const PROFILE: InvestorProfile = {
  styleTags: [
    'dividend_income',
    'small_cap_growth',
    'mature_large_cap',
    'defensive_sectors',
    'high_growth_sectors',
  ],
  currencyTargets: TARGETS('CUR', 12),
  sectorTargets: TARGETS('Sector', 15),
  assetClassTargets: [...TARGETS('Class', 5), { key: CASH_ASSET_KEY, low: 1, high: 5 }],
  positionSize: { low: 0, high: 8 },
  updatedAt: Date.UTC(2026, 5, 1),
}

const band = (prefix: string, index: number): DriftBand => ({
  key: `${prefix}${index}`,
  label: `${prefix} ${index}`,
  actual: 60 + index,
  low: 40,
  high: 45,
  status: 'above',
  distance: 15 + index,
  move: {
    direction: 'trim',
    points: 15 + index,
    contributors: Array.from({ length: 3 }, (_, slot) => ({
      symbol: `SYMBOL${index}${slot}`,
      name: `${LONG_NAME} ${index}${slot}`,
      weight: 20,
      points: 5,
      resultingWeight: 15,
    })),
    uncovered: 0.5,
    ceilingLimited: true,
    candidates: 40,
  },
})

const DRIFT: BalanceDriftReport = {
  displayCurrency: 'EUR',
  readAt: Date.UTC(2026, 5, 30, 14, 22),
  placedValue: 50_000_000,
  dimensions: [
    {
      dimension: 'currency',
      bands: Array.from({ length: 12 }, (_, index) => band('CUR', index)),
      residuals: [{ kind: 'cash', label: 'Cash (no sector)', weight: 3.5 }],
      untargeted: 12.5,
    },
    {
      dimension: 'sector',
      bands: Array.from({ length: 15 }, (_, index) => band('Sector', index)),
      residuals: [
        { kind: 'cash', label: 'Cash (no sector)', weight: 3.5 },
        { kind: 'unclassified', label: 'Not yet classified', weight: 4.25 },
      ],
      untargeted: 9.75,
    },
    {
      dimension: 'assetClass',
      bands: Array.from({ length: 6 }, (_, index) => band('Class', index)),
      residuals: [{ kind: 'unknown_asset_class', label: 'Not in imported history', weight: 2.5 }],
      untargeted: 6,
    },
  ],
  position: {
    symbol: 'SYMBOL0',
    name: `${LONG_NAME} 0`,
    actual: 18.75,
    low: 0,
    high: 8,
    status: 'above',
    distance: 10.75,
    bounded: true,
  },
  unplaced: {
    positions: 6,
    cashBalances: 3,
    currencies: ['CHF', 'JPY', 'NOK', 'SEK'],
    nativeTotals: [
      { currency: 'CHF', amount: 12_345 },
      { currency: 'JPY', amount: 9_000_000 },
      { currency: 'NOK', amount: 54_321 },
      { currency: 'SEK', amount: 65_432 },
    ],
  },
  balanced: false,
}

const REPORTS: GroundingReports = {
  allocation: { status: 'ok', report: ALLOCATION },
  profile: PROFILE,
  drift: { status: 'ok', report: DRIFT },
  performance: { status: 'ok', report: longHistory() },
}

/** As long as a person actually types, which is longer than a test would otherwise make it. */
const QUESTION =
  'Comparing 2025 with 2024 and the last two quarters against each other, how did the portfolio do, ' +
  'how far is each of my currency and sector targets from where I said I wanted it, and what would ' +
  'I have to trim or add to close the three widest gaps without pushing anything past my ' +
  'single-position ceiling? Please name the positions.'

describe('the assembled prompt at the worst case the caps allow', () => {
  it('fits inside the ceiling the gateway enforces, with room left', () => {
    const size = SYSTEM_PROMPT.length + buildPrompt(QUESTION, buildAssistantContext(REPORTS)).length

    expect(size).toBeLessThan(MAX_PROMPT_CHARS)
    // Not merely inside it. A story that lands at 99% has spent the next story's budget as well as
    // its own, and the next story is #288 — which adds to the *system prompt*, the other half of
    // the number measured here. This is also the assertion that would have caught #287 shipping
    // over the old 24,000 ceiling, which it did: raising it was that measurement's own finding.
    expect(size).toBeLessThan(MAX_PROMPT_CHARS * 0.85)
  })

  /**
   * The caps have to be what holds it, not the fixture happening to be small. If a cap stopped
   * cutting, this fixture is large enough that the assertion above would fail — so it is worth
   * knowing that the sections really did truncate.
   */
  it('is held there by the caps, each of which states what it left out', () => {
    const context = buildAssistantContext(REPORTS)

    expect(context.holdings).toContain(`The ${MAX_LISTED_POSITIONS} largest of 60 open positions`)
    expect(context.performance).toContain('Calendar years: the 8 most recent of 20')
    expect(context.performance).toContain('Calendar quarters: the 8 most recent of 80')
    expect(context.profile).toContain('33 band(s) are outside their range; the 6 with the largest gaps')
  })
})
