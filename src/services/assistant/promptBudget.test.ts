import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, buildPrompt } from './assistantService'
import { MAX_PROMPT_CHARS } from '@repositories/assistant/aiGateway'
import { ABSENCE_DISCLOSURES } from '@shared/domain/assistantAbsences'
import type { AiMessage } from '@shared/domain/assistant'
import {
  MAX_LISTED_POSITIONS,
  buildAssistantContext,
  type GroundingReports,
} from '@renderer/lib/assistantContext'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'
import type { AllocationPosition, AllocationReport, AllocationSlice } from '@shared/domain/allocation'
import type {
  BalanceDriftReport,
  BaselineReview,
  DriftBand,
} from '@shared/domain/balanceDrift'
import { BASELINE_CHECKS, BASELINE_VERSION } from '@shared/domain/portfolioBaseline'
import type { PerformanceReport, ValuePoint } from '@shared/domain/performance'
import {
  EMPTY_INVESTOR_PROFILE,
  type CategoryTarget,
  type InvestorProfile,
} from '@shared/domain/investorProfileTerms'

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

/**
 * The baseline at its longest, which needs a profile at its **emptiest** (Story #315, ADR-0012).
 *
 * The two halves of this section cannot both be maximal in one reading, and that is a property of
 * the design rather than an accident of the fixture: a check runs only where the profile states
 * nothing, so every target that lengthens the drift block shortens the baseline block. `PROFILE`
 * targets every dimension, so its baseline is four deferred checks and three short lines; this one
 * belongs to an owner who has written nothing at all.
 *
 * Both are measured, because either could be the larger prompt and only measuring both says which.
 */
const BASELINE_APPLIED: BaselineReview = {
  version: BASELINE_VERSION,
  applied: [...BASELINE_CHECKS],
  deferred: [],
  ceilings: [
    {
      check: 'position',
      key: 'SYMBOL0',
      label: 'SYMBOL0',
      name: `${LONG_NAME} 0`,
      actual: 18.75,
      limit: 10,
      status: 'above',
      distance: 8.75,
      bounded: true,
    },
    {
      check: 'sector',
      key: LONG_SECTOR,
      label: LONG_SECTOR,
      name: null,
      actual: 41.5,
      limit: 30,
      status: 'above',
      distance: 11.5,
      bounded: true,
    },
    {
      check: 'cash',
      key: CASH_ASSET_KEY,
      label: 'Cash',
      name: null,
      actual: 22.25,
      limit: 15,
      status: 'above',
      distance: 7.25,
      bounded: true,
    },
  ],
  absentAssetClasses: [{ key: 'BOND', label: 'Bonds' }],
  sectorsHeld: 24,
  withinBaseline: false,
}

/** What the same service returns for `PROFILE`, which states a target in every dimension. */
const BASELINE_DEFERRED: BaselineReview = {
  version: BASELINE_VERSION,
  applied: [],
  deferred: [...BASELINE_CHECKS],
  ceilings: [],
  absentAssetClasses: [],
  sectorsHeld: 24,
  withinBaseline: null,
}

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
  baseline: BASELINE_DEFERRED,
  balanced: false,
}

const REPORTS: GroundingReports = {
  allocation: { status: 'ok', report: ALLOCATION },
  profile: PROFILE,
  drift: { status: 'ok', report: DRIFT },
  performance: { status: 'ok', report: longHistory() },
}

/**
 * The other reachable extreme: no profile at all, so the baseline runs every check.
 *
 * The drift block shrinks to nothing with it - no targets is no bands - which is exactly why this
 * has to be measured separately rather than folded into the fixture above.
 */
const REPORTS_NO_PROFILE: GroundingReports = {
  ...REPORTS,
  profile: EMPTY_INVESTOR_PROFILE,
  drift: {
    status: 'ok',
    report: { ...DRIFT, dimensions: [], position: null, baseline: BASELINE_APPLIED, balanced: null },
  },
}

/** As long as a person actually types, which is longer than a test would otherwise make it. */
const QUESTION =
  'Comparing 2025 with 2024 and the last two quarters against each other, how did the portfolio do, ' +
  'how far is each of my currency and sector targets from where I said I wanted it, and what would ' +
  'I have to trim or add to close the three widest gaps without pushing anything past my ' +
  'single-position ceiling? Please name the positions.'

/**
 * The whole conversation, which is what the gateway's ceiling now counts (Story #324, DDR-0111).
 *
 * The number does not move and neither does what it measures *here*: a question is still a system
 * turn and a user turn, so this is the same arithmetic the two strings used to do. What changed is
 * that the gateway checks it **before every round** rather than once — so this measures the first
 * round, which is the one the caps in `assistantContext` are responsible for. The rounds a tool
 * loop adds are bounded by `MAX_TOOL_ROUNDS` and by the same ceiling, and are `aiGateway.test.ts`'s
 * to assert; a story that wires up a tool has to keep *this* fitting first, because a first round
 * over the ceiling never reaches a second.
 */
const conversation = (reports: GroundingReports): AiMessage[] => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: buildPrompt(QUESTION, buildAssistantContext(reports)) },
]

const promptSize = (reports: GroundingReports): number =>
  conversation(reports).reduce((total, message) => total + message.content.length, 0)

/** The one section both baselines are written into. */
const profileOf = (reports: GroundingReports): string =>
  buildAssistantContext(reports).profile ?? ''

describe('the assembled prompt at the worst case the caps allow', () => {
  it.each([
    ['every target set, so the baseline defers', REPORTS],
    ['no profile at all, so the baseline runs', REPORTS_NO_PROFILE],
  ])('fits inside the ceiling the gateway enforces, with room left: %s', (_case, reports) => {
    const size = promptSize(reports)

    expect(size).toBeLessThan(MAX_PROMPT_CHARS)
    // Not merely inside it. A story that lands at 99% has spent the next story's budget as well as
    // its own. This is also the assertion that would have caught #287 shipping over the old 24,000
    // ceiling, which it did: raising it was that measurement's own finding.
    //
    // **Story #325 spends most of what was left, and that is this measurement's finding.** The
    // worst case moved from 82.2% to 84.8% — the four sets of disclosure became unconditional, so
    // the baseline's two absences and the store-and-clock pairing are now sent even by the reading
    // that states every target and defers every check, which is this fixture. Roughly 90 characters
    // remain under the gate. **Nothing may be added to the assembled context before Epic #322 takes
    // figures out of it**; the next story that tries fails here, which is what the gate is for.
    expect(size).toBeLessThan(MAX_PROMPT_CHARS * 0.85)
  })

  /**
   * The disclosures are counted, not assumed (Story #325, DDR-0111).
   *
   * They were measured before this story too — as part of `performanceSection`, which this fixture
   * happens to carry. What changed is that they no longer *depend* on it: the number above now
   * includes them in the reading that carries them least, so the gate is measuring a prompt with
   * every unconditional statement in it rather than one that happened to earn them.
   */
  it.each([
    ['every target set, so the baseline defers', REPORTS],
    ['no profile at all, so the baseline runs', REPORTS_NO_PROFILE],
  ])('is measured with every absence in it: %s', (_case, reports) => {
    const [system, user] = conversation(reports)

    for (const disclosure of ABSENCE_DISCLOSURES) {
      expect(user!.content).toContain(disclosure.text)
    }
    // The system prompt is the other half of the number, and the half these support.
    expect(system!.content).toContain('unless explicitly supplied by the application or a tool')
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

  /**
   * The baseline is measured rather than assumed absent (Story #315).
   *
   * Its block is bounded by construction - four checks, at most three ceilings, one coverage
   * line - so it cannot grow with the portfolio the way a band list can. What it *can* do is
   * grow with a story, which is what the 85% gate above is there to catch. This asserts the
   * fixtures really did carry it, so the gate is measuring prompts with a baseline in them -
   * one deferring every check and one running every check.
   */
  it('carries both baselines, each marked as the app\u2019s own standard', () => {
    // Every check deferred is deliberately one sentence rather than a section: it is the longest
    // prompt the app assembles, and a baseline nothing can be judged against earns no headings.
    // Since Story #325 it says only *which* checks stood down — that the baseline stands down at
    // all is stated unconditionally in the base context, above every section.
    expect(profileOf(REPORTS)).toContain('None of the app’s default baseline applies here')
    expect(profileOf(REPORTS)).not.toContain('against the app’s default')

    const applied = profileOf(REPORTS_NO_PROFILE)
    expect(applied).toContain('against the app’s default 10%')
    expect(applied).toContain('holds no weight at all in Bonds')
    expect(applied).toContain('never name a missing sector')
  })
})
