import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, buildPrompt, historyMessages } from './assistantService'
import {
  MAX_HISTORY_CHARS,
  MAX_REMEMBERED_TURNS,
  trimHistory,
} from '@shared/domain/assistantHistory'
import { assistantToolDefinitions } from './assistantTools'
import {
  MAX_LISTED_CANDIDATES,
  MAX_LISTED_POSITIONS,
  allocationReport,
  investorProfileReport,
  portfolioOverviewReport,
  positionReport,
  rebalanceGapsReport,
  type LivePortfolioResult,
  type LivePositionResult,
} from './toolReports'
import {
  MAX_HISTORY_POINTS,
  dailyReturnsReport,
  performancePeriodsReport,
  performanceReport,
  portfolioHistoryReport,
} from './performanceReports'
import {
  MAX_LISTED_INCOME_SYMBOLS,
  MAX_LISTED_REALIZED,
  MAX_LISTED_UPCOMING,
  dataCoverageReport,
  dividendIncomeReport,
  realizedGainsReport,
} from './storeReports'
import type { DataCoverage } from '@services/dataCoverage/dataCoverageService'
import type { DividendEvent, DividendReport } from '@shared/domain/dividends'
import type { RealizedGainsReport } from '@shared/domain/realizedGains'
import { MAX_LISTED_QUARTERS, MAX_LISTED_YEARS } from '@shared/domain/standardPeriods'
import { MAX_PROMPT_CHARS, MAX_TOOL_ROUNDS } from '@repositories/assistant/aiGateway'
import { ABSENCE_DISCLOSURES } from '@shared/domain/assistantAbsences'
import type { AiMessage } from '@shared/domain/assistant'
import type { Holding } from '@shared/domain/portfolio'
import { buildAssistantContext, type GroundingReports } from '@renderer/lib/assistantContext'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'
import type { AllocationPosition, AllocationReport, AllocationSlice } from '@shared/domain/allocation'
import type {
  BalanceDriftReport,
  BaselineReview,
  DriftBand,
} from '@shared/domain/balanceDrift'
import { BASELINE_CHECKS, BASELINE_VERSION } from '@shared/domain/portfolioBaseline'
import type { PerformanceReport, PerformanceResult, ValuePoint } from '@shared/domain/performance'
import {
  EMPTY_INVESTOR_PROFILE,
  type CategoryTarget,
  type InvestorProfile,
} from '@shared/domain/investorProfileTerms'

/**
 * The prompt budget, measured at the worst case the caps allow (Story #287, DDR-0103).
 *
 * **A conversation over the gateway's ceiling is not sent, or is cut off mid-question.** `aiGateway`
 * refuses a first round over `MAX_PROMPT_CHARS` outright as `too_large` — nothing is sent, which is
 * the honest failure — and refuses a *later* one as `incomplete`, which is worse for an owner: the
 * question was answered by nothing after several rounds were paid for. Every cap in the grounding
 * and in the tool reports exists to make both unreachable, and this is the assertion that they still
 * do.
 *
 * It sits on the **service** side, which is the one place every half of the real conversation meets:
 * the ceiling is the gateway's, the assembly is `buildPrompt`'s, the one remaining section is the
 * renderer's, and the reports are `toolReports.ts`'s.
 *
 * **Story #326 changes what is measured, because it changed what is sent.** Three of the four
 * assembled sections became tools, so the first round is far smaller and the *conversation* is what
 * has to fit: the question, then the reports the model asked for, each round carrying everything
 * before it. Measuring only the first round would now measure the easy case and miss the one that
 * ends in `incomplete`.
 *
 * The fixture is deliberately larger than a portfolio is: every list at its cap, every band out of
 * range, every name long, twenty years of history, every tool called in one round, and a question at
 * the length a person will actually type. If this passes, no real reading can fail.
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
 * The live book at its worst: every position long-named, and six that could not be valued.
 *
 * The live overview has no cap of its own beyond `MAX_LISTED_POSITIONS`, and this fixture is beyond
 * it on purpose — the report must be the thing that cuts, not the fixture.
 */
const LIVE_HOLDINGS: Holding[] = Array.from({ length: MAX_LISTED_POSITIONS + 20 }, (_, index) => ({
  conid: index,
  symbol: `SYMBOL${index}`,
  description: `SYMBOL${index}`,
  companyName: `${LONG_NAME} ${index}`,
  quantity: 100,
  averageCost: 100,
  marketPrice: 150,
  marketValue: 15_000,
  unrealizedPnl: 5_000,
  currency: 'USD',
  // The last six carry no rate, which is the branch that names them and bounds every weight.
  displayValue: index >= MAX_LISTED_POSITIONS + 14 ? null : 15_000 - index,
  displayUnrealizedPnl: null,
}))

const LIVE: LivePortfolioResult = {
  status: 'ok',
  overview: {
    holdings: LIVE_HOLDINGS,
    balances: {
      currency: 'EUR',
      totalCashValue: 1_000_000,
      netLiquidation: 50_000_000,
      stockMarketValue: 49_000_000,
    },
    allocation: [],
    totalMarketValue: 49_000_000,
    displayCurrency: 'EUR',
  },
  displayCurrency: 'EUR',
  readAt: Date.UTC(2026, 5, 30, 14, 22),
}

/**
 * A single position at its longest, which is the **ambiguous** state rather than the resolved one.
 *
 * A resolved position is one holding and a fixed amount of prose; what grows with a cap is the list
 * of candidates a query matched, so that is the branch the budget has to see. It is beyond
 * `MAX_LISTED_CANDIDATES` on purpose — the report must be the thing that cuts, not the fixture —
 * and every candidate carries a name as long as IBKR writes them (Story #328).
 */
const AMBIGUOUS: LivePositionResult = {
  status: 'ok',
  lookup: {
    status: 'ambiguous',
    query: 'international diversified',
    candidates: Array.from({ length: MAX_LISTED_CANDIDATES + 5 }, (_, index) => ({
      conid: index,
      symbol: `SYMBOL${index}`,
      name: `${LONG_NAME} ${index}`,
    })),
  },
  displayCurrency: 'EUR',
  readAt: Date.UTC(2026, 5, 30, 14, 22),
}

/**
 * Twenty years of dividends, every list past its cap (Story #329).
 *
 * Both caps have to be the thing that cuts: more instruments than the income breakdown names, more
 * accruals than the upcoming list names, and every name as long as IBKR writes them. The events run
 * monthly across the whole history so the `all` window holds every one of them, which is the widest
 * window the set has.
 */
function longDividends(): DividendReport {
  const events: DividendEvent[] = []
  for (let month = 0; month < 20 * 12; month++) {
    for (let symbol = 0; symbol < MAX_LISTED_INCOME_SYMBOLS + 3; symbol++) {
      const date = Date.UTC(2006, month, 15)
      events.push({
        date,
        symbol: `SYMBOL${symbol}`,
        description: `${LONG_NAME} ${symbol}`,
        type: 'Dividends',
        currency: 'USD',
        amountNative: 1_234.56,
        amountBase: 1_111.11,
        sharesHeld: 1_000,
        perShareNative: 1.23,
      })
      events.push({
        date,
        symbol: `SYMBOL${symbol}`,
        description: `${LONG_NAME} ${symbol}`,
        type: 'Withholding Tax',
        currency: 'USD',
        amountNative: -185.18,
        amountBase: -166.67,
        sharesHeld: 1_000,
        perShareNative: -0.19,
      })
    }
  }
  // Undated rows exist in real exports, and they add a sentence the report must carry.
  events.push({
    date: null,
    symbol: 'SYMBOL0',
    description: `${LONG_NAME} 0`,
    type: 'Dividends',
    currency: 'USD',
    amountNative: 100,
    amountBase: 90,
    sharesHeld: null,
    perShareNative: null,
  })

  return {
    baseCurrency: 'EUR',
    totalGrossBase: 2_666_664,
    totalWithholdingBase: 400_008,
    totalNetBase: 2_266_656,
    bySymbol: [],
    byMonth: [],
    events,
    upcoming: {
      asOf: Date.UTC(2026, 5, 30),
      sectionPresent: true,
      totalGrossBase: 12_345.67,
      totalWithholdingBase: 1_851.85,
      totalNetBase: 10_493.82,
      items: Array.from({ length: MAX_LISTED_UPCOMING + 4 }, (_, index) => ({
        symbol: `SYMBOL${index}`,
        description: `${LONG_NAME} ${index}`,
        currency: 'USD',
        exDate: Date.UTC(2026, 6, 1 + index),
        payDate: Date.UTC(2026, 6, 20 + index),
        quantity: 1_000,
        grossRate: 1.23,
        netNative: 1_045.67,
        grossBase: 1_234.56,
        withholdingBase: 185.18,
        netBase: 1_049.38,
      })),
    },
  }
}

/** More instruments than either end of the realised list names, with the totals far above them. */
const REALIZED: RealizedGainsReport = {
  baseCurrency: 'EUR',
  totalRealized: 345_678.9,
  totalRealizedShortTerm: 234_567.89,
  totalRealizedLongTerm: 111_111.01,
  totalUnrealized: 234_567.89,
  bySymbol: Array.from({ length: (MAX_LISTED_REALIZED + 4) * 2 }, (_, index) => ({
    conid: index,
    symbol: `SYMBOL${index}`,
    description: `${LONG_NAME} ${index}`,
    realizedShortTerm: 50_000 - index * 1_000,
    realizedLongTerm: 20_000 - index * 1_000,
    totalRealized: 70_000 - index * 5_000,
  })),
  trades: [],
}

/** Coverage at its longest: two base currencies, both stores populated. */
const COVERAGE: DataCoverage = {
  flex: {
    statements: 24,
    from: Date.UTC(2006, 0, 1),
    to: Date.UTC(2026, 5, 30),
    latestImportedAt: Date.UTC(2026, 6, 2),
    baseCurrencies: ['EUR', 'USD'],
  },
  snapshots: { captures: 480, earliest: Date.UTC(2024, 0, 1), latest: Date.UTC(2026, 5, 30) },
  readAt: Date.UTC(2026, 5, 30, 14, 22),
}

/**
 * The first round: the system prompt, the base context and the question.
 *
 * Two turns, as they always were — what shrank is the second of them. #326 took three of the four
 * assembled sections behind tools and #327 took the fourth, so the user turn is now the base context
 * and the question alone (`buildAssistantContext` returns `{}` and takes nothing). It is still
 * measured on its own before anything is added: a first round over the ceiling never reaches a
 * second, and it no longer varies with the reports at all — which is why the two cases below differ
 * only in what their *tool answers* cost.
 */
const firstRound = (): AiMessage[] => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: buildPrompt(QUESTION, buildAssistantContext()) },
]

/**
 * A history at **both** its caps, which is what Story #320 adds to every row below (DDR-0113).
 *
 * `MAX_REMEMBERED_TURNS` turns is the count; `MAX_HISTORY_CHARS` is what they may cost, and this
 * fixture spends the budget to the character. That is deliberately not a shape a real conversation
 * takes — a typical exchange here is a ~150-character question and a ~1,500-character answer, so
 * three real turns is nearer 5,000 — but the whole point of this file is the worst case the caps
 * allow rather than the case anyone meets.
 *
 * It is built through `trimHistory`, not around it: a fixture that hand-rolled the cap would measure
 * the fixture, and if the trim ever stopped honouring the budget this would keep passing.
 */
const FULL_HISTORY = trimHistory(
  Array.from({ length: MAX_REMEMBERED_TURNS }, (_, index) => ({
    question: `Follow-up ${index}: `.padEnd(200, 'q'),
    answer: 'a'.repeat(Math.floor(MAX_HISTORY_CHARS / MAX_REMEMBERED_TURNS) - 200),
  })),
)

/** The same first round, asked as a follow-up in a conversation that is already at its cap. */
const firstRoundRemembering = (): AiMessage[] => [
  { role: 'system', content: SYSTEM_PROMPT },
  ...historyMessages(FULL_HISTORY),
  { role: 'user', content: buildPrompt(QUESTION, buildAssistantContext()) },
]

/**
 * The worst round a tool loop can produce: **every** report, in one round, at every cap.
 *
 * A real question calls one or two tools. This calls all eight in a single round — which is a shape
 * the provider may genuinely return, and the largest one round can be — and measures the
 * conversation the *next* round would carry, because that is the array the gateway checks. Sizing
 * only the reports would miss the question they are appended to.
 *
 * Each performance tool is measured over the **longest** history the caps allow and the widest
 * period in it, which is the whole twenty years: the periods list is at both its caps, the value and
 * composition histories are at `MAX_HISTORY_POINTS`, and every band is populated on every day.
 *
 * The call arguments are counted the way `conversationSize` counts them: a name and its JSON, which
 * is the material a loop adds and the growth the ceiling exists to see.
 */
const HISTORY = longHistory()
const PERFORMANCE: PerformanceResult = { status: 'ok', report: HISTORY }

const DIVIDENDS = longDividends()

const toolAnswers = (reports: GroundingReports): string[] => [
  portfolioOverviewReport(LIVE),
  positionReport(AMBIGUOUS),
  investorProfileReport(reports.profile),
  allocationReport({ status: 'ok', report: ALLOCATION }, 'position', MAX_LISTED_POSITIONS),
  rebalanceGapsReport(reports.drift),
  performancePeriodsReport(PERFORMANCE),
  performanceReport(PERFORMANCE, 'all'),
  dailyReturnsReport(PERFORMANCE, 'all'),
  portfolioHistoryReport(PERFORMANCE, 'all', 'composition'),
  dividendIncomeReport({ status: 'ok', report: DIVIDENDS }, 'all'),
  realizedGainsReport({ status: 'ok', report: REALIZED }),
  dataCoverageReport(COVERAGE),
]

/** The calls that produce {@link toolAnswers}, index-aligned with it. */
const TOOL_CALLS = [
  { id: 'call_1', name: 'get_portfolio_overview', argumentsJson: '{}' },
  { id: 'call_2', name: 'get_position', argumentsJson: '{"query":"international diversified"}' },
  { id: 'call_3', name: 'get_investor_profile', argumentsJson: '{}' },
  { id: 'call_4', name: 'get_allocation', argumentsJson: '{"dimension":"position","limit":40}' },
  { id: 'call_5', name: 'get_rebalance_gaps', argumentsJson: '{}' },
  { id: 'call_6', name: 'get_performance_periods', argumentsJson: '{}' },
  { id: 'call_7', name: 'get_performance', argumentsJson: '{"period":"all"}' },
  { id: 'call_8', name: 'get_daily_returns', argumentsJson: '{"period":"all"}' },
  {
    id: 'call_9',
    name: 'get_portfolio_history',
    argumentsJson: '{"period":"all","series":"composition"}',
  },
  { id: 'call_10', name: 'get_dividend_income', argumentsJson: '{"period":"all"}' },
  { id: 'call_11', name: 'get_realized_gains', argumentsJson: '{}' },
  { id: 'call_12', name: 'get_data_coverage', argumentsJson: '{}' },
]

const afterOneToolRound = (reports: GroundingReports): AiMessage[] => {
  const answers = toolAnswers(reports)

  return [
    ...firstRound(),
    { role: 'assistant', content: '', toolCalls: TOOL_CALLS },
    ...answers.map((content, index) => ({
      role: 'tool' as const,
      toolCallId: TOOL_CALLS[index]!.id,
      content,
    })),
  ]
}

/** What the gateway counts: every character that would go on the wire, tool calls included. */
const size = (messages: AiMessage[]): number =>
  messages.reduce(
    (total, message) =>
      total +
      message.content.length +
      (message.toolCalls ?? []).reduce(
        (calls, call) => calls + call.name.length + call.argumentsJson.length,
        0,
      ),
    0,
  )

const CASES: [string, GroundingReports][] = [
  ['every target set, so the baseline defers', REPORTS],
  ['no profile at all, so the baseline runs', REPORTS_NO_PROFILE],
]

/**
 * **The first round no longer varies with the portfolio at all**, which is Story #327's own result
 * and the reason this block is one case where it used to be two: the renderer assembles nothing, so
 * the first message array is the system prompt, the absences and the question, whatever has been
 * imported and whatever the owner has written. What still varies per case is the *reports*, and they
 * are measured below.
 */
describe('the first round at the worst case the caps allow', () => {
  it('fits inside the ceiling with room for the reports to come', () => {
    const first = size(firstRound())

    expect(first).toBeLessThan(MAX_PROMPT_CHARS)
    // **Stories #326 and #327 are what bought this room back.** The worst case was 84.8% of the
    // ceiling with roughly 90 characters to spare, which is why nothing could be added to the
    // assembled context — and why a tool result appended to it would have ended the question as
    // `incomplete` rather than answering it. Every section is a tool now and the renderer assembles
    // nothing, so the first round is ~10.6% at the time of writing (6,379 characters, and it does
    // not grow with the portfolio at all), and the rest of the budget is what reports spend.
    expect(first).toBeLessThan(MAX_PROMPT_CHARS * 0.25)
  })

  it('is measured with every absence in it', () => {
    const [system, user] = firstRound()

    for (const disclosure of ABSENCE_DISCLOSURES) {
      expect(user!.content).toContain(disclosure.text)
    }
    // The system prompt is the other half of the number, and the half these support.
    expect(system!.content).toContain('unless explicitly supplied by the application or a tool')
  })
})

describe('the conversation after the model has asked for reports', () => {
  /**
   * **A real question, at the worst case the caps allow.** One tool answers most questions and two
   * answer nearly all of them, so the assertion that matters day to day is that the largest single
   * report on top of the largest first round leaves the 85% gate intact (DDR-0103) — which is where
   * the room for #327's performance tools has to come from.
   */
  it.each(CASES)('leaves the gate intact for the largest single report: %s', (_case, reports) => {
    const first = size(firstRound())
    const largest = Math.max(...toolAnswers(reports).map((answer) => answer.length))

    expect(first + largest).toBeLessThan(MAX_PROMPT_CHARS * 0.85)
  })

  /**
   * **The row that decided the ceiling** (Story #329, DDR-0112).
   *
   * Between the one-report question and the exhaustive round sits the shape an owner actually
   * reaches: *how did I do, what do I hold, what does it pay me, am I balanced* — half a dozen
   * reports over a few rounds. At `MAX_PROMPT_CHARS` of 40,000 that came to **92.7%**, so a seventh
   * report ended the question as `incomplete`: answered by nothing, after every round was paid for.
   * That is the ceiling rationing a *question* rather than a bug, which is what DDR-0096 never
   * wanted and DDR-0103 raised it the first time to avoid.
   *
   * Held to the 85% gate rather than to the ceiling, because unlike the exhaustive round this is a
   * question — and a question that fits only just is one the next story breaks.
   */
  it.each(CASES)('leaves the gate intact for a real multi-part question: %s', (_case, reports) => {
    const sixLargest = [...toolAnswers(reports)]
      .sort((a, b) => b.length - a.length)
      .slice(0, 6)
      .reduce((total, answer) => total + answer.length, 0)

    expect(size(firstRound()) + sixLargest).toBeLessThan(MAX_PROMPT_CHARS * 0.85)
  })

  /**
   * **The exhaustive case: every report this app has, in one round.** It fits, and it is measured
   * here without the 85% gate on purpose — the gate is DDR-0103's on what is *assembled* and sent
   * unasked, and this is a conversation in which the model asked for all twelve at once over a
   * fixture larger than any real portfolio: forty long-named positions, thirty-three bands every one
   * of them out of range, twenty years of daily history, and twenty years of monthly dividends
   * across thirteen instruments. At the time of writing it comes to **79.6%** of the ceiling against
   * a first round at 10.6%, which is the trade the Epic made: what used to be sent with every
   * question is now sent only when it is asked for.
   *
   * **`MAX_PROMPT_CHARS` was raised to 60,000 to keep this assertion, and the raise is DDR-0112.**
   * At 40,000 these twelve reports came to 119.4%, and the honest question was which half to give
   * up. What decided it was not this row — twelve reports in one round is a shape no question takes,
   * and the round bound rations it — but the row beneath it: the **six largest reports on one
   * conversation was 92.7%** of the old ceiling, a shape a multi-part question really reaches, where
   * a seventh ended the question as `incomplete`. A ceiling that rations a bug is the constant
   * DDR-0096 wanted; one that rations a question is not, and DDR-0103 raised it the first time for
   * exactly that reason.
   *
   * It is deliberately still not the gate: the assertion above — the largest single report on the
   * largest first round, at ~28% — is what a real question costs.
   *
   * A *second* exhaustive round is what the bounds exist to stop, and it stops as `incomplete` — a
   * named state, never a partial answer. A model asking for all twelve reports twice is the runaway
   * `MAX_PROMPT_CHARS` rations rather than a question anyone asked.
   */
  it.each(CASES)('fits inside the ceiling with every report in it: %s', (_case, reports) => {
    expect(size(afterOneToolRound(reports))).toBeLessThan(MAX_PROMPT_CHARS)
  })

  /**
   * **And it fits however the rounds are spread**, which is the property that makes the number
   * above a bound rather than one arrangement's measurement.
   *
   * The array only ever grows, so what a conversation costs is the reports in it and not the rounds
   * they arrived over — one round of nine calls and four rounds of two or three carry the same
   * reports, differing only by the assistant turns between them. This is the shape a multi-step
   * question actually takes, at `MAX_TOOL_ROUNDS` exactly, so the loop ends on its **round count**
   * rather than on the ceiling. What the ceiling still rations is a model asking for the *same*
   * report twice, which is the runaway rather than a question.
   */
  it.each(CASES)('fits inside the ceiling with every report and a full history: %s', (_case, reports) => {
    const messages = afterOneToolRound(reports)
    expect(size([...historyMessages(FULL_HISTORY), ...messages])).toBeLessThan(MAX_PROMPT_CHARS)
  })

  it.each(CASES)('fits however the reports are spread over the rounds: %s', (_case, reports) => {
    const answers = toolAnswers(reports)
    expect(answers).toHaveLength(TOOL_CALLS.length)
    // Spread as evenly as they go, over `MAX_TOOL_ROUNDS` exactly — the most rounds a conversation
    // carrying every report can be spread over. Twelve reports over four rounds divides evenly
    // again; where it does not, the remainder is not worth a fixture, since what is being measured
    // is that every report is in the array however the rounds fell.
    const perRound = Math.ceil(answers.length / MAX_TOOL_ROUNDS)

    const messages: AiMessage[] = [...firstRound()]
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const calls = TOOL_CALLS.slice(round * perRound, (round + 1) * perRound)
      if (calls.length === 0) continue
      messages.push({ role: 'assistant', content: '', toolCalls: calls })
      for (const call of calls) {
        const index = TOOL_CALLS.indexOf(call)
        messages.push({ role: 'tool', toolCallId: call.id, content: answers[index]! })
      }
    }

    expect(size(messages)).toBeLessThan(MAX_PROMPT_CHARS)
  })

  /**
   * The caps have to be what holds it, not the fixture happening to be small. Each states what it
   * left out, in the report that cut it.
   */
  it('is held there by the caps, each of which states what it left out', () => {
    expect(performancePeriodsReport(PERFORMANCE)).toContain(
      `Calendar years: the ${MAX_LISTED_YEARS} most recent of 20`,
    )
    expect(performancePeriodsReport(PERFORMANCE)).toContain(
      `Calendar quarters: the ${MAX_LISTED_QUARTERS} most recent of 80`,
    )
    expect(portfolioHistoryReport(PERFORMANCE, 'all', 'composition')).toContain(
      `The ${MAX_HISTORY_POINTS} day(s) below are evenly spaced samples of the 7300 day(s)`,
    )
    expect(portfolioOverviewReport(LIVE)).toContain(
      `The ${MAX_LISTED_POSITIONS} largest of ${MAX_LISTED_POSITIONS + 14} open positions`,
    )
    expect(
      allocationReport({ status: 'ok', report: ALLOCATION }, 'position', MAX_LISTED_POSITIONS),
    ).toContain(`The ${MAX_LISTED_POSITIONS} largest of ${MAX_LISTED_POSITIONS + 20} open positions`)
    expect(rebalanceGapsReport(REPORTS.drift)).toContain(
      '33 band(s) are outside their range; the 6 with the largest gaps',
    )
    expect(positionReport(AMBIGUOUS)).toContain(
      `The ${MAX_LISTED_CANDIDATES} largest of ${MAX_LISTED_CANDIDATES + 5} matches`,
    )
    // Story #329's three: both income caps cut, and realised gains lists each end of a longer list.
    const income = dividendIncomeReport({ status: 'ok', report: DIVIDENDS }, 'all')
    expect(income).toContain(
      `The ${MAX_LISTED_INCOME_SYMBOLS} largest of ${MAX_LISTED_INCOME_SYMBOLS + 3} instruments`,
    )
    expect(income).toContain(`The ${MAX_LISTED_UPCOMING} soonest of them`)
    expect(realizedGainsReport({ status: 'ok', report: REALIZED })).toContain(
      `${(MAX_LISTED_REALIZED + 4) * 2} instrument(s) have realised profit or loss`,
    )
  })

  /**
   * The tool declarations are sent on every round too, and they are **not** in the gateway's count —
   * a schema is not a message. What stops them growing is this: a story adding a ninth tool, or a
   * paragraph to a description, measures it here.
   *
   * **Raised twice, each time once and on the record**: 4,000 → 8,000 in Story #327, and 8,000 →
   * 12,000 by the owner in #328. The unit is stable at roughly 900 characters a tool — nine come to
   * about 7,800 — so the new ceiling is the room for #329's three reports plus a description's worth
   * of margin, rather than a number picked to clear today's measurement.
   *
   * **What the growth buys is the property, not padding.** The four period tools spend their
   * descriptions saying the key comes from `get_performance_periods` and that no free-form range
   * exists, which is the sentence that keeps a model from inventing one (DDR-0102). `get_position`
   * spends its two on what it is *not* — no filter, no threshold, no list — which is what stands
   * between an identity argument and the general query ADR-0009 forbids. A tool description that
   * only described would be shorter and worse.
   *
   * The ceiling stays because the reason for it does: these are sent on **every round**, they are
   * outside the gateway's own count — a schema is not a message — and nothing else would notice them
   * growing.
   */
  it('declares tool schemas small enough to be sent on every round', () => {
    expect(JSON.stringify(assistantToolDefinitions()).length).toBeLessThan(12_000)
  })

  /**
   * The baseline is measured rather than assumed absent (Story #315). Its block is bounded by
   * construction — four checks, at most three ceilings, one coverage line — so it cannot grow with
   * the portfolio the way a band list can. What it *can* do is grow with a story, which is what the
   * gate above is there to catch.
   */
  it('carries both baselines, each marked as the app’s own standard', () => {
    // Every check deferred is deliberately one sentence rather than a section: that a default exists
    // and stands down where the owner spoke is said unconditionally in the base context.
    expect(rebalanceGapsReport(REPORTS.drift)).toContain(
      'None of the app’s default baseline applies here',
    )
    expect(rebalanceGapsReport(REPORTS.drift)).not.toContain('against the app’s default')

    const applied = rebalanceGapsReport(REPORTS_NO_PROFILE.drift)
    expect(applied).toContain('against the app’s default 10%')
    expect(applied).toContain('holds no weight at all in Bonds')
    expect(applied).toContain('never name a missing sector')
  })
})

/**
 * **What memory costs, measured against the ceiling it spends from** (Story #320, DDR-0113).
 *
 * A conversation that remembers its own turns sends more on every question, and the story's binding
 * criterion is that the worst case **with a full history at the cap** still clears DDR-0103's 85%
 * gate. So every row above is measured again with {@link FULL_HISTORY} under it — the count at
 * `MAX_REMEMBERED_TURNS` and the characters at `MAX_HISTORY_CHARS`, which is a shape no real
 * conversation reaches.
 *
 * The two caps were chosen against these numbers rather than against taste. Before the story the
 * multi-part question stood at 61.8% of 60,000, leaving 13,918 characters under the gate, and the
 * exhaustive round at 79.6% left 12,225 under the ceiling itself. 8,000 fits inside the smaller of
 * those with room to spare, which is the property DDR-0103 exists to defend: a history that fits
 * only just is one the next story breaks.
 */
describe('a conversation that remembers itself', () => {
  it('spends what the caps say it may, and no more', () => {
    const cost = size(historyMessages(FULL_HISTORY))

    expect(FULL_HISTORY).toHaveLength(MAX_REMEMBERED_TURNS)
    expect(cost).toBeLessThanOrEqual(MAX_HISTORY_CHARS)
    // Worth stating as a share: what it takes is what the reports no longer have.
    expect(cost / MAX_PROMPT_CHARS).toBeLessThan(0.14)
  })

  it('leaves the first round far inside the ceiling', () => {
    expect(size(firstRoundRemembering())).toBeLessThan(MAX_PROMPT_CHARS * 0.25)
  })

  /**
   * The row that matters day to day: one report answers most questions and two answer nearly all of
   * them, asked as a follow-up in a conversation already at its cap.
   */
  it.each(CASES)('leaves the gate intact for the largest single report: %s', (_case, reports) => {
    const largest = Math.max(...toolAnswers(reports).map((answer) => answer.length))

    expect(size(firstRoundRemembering()) + largest).toBeLessThan(MAX_PROMPT_CHARS * 0.85)
  })

  /**
   * **The row DDR-0112 says decides the ceiling, asked as a follow-up.** *How did I do, what do I
   * hold, what does it pay me, am I balanced* — six reports over a few rounds, on top of three
   * remembered turns. This is the assertion the two caps were sized against.
   */
  it.each(CASES)('leaves the gate intact for a real multi-part question: %s', (_case, reports) => {
    const sixLargest = [...toolAnswers(reports)]
      .sort((a, b) => b.length - a.length)
      .slice(0, 6)
      .reduce((total, answer) => total + answer.length, 0)

    expect(size(firstRoundRemembering()) + sixLargest).toBeLessThan(MAX_PROMPT_CHARS * 0.85)
  })

  /**
   * The grounding block is emitted **once** however long the conversation is, which is the property
   * that keeps memory linear in the turns rather than in the turns times the absences (DDR-0113,
   * decision 3). Measured rather than asserted structurally: a remembered turn that carried its own
   * `buildPrompt` would show up here as a multiple of the base context, not as a failing shape.
   */
  it('does not restate the grounding once per remembered turn', () => {
    const grounding = size(firstRound()) - QUESTION.length
    const remembered = size(firstRoundRemembering())

    expect(remembered - size(firstRound())).toBeLessThanOrEqual(MAX_HISTORY_CHARS)
    expect(remembered).toBeLessThan(size(firstRound()) + MAX_REMEMBERED_TURNS * grounding)
  })
})
