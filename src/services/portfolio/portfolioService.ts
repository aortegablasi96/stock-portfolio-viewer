import { classificationRepository } from '@repositories/classification/classificationRepository'
import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import {
  portfolioRepository,
  type CashBalance,
} from '@repositories/portfolio/portfolioRepository'
import { holdingName } from '@shared/format'
import type {
  AccountBalances,
  AllocationSlice,
  Holding,
  PortfolioOverview,
} from '@shared/domain/portfolio'

/**
 * Cash in one currency, valued in a display currency on a holding's terms (Story #281).
 *
 * `displayValue === null` means **unconvertible, not zero** — the rule DDR-0007 states for a
 * holding, and the reason this shape exists rather than a bare converted number.
 */
export interface CashPosition extends CashBalance {
  displayValue: number | null
}

/**
 * One held position, measured the way the live book measures every other one (Story #328).
 *
 * **No amount of money, and that is the shape rather than an omission.** The assistant's
 * `get_position` is declared under `holdings` and `weights` — names and percentages — so what a
 * position is *worth* is not in a category this app discloses (DDR-0098). What is here instead is
 * the two percentages that answer the questions money would have: how much of the book it is, and
 * how it has done against what it cost.
 */
export interface PositionDetail {
  /** The identity everything resolved to. A ticker is an input; this is the key (DDR-0088). */
  conid: number
  symbol: string
  /**
   * The instrument's name, or `null` where local history knows none.
   *
   * Resolved through `holdingName` — imported Flex `companyName` first, the gateway's own
   * `description` second — so a description that merely repeats the ticker comes back `null` rather
   * than as a name (DDR-0066, DDR-0088). Never `formatCompanyName`, which title-cases `CAD` to
   * `Cad` and would turn an identifier into a company that does not exist (DDR-0067).
   */
  name: string | null
  currency: string
  /** The cached sector, or `null` where the local classification cache holds none (DDR-0009). */
  sector: string | null
  /**
   * This position's share of the value of the holdings that could be valued, in percent.
   *
   * `null` where **this** holding is one of the ones that could not be valued — DDR-0007's rule
   * exactly: unconvertible is *unplaced*, not zero, and there is no rate with which to compute a
   * percentage for it (Bug #68).
   */
  weight: number | null
  /**
   * The position's unrealized gain or loss as a percentage of what it cost.
   *
   * Both halves are DDR-0087's traps. The numerator is **IBKR's own `unrealizedPnl`** rather than
   * one derived from price minus cost, and the denominator treats **`averageCost` as per share** and
   * multiplies by the quantity held — read as a position total it would scale every row by its own
   * size and still look plausible.
   *
   * It is a ratio of two figures in the position's *native* currency, so it needs no exchange rate
   * and exists even for a holding that could not be valued. `null` where the gateway reported no
   * unrealized figure, no average cost, or a zero cost basis — absent, never zero.
   */
  gainOnCostPercent: number | null
  /**
   * Whether some **other** holding could not be valued, which makes {@link weight} a lower bound.
   *
   * The same qualification the concentration ceiling carries for the same reason: the denominator is
   * missing whatever those holdings are worth, so this share is at most what it says (Bug #68).
   */
  bounded: boolean
}

/** One of several holdings a query matched: identity only, never a figure. */
export interface PositionCandidate {
  conid: number
  symbol: string
  name: string | null
}

/**
 * What a lookup came to — **the resolution rule's outcomes, named in the service** (DDR-0111).
 *
 * `ambiguous` and `not_held` are business rules and live here rather than in the tool layer, which
 * is the layer least covered by the tests that make ADR-0009's grounding rule true. The gateway's
 * own failures are **not** in this union: `getOverview` throws them and the caller maps them, which
 * is where `IbkrTimeoutError` and `IbkrNotConnectedError` stay apart (DDR-0022).
 */
export type PositionLookup =
  | { status: 'ok'; query: string; position: PositionDetail }
  | { status: 'ambiguous'; query: string; candidates: PositionCandidate[] }
  | { status: 'not_held'; query: string; heldPositions: number }

/** A holding beside the name it resolves to, so a match is made against the name a view draws. */
interface NamedHolding {
  holding: Holding
  name: string | null
}

/**
 * Which holdings a query names, in tiers — **exact before partial, and identity before either**.
 *
 * The tiers are what keeps *ambiguous* meaningful. `CAD` is a bare currency identifier IBKR writes
 * where an instrument has no name (DDR-0066), and it is also a substring of half a dozen Canadian
 * companies: matched flat, a ticker the owner typed exactly would come back ambiguous against names
 * that merely contain it. So the first tier that matches anything wins, and the tiers below it are
 * never consulted.
 *
 * A one-character query resolves **only** as an exact ticker. Below that length a substring is a
 * near-universal match, which would report an ambiguity between everything the owner holds — a
 * state so wide it says nothing.
 *
 * Nothing here folds a *near* match: no trimming to a prefix, no edit distance, no "did you mean".
 * Two holdings whose names differ by a letter are two instruments, and choosing between them is the
 * best-guess this story exists to refuse.
 */
function matchHoldings(query: string, holdings: readonly NamedHolding[]): NamedHolding[] {
  const needle = query.trim().toUpperCase()
  if (needle === '') return []

  // The conid itself, which is what every other tier resolves *to*. A model that read a previous
  // report has it, and it is the one input that cannot be ambiguous.
  const byConid = holdings.filter((entry) => String(entry.holding.conid) === needle)
  if (byConid.length > 0) return byConid

  const bySymbol = holdings.filter((entry) => entry.holding.symbol.trim().toUpperCase() === needle)
  if (bySymbol.length > 0) return bySymbol

  const byName = holdings.filter((entry) => namesOf(entry).includes(needle))
  if (byName.length > 0) return byName

  if (needle.length < 2) return []
  return holdings.filter(
    (entry) =>
      entry.holding.symbol.toUpperCase().includes(needle) ||
      namesOf(entry).some((name) => name.includes(needle)),
  )
}

/**
 * Every string this holding is legitimately called, upper-cased for comparison.
 *
 * Two of them, because the shortened name and the exported one are both things an owner types:
 * `holdingName` gives `Interactive Brokers`, while the Flex export says
 * `INTERACTIVE BROKERS GROUP INC` and a question may quote either. The gateway's raw `description`
 * is deliberately **not** a third — on this build it repeats the ticker, which the symbol tier
 * already matched (DDR-0066, DDR-0087).
 */
function namesOf({ holding, name }: NamedHolding): string[] {
  const names: string[] = []
  if (name !== null) names.push(name.toUpperCase())
  const exported = holding.companyName?.trim().toUpperCase()
  if (exported !== undefined && exported !== '') names.push(exported)
  return names
}

/**
 * A holding's value in the display currency, or `null` where no rate was available.
 *
 * `undefined` is the *native* overview, which has no conversion to have failed; `null` is a
 * conversion that could not be made. The two mean different things and only the second is unplaced
 * (DDR-0007).
 */
function displayValueOf(holding: Holding): number | null {
  return holding.displayValue === undefined ? holding.marketValue : holding.displayValue
}

/** IBKR's own unrealized figure over the cost of the position, in percent (DDR-0087). */
function gainOnCost(holding: Holding): number | null {
  if (holding.unrealizedPnl === null || holding.averageCost === null) return null
  const costBasis = Math.abs(holding.averageCost * holding.quantity)
  if (!Number.isFinite(costBasis) || costBasis === 0) return null
  return (holding.unrealizedPnl / costBasis) * 100
}

/**
 * Portfolio business logic for the read-only dashboard (Milestone M1, refined in M3
 * Story #28). The service orchestrates the repository and owns the calculations — total
 * market value, allocation weights, and (optionally) display-currency conversion — that
 * turn raw holdings into the overview the UI renders.
 *
 * It is framework-agnostic (no Electron/IPC/React) and reaches data only through the
 * repository, so it is the primary unit-test target (repository mocked). Connection
 * failures raised by the repository propagate as typed errors; the IPC handler maps
 * them to the renderer's `not_connected` / `error` states.
 */

/**
 * Give each holding the instrument name imported Flex history knows it by (Story #263 follow-up).
 *
 * The live gateway has no name to give: this build sends no `ticker`, so a position's
 * `description` is `contractDesc` — the symbol again (DDR-0066). The imported `SecurityInfo`
 * rows do have one, and every position the owner holds has been traded, so the join is a **local
 * read of history the app already stores**, not a request. It costs one query per overview and
 * cannot fail the view: with nothing imported the index is empty and every name is `null`.
 *
 * Resolved **by conid, falling back to symbol** — the same resolver the dividend tables use, for
 * the same reason: a conid is stable where a ticker is not (`NWL` and `NWLm` are one instrument on
 * two listings, and this account holds it under a third symbol live). The raw exported string is
 * carried through; shortening happens once, in the renderer, through `instrumentName`.
 */
function nameHoldings(holdings: Holding[]): Holding[] {
  const byConid = new Map<number, string>()
  const bySymbol = new Map<string, string>()
  for (const n of flexReadRepository.getInstrumentNames()) {
    if (n.description === '') continue
    if (n.conid != null && !byConid.has(n.conid)) byConid.set(n.conid, n.description)
    if (n.symbol !== '' && !bySymbol.has(n.symbol)) bySymbol.set(n.symbol, n.description)
  }
  if (byConid.size === 0 && bySymbol.size === 0) return holdings
  return holdings.map((h) => ({
    ...h,
    companyName: byConid.get(h.conid) ?? bySymbol.get(h.symbol) ?? null,
  }))
}

/** Round a money amount to cents, so displayed per-position values sum exactly to the total. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Each holding's share of the total holdings market value; empty when there is nothing to weight. */
function computeAllocation(holdings: Holding[], totalMarketValue: number): AllocationSlice[] {
  if (totalMarketValue <= 0) return []
  return holdings.map((h) => ({
    conid: h.conid,
    symbol: h.symbol,
    marketValue: h.marketValue,
    weight: h.marketValue / totalMarketValue,
  }))
}

/**
 * Allocation over the *converted* values (Story #28). Positions that could not be
 * converted (`displayValue === null`) are excluded — they contribute no weight and are
 * absent from the total — so the remaining weights sum to 1.
 */
function computeDisplayAllocation(
  holdings: Holding[],
  totalMarketValue: number,
): AllocationSlice[] {
  if (totalMarketValue <= 0) return []
  return holdings
    .filter((h) => h.displayValue != null)
    .map((h) => ({
      conid: h.conid,
      symbol: h.symbol,
      marketValue: h.displayValue as number,
      weight: (h.displayValue as number) / totalMarketValue,
    }))
}

/** Convert the base-currency balances into `target`; left native if its rate is unavailable. */
function convertBalances(
  balances: AccountBalances,
  rates: Record<string, number>,
  target: string,
): AccountBalances {
  const rate = rates[balances.currency]
  if (rate === undefined) return balances
  return {
    currency: target,
    totalCashValue: round2(balances.totalCashValue * rate),
    netLiquidation: round2(balances.netLiquidation * rate),
    stockMarketValue: round2(balances.stockMarketValue * rate),
  }
}

export const portfolioService = {
  /**
   * Assemble the current read-only portfolio overview: holdings, balances, and allocation.
   *
   * When `displayCurrency` is omitted the overview is returned in each position's **native**
   * currency (the original M1 behaviour, and the shape the snapshot capture path persists).
   * When a `displayCurrency` is given, every holding's market value, the total, the
   * allocation, and the balances are converted into it using live FX rates from the
   * repository; per-position native amounts are retained and positions with no available
   * rate are flagged (`displayValue === null`) and excluded from the converted total. See
   * DDR-0007.
   */
  async getOverview(displayCurrency?: string): Promise<PortfolioOverview> {
    const [rawHoldings, balances] = await Promise.all([
      portfolioRepository.getHoldings(),
      portfolioRepository.getBalances(),
    ])
    // Both branches, so the view is named whichever one it took. The snapshot capture path reads
    // the native branch and simply ignores the field — `toHoldingValues` persists what a position
    // was worth, and a name is not that.
    const holdings = nameHoldings(rawHoldings)

    if (!displayCurrency) {
      const totalMarketValue = holdings.reduce((sum, h) => sum + h.marketValue, 0)
      const allocation = computeAllocation(holdings, totalMarketValue)
      return { holdings, balances, allocation, totalMarketValue }
    }

    const rates = await portfolioRepository.getExchangeRates(
      [...holdings.map((h) => h.currency), balances.currency],
      displayCurrency,
    )

    const convertedHoldings: Holding[] = holdings.map((h) => {
      const rate = rates[h.currency]
      return {
        ...h,
        displayValue: rate === undefined ? null : round2(h.marketValue * rate),
        // A gain is an amount and converts, unlike the price and average cost beside it, which
        // stay native because a quote is a native-currency fact (DDR-0007). Same rate, so the
        // column agrees with the Market value beside it; `null` where either the rate or the
        // native figure is missing, which is what the table draws an em dash for (Story #263).
        displayUnrealizedPnl:
          rate === undefined || h.unrealizedPnl === null ? null : round2(h.unrealizedPnl * rate),
      }
    })

    const totalMarketValue = convertedHoldings.reduce((sum, h) => sum + (h.displayValue ?? 0), 0)
    const allocation = computeDisplayAllocation(convertedHoldings, totalMarketValue)
    const convertedBalances = convertBalances(balances, rates, displayCurrency)

    return {
      holdings: convertedHoldings,
      balances: convertedBalances,
      allocation,
      totalMarketValue: round2(totalMarketValue),
      displayCurrency,
    }
  },

  /**
   * One held position, resolved from whatever the owner called it (Story #328, DDR-0111).
   *
   * **The method exists because the tool needed it, which is the expensive route on purpose.** There
   * was no per-position read before this: `getOverview` returns the whole book, so the assistant's
   * `get_position` would have been a projection performed in the tool layer — a filter over a
   * report, and the closest thing in Epic #322 to the general query ADR-0009 forbids. DDR-0111's
   * rule is that where no service method exists, **the method is added**, so the resolution rule and
   * its two named states are here, tested where the rest of the app's business rules are tested.
   *
   * **The key is the conid, and a ticker or a name is an input to be resolved into one** (DDR-0088).
   * This build sends no `ticker`, so a live row's `symbol` *and* `description` both fall back to
   * `contractDesc`, and a description that repeats the symbol is not a name (DDR-0066) — so a string
   * match is a resolution step with its own outcomes rather than a lookup.
   *
   * **It reaches every position, and that is the story.** The reports cap their lists at
   * `MAX_LISTED_POSITIONS` largest-first, which made the 41st holding invisible to the assistant
   * however it was asked about. Nothing here truncates: a position is found by identity or it is not
   * held, and where it ranks by size has no bearing on either.
   *
   * It reuses the overview rather than re-reading the gateway — the repository's cache coalesces
   * both into one round trip (DDR-0024) — so the weight it returns is a share of exactly the
   * denominator the live holdings report uses: the holdings that could be valued, cash excluded.
   */
  async getPosition(query: string, displayCurrency: string): Promise<PositionLookup> {
    const overview = await portfolioService.getOverview(displayCurrency)
    const named: NamedHolding[] = overview.holdings.map((holding) => ({
      holding,
      name: holdingName(holding.symbol, holding.description, holding.companyName),
    }))

    // Largest first wherever a list of them is shown, as everything else in this app is; a holding
    // that could not be valued sorts last rather than as nothing.
    const matches = matchHoldings(query, named).sort(
      (a, b) => (displayValueOf(b.holding) ?? -Infinity) - (displayValueOf(a.holding) ?? -Infinity),
    )

    if (matches.length === 0) {
      return { status: 'not_held', query, heldPositions: overview.holdings.length }
    }
    if (matches.length > 1) {
      return {
        status: 'ambiguous',
        query,
        candidates: matches.map(({ holding, name }) => ({
          conid: holding.conid,
          symbol: holding.symbol,
          name,
        })),
      }
    }

    const { holding, name } = matches[0] as NamedHolding
    const own = displayValueOf(holding)
    // The same total the overview weighs against, computed the same way: unconvertible holdings are
    // absent from it rather than counted at face value (DDR-0007).
    const total = overview.holdings.reduce((sum, other) => sum + (displayValueOf(other) ?? 0), 0)
    const sector = classificationRepository
      .getAll()
      .find((row) => row.conid === holding.conid)?.sector

    return {
      // Carried on every variant, `ok` included: the report quotes what was asked for beside what it
      // resolved to, so an owner reading the answer can see that "apple" became AAPL rather than
      // having to trust that it did.
      status: 'ok',
      query,
      position: {
        conid: holding.conid,
        symbol: holding.symbol,
        name,
        currency: holding.currency,
        sector: sector === undefined || sector === '' ? null : sector,
        weight: own === null || total <= 0 ? null : (own / total) * 100,
        gainOnCostPercent: gainOnCost(holding),
        bounded: overview.holdings.some(
          (other) => other.conid !== holding.conid && displayValueOf(other) === null,
        ),
      },
    }
  },

  /**
   * Cash per currency, each valued in `displayCurrency` on the same terms as a holding
   * (Story #281, DDR-0095).
   *
   * `getOverview` reports cash as the one base-currency total the dashboard's tile shows. A
   * currency-exposure question is the one place that is the wrong shape: the total is the
   * base-currency *equivalent* of cash held across several currencies, so attributing it to the
   * base currency would invent an exposure the owner may not have.
   *
   * `displayValue` follows DDR-0007 exactly, which is the whole reason this lives here rather
   * than in the repository: an unavailable rate is `null` — **unconvertible, not zero** — so a
   * cash balance the gateway could not price leaves every total instead of quietly landing in
   * one at face value. Native `amount` is retained beside it, as a holding's is.
   *
   * It reuses the ledger read `getOverview` already made and the rates it already fetched, both
   * coalesced by the repository's cache, so calling both costs one gateway round trip (DDR-0024).
   */
  async getCashPositions(displayCurrency: string): Promise<CashPosition[]> {
    const cash = await portfolioRepository.getCashByCurrency()
    if (cash.length === 0) return []

    const rates = await portfolioRepository.getExchangeRates(
      cash.map((c) => c.currency),
      displayCurrency,
    )
    return cash.map((c) => {
      const rate = rates[c.currency]
      return {
        ...c,
        displayValue: rate === undefined ? null : round2(c.amount * rate),
      }
    })
  },

  /**
   * Live gateway FX rates converting each of `currencies` into `target`, as a `source → rate`
   * map (`target` maps to `1`; unavailable pairs are omitted). Exposed so other services can
   * apply the *same* live-FX convention as the Portfolio view (Bug #44: converting stored
   * snapshot totals for the history section). A thin pass-through to the repository — a
   * disconnected gateway still propagates `IbkrNotConnectedError`. See DDR-0007.
   */
  async getExchangeRates(
    currencies: readonly string[],
    target: string,
  ): Promise<Record<string, number>> {
    return portfolioRepository.getExchangeRates(currencies, target)
  },
}
