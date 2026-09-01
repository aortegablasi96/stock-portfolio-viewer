import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  ASSISTANT_TOOLS,
  DECLARED_TOOL_CATEGORIES,
  assistantToolDefinitions,
  runAssistantTool,
} from './assistantTools'
import { ALLOCATION_DIMENSIONS, MAX_LISTED_POSITIONS } from './toolReports'
import { portfolioService } from '@services/portfolio/portfolioService'
import { allocationService } from '@services/analytics/allocationService'
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
  portfolioService: { getOverview: vi.fn() },
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

const overview = vi.mocked(portfolioService.getOverview)
const allocation = vi.mocked(allocationService.getAllocation)
const profile = vi.mocked(investorProfileService.get)
const gaps = vi.mocked(balanceDriftService.getBalanceDrift)

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
  allocation.mockReturnValue({ status: 'needs_import' })
  profile.mockReturnValue(EMPTY_INVESTOR_PROFILE)
  gaps.mockResolvedValue({ status: 'no_data' })
})

// ---- the inventory ADR-0009 permits -----------------------------------------

describe('the registry is the contract ADR-0009 wrote', () => {
  it('is the four reports this story ships, named as the record names them', () => {
    expect(ASSISTANT_TOOLS.map((tool) => tool.name)).toEqual([
      'get_portfolio_overview',
      'get_investor_profile',
      'get_allocation',
      'get_rebalance_gaps',
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
  })

  /**
   * **Read-only, and asserted as a list rather than reviewed.** ADR-0009's *never acts* is what a
   * write tool would break, and nothing in the toolchain would notice one being added — so the
   * backing methods are pinned to the four reads they are allowed to be.
   */
  it('is backed by four read-only service methods and nothing else', () => {
    expect(ASSISTANT_TOOLS.map((tool) => tool.backedBy)).toEqual([
      'portfolioService.getOverview',
      'investorProfileService.get',
      'allocationService.getAllocation',
      'balanceDriftService.getBalanceDrift',
    ])
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.backedBy, tool.name).toMatch(/\.(get|list)[A-Za-z]*$/)
    }
  })

  /** One backing method each. Many tools may share one; none may span two (DDR-0111). */
  it('gives every tool exactly one backing method', () => {
    for (const tool of ASSISTANT_TOOLS) {
      expect(tool.backedBy.split(','), tool.name).toHaveLength(1)
    }
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
   * And none of the four declares the one category that may carry money. `performance` is where
   * amounts are disclosed, and no tool in this story returns any — which is what
   * `toolReports.test.ts` asserts over the prose itself.
   */
  it('declares no category that would license an amount of money', () => {
    const granularities = DECLARED_TOOL_CATEGORIES.map(
      (id) => DISCLOSURE_CATEGORIES.find((category) => category.id === id)!.granularity,
    )
    expect(granularities).not.toContain('figures')
  })
})

// ---- what the model is offered ----------------------------------------------

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
   * the whole parameter surface is pinned: three tools take nothing, and the fourth takes a
   * dimension and a count.
   */
  it('offers no argument that could be a predicate', () => {
    const properties = (name: string): string[] => {
      const parameters = assistantToolDefinitions().find((tool) => tool.name === name)!.parameters
      return Object.keys((parameters as { properties: Record<string, unknown> }).properties)
    }

    expect(properties('get_portfolio_overview')).toEqual([])
    expect(properties('get_investor_profile')).toEqual([])
    expect(properties('get_rebalance_gaps')).toEqual([])
    expect(properties('get_allocation')).toEqual(['dimension', 'limit'])
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
