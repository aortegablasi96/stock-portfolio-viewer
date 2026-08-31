import { describe, it, expect, vi, beforeEach } from 'vitest'
import { balanceDriftService } from './balanceDriftService'
import { investorProfileService } from './investorProfileService'
import { portfolioService, type CashPosition } from '@services/portfolio/portfolioService'
import { classificationRepository } from '@repositories/classification/classificationRepository'
import { flexReadRepository } from '@repositories/flex/flexReadRepository'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'
import {
  EMPTY_INVESTOR_PROFILE,
  type InvestorProfile,
} from '@shared/domain/investorProfileTerms'
import type { BalanceDriftReport, DimensionDrift } from '@shared/domain/balanceDrift'
import { BASELINE_CEILINGS, BASELINE_CHECKS } from '@shared/domain/portfolioBaseline'
import type { Holding, PortfolioOverview } from '@shared/domain/portfolio'

/**
 * Balance drift (Story #281, DDR-0095).
 *
 * **This is the most consequential test file in Epic #5**, because it is the guarantee that no
 * model ever does this arithmetic. Everything the assistant will later say about balance is a
 * number computed here and phrased there, so a wrong number here is a wrong answer that reads
 * exactly like a right one.
 *
 * Four traps the story names have each shipped broken in this codebase before, and each has its
 * own block below: an unconvertible holding read as zero (DDR-0007), an unclassified instrument
 * redistributed rather than surfaced (DDR-0009, DDR-0052), cash attributed to a currency it may
 * not be in, and a residual quietly rescaled away. The sum invariant at the end is what would
 * catch a fifth nobody thought of.
 */

vi.mock('@services/profile/investorProfileService', () => ({
  investorProfileService: { get: vi.fn() },
}))
vi.mock('@services/portfolio/portfolioService', () => ({
  portfolioService: { getOverview: vi.fn(), getCashPositions: vi.fn() },
}))
vi.mock('@repositories/classification/classificationRepository', () => ({
  classificationRepository: { getAll: vi.fn() },
}))
vi.mock('@repositories/flex/flexReadRepository', () => ({
  flexReadRepository: { getInstrumentAssetClasses: vi.fn() },
}))

const mockProfile = vi.mocked(investorProfileService)
const mockPortfolio = vi.mocked(portfolioService)
const mockClassifications = vi.mocked(classificationRepository)
const mockFlex = vi.mocked(flexReadRepository)

const NOW = 1_756_000_000_000

// ---- fixtures ---------------------------------------------------------------

/**
 * The known fixture the sums are checked against, end to end.
 *
 * Four instruments and two cash balances, priced so the weights are exact and hand-checkable:
 * 40 + 25 + 15 + 10 in holdings, 8 + 2 in cash — **100 in total**, so every weight below is also
 * its own value. Deliberately chosen: a fixture that needs a calculator to verify is a fixture
 * whose expectations get copied from a failing run.
 */
const holding = (over: Partial<Holding> & Pick<Holding, 'conid' | 'symbol'>): Holding => ({
  description: over.symbol,
  companyName: null,
  quantity: 1,
  averageCost: null,
  marketPrice: null,
  marketValue: over.displayValue ?? 0,
  unrealizedPnl: null,
  currency: 'EUR',
  ...over,
})

const HOLDINGS: Holding[] = [
  holding({ conid: 1, symbol: 'AAA', currency: 'USD', displayValue: 40, marketValue: 44 }),
  holding({ conid: 2, symbol: 'BBB', currency: 'EUR', displayValue: 25, marketValue: 25 }),
  holding({ conid: 3, symbol: 'CCC', currency: 'USD', displayValue: 15, marketValue: 16 }),
  holding({ conid: 4, symbol: 'DDD', currency: 'GBP', displayValue: 10, marketValue: 9 }),
]

const CASH: CashPosition[] = [
  { currency: 'EUR', amount: 8, displayValue: 8 },
  { currency: 'USD', amount: 2.2, displayValue: 2 },
]

const CLASSIFICATIONS = [
  { conid: 1, symbol: 'AAA', sector: 'Technology', industry: '', fetchedAt: NOW },
  { conid: 2, symbol: 'BBB', sector: 'Financial', industry: '', fetchedAt: NOW },
  { conid: 3, symbol: 'CCC', sector: 'Technology', industry: '', fetchedAt: NOW },
  // conid 4 is deliberately absent: the classification refresh is resumable, not transactional,
  // so a run that died part-way leaves exactly this state (DDR-0009, DDR-0023).
]

const ASSET_CLASSES = [
  { conid: 1, symbol: 'AAA', assetCategory: 'STK' },
  { conid: 2, symbol: 'BBB', assetCategory: 'STK' },
  { conid: 3, symbol: 'CCC', assetCategory: 'ETF' },
  { conid: 4, symbol: 'DDD', assetCategory: 'STK' },
]

const overview = (holdings: Holding[]): PortfolioOverview => ({
  holdings,
  balances: {
    currency: 'EUR',
    totalCashValue: 10,
    netLiquidation: 100,
    stockMarketValue: 90,
  },
  allocation: [],
  totalMarketValue: 90,
  displayCurrency: 'EUR',
})

const profile = (over: Partial<InvestorProfile> = {}): InvestorProfile => ({
  ...EMPTY_INVESTOR_PROFILE,
  ...over,
})

/** Arrange the whole world; each test overrides only what it is about. */
function given(
  over: {
    profile?: InvestorProfile
    holdings?: Holding[]
    cash?: CashPosition[]
    classifications?: typeof CLASSIFICATIONS
    assetClasses?: typeof ASSET_CLASSES
  } = {},
): void {
  mockProfile.get.mockReturnValue(over.profile ?? profile({ styleTags: ['dividend_income'] }))
  mockPortfolio.getOverview.mockResolvedValue(overview(over.holdings ?? HOLDINGS))
  mockPortfolio.getCashPositions.mockResolvedValue(over.cash ?? CASH)
  mockClassifications.getAll.mockReturnValue(over.classifications ?? CLASSIFICATIONS)
  mockFlex.getInstrumentAssetClasses.mockReturnValue(over.assetClasses ?? ASSET_CLASSES)
}

/** The report, or a thrown failure naming the variant that came back instead. */
async function report(): Promise<BalanceDriftReport> {
  const result = await balanceDriftService.getBalanceDrift('EUR', NOW)
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
  return result.report
}

const dimension = (r: BalanceDriftReport, name: DimensionDrift['dimension']): DimensionDrift => {
  const found = r.dimensions.find((d) => d.dimension === name)
  if (!found) throw new Error(`no ${name} dimension in the report`)
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---- the states that are not a report ---------------------------------------

describe('what comes back when there is nothing to measure', () => {
  /**
   * `no_profile` and `no_targets` are gone (Story #315, ADR-0012), and this asserts the reversal.
   *
   * They short-circuited *before the portfolio was read*, which is exactly the case the app's
   * baseline exists for: an owner who has written nothing still has a portfolio with a shape, and
   * refusing to read it is refusing to answer the question the story is about. What they carried is
   * not lost - the profile itself sits beside this report in the assembled context, so "they have
   * not set one" is still sayable, from the profile rather than from the absence of a measurement.
   */
  it('measures an unwritten profile rather than refusing to look at the portfolio', async () => {
    given({ profile: EMPTY_INVESTOR_PROFILE })
    const empty = await balanceDriftService.getBalanceDrift('EUR', NOW)

    expect(empty.status).toBe('ok')
    if (empty.status !== 'ok') return
    // Nothing of the owner's to be inside or outside, said as `null` rather than as a vacuous
    // `true` - which is the sentence a model would phrase as "your portfolio is balanced".
    expect(empty.report.balanced).toBeNull()
    expect(empty.report.dimensions).toEqual([])
    expect(empty.report.baseline.applied).toEqual([...BASELINE_CHECKS])
    expect(empty.report.baseline.deferred).toEqual([])

    given({ profile: profile({ styleTags: ['dividend_income'] }) })
    const tagsOnly = await balanceDriftService.getBalanceDrift('EUR', NOW)

    // Style tags are not targets, so the baseline still covers everything: a tag is a description
    // of an intent, and there is nothing in one to measure a weight against.
    expect(tagsOnly.status).toBe('ok')
    if (tagsOnly.status !== 'ok') return
    expect(tagsOnly.report.balanced).toBeNull()
    expect(tagsOnly.report.baseline.applied).toEqual([...BASELINE_CHECKS])
  })

  it('reports no data for an account holding nothing', async () => {
    given({
      profile: profile({ currencyTargets: [{ key: 'EUR', low: 40, high: 60 }] }),
      holdings: [],
      cash: [],
    })
    expect((await balanceDriftService.getBalanceDrift('EUR', NOW)).status).toBe('no_data')
  })

  /**
   * With no rate for anything there is no denominator, so there are no weights to report. The
   * Portfolio view is where the unconverted rows are already shown.
   */
  it('reports no data when nothing at all could be valued in the display currency', async () => {
    given({
      profile: profile({ currencyTargets: [{ key: 'EUR', low: 40, high: 60 }] }),
      holdings: HOLDINGS.map((h) => ({ ...h, displayValue: null })),
      cash: CASH.map((c) => ({ ...c, displayValue: null })),
    })
    expect((await balanceDriftService.getBalanceDrift('EUR', NOW)).status).toBe('no_data')
  })

  /** No model is reachable from here, and nothing about this computation is asynchronous magic. */
  it('never consults anything but the profile, the live read and two local caches', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'EUR', low: 0, high: 100 }] }) })
    await report()

    expect(mockPortfolio.getOverview).toHaveBeenCalledWith('EUR')
    expect(mockPortfolio.getCashPositions).toHaveBeenCalledWith('EUR')
    expect(mockClassifications.getAll).toHaveBeenCalledTimes(1)
    expect(mockFlex.getInstrumentAssetClasses).toHaveBeenCalledTimes(1)
  })
})

// ---- the four dimensions ----------------------------------------------------

describe('currency exposure', () => {
  /**
   * The fixture sums to 100, so a weight is also its own value: USD is 40 + 15 in holdings plus 2
   * in cash, EUR is 25 plus 8.
   */
  it('weighs holdings and cash together, because a currency policy is about the whole portfolio', async () => {
    given({
      profile: profile({
        currencyTargets: [
          { key: 'USD', low: 40, high: 50 },
          { key: 'EUR', low: 40, high: 60 },
        ],
      }),
    })
    const currency = dimension(await report(), 'currency')

    expect(currency.bands.find((b) => b.key === 'USD')?.actual).toBeCloseTo(57, 6)
    expect(currency.bands.find((b) => b.key === 'EUR')?.actual).toBeCloseTo(33, 6)
    expect(currency.untargeted).toBeCloseTo(10, 6) // GBP, which carries no target
    expect(currency.residuals).toEqual([])
  })

  /**
   * The trap this dimension exists to avoid. `getBalances` reports cash as one base-currency
   * total — the base-currency *equivalent* of money held across several currencies — so
   * attributing it to the base currency would invent an exposure the owner may not have. Here
   * EUR cash is 8 and USD cash is 2; reading both as EUR would put EUR at 35 and USD at 55.
   */
  it('attributes cash to the currency it is actually in, never to the base currency', async () => {
    given({
      profile: profile({
        currencyTargets: [
          { key: 'USD', low: 0, high: 100 },
          { key: 'EUR', low: 0, high: 100 },
        ],
      }),
    })
    const currency = dimension(await report(), 'currency')

    expect(currency.bands.find((b) => b.key === 'USD')?.actual).toBeCloseTo(57, 6)
    expect(currency.bands.find((b) => b.key === 'EUR')?.actual).toBeCloseTo(33, 6)
  })

  /** A target the owner typed as `usd` names the same exposure as a bucket keyed `USD` (DDR-0094). */
  it('matches a target to its bucket case-insensitively', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'usd', low: 0, high: 100 }] }) })
    const currency = dimension(await report(), 'currency')

    expect(currency.bands[0]!.actual).toBeCloseTo(57, 6)
    expect(currency.bands[0]!.key).toBe('usd')
  })
})

describe('sector weight', () => {
  it('weighs by the sector the local cache knows', async () => {
    given({
      profile: profile({
        sectorTargets: [
          { key: 'Technology', low: 40, high: 60 },
          { key: 'Financial', low: 20, high: 30 },
        ],
      }),
    })
    const sector = dimension(await report(), 'sector')

    expect(sector.bands.find((b) => b.key === 'Technology')?.actual).toBeCloseTo(55, 6)
    expect(sector.bands.find((b) => b.key === 'Financial')?.actual).toBeCloseTo(25, 6)
  })

  /**
   * The classification refresh is **resumable, not transactional** (DDR-0009, DDR-0023): a run
   * that died at 30 of 40 leaves 29 classified. DDD's 10% must appear as its own surfaced
   * quantity, never spread across Technology and Financial — drop it into a bucket and nothing
   * will look wrong (DDR-0052).
   */
  it('surfaces an unclassified holding rather than redistributing it', async () => {
    given({ profile: profile({ sectorTargets: [{ key: 'Technology', low: 40, high: 60 }] }) })
    const sector = dimension(await report(), 'sector')

    const unclassified = sector.residuals.find((r) => r.kind === 'unclassified')
    expect(unclassified?.weight).toBeCloseTo(10, 6)
    expect(sector.bands[0]!.actual).toBeCloseTo(55, 6)
  })

  /** Money has no sector. It is a residual here and a bucket in the other two dimensions. */
  it('surfaces cash as its own residual, because money has no sector', async () => {
    given({ profile: profile({ sectorTargets: [{ key: 'Technology', low: 0, high: 100 }] }) })
    const sector = dimension(await report(), 'sector')

    expect(sector.residuals.find((r) => r.kind === 'cash')?.weight).toBeCloseTo(10, 6)
  })

  /** Conid first, symbol second — a conid is stable where a ticker is not (DDR-0088). */
  it('falls back to the symbol when the cache has no conid for the instrument', async () => {
    given({
      profile: profile({ sectorTargets: [{ key: 'Utilities', low: 0, high: 100 }] }),
      classifications: [
        { conid: 999, symbol: 'DDD', sector: 'Utilities', industry: '', fetchedAt: NOW },
      ],
    })
    const sector = dimension(await report(), 'sector')

    expect(sector.bands[0]!.actual).toBeCloseTo(10, 6)
  })
})

describe('asset-class weight', () => {
  /**
   * The keys are IBKR's own codes because the profile's asset-class vocabulary comes from the
   * allocation report, which groups by exactly this field. A drift service deriving its own key
   * scheme would leave every stored target joining with nothing and reading as 0% — the failure
   * DDR-0094 named as one the owner cannot see.
   */
  it('buckets by the same codes the allocation report publishes', async () => {
    given({
      profile: profile({
        assetClassTargets: [
          { key: 'STK', low: 60, high: 80 },
          { key: 'ETF', low: 10, high: 20 },
        ],
      }),
    })
    const assetClass = dimension(await report(), 'assetClass')

    expect(assetClass.bands.find((b) => b.key === 'STK')?.actual).toBeCloseTo(75, 6)
    expect(assetClass.bands.find((b) => b.key === 'ETF')?.actual).toBeCloseTo(15, 6)
  })

  /**
   * Uninvested cash is an asset class, under the sentinel key the allocation report already uses
   * — so a target the owner set from that vocabulary joins with it. It must never merge with the
   * Flex `CASH` category, which is FX *positions*.
   */
  it('buckets uninvested cash under the allocation report’s own cash key', async () => {
    given({
      profile: profile({ assetClassTargets: [{ key: CASH_ASSET_KEY, low: 5, high: 15 }] }),
    })
    const assetClass = dimension(await report(), 'assetClass')

    expect(assetClass.bands[0]!.actual).toBeCloseTo(10, 6)
    expect(assetClass.bands[0]!.label).toBe('Cash')
    expect(assetClass.bands[0]!.status).toBe('inside')
  })

  /** An instrument bought since the last Flex import has no asset class, and is not a stock. */
  it('surfaces an instrument imported history has never seen', async () => {
    given({
      profile: profile({ assetClassTargets: [{ key: 'STK', low: 0, high: 100 }] }),
      assetClasses: ASSET_CLASSES.filter((a) => a.conid !== 4),
    })
    const assetClass = dimension(await report(), 'assetClass')

    expect(assetClass.residuals.find((r) => r.kind === 'unknown_asset_class')?.weight).toBeCloseTo(
      10,
      6,
    )
    expect(assetClass.bands[0]!.actual).toBeCloseTo(65, 6)
  })

  it('labels a known code and passes an unknown one through', async () => {
    given({
      profile: profile({ assetClassTargets: [{ key: 'STK', low: 0, high: 100 }] }),
    })
    const assetClass = dimension(await report(), 'assetClass')
    expect(assetClass.bands[0]!.label).toBe('Stocks')
  })
})

describe('the single-position ceiling', () => {
  it('measures the largest holding against the band', async () => {
    given({ profile: profile({ positionSize: { low: 0, high: 30 } }) })
    const r = await report()

    expect(r.position?.symbol).toBe('AAA')
    expect(r.position?.actual).toBeCloseTo(40, 6)
    expect(r.position?.status).toBe('above')
    expect(r.position?.distance).toBeCloseTo(10, 6)
  })

  /** Cash is not an instrument, so it cannot be the largest *position*. */
  it('never counts cash as a position', async () => {
    given({
      profile: profile({ positionSize: { low: 0, high: 100 } }),
      holdings: [holding({ conid: 1, symbol: 'AAA', displayValue: 5, marketValue: 5 })],
      cash: [{ currency: 'EUR', amount: 95, displayValue: 95 }],
    })
    const r = await report()

    expect(r.position?.symbol).toBe('AAA')
    expect(r.position?.actual).toBeCloseTo(5, 6)
  })

  /**
   * With something unplaced the figure is a **lower bound**: a larger holding may be hiding among
   * the positions that could not be valued. Reporting a bare number there is the quiet kind of
   * wrong this Epic exists to avoid.
   */
  it('reports the figure as bounded when a position could not be valued', async () => {
    given({
      profile: profile({ positionSize: { low: 0, high: 30 } }),
      holdings: [
        ...HOLDINGS.slice(0, 3),
        { ...HOLDINGS[3]!, displayValue: null },
      ],
    })
    const r = await report()

    expect(r.position?.bounded).toBe(true)
  })

  it('is bounded false when everything could be valued', async () => {
    given({ profile: profile({ positionSize: { low: 0, high: 100 } }) })
    expect((await report()).position?.bounded).toBe(false)
  })

  it('is absent when the profile states no ceiling', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'EUR', low: 0, high: 100 }] }) })
    expect((await report()).position).toBeNull()
  })
})

// ---- the rules that apply to every band -------------------------------------

describe('the verdict on a band', () => {
  const bandFor = async (low: number, high: number): Promise<{ status: string; distance: number }> => {
    given({ profile: profile({ currencyTargets: [{ key: 'GBP', low, high }] }) })
    const currency = dimension(await report(), 'currency')
    return currency.bands[0]!
  }

  // GBP is 10% of the fixture.
  it('reports inside with a distance of exactly zero', async () => {
    expect(await bandFor(5, 15)).toMatchObject({ status: 'inside', distance: 0 })
  })

  /** A range is closed: a target of 5–10 must not fault a portfolio sitting at exactly 10. */
  it.each([
    ['the low edge', 10, 20],
    ['the high edge', 0, 10],
  ])('counts %s as inside', async (_case, low, high) => {
    expect((await bandFor(low, high)).status).toBe('inside')
  })

  it('signs the distance negative below the range and positive above it', async () => {
    expect(await bandFor(25, 40)).toMatchObject({ status: 'below', distance: -15 })
    expect(await bandFor(2, 4)).toMatchObject({ status: 'above', distance: 6 })
  })

  /**
   * "I want 10% in utilities and hold none" is exactly the answer being asked for, so an unheld
   * target is a band at 0% rather than an absent one.
   */
  it('reports a target the portfolio does not hold as a real drift at zero', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'CHF', low: 5, high: 10 }] }) })
    const currency = dimension(await report(), 'currency')

    expect(currency.bands[0]).toMatchObject({
      key: 'CHF',
      actual: 0,
      status: 'below',
      distance: -5,
    })
  })
})

/**
 * The move that closes a band (Story #287, DDR-0103).
 *
 * `driftMoves.test.ts` has the arithmetic; what these assert is the **wiring**, which is the half
 * that can be silently wrong: that the positions handed to it are the ones actually in the band,
 * that cash is not one of them, that the owner's ceiling reaches it, and that a band inside its
 * range gets no move at all. A move sized over the wrong positions is a suggestion to sell
 * something the owner does not hold in the exposure being closed.
 */
describe('the move attached to a band', () => {
  it('is absent for a band already inside its range', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'GBP', low: 5, high: 15 }] }) })
    expect(dimension(await report(), 'currency').bands[0]!.move).toBeNull()
  })

  /**
   * USD is 57% of the fixture: AAA at 40, CCC at 15, and 2 of cash. Trimming seven points must
   * fall on the two instruments in proportion, and **not** on the cash — a currency band's weight
   * can be part cash, and cash is not a position anyone trims.
   */
  it('spreads a trim across the instruments in the band, never across its cash', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'USD', low: 40, high: 50 }] }) })
    const move = dimension(await report(), 'currency').bands[0]!.move

    expect(move).toMatchObject({ direction: 'trim', candidates: 2 })
    expect(move?.points).toBeCloseTo(7, 9)
    expect(move?.contributors.map((c) => c.symbol)).toEqual(['AAA', 'CCC'])
    expect(move?.contributors[0]?.points).toBeCloseTo((40 / 55) * 7, 9)
    expect(move?.contributors[1]?.points).toBeCloseTo((15 / 55) * 7, 9)
    expect(move?.uncovered).toBe(0)
  })

  it('buckets a move by the same dimension the band was measured in', async () => {
    given({ profile: profile({ sectorTargets: [{ key: 'Technology', low: 20, high: 30 }] }) })
    const move = dimension(await report(), 'sector').bands[0]!.move

    // Technology is AAA (40) and CCC (15); BBB is Financial and DDD has no sector at all.
    expect(move?.contributors.map((c) => c.symbol)).toEqual(['AAA', 'CCC'])
    expect(move?.candidates).toBe(2)
  })

  /**
   * The one interaction between two targets this app models: closing a sector or currency gap must
   * not push a position through the owner's own concentration ceiling.
   */
  it('never proposes an add that would breach the concentration ceiling', async () => {
    given({
      profile: profile({
        currencyTargets: [{ key: 'GBP', low: 40, high: 50 }],
        positionSize: { low: 0, high: 12 },
      }),
    })
    const move = dimension(await report(), 'currency').bands[0]!.move

    // GBP is DDD alone at 10%, and the ceiling leaves it two points of room against thirty needed.
    expect(move).toMatchObject({ direction: 'add', points: 30, ceilingLimited: true })
    expect(move?.contributors[0]).toMatchObject({ symbol: 'DDD', resultingWeight: 12 })
    expect(move?.uncovered).toBeCloseTo(28, 9)
  })

  it('has nothing to carry a target the owner holds none of', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'CHF', low: 5, high: 10 }] }) })
    const move = dimension(await report(), 'currency').bands[0]!.move

    expect(move).toMatchObject({ direction: 'add', points: 5, candidates: 0, uncovered: 5 })
    expect(move?.contributors).toEqual([])
  })

  /** A position the gateway could not value is in no weight, so it carries no move either. */
  it('leaves an unconvertible holding out of the positions a move names', async () => {
    given({
      profile: profile({ currencyTargets: [{ key: 'USD', low: 5, high: 10 }] }),
      holdings: HOLDINGS.map((h) => (h.symbol === 'CCC' ? { ...h, displayValue: null } : h)),
    })
    const move = dimension(await report(), 'currency').bands[0]!.move

    expect(move?.contributors.map((c) => c.symbol)).toEqual(['AAA'])
    expect(move?.candidates).toBe(1)
  })

  /** Percentage points only: the `profile` disclosure carries no money (DDR-0097). */
  it('carries no amount of money in any move on the report', async () => {
    given({
      profile: profile({
        currencyTargets: [{ key: 'USD', low: 10, high: 20 }],
        sectorTargets: [{ key: 'Technology', low: 5, high: 10 }],
      }),
    })
    const moves = (await report()).dimensions.flatMap((d) => d.bands.map((b) => b.move))

    expect(moves.filter((move) => move !== null).length).toBeGreaterThan(0)
    for (const move of moves) {
      for (const contributor of move?.contributors ?? []) {
        // Every figure is a share or a difference of shares. Nothing here is in the display
        // currency, and the fixture's values (40, 25, 15, 10) are also its weights, so the check
        // that would be ambiguous elsewhere is a check on the *shape*: no field but these exist.
        expect(Object.keys(contributor).sort()).toEqual([
          'name',
          'points',
          'resultingWeight',
          'symbol',
          'weight',
        ])
      }
    }
  })
})

describe('a dimension the profile says nothing about', () => {
  /**
   * Absent, never present-and-empty and never a drift of zero. A profile stating nothing about
   * sectors is not a profile stating that sectors do not matter.
   */
  it('is absent from the report entirely', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'EUR', low: 0, high: 100 }] }) })
    const r = await report()

    expect(r.dimensions.map((d) => d.dimension)).toEqual(['currency'])
  })

  it('leaves all three present when the profile carries all three', async () => {
    given({
      profile: profile({
        currencyTargets: [{ key: 'EUR', low: 0, high: 100 }],
        sectorTargets: [{ key: 'Technology', low: 0, high: 100 }],
        assetClassTargets: [{ key: 'STK', low: 0, high: 100 }],
      }),
    })
    const r = await report()

    expect(r.dimensions.map((d) => d.dimension)).toEqual(['currency', 'sector', 'assetClass'])
  })
})

// ---- DDR-0007: unconvertible is not zero ------------------------------------

describe('a holding the gateway could not price', () => {
  const UNPRICED: Holding[] = [
    HOLDINGS[0]!,
    HOLDINGS[1]!,
    HOLDINGS[2]!,
    { ...HOLDINGS[3]!, displayValue: null, marketValue: 9, currency: 'GBP' },
  ]

  /**
   * The trap, stated plainly: DDD is 10% of the portfolio and its rate was unavailable. Read as
   * zero it would still be *in* the denominator, quietly shrinking every other weight; excluded,
   * the remaining 90 becomes the whole and the weights are honest about what they cover.
   */
  it('is excluded from the denominator rather than counted as zero', async () => {
    given({
      profile: profile({ currencyTargets: [{ key: 'USD', low: 0, high: 100 }] }),
      holdings: UNPRICED,
    })
    const r = await report()

    expect(r.placedValue).toBeCloseTo(90, 6)
    // USD is still 40 + 15 + 2 = 57, now out of 90 rather than 100.
    expect(dimension(r, 'currency').bands[0]!.actual).toBeCloseTo((57 / 90) * 100, 6)
  })

  /**
   * It is a **surfaced quantity, not a zero**: reported by count, currency and native amount. No
   * percentage is offered, and that is the decision — pricing it in the display currency is
   * exactly what the gateway could not do, and deriving a share from the gap against IBKR's own
   * base-currency total would be reading rounding noise as a quantity (Bug #68, DDR-0095).
   */
  it('is reported by count, currency and native amount', async () => {
    given({
      profile: profile({ currencyTargets: [{ key: 'USD', low: 0, high: 100 }] }),
      holdings: UNPRICED,
    })
    const r = await report()

    expect(r.unplaced).toEqual({
      positions: 1,
      cashBalances: 0,
      currencies: ['GBP'],
      nativeTotals: [{ currency: 'GBP', amount: 9 }],
    })
  })

  it('treats an unpriced cash balance the same way a holding is treated', async () => {
    given({
      profile: profile({ currencyTargets: [{ key: 'EUR', low: 0, high: 100 }] }),
      cash: [
        { currency: 'EUR', amount: 8, displayValue: 8 },
        { currency: 'USD', amount: 2.2, displayValue: null },
      ],
    })
    const r = await report()

    expect(r.placedValue).toBeCloseTo(98, 6)
    expect(r.unplaced.cashBalances).toBe(1)
    expect(r.unplaced.nativeTotals).toEqual([{ currency: 'USD', amount: 2.2 }])
  })

  it('sums several unplaced rows in one currency rather than listing it twice', async () => {
    given({
      profile: profile({ currencyTargets: [{ key: 'EUR', low: 0, high: 100 }] }),
      holdings: [
        HOLDINGS[1]!,
        { ...HOLDINGS[0]!, displayValue: null, marketValue: 44, currency: 'USD' },
        { ...HOLDINGS[2]!, displayValue: null, marketValue: 16, currency: 'USD' },
      ],
    })
    const r = await report()

    expect(r.unplaced.currencies).toEqual(['USD'])
    expect(r.unplaced.nativeTotals).toEqual([{ currency: 'USD', amount: 60 }])
  })

  /**
   * The assertion that can actually *see* the difference between excluding an unpriced holding
   * and reading it as zero — the sums cannot, because zero adds nothing to them, and a test that
   * only checks the sums would pass either way.
   *
   * Here DDD is both unpriced and unclassified. Read as zero it would join the `unclassified`
   * residual at a weight of 0, and the report would tell the owner they hold something the
   * classification cache has not reached — when what they actually hold is something the *gateway*
   * could not price. Two different problems with two different fixes, and one of them would be
   * announced falsely. Excluded, the residual does not exist at all.
   */
  it('creates no residual for a holding that is not part of the placed portfolio', async () => {
    given({
      profile: profile({ sectorTargets: [{ key: 'Technology', low: 0, high: 100 }] }),
      holdings: UNPRICED,
      // DDD is absent from the cache, so it is unclassified as well as unpriced.
      classifications: CLASSIFICATIONS,
    })
    const sector = dimension(await report(), 'sector')

    expect(sector.residuals.map((r) => r.kind)).toEqual(['cash'])
    expect(sector.residuals.every((r) => r.weight > 0)).toBe(true)
  })

  it('reports nothing unplaced when every rate was available', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'EUR', low: 0, high: 100 }] }) })
    const r = await report()

    expect(r.unplaced).toEqual({
      positions: 0,
      cashBalances: 0,
      currencies: [],
      nativeTotals: [],
    })
  })
})

// ---- the invariant ----------------------------------------------------------

/**
 * The end-to-end sum check the story asks for, and the assertion most likely to catch a bug
 * nobody predicted: whatever the buckets, the residuals and the untargeted remainder are, they
 * account for the **whole** placed portfolio exactly once. A double-count pushes it over 100 and
 * a silent drop pushes it under.
 */
describe('every dimension accounts for the whole placed portfolio', () => {
  const total = (d: DimensionDrift): number =>
    d.bands.reduce((sum, b) => sum + b.actual, 0) +
    d.residuals.reduce((sum, r) => sum + r.weight, 0) +
    d.untargeted

  it.each(['currency', 'sector', 'assetClass'] as const)(
    'sums to 100 in the %s dimension',
    async (name) => {
      given({
        profile: profile({
          currencyTargets: [{ key: 'USD', low: 0, high: 100 }],
          sectorTargets: [{ key: 'Technology', low: 0, high: 100 }],
          assetClassTargets: [{ key: 'STK', low: 0, high: 100 }],
        }),
      })
      expect(total(dimension(await report(), name))).toBeCloseTo(100, 6)
    },
  )

  /** Still exactly 100 when a fifth of the portfolio has no category and a tenth is unplaced. */
  it('sums to 100 with residuals present and something unplaced', async () => {
    given({
      profile: profile({
        currencyTargets: [{ key: 'USD', low: 0, high: 100 }],
        sectorTargets: [{ key: 'Technology', low: 0, high: 100 }],
        assetClassTargets: [{ key: 'STK', low: 0, high: 100 }],
      }),
      holdings: [...HOLDINGS.slice(0, 3), { ...HOLDINGS[3]!, displayValue: null }],
      classifications: CLASSIFICATIONS.slice(0, 1),
      assetClasses: ASSET_CLASSES.slice(0, 1),
    })
    const r = await report()

    for (const d of r.dimensions) expect(total(d)).toBeCloseTo(100, 6)
  })

  /** A target is never double-counted into `untargeted`, however the owner cased its key. */
  it('does not count a targeted bucket as untargeted', async () => {
    given({
      profile: profile({
        currencyTargets: [
          { key: 'usd', low: 0, high: 100 },
          { key: 'eur', low: 0, high: 100 },
          { key: 'gbp', low: 0, high: 100 },
        ],
      }),
    })
    const currency = dimension(await report(), 'currency')

    expect(currency.untargeted).toBeCloseTo(0, 6)
    expect(total(currency)).toBeCloseTo(100, 6)
  })
})

// ---- the summary ------------------------------------------------------------

describe('balanced', () => {
  it('is true only when every band and the ceiling are inside', async () => {
    given({
      profile: profile({
        currencyTargets: [{ key: 'USD', low: 50, high: 60 }],
        positionSize: { low: 0, high: 50 },
      }),
    })
    expect((await report()).balanced).toBe(true)
  })

  it('is false when one band is outside', async () => {
    given({
      profile: profile({
        currencyTargets: [
          { key: 'USD', low: 50, high: 60 },
          { key: 'EUR', low: 50, high: 60 },
        ],
      }),
    })
    expect((await report()).balanced).toBe(false)
  })

  it('is false when only the concentration ceiling is breached', async () => {
    given({
      profile: profile({
        currencyTargets: [{ key: 'USD', low: 50, high: 60 }],
        positionSize: { low: 0, high: 20 },
      }),
    })
    expect((await report()).balanced).toBe(false)
  })

  it('carries the reading time and the currency every weight is a share of', async () => {
    given({ profile: profile({ currencyTargets: [{ key: 'EUR', low: 0, high: 100 }] }) })
    const r = await report()

    expect(r.readAt).toBe(NOW)
    expect(r.displayCurrency).toBe('EUR')
    expect(r.placedValue).toBeCloseTo(100, 6)
  })
})

  /**
   * The label a band takes when the owner targets a category the portfolio holds **nothing** in.
   *
   * That is the interesting case by design — "I want 10% in bonds and hold none" is exactly the
   * answer being asked for — and it is the one where there is no bucket to take a label from. The
   * fallback was the raw stored key, so a 0% band read `__cash__` or `BOND` while every held band
   * beside it read `Stocks`: one report, two vocabularies for the same dimension.
   */
  it('labels a target the portfolio holds nothing in, rather than falling back to its key', async () => {
    given({
      profile: profile({
        assetClassTargets: [
          { key: 'STK', low: 50, high: 90 },
          { key: 'BOND', low: 5, high: 20 },
          { key: CASH_ASSET_KEY, low: 2, high: 10 },
        ],
      }),
      assetClasses: ASSET_CLASSES.map((a) => ({ ...a, assetCategory: 'STK' })),
    })
    const bands = dimension(await report(), 'assetClass').bands

    expect(bands.map((b) => b.label)).toEqual(['Stocks', 'Bonds', 'Cash'])
    // And the held one still takes the bucket's own label, which is the path that already worked.
    expect(bands.find((b) => b.key === 'STK')?.actual).toBeGreaterThan(0)
    expect(bands.find((b) => b.key === 'BOND')?.actual).toBe(0)
  })

// ---- the app's own standard, beside the owner's ------------------------------

/**
 * The baseline half of the same report (Story #315, ADR-0012).
 *
 * It is measured **here** rather than in a service of its own, and that is the property this block
 * exists to pin: one live reading, one `placedValue`, one set of weights. A second service would
 * derive its own denominator and could disagree with this one about how large a position is - two
 * verdicts contradicting each other inside a single answer, which is the failure hardest to see.
 *
 * The fixture sums to 100, so every weight below is also its own value: AAA 40, BBB 25, CCC 15,
 * DDD 10, cash 10. Technology is AAA + CCC = 55; DDD is unclassified and is therefore not a sector.
 */
describe('the app’s baseline, over the same reading as the drift', () => {
  it('measures the largest position and sector against the app’s own ceilings', async () => {
    given({ profile: EMPTY_INVESTOR_PROFILE })
    const { baseline } = await report()

    expect(baseline.ceilings.find((c) => c.check === 'position')).toMatchObject({
      key: 'AAA',
      actual: 40,
      limit: BASELINE_CEILINGS.position,
      status: 'above',
      distance: 30,
    })
    const sector = baseline.ceilings.find((c) => c.check === 'sector')
    expect(sector).toMatchObject({
      key: 'Technology',
      limit: BASELINE_CEILINGS.sector,
      status: 'above',
    })
    // Unrounded, exactly as a `DriftBand`'s own `actual` is: two summed conversions land on
    // 55.00000000000001, and the section's formatters are what round it for the page.
    expect(sector?.actual).toBeCloseTo(55, 6)
    expect(sector?.distance).toBeCloseTo(25, 6)
    expect(baseline.withinBaseline).toBe(false)
  })

  /**
   * The residuals DDR-0095 refuses to absorb, refused here too. DDD carries no sector because the
   * classification refresh is resumable and died before reaching it - counting that cache miss as a
   * sector would report a gap in local reference data as a concentration.
   */
  it('leaves an unclassified holding out of the sector figures entirely', async () => {
    given({ profile: EMPTY_INVESTOR_PROFILE })
    const { baseline } = await report()

    expect(baseline.sectorsHeld).toBe(2)
    expect(baseline.ceilings.map((c) => c.key)).not.toContain('')
  })

  /** Cash has no sector and every currency, so it is an asset class here and nothing else. */
  it('reports uninvested cash as an asset class, never as a sector', async () => {
    given({ profile: EMPTY_INVESTOR_PROFILE })
    const { baseline } = await report()

    expect(baseline.ceilings.find((c) => c.check === 'cash')).toMatchObject({
      actual: 10,
      limit: BASELINE_CEILINGS.cash,
      status: 'inside',
    })
  })

  /**
   * The fixture holds stocks, an ETF and cash and no bonds, which is the only absence the app is
   * willing to name: the asset-class vocabulary is fixed and the app owns it, and there is no
   * equivalent for sectors (ADR-0012, Option D).
   */
  it('names the coverage class the portfolio holds nothing in', async () => {
    given({ profile: EMPTY_INVESTOR_PROFILE })
    const { baseline } = await report()

    expect(baseline.absentAssetClasses).toEqual([{ key: 'BOND', label: 'Bonds' }])
  })

  /**
   * One position split across two rows must not read as two smaller ones. `positionDriftFor` sums
   * by conid for the owner's own ceiling; the app's ceiling has to sum the same way or the two
   * disagree about the same holding.
   */
  it('sums a split holding by conid, exactly as the owner’s own ceiling does', async () => {
    given({
      profile: EMPTY_INVESTOR_PROFILE,
      holdings: [
        holding({ conid: 1, symbol: 'AAA', currency: 'USD', displayValue: 20, marketValue: 22 }),
        holding({ conid: 1, symbol: 'AAA', currency: 'USD', displayValue: 20, marketValue: 22 }),
        ...HOLDINGS.slice(1),
      ],
    })
    const { baseline } = await report()

    expect(baseline.ceilings.find((c) => c.check === 'position')).toMatchObject({
      key: 'AAA',
      actual: 40,
    })
  })

  /**
   * DDR-0007's rule reaching the baseline: an unconvertible holding is in no denominator, so the
   * largest position the app can see may not be the largest one there is.
   */
  it('marks its figures a lower bound when a holding could not be valued', async () => {
    given({
      profile: EMPTY_INVESTOR_PROFILE,
      holdings: [...HOLDINGS, holding({ conid: 9, symbol: 'ZZZ', displayValue: null })],
    })
    const { baseline } = await report()

    expect(baseline.ceilings.every((c) => c.bounded)).toBe(true)
  })

  /**
   * ADR-0012's central line, end to end: the owner's stated ceiling governs, and the app's default
   * is not computed, not returned and not mentioned for that dimension. A 25% ceiling on a 40%
   * position is out of range by the owner's own standard - and the app does not also say it is out
   * of range by 30 points of its own, which would be second-guessing a decision they made.
   */
  it('says nothing of its own about a dimension the owner has targeted', async () => {
    given({ profile: profile({ positionSize: { low: 0, high: 25 } }) })
    const r = await report()

    expect(r.position).toMatchObject({ symbol: 'AAA', actual: 40, status: 'above' })
    expect(r.baseline.deferred).toContain('position')
    expect(r.baseline.ceilings.map((c) => c.check)).not.toContain('position')
  })
})
