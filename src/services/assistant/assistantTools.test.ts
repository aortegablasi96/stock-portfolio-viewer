import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  ASSISTANT_TOOLS,
  DECLARED_TOOL_CATEGORIES,
  assistantToolDefinitions,
  runAssistantTool,
} from './assistantTools'
import { ALLOCATION_DIMENSIONS, MAX_LISTED_POSITIONS } from './toolReports'
import { HISTORY_SERIES } from './performanceReports'
import { portfolioService } from '@services/portfolio/portfolioService'
import { allocationService } from '@services/analytics/allocationService'
import { performanceService } from '@services/analytics/performanceService'
import { dividendService } from '@services/dividends/dividendService'
import { realizedGainsService } from '@services/analytics/realizedGainsService'
import { dataCoverageService } from '@services/dataCoverage/dataCoverageService'
import { investorProfileService } from '@services/profile/investorProfileService'
import { balanceDriftService } from '@services/profile/balanceDriftService'
import { DISCLOSURE_CATEGORIES, DISCLOSURE_CATEGORY_IDS } from '@shared/domain/assistantDisclosure'
import { IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'
import { EMPTY_INVESTOR_PROFILE } from '@shared/domain/investorProfileTerms'
import type { AiToolCall } from '@shared/domain/assistant'

/**
 * The tool registry: what the model may ask for, and what answers it (Story #326, DDR-0111).
 *
 * **This file is where ADR-0009's four conditions stop being prose.** The record permits tool
 * calling *provided* every tool returns a computed report, no tool is a general query, each is
 * backed by one service method, and none can write. Three of those are properties of a list, and a
 * list is exactly the thing a future story extends without re-reading the record — so they are
 * asserted here rather than reviewed.
 */

vi.mock('@services/portfolio/portfolioService', () => ({
  portfolioService: { getOverview: vi.fn(), getPosition: vi.fn() },
}))
vi.mock('@services/analytics/allocationService', () => ({
  allocationService: { getAllocation: vi.fn() },
}))
vi.mock('@services/profile/investorProfileService', () => ({
  investorProfileService: { get: vi.fn() },
}))
vi.mock('@services/profile/balanceDriftService', () => ({
  balanceDriftService: { getBalanceDrift: vi.fn() },
}))
vi.mock('@services/analytics/performanceService', () => ({
  performanceService: { getPerformance: vi.fn() },
}))
vi.mock('@services/dividends/dividendService', () => ({
  dividendService: { getDividends: vi.fn() },
}))
vi.mock('@services/analytics/realizedGainsService', () => ({
  realizedGainsService: { getRealizedGains: vi.fn() },
}))
vi.mock('@services/dataCoverage/dataCoverageService', () => ({
  dataCoverageService: { getCoverage: vi.fn() },
}))

const overview = vi.mocked(portfolioService.getOverview)
const position = vi.mocked(portfolioService.getPosition)
const allocation = vi.mocked(allocationService.getAllocation)
const profile = vi.mocked(investorProfileService.get)
const gaps = vi.mocked(balanceDriftService.getBalanceDrift)
const history = vi.mocked(performanceService.getPerformance)
const dividends = vi.mocked(dividendService.getDividends)
const realized = vi.mocked(realizedGainsService.getRealizedGains)
const coverage = vi.mocked(dataCoverageService.getCoverage)

const CONTEXT = { displayCurrency: 'EUR' } as const

const call = (name: string, argumentsJson = ''): AiToolCall => ({
  id: 'call_1',
  name,
  argumentsJson,
})

beforeEach(() => {
  vi.clearAllMocks()
  overview.mockResolvedValue({
    holdings: [],
    balances: {
      currency: 'EUR',
      totalCashValue: 0,
      netLiquidation: 0,
      stockMarketValue: 0,
    },
    allocation: [],
    totalMarketValue: 0,
    displayCurrency: 'EUR',
  })
  position.mockResolvedValue({ status: 'not_held', query: 'TSLA', heldPositions: 0 })
  allocation.mockReturnValue({ status: 'needs_import' })
  profile.mockReturnValue(EMPTY_INVESTOR_PROFILE)
  gaps.mockResolvedValue({ status: 'no_data' })
  history.mockReturnValue({ status: 'needs_import' })
  dividends.mockReturnValue({ status: 'needs_import' })
  realized.mockReturnValue({ status: 'needs_import' })
  coverage.mockResolvedValue({
    flex: { statements: 0, from: null, to: null, latestImportedAt: null, baseCurrencies: [] },
    snapshots: { captures: 0, earliest: null, latest: null },
    readAt: Date.UTC(2026, 5, 30, 14, 22),
  })
})

// ---- the inventory ADR-0009 permits -----------------------------------------

describe('the registry is the contract ADR-0009 wrote', () => {
  it('is the twelve reports the Epic ships, named as the record names them', () => {
    expect(ASSISTANT_TOOLS.map((tool) => tool.name)).toEqual([
      'get_portfolio_overview',
      'get_position',
      'get_investor_profile',
      'get_allocation',
      'get_rebalance_gaps',
      'get_performance_periods',
      'get_performance',
      'get_daily_returns',
      'get_portfolio_history',
      'get_dividend_income',
      'get_realized_gains',
      'get_data_coverage',
    ])
  })

  /**
   * **`get_portfolio_snapshot` is not among them, and the name is the trap** (DDR-0111). *Snapshot*
   * is a domain name in this app — the immutable local history, with its own service and table — so
   * a tool by that name returning **live** IBKR data would collide with the one thing it is not.
   */
  it('carries no tool named for a domain it does not read', () => {
    const names = ASSISTANT_TOOLS.map((tool) => tool.name)
    expect(names).not.toContain('get_portfolio_snapshot')
    // Folded into `get_allocation`'s largest-N and the baseline's own ceiling, deliberately: a
    // third path would compute concentration off a third denominator (DDR-0111).
    expect(names).not.toContain('get_concentration')
    // `get_daily_extremes` was renamed to `get_daily_returns` before it was built (Story #327): its
    // example question was "how volatile has the ride been?", and a tool whose *name* promises
    // volatility reads as the supply DDR-0110's risk-statistic prohibition is conditional on.
    expect(names).not.toContain('get_daily_extremes')
  })

  /**
   * **Read-only, and asserted as a list rather than reviewed.** ADR-0009's *never acts* is what a
   * write tool would break, and nothing in the toolchain would notice one being added — so the
   * backing methods are pinned to the reads they are allowed to be.
   */
  it('is backed by read-only service methods and nothing else', () => {
    expect(ASSISTANT_TOOLS.map((tool) => tool.backedBy)).toEqual([
      'portfolioService.getOverview',
      'portfolioService.getPosition',
      'investorProfileService.get',
      'allocationService.getAllocation',
      'balanceDriftService.getBalanceDrift',
      'performanceService.getPerformance',
      'performanceService.getPerformance',
      'performanceService.getPerformance',
      'performanceService.getPerformance',
      'dividendService.getDividends',
      'realizedGainsService.getRealizedGains',
      'dataCoverageService.getCoverage',
    ])
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.backedBy, tool.name).toMatch(/\.(get|list)[A-Za-z]*$/)
    }
  })

  /**
   * **`get_data_coverage` is where the one-method rule cost a service** (Story #329, DDR-0111).
   *
   * It was sketched over `flex:listStatements` **plus** `snapshot:list`, which the rule forbids: a
   * join is computation performed in the layer least covered by service tests, and *"it is only
   * metadata"* was weighed and rejected as a line nobody can hold. So the join is a service, and the
   * assertion that matters is that the tool names **it** rather than either of the two underneath.
   */
  it('reaches a coverage service rather than joining two stores in the tool layer', () => {
    const coverage = ASSISTANT_TOOLS.find((tool) => tool.name === 'get_data_coverage')!
    expect(coverage.backedBy).toBe('dataCoverageService.getCoverage')
    expect(ASSISTANT_TOOLS.map((tool) => tool.backedBy)).not.toContain(
      'flexStatementsService.listStatements',
    )
    expect(ASSISTANT_TOOLS.map((tool) => tool.backedBy)).not.toContain('snapshotService.getHistory')
  })

  /**
   * One backing method each. **Many tools may share one; none may span two** (DDR-0111), and the
   * four performance tools are the sharing half of that rule made visible: they are four narrowings
   * of `analytics:getPerformance` and add no arithmetic and no join. A tool spanning two methods
   * would be joining in the layer least covered by the service tests, which is where the assertion
   * below would fail it.
   */
  it('gives every tool exactly one backing method', () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.backedBy.split(','), tool.name).toHaveLength(1)
    }
    expect(new Set(ASSISTANT_TOOLS.map((tool) => tool.backedBy)).size).toBeLessThan(
      ASSISTANT_TOOLS.length,
    )
  })

  /**
   * **The disclosure has to reach a tool result, or a tool is the way around it** (DDR-0111,
   * decision 6). `pickDisclosedSections` bounds the assembled context at the IPC boundary, and a
   * tool result never crosses it — so the categories are bounded here instead.
   */
  it('declares only categories the disclosure names', () => {
    expect(DECLARED_TOOL_CATEGORIES.length).toBeGreaterThan(0)
    for (const category of DECLARED_TOOL_CATEGORIES) {
      expect(DISCLOSURE_CATEGORY_IDS, category).toContain(category)
    }
  })

  /**
   * **Money is licensed by exactly one category, and only the four tools that need it declare it.**
   *
   * `performance` is the sole entry disclosed at `figures`, and it is the sole entry under which an
   * amount of money may be written (DDR-0098). The line runs between the two halves of the registry:
   * the live book, the profile, the allocation and the gaps are names and percentages and return no
   * amount at all — which `toolReports.test.ts` asserts over the prose itself — while the four
   * performance reports carry portfolio values, deposits and costs and say so on the tin.
   */
  it('licenses an amount of money for the performance reports and for no others', () => {
    const granularity = (name: string): string[] =>
      ASSISTANT_TOOLS.find((tool) => tool.name === name)!.categories.map(
        (id) => DISCLOSURE_CATEGORIES.find((category) => category.id === id)!.granularity,
      )

    for (const name of [
      'get_portfolio_overview',
      'get_position',
      'get_investor_profile',
      'get_allocation',
      'get_rebalance_gaps',
      // Coverage counts statements and dates them; it carries no weight and no money, and says so
      // in its own text (Story #329).
      'get_data_coverage',
    ]) {
      expect(granularity(name), name).not.toContain('figures')
    }
    for (const name of [
      'get_performance_periods',
      'get_performance',
      'get_daily_returns',
      'get_portfolio_history',
      'get_dividend_income',
      'get_realized_gains',
    ]) {
      expect(granularity(name), name).toEqual(['figures'])
    }
  })

  /**
   * **A category was added rather than a report squeezed under an existing one** (Story #329).
   *
   * `DISCLOSURE_CATEGORIES` is *"the only keys an assistant context may carry"*, and no entry named
   * statement counts, spans or import dates. Declaring `get_data_coverage` under `holdings` would
   * have been the cheap move and the dishonest one: the disclosure would then describe something the
   * app does not send and omit something it does.
   */
  it('declares coverage under a category of its own, at names', () => {
    const coverage = DISCLOSURE_CATEGORIES.find((category) => category.id === 'coverage')
    expect(coverage?.granularity).toBe('names')
    expect(coverage?.detail).toContain('No positions, no weights and no amounts of money')
  })
})

// ---- what the model is offered ----------------------------------------------

/** One tool's declared JSON Schema, as the gateway sends it. */
const schema = (name: string): { properties: Record<string, unknown> } =>
  assistantToolDefinitions().find((tool) => tool.name === name)!.parameters as {
    properties: Record<string, unknown>
  }

/** The argument names one tool takes, in declaration order. */
const properties = (name: string): string[] => Object.keys(schema(name).properties)

describe('the definitions the gateway declares', () => {
  it('carries a name, a description and a schema for each tool, and nothing else', () => {
    for (const definition of assistantToolDefinitions()) {
      expect(Object.keys(definition).sort()).toEqual(['description', 'name', 'parameters'])
      expect(definition.description.length).toBeGreaterThan(0)
    }
  })

  /**
   * **No argument is a predicate** (DDR-0111). A filter, a sort, a comparison, a threshold or a
   * free-form range is ADR-0009's general query arriving as a parameter rather than as a tool, so
   * the whole parameter surface is pinned: four tools take nothing, and the four that take something
   * take a dimension, a count, an enumerated period key or a choice between two series.
   */
  it('offers no argument that could be a predicate', () => {
    expect(properties('get_portfolio_overview')).toEqual([])
    expect(properties('get_investor_profile')).toEqual([])
    expect(properties('get_rebalance_gaps')).toEqual([])
    expect(properties('get_performance_periods')).toEqual([])
    expect(properties('get_allocation')).toEqual(['dimension', 'limit'])
    expect(properties('get_performance')).toEqual(['period'])
    expect(properties('get_daily_returns')).toEqual(['period'])
    expect(properties('get_portfolio_history')).toEqual(['period', 'series'])
    expect(properties('get_position')).toEqual(['query'])
    // Story #329: income takes the one enumerated key, and the other two take nothing at all.
    expect(properties('get_dividend_income')).toEqual(['period'])
    expect(properties('get_realized_gains')).toEqual([])
    expect(properties('get_data_coverage')).toEqual([])
  })

  /**
   * **`get_position` takes one identity and nothing that could narrow a list** (Story #328).
   *
   * It is the only tool taking free text, which makes it the one place the general query could
   * arrive wearing an identity's clothes — so the argument surface is pinned rather than reviewed.
   * A `limit` here would be the *first N of what*, and a `sector`, a `minWeight` or a `sort` is the
   * predicate DDR-0111 forbids as a parameter. Largest-N by weight is `get_allocation`'s count.
   */
  it('offers no way to ask get_position for more than one holding', () => {
    for (const forbidden of ['limit', 'sort', 'sector', 'currency', 'minWeight', 'above', 'filter']) {
      expect(properties('get_position'), forbidden).not.toContain(forbidden)
    }
    expect(schema('get_position').properties['query']).toMatchObject({ type: 'string' })
    // Said in both descriptions too, because a shape is not what the model reads first.
    expect(schema('get_position').properties['query']).toMatchObject({
      description: expect.stringContaining('never a condition'),
    })
    expect(
      assistantToolDefinitions().find((tool) => tool.name === 'get_position')!.description,
    ).toContain('no filter, no threshold and no list')
  })

  /**
   * **A period is a key, not a range** (DDR-0102). The schema cannot `enum` the keys — the set is a
   * function of the imported history, so the valid ones differ per account — and what it must never
   * do instead is offer a window anyone can describe. `from`, `to` and `range` are the shapes the
   * period picker that record removed would arrive in.
   */
  it('offers no way to describe a window it did not compute', () => {
    for (const name of [
      'get_performance',
      'get_daily_returns',
      'get_portfolio_history',
      'get_dividend_income',
    ]) {
      expect(properties(name), name).not.toContain('from')
      expect(properties(name), name).not.toContain('to')
      expect(properties(name), name).not.toContain('range')
      expect(schema(name).properties['period']).toMatchObject({ type: 'string' })
    }
  })

  /**
   * The two series the model may choose between, offered as the same array the report reads — so a
   * tool cannot advertise a series it then refuses. The split is DDR-0013's: value and return may
   * not arrive in one payload, and there is no `return` member here at all.
   */
  it('offers exactly the two series the history report can produce', () => {
    const series = schema('get_portfolio_history').properties['series'] as { enum: string[] }
    expect(series.enum).toEqual([...HISTORY_SERIES])
    expect(series.enum).not.toContain('return')
  })

  /**
   * The list the model is offered and the list the parser accepts are the same array, so a tool
   * cannot advertise a breakdown it then refuses.
   */
  it('offers exactly the dimensions the report can produce', () => {
    const parameters = assistantToolDefinitions().find((tool) => tool.name === 'get_allocation')!
      .parameters as { properties: { dimension: { enum: string[] } } }

    expect(parameters.properties.dimension.enum).toEqual([...ALLOCATION_DIMENSIONS])
  })

  it('bounds the one count it accepts at the cap the report enforces', () => {
    const parameters = assistantToolDefinitions().find((tool) => tool.name === 'get_allocation')!
      .parameters as { properties: { limit: { maximum: number } } }

    expect(parameters.properties.limit.maximum).toBe(MAX_LISTED_POSITIONS)
  })
})

// ---- running one ------------------------------------------------------------

describe('running a call', () => {
  it('routes each tool to its own service method, and to no other', async () => {
    await runAssistantTool(call('get_portfolio_overview'), CONTEXT)
    expect(overview).toHaveBeenCalledWith('EUR')
    expect(allocation).not.toHaveBeenCalled()
    expect(gaps).not.toHaveBeenCalled()

    await runAssistantTool(call('get_allocation', '{"dimension":"sector"}'), CONTEXT)
    expect(allocation).toHaveBeenCalledTimes(1)

    await runAssistantTool(call('get_investor_profile'), CONTEXT)
    expect(profile).toHaveBeenCalledTimes(1)

    await runAssistantTool(call('get_rebalance_gaps'), CONTEXT)
    expect(gaps).toHaveBeenCalledWith('EUR')
  })

  /**
   * The four performance tools share one method and reach nothing else — the *many tools, one
   * method* half of DDR-0111's rule, asserted at the call rather than only in the registry.
   */
  it('routes all four performance tools to the one method behind them', async () => {
    for (const name of [
      'get_performance_periods',
      'get_performance',
      'get_daily_returns',
      'get_portfolio_history',
    ]) {
      await runAssistantTool(call(name, '{"period":"all","series":"value"}'), CONTEXT)
    }

    expect(history).toHaveBeenCalledTimes(4)
    expect(overview).not.toHaveBeenCalled()
    expect(allocation).not.toHaveBeenCalled()
    expect(gaps).not.toHaveBeenCalled()
  })

  /**
   * The three reports #329 added reach their own service and nothing else — coverage especially,
   * since the two stores it describes each have a service the tool must not be reaching directly.
   */
  it('routes the three store reports to their own methods', async () => {
    await runAssistantTool(call('get_dividend_income', '{"period":"all"}'), CONTEXT)
    expect(dividends).toHaveBeenCalledTimes(1)

    await runAssistantTool(call('get_realized_gains'), CONTEXT)
    expect(realized).toHaveBeenCalledTimes(1)

    await runAssistantTool(call('get_data_coverage'), CONTEXT)
    expect(coverage).toHaveBeenCalledTimes(1)

    expect(overview).not.toHaveBeenCalled()
    expect(history).not.toHaveBeenCalled()
    expect(allocation).not.toHaveBeenCalled()
  })

  /**
   * **Coverage always answers**, and this is where that stops being prose (Story #329). Every other
   * report over the imported store returns `needs_import` when nothing is there; an empty store *is*
   * this report's subject, so a state in its place would be the inverted failure.
   */
  it('answers coverage from an empty store rather than with a needs-import state', async () => {
    const answer = await runAssistantTool(call('get_data_coverage'), CONTEXT)

    expect(answer).toContain('Nothing has been imported at all')
    expect(answer).toContain('This is the coverage, not a failure to report it')
    expect(answer).not.toContain('needs_import')
  })

  /** The two that read the imported store keep theirs, because an empty report is not a state. */
  it.each([
    ['get_dividend_income', '{"period":"all"}'],
    ['get_realized_gains', ''],
  ])('answers %s from an empty store as a state', async (name, args) => {
    const answer = await runAssistantTool(call(name, args), CONTEXT)
    expect(answer).toContain('no Flex statement has been imported')
  })

  /**
   * **A period key is passed through unaltered, and a miss is a state** (DDR-0102).
   *
   * The opposite of `get_allocation`'s fallback, deliberately: a dimension outside a five-name enum
   * is a model that has not read the schema, where an unknown period key is a question about a
   * *window*, and answering it from the nearest one is the substitution the precomputed set exists
   * to prevent. A missing key takes the same route rather than quietly becoming the whole history.
   */
  it.each(['{"period":"march to july"}', '{}', '', '{"period":42}'])(
    'answers a period it did not compute as a state rather than as another period: %s',
    async (args) => {
      history.mockReturnValue({
        status: 'ok',
        report: {
          baseCurrency: 'EUR',
          valueSeries: [
            { date: Date.UTC(2026, 0, 1), value: 100 },
            { date: Date.UTC(2026, 5, 1), value: 120 },
          ],
          returnSeries: [
            { date: Date.UTC(2026, 0, 1), value: 0 },
            { date: Date.UTC(2026, 5, 1), value: 5 },
          ],
          compositionSeries: { bands: [], points: [] },
          periods: [],
          startingValue: 100,
          endingValue: 120,
          cumulativeTwr: 5,
          totalDepositsWithdrawals: 0,
          totalRealizedPnl: 0,
          totalUnrealizedPnl: 0,
        },
      })

      const answer = await runAssistantTool(call('get_performance', args), CONTEXT)
      expect(answer).toContain('this app holds no period called')
      expect(answer).toContain('- all — Full history')
      expect(answer).not.toContain('%')
    },
  )

  /**
   * The query reaches the service **unresolved**, which is DDR-0111's rule that the resolution rule
   * and its states live where the app's business rules are tested — not in this layer.
   */
  it('passes the query to the service rather than matching it here', async () => {
    await runAssistantTool(call('get_position', '{"query":"  apple "}'), CONTEXT)

    expect(position).toHaveBeenCalledWith('apple', 'EUR')
    expect(overview).not.toHaveBeenCalled()
    expect(allocation).not.toHaveBeenCalled()
  })

  /**
   * A call naming no instrument reads nothing at all, and the reason it is handled here rather than
   * as a service state is that it is not a fact about the portfolio: an unknown *period* is a real
   * answer about a real window, where a blank query is a call the model did not finish writing.
   */
  it.each(['{}', '', '{"query":"   "}', '{"query":42}'])(
    'answers a call naming no instrument without reading the portfolio: %s',
    async (args) => {
      const answer = await runAssistantTool(call('get_position', args), CONTEXT)

      expect(answer).toContain('needs the ticker or name of one instrument')
      expect(answer).toContain('get_portfolio_overview')
      expect(position).not.toHaveBeenCalled()
    },
  )

  /** A lookup that never ran must not be able to arrive as "you do not hold it" (DDR-0022). */
  it.each([
    [new IbkrNotConnectedError('gateway down'), 'the IBKR gateway is not running'],
    [new IbkrTimeoutError('stalled'), 'stopped answering'],
  ])('reports a gateway failure on a lookup as its own state', async (error, phrase) => {
    position.mockRejectedValue(error)

    const answer = await runAssistantTool(call('get_position', '{"query":"AAPL"}'), CONTEXT)
    expect(answer).toContain(phrase)
    expect(answer).not.toContain('training data')
  })

  /** The app's currency selection reaches the live reads, so an answer is weighed in it. */
  it('weighs a live report in the currency the question carried', async () => {
    await runAssistantTool(call('get_rebalance_gaps'), { displayCurrency: 'USD' })
    expect(gaps).toHaveBeenCalledWith('USD')
  })

  it('returns prose, never JSON', async () => {
    const answer = await runAssistantTool(call('get_investor_profile'), CONTEXT)
    expect(answer).toContain('has not set an investor profile at all')
    expect(() => JSON.parse(answer)).toThrow()
  })

  it('reads the arguments the model wrote', async () => {
    allocation.mockReturnValue({ status: 'needs_import' })
    const answer = await runAssistantTool(
      call('get_allocation', '{"dimension":"currency","limit":3}'),
      CONTEXT,
    )
    expect(answer).toContain('no Flex statement has been imported')
  })

  /**
   * The gateway rejects an undeclared name before the executor runs, which is where that check
   * belongs. This is the second lock, and it **names the tool** rather than silently answering as
   * another one — answering a name nobody declared would be the general query arriving by the back
   * door.
   */
  it('answers an unknown tool by name rather than with another report', async () => {
    const answer = await runAssistantTool(call('get_everything'), CONTEXT)
    expect(answer).toContain('There is no get_everything report in this app')
    expect(overview).not.toHaveBeenCalled()
    expect(allocation).not.toHaveBeenCalled()
  })

  it('says why unreadable arguments could not be read, and runs nothing', async () => {
    const answer = await runAssistantTool(call('get_allocation', '{not json'), CONTEXT)
    expect(answer).toContain('were not valid JSON')
    expect(allocation).not.toHaveBeenCalled()
  })

  /**
   * A missing or unknown dimension falls back rather than failing the call: it is a model that has
   * not read the schema, and the largest positions answer the widest range of questions it could
   * have meant. There is no sixth breakdown for a free-form one to have wanted.
   */
  it('falls back to the positions when no dimension the schema names was given', async () => {
    allocation.mockReturnValue({ status: 'needs_import' })
    for (const args of ['', '{}', '{"dimension":"astrology"}']) {
      expect(await runAssistantTool(call('get_allocation', args), CONTEXT)).toContain('ALLOCATION')
    }
    expect(allocation).toHaveBeenCalledTimes(3)
  })

  /**
   * **A tool that could not answer is a state, not a failed question** (DDR-0022). The gateway ends
   * the whole exchange on a thrown executor, which is right for a bug and wrong for a gateway that
   * is not running — so the two typed IBKR errors are mapped into prose and the conversation
   * continues with the model told exactly what it could not see.
   */
  it.each([
    [new IbkrNotConnectedError('gateway down'), 'the IBKR gateway is not running'],
    [new IbkrTimeoutError('stalled'), 'stopped answering'],
  ])('turns a gateway failure into a report that names the state', async (error, phrase) => {
    overview.mockRejectedValue(error)
    gaps.mockRejectedValue(error)

    expect(await runAssistantTool(call('get_portfolio_overview'), CONTEXT)).toContain(phrase)
    expect(await runAssistantTool(call('get_rebalance_gaps'), CONTEXT)).toContain(phrase)
  })

  /** Anything else is still a report that could not be produced, never a thrown promise. */
  it('resolves rather than rejecting when a service throws something unexpected', async () => {
    profile.mockImplementation(() => {
      throw new Error('the database is locked')
    })

    const answer = await runAssistantTool(call('get_investor_profile'), CONTEXT)
    expect(answer).toContain('could not be produced')
    expect(answer).toContain('never answer it from anything else')
  })
})
