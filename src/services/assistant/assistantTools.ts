import { portfolioService } from '@services/portfolio/portfolioService'
import { allocationService } from '@services/analytics/allocationService'
import { performanceService } from '@services/analytics/performanceService'
import { investorProfileService } from '@services/profile/investorProfileService'
import { balanceDriftService } from '@services/profile/balanceDriftService'
import { IbkrNotConnectedError, IbkrTimeoutError } from '@shared/errors'
import type { DisclosureCategoryId } from '@shared/domain/assistantDisclosure'
import type { AiToolCall, AiToolDefinition } from '@shared/domain/assistant'
import type { BalanceDriftResult } from '@shared/domain/balanceDrift'
import {
  ALLOCATION_DIMENSIONS,
  MAX_LISTED_POSITIONS,
  allocationReport,
  investorProfileReport,
  portfolioOverviewReport,
  rebalanceGapsReport,
  type AllocationDimension,
  type LivePortfolioResult,
} from './toolReports'
import {
  HISTORY_SERIES,
  dailyReturnsReport,
  performancePeriodsReport,
  performanceReport,
  portfolioHistoryReport,
  type HistorySeries,
} from './performanceReports'

/**
 * The reports the model may ask for, and the one place a tool name meets a service (#326, #327).
 *
 * ## What a tool is allowed to be
 *
 * ADR-0009 permits tool calling on four conditions, and DDR-0111 turned them into a contract this
 * module is the whole of:
 *
 * 1. **Every tool returns a computed report, never raw data.** What crosses to the model is the
 *    app's own prose out of `toolReports.ts`, not a payload it could recombine.
 * 2. **No general query, and no tool reaching a repository, the gateway or the database.** Every
 *    entry below calls a *service*, and the layering is the enforcement rather than the intention:
 *    a service is where the app's business rules already are.
 * 3. **One backing service method per tool.** Many tools may share a method; none may span two,
 *    because a join is computation performed in the layer least covered by service tests. Both
 *    halves of that rule are visible here. `get_rebalance_gaps` is the *may not span two* half — the
 *    owner's targets and ADR-0012's baseline arrive in one payload, off one reading and one
 *    denominator, because splitting them is the second answer that record refused. The four
 *    performance tools are the *may share one* half: they are four narrowings of
 *    `analytics:getPerformance`, adding no arithmetic and no join, where one tool with a `section`
 *    argument would be a discriminated tool wearing a disguise (Story #327).
 * 4. **No write tool, and no path to one.** Eight reads. `assistantTools.test.ts` asserts the
 *    registry against the read-only methods it is allowed to name, so a future entry that mutated
 *    anything fails there rather than being caught by review.
 *
 * **No argument is a predicate** (DDR-0111). No filter, sort, comparison, threshold or free-form
 * range: those are the general query arriving as a parameter rather than as a tool. Three arguments
 * exist and none of them is one. `get_allocation`'s `limit` is a **count, not a condition** —
 * largest-N by weight, a shape the allocation report already computes. A `period` is an
 * **enumerated key** out of the precomputed set, so a window this app did not measure is a named
 * state with the alternatives rather than a range anyone can describe (DDR-0102). And
 * `get_portfolio_history`'s `series` **selects between two answers**, which is the split DDR-0013
 * requires rather than a filter over one.
 *
 * ## The disclosure has to reach a tool result, or a tool is the way around it
 *
 * `pickDisclosedSections` bounds the assembled context at the IPC boundary, and tool results never
 * cross that boundary — they are built here, in main, and go straight to the gateway. So each tool
 * **declares the category it falls under**, the categories are asserted to be a subset of
 * `DISCLOSURE_CATEGORIES`, and the granularity that category declares is what the report may carry.
 * The line runs between the two halves of this registry: the first four fall under `holdings`,
 * `weights` or `profile`, which are names and percentages, so **no amount of money appears in any of
 * them**; the four performance tools declare `performance`, which is the one category disclosed at
 * `figures` and the only place an amount is allowed (DDR-0098, DDR-0111 decision 6).
 *
 * ## The absences are not here, and that is deliberate
 *
 * *WHAT THIS APP DOES NOT COMPUTE* is `BASE_CONTEXT`, emitted above every question whether or not a
 * single tool ran (Story #325). A prohibition whose supporting fact the model may decline to fetch
 * is not a prohibition, and three of the prompt's are conditional on those statements being present
 * (DDR-0110, DDR-0111 decision 3). What a report restates is the absence qualifying **its own**
 * figures, which is belt-and-braces rather than the binding.
 */

/** Everything a tool needs that is not in its own arguments: the app's currency selection. */
export interface ToolContext {
  /**
   * The display currency the app is showing, which every live weight is a share of a total in.
   *
   * It arrives with the question rather than being read here, because it is a *view* selection —
   * the shell owns it (DDR-0007) — and a tool that resolved its own would answer in a currency the
   * owner is not looking at.
   */
  readonly displayCurrency: string
}

/** One report the model may ask for: what it is called, what it takes, and what computes it. */
export interface AssistantTool {
  readonly name: string
  /** What the report is, in the register the model reads — including what it is *not*. */
  readonly description: string
  /** JSON Schema for the arguments. `{}` with no properties is a tool that takes none. */
  readonly parameters: Record<string, unknown>
  /**
   * Which `DISCLOSURE_CATEGORIES` entries this report's prose falls under.
   *
   * Several, where a report legitimately draws on more than one — the live book names instruments
   * (`holdings`) and weighs them (`weights`) — and the **most permissive** of them is the bound the
   * prose is written to. A test reads every report back against it.
   */
  readonly categories: readonly DisclosureCategoryId[]
  /** The service method behind it, named so a test can assert the registry reaches nothing else. */
  readonly backedBy: string
  run(args: unknown, context: ToolContext): Promise<string>
}

/**
 * The arguments `get_allocation` takes, declared once and read twice.
 *
 * The enum is `ALLOCATION_DIMENSIONS` itself rather than a copy: the list the model is offered and
 * the list the parser accepts are the same array, so they cannot drift into a tool that advertises
 * a breakdown it then refuses.
 */
const ALLOCATION_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    dimension: {
      type: 'string',
      enum: [...ALLOCATION_DIMENSIONS],
      description:
        'Which breakdown to return. One of these exactly; there is no other breakdown and no free-form grouping.',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      maximum: MAX_LISTED_POSITIONS,
      description: `How many of the largest positions to list, when dimension is "position". A count, never a condition — there is no way to ask for "everything above 5%". Defaults to ${MAX_LISTED_POSITIONS}, which is also the ceiling.`,
    },
  },
  required: ['dimension'],
  additionalProperties: false,
}

/** A tool that takes nothing. Spelled out rather than omitted: the provider expects a schema. */
const NO_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {},
  additionalProperties: false,
}

/**
 * How a period is named to the model, and why the schema cannot enumerate the keys itself.
 *
 * **The set is a function of the imported history**, so the valid keys are `2025` and `Q3 2025` in
 * one account and `2011` and `Q1 2012` in another; a static `enum` here would be a lie in every
 * account but one. The enumeration is real all the same and is enforced where it can be — the key
 * must be one `get_performance_periods` listed, `findPeriod` matches it exactly, and a miss is a
 * named state **with the alternatives** rather than the adjacent row (DDR-0102, DDR-0111).
 *
 * It is therefore **not** a free-form range: there is no `from`, no `to`, and no way to describe a
 * window in words. A tool taking one would be the period picker DDR-0102 removed, arriving through a
 * different door.
 */
const PERIOD_ARGUMENT: Record<string, unknown> = {
  type: 'string',
  description:
    'Which period, as one of the exact keys get_performance_periods lists (for example "all", "trailing:1y", "year:2025", "quarter:Q3 2025"). Call that tool first if you do not already have the keys. There is no free-form date range: a window this app did not compute comes back as unavailable, with the periods that exist listed.',
}

const PERIOD_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: { period: PERIOD_ARGUMENT },
  required: ['period'],
  additionalProperties: false,
}

/**
 * `get_portfolio_history`'s two arguments: which period, and **which** series.
 *
 * The `series` enum is the split DDR-0013 requires and DDR-0111 pinned. Value over time and
 * composition over time are two answers about the same days, and returning both in one payload is
 * how a model attributes a deposit to performance — so the model asks for one.
 */
const HISTORY_PARAMETERS: Record<string, unknown> = {
  type: 'object',
  properties: {
    period: PERIOD_ARGUMENT,
    series: {
      type: 'string',
      enum: [...HISTORY_SERIES],
      description:
        'Which series to return: "value" for the portfolio value on each day, or "composition" for how that value was divided across asset classes. One or the other, never both — a return over the period is get_performance’s single figure, and this tool returns no return at all.',
    },
  },
  required: ['period', 'series'],
  additionalProperties: false,
}

export const ASSISTANT_TOOLS: readonly AssistantTool[] = [
  {
    name: 'get_portfolio_overview',
    description:
      'The live portfolio as the IBKR gateway reports it right now: every open position by ticker and name, its currency, and its weight as a share of the holdings that could be valued. Cash is not weighted here. Returns names and percentages only — no amounts of money. This is the live book, not the imported statement history: use it for what is held now, never for returns, income or anything as of a statement date.',
    parameters: NO_PARAMETERS,
    categories: ['holdings', 'weights'],
    backedBy: 'portfolioService.getOverview',
    async run(_args, context): Promise<string> {
      return portfolioOverviewReport(await liveOverview(context.displayCurrency))
    },
  },
  {
    name: 'get_investor_profile',
    description:
      'The investor profile the owner wrote: their investing style tags and every target range they set, by currency, sector, asset class and single-position size, plus the dimensions they set no target for. It says what their standard is, never whether the portfolio meets it — ask for get_rebalance_gaps for that. Percentages only.',
    parameters: NO_PARAMETERS,
    categories: ['profile'],
    backedBy: 'investorProfileService.get',
    async run(): Promise<string> {
      return investorProfileReport(investorProfileService.get())
    },
  },
  {
    name: 'get_allocation',
    description:
      'One breakdown of the imported statement history: how the portfolio is divided by position, asset class, currency, sector or issuer country, as a share of net asset value. Ask for the one dimension the question is about. For positions it returns the largest N by weight, which is also where concentration is answered. Percentages only — no amounts of money. This reads the imported Flex store as of the latest statement, never live.',
    parameters: ALLOCATION_PARAMETERS,
    categories: ['holdings', 'weights'],
    backedBy: 'allocationService.getAllocation',
    async run(args): Promise<string> {
      const { dimension, limit } = allocationArguments(args)
      return allocationReport(allocationService.getAllocation(), dimension, limit)
    },
  },
  {
    name: 'get_rebalance_gaps',
    description:
      'How far the live portfolio sits from the owner’s targets, and — only where they set none — from the app’s own published baseline, both measured off one reading and one denominator with cash included. Carries each band’s verdict, the app-computed move that would close it and which held positions carry that move, in percentage points. Every line says whose standard it is. Percentages only — no amounts of money.',
    parameters: NO_PARAMETERS,
    categories: ['profile'],
    backedBy: 'balanceDriftService.getBalanceDrift',
    async run(_args, context): Promise<string> {
      return rebalanceGapsReport(await liveDrift(context.displayCurrency))
    },
  },
  {
    name: 'get_performance_periods',
    description:
      'Which periods this app has computed, by their exact keys: the whole imported history, the trailing windows, the recent calendar years and the recent calendar quarters, each with the window it covers and whether it holds any data. Carries no return and no value — it is the discovery tool. Call it before get_performance, get_daily_returns or get_portfolio_history unless you already have the keys, because those accept these keys only and no free-form date range exists.',
    parameters: NO_PARAMETERS,
    categories: ['performance'],
    backedBy: 'performanceService.getPerformance',
    async run(): Promise<string> {
      return performancePeriodsReport(performanceService.getPerformance())
    },
  },
  {
    name: 'get_performance',
    description:
      'The return and the value over one period of the imported statement history, kept apart as two separate figures: a time-weighted return that money paid in or taken out does not move, and a change in value that it does. Also the deposits, withdrawals, dividend income, interest and commissions over the statement periods the window touches, and the whole-history roll-ups. Amounts are in the base currency of the imported statements. Takes one of get_performance_periods’ exact keys; a window this app did not compute comes back as unavailable with the alternatives listed.',
    parameters: PERIOD_PARAMETERS,
    categories: ['performance'],
    backedBy: 'performanceService.getPerformance',
    async run(args): Promise<string> {
      return performanceReport(performanceService.getPerformance(), periodArgument(args))
    },
  },
  {
    name: 'get_daily_returns',
    description:
      'How the return over one period was travelled day by day: how many trading days were up, down and unchanged, and the best and worst day with its date. Each day is chain-linked from the return curve and measured against the trading day that really preceded it. It supplies no volatility, standard deviation, Sharpe ratio, beta or drawdown — this app computes none, and these counts and extremes are the only dispersion that exists. Takes one of get_performance_periods’ exact keys.',
    parameters: PERIOD_PARAMETERS,
    categories: ['performance'],
    backedBy: 'performanceService.getPerformance',
    async run(args): Promise<string> {
      return dailyReturnsReport(performanceService.getPerformance(), periodArgument(args))
    },
  },
  {
    name: 'get_portfolio_history',
    description:
      'One period’s history day by day, as either the portfolio value on each day or how that value was divided across asset classes — one series or the other, never both, since a value and a return are different figures about the same days. Amounts are in the base currency of the imported statements, and long periods are sampled to a stated number of days. Takes one of get_performance_periods’ exact keys. It returns no return at all: ask get_performance for that.',
    parameters: HISTORY_PARAMETERS,
    categories: ['performance'],
    backedBy: 'performanceService.getPerformance',
    async run(args): Promise<string> {
      return portfolioHistoryReport(
        performanceService.getPerformance(),
        periodArgument(args),
        seriesArgument(args),
      )
    },
  },
]

/** The registry as the gateway declares it: names, descriptions and schemas, and nothing else. */
export function assistantToolDefinitions(): AiToolDefinition[] {
  return ASSISTANT_TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

/**
 * Run one call and return the prose the model sees.
 *
 * **It resolves, never rejects.** The gateway names a throwing executor `error` and ends the
 * question, which is right for a bug and wrong for everything a service can legitimately fail at —
 * so the failures that are *states* are turned into prose here and the question continues. A tool
 * that could not answer says so in its own report; it does not take the conversation down with it.
 *
 * An undeclared name cannot reach this: `aiGateway` rejects the round as `invalid` before the
 * executor runs, which is where that check belongs — running a name nobody declared would be the
 * general query ADR-0009 forbids arriving by the back door. The branch here is the second lock, and
 * it names the tool rather than silently answering as another one.
 */
export async function runAssistantTool(call: AiToolCall, context: ToolContext): Promise<string> {
  const tool = ASSISTANT_TOOLS.find((candidate) => candidate.name === call.name)
  if (tool === undefined) {
    return `There is no ${call.name} report in this app. Say that the report is not available; do not answer from another one.`
  }

  const args = parseArguments(call.argumentsJson)
  if (args.status === 'invalid') {
    return `The ${call.name} report could not be produced: ${args.message} Ask again with arguments this app’s tool description allows.`
  }

  try {
    return await tool.run(args.value, context)
  } catch (err) {
    // A tool's own failure is a report that could not be produced, not an answer that is wrong. It
    // is said as a state so the model states it, rather than routing around it with training data.
    return `The ${call.name} report could not be produced: ${err instanceof Error ? err.message : String(err)}. Say the report is unavailable; never answer it from anything else.`
  }
}

/** The arguments as the model wrote them, or why they could not be read. */
type ParsedArguments =
  | { status: 'ok'; value: unknown }
  | { status: 'invalid'; message: string }

/**
 * The JSON string the provider sends, parsed here and nowhere earlier.
 *
 * `aiGateway` deliberately carries it as a string: what the arguments *mean* is the tool's business,
 * and a gateway that parsed them would be ruling on a malformed request it cannot interpret. An
 * empty string is a tool that takes none, which is what a provider sends for a parameterless call.
 */
function parseArguments(argumentsJson: string): ParsedArguments {
  const raw = argumentsJson.trim()
  if (raw === '') return { status: 'ok', value: {} }
  try {
    return { status: 'ok', value: JSON.parse(raw) }
  } catch {
    return { status: 'invalid', message: 'its arguments were not valid JSON.' }
  }
}

/**
 * `get_allocation`'s two arguments, validated against the same list the schema advertises.
 *
 * A dimension outside the enum falls back to `position` rather than failing the call, and the reason
 * is DDR-0022's: the recoveries differ. A missing or unknown dimension is a model that has not read
 * the schema, and the largest positions are the answer to the widest range of questions it could
 * have meant — while a *free-form* dimension is not something to guess at, because there is no
 * sixth breakdown for it to have wanted. Both land in the same place because there is only one
 * place to land.
 */
function allocationArguments(args: unknown): { dimension: AllocationDimension; limit: number | null } {
  const record = argumentRecord(args)
  const dimension = ALLOCATION_DIMENSIONS.find((candidate) => candidate === record['dimension'])
  const limit = typeof record['limit'] === 'number' ? record['limit'] : null
  return { dimension: dimension ?? 'position', limit }
}

/**
 * The period key as the model wrote it, passed through **unvalidated and unaltered** (Story #327).
 *
 * The opposite of {@link allocationArguments}' fallback, and deliberately: a dimension outside the
 * enum is a model that has not read a schema listing five fixed names, where a period key is a
 * question about a *window* and the honest answers are two — the app computed it, or it did not. A
 * fallback here would answer about a period nobody asked for, which is the substitution DDR-0102's
 * precomputed set exists to make impossible.
 *
 * So a missing or non-string key becomes the empty string and takes the same route as `2024-03-01..
 * 2024-06-15`: `period_not_available`, naming what was asked for and listing every key that exists.
 * There is no trimming, no case folding and no nearest match — every one of those turns *"this app
 * does not hold that window"* into a right-looking figure under the wrong heading.
 */
function periodArgument(args: unknown): string {
  const value = argumentRecord(args)['period']
  return typeof value === 'string' ? value : ''
}

/**
 * Which series `get_portfolio_history` was asked for; `value` where the model named neither.
 *
 * A fallback is right here where it is wrong for a period, and the difference is what an unreadable
 * argument *means*: the enum has two fixed members the schema advertises in full, so an unknown one
 * is a model that did not read it rather than a question about something the app cannot answer. The
 * portfolio's value is the series a question about "history" almost always means, and the report
 * names the series it returned in its own heading — so a wrong guess is visible rather than silent.
 */
function seriesArgument(args: unknown): HistorySeries {
  const value = argumentRecord(args)['series']
  return HISTORY_SERIES.find((candidate) => candidate === value) ?? 'value'
}

/** Whatever the model sent, as something with keys. A non-object carries no arguments. */
function argumentRecord(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {}
}

/**
 * The live overview, with the gateway's two typed errors turned into the states they mean.
 *
 * `IbkrTimeoutError` is **not** a subclass of `IbkrNotConnectedError` and the two are not
 * interchangeable (DDR-0022): one means start the gateway, the other means it is running and
 * stalled. The order of the branches is load-bearing for exactly that reason and mirrors the IPC
 * handlers', which are the other place this mapping is written.
 */
async function liveOverview(displayCurrency: string): Promise<LivePortfolioResult> {
  try {
    return {
      status: 'ok',
      overview: await portfolioService.getOverview(displayCurrency),
      displayCurrency,
      readAt: Date.now(),
    }
  } catch (err) {
    if (err instanceof IbkrTimeoutError) return { status: 'not_responding', message: err.message }
    if (err instanceof IbkrNotConnectedError) return { status: 'not_connected', message: err.message }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Unexpected error reading the portfolio.',
    }
  }
}

/** The same mapping for the drift read, which is built on the same live overview. */
async function liveDrift(displayCurrency: string): Promise<BalanceDriftResult> {
  try {
    return await balanceDriftService.getBalanceDrift(displayCurrency)
  } catch (err) {
    if (err instanceof IbkrTimeoutError) return { status: 'not_responding', message: err.message }
    if (err instanceof IbkrNotConnectedError) return { status: 'not_connected', message: err.message }
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Unexpected error measuring drift.',
    }
  }
}

/**
 * Every category the registry declares, unfiltered — the input to the bound, never the bound itself.
 *
 * Deliberately **not** narrowed to the declared list here: filtering would turn an undeclared
 * category into a silent omission, which is the shape of guard this codebase keeps refusing.
 * `assistantTools.test.ts` asserts this is a subset of `DISCLOSURE_CATEGORY_IDS`, so a tool
 * inventing a category fails there instead of disappearing.
 */
export const DECLARED_TOOL_CATEGORIES: readonly DisclosureCategoryId[] = [
  ...new Set(ASSISTANT_TOOLS.flatMap((tool) => tool.categories)),
]
