import { describe, it, expect, vi, beforeEach } from 'vitest'
import { investorProfileService, INVESTOR_PROFILE_KEY } from './investorProfileService'
import { metaRepository } from '@repositories/meta/metaRepository'
import {
  EMPTY_INVESTOR_PROFILE,
  countTargets,
  isProfileEmpty,
  validatedInvestorProfileDraftSchema,
  type InvestorProfileDraft,
} from '@shared/domain/investorProfile'

/**
 * The investor profile's storage and normalisation (Story #280, DDR-0094).
 *
 * The repository is mocked so the service is tested in isolation, which is the pattern
 * `metaService` established and `sidebarStateService` follows. What is worth pinning here is
 * everything the *type* does not say: that a partial profile survives a round trip unchanged,
 * that an unreadable stored value costs the profile rather than the launch, that a key the
 * portfolio does not hold is preserved, and that clearing removes the key rather than storing an
 * empty profile with a timestamp on it.
 */
vi.mock('@repositories/meta/metaRepository', () => ({
  metaRepository: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}))

const mockRepo = vi.mocked(metaRepository)

const NOW = 1_756_000_000_000

const draft = (overrides: Partial<InvestorProfileDraft> = {}): InvestorProfileDraft => ({
  styleTags: [],
  currencyTargets: [],
  sectorTargets: [],
  assetClassTargets: [],
  positionSize: null,
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('investorProfileService.get', () => {
  it('reports the empty profile when the owner has never written one', () => {
    mockRepo.get.mockReturnValue(undefined)

    expect(investorProfileService.get()).toEqual(EMPTY_INVESTOR_PROFILE)
    expect(mockRepo.get).toHaveBeenCalledWith(INVESTOR_PROFILE_KEY)
  })

  /**
   * The empty profile is a real profile, not an absence — which is what keeps every reader free
   * of a "no profile yet" branch. An owner with no policy and an owner who cleared theirs are in
   * the same position, and both are `updatedAt: null`.
   */
  it('reports the empty profile as a profile rather than as nothing', () => {
    expect(isProfileEmpty(EMPTY_INVESTOR_PROFILE)).toBe(true)
    expect(EMPTY_INVESTOR_PROFILE.updatedAt).toBeNull()
  })

  it('restores a stored profile whole', () => {
    const stored = {
      styleTags: ['dividend_income'],
      currencyTargets: [{ key: 'USD', low: 20, high: 40 }],
      sectorTargets: [],
      assetClassTargets: [],
      positionSize: { low: 0, high: 8 },
      updatedAt: NOW,
    }
    mockRepo.get.mockReturnValue(JSON.stringify(stored))

    expect(investorProfileService.get()).toEqual(stored)
  })

  /**
   * The value is a hand-editable row in a local database and can predate a change to this shape,
   * so every way of being unusable ends at the empty profile rather than at a thrown launch. The
   * out-of-range case is the one that matters most: it is what a stored value edited by hand past
   * the boundary's guard looks like, and reading it back would defeat the boundary.
   */
  it.each([
    ['not JSON at all', 'profile'],
    ['JSON of the wrong shape', '{"tags":[]}'],
    ['a JSON scalar rather than an object', '42'],
    ['an empty string, which the repository reports for an empty value', ''],
    [
      'a percentage outside 0–100',
      '{"styleTags":[],"currencyTargets":[{"key":"USD","low":0,"high":140}],"sectorTargets":[],"assetClassTargets":[],"positionSize":null,"updatedAt":1}',
    ],
    [
      'an unknown style tag',
      '{"styleTags":["day_trading"],"currencyTargets":[],"sectorTargets":[],"assetClassTargets":[],"positionSize":null,"updatedAt":1}',
    ],
  ])('falls back to the empty profile when the stored value is %s', (_case, stored) => {
    mockRepo.get.mockReturnValue(stored)

    expect(investorProfileService.get()).toEqual(EMPTY_INVESTOR_PROFILE)
  })
})

describe('investorProfileService.save', () => {
  it('writes one overwritten key rather than appending a version', () => {
    investorProfileService.save(draft({ styleTags: ['mature_large_cap'] }), NOW)
    investorProfileService.save(draft({ styleTags: ['defensive_sectors'] }), NOW + 1000)

    expect(mockRepo.set).toHaveBeenCalledTimes(2)
    expect(mockRepo.set.mock.calls.map(([key]) => key)).toEqual([
      INVESTOR_PROFILE_KEY,
      INVESTOR_PROFILE_KEY,
    ])
  })

  /** What is written is what `get` parses: a round trip is the only thing that makes it a setting. */
  it('round-trips through the stored value', () => {
    const submitted = draft({
      styleTags: ['dividend_income', 'defensive_sectors'],
      currencyTargets: [{ key: 'USD', low: 30, high: 50 }],
      positionSize: { low: 1, high: 7.5 },
    })
    const saved = investorProfileService.save(submitted, NOW)

    const [, written] = mockRepo.set.mock.calls[0]!
    mockRepo.get.mockReturnValue(written)

    expect(investorProfileService.get()).toEqual(saved)
  })

  it('stamps the write time itself rather than taking one from the caller', () => {
    expect(investorProfileService.save(draft(), NOW).updatedAt).toBe(NOW)
  })

  /**
   * A partial profile is valid, and "valid" has to mean *unchanged*: an owner who stated only
   * currency targets must not find sector targets invented, and nothing is required to sum to
   * 100. The 45–60 pair here deliberately leaves 40% of the portfolio unstated.
   */
  it('keeps a partial profile partial, and never fills a blank with a default', () => {
    const saved = investorProfileService.save(
      draft({ currencyTargets: [{ key: 'EUR', low: 45, high: 60 }] }),
      NOW,
    )

    expect(saved.currencyTargets).toEqual([{ key: 'EUR', low: 45, high: 60 }])
    expect(saved.sectorTargets).toEqual([])
    expect(saved.assetClassTargets).toEqual([])
    expect(saved.styleTags).toEqual([])
    expect(saved.positionSize).toBeNull()
    expect(countTargets(saved)).toBe(1)
  })

  /**
   * The acceptance criterion the vocabularies exist to *not* enforce. `CHF` may be a currency the
   * owner intends to take an exposure to and does not hold yet; dropping it, or reading it as 0%,
   * would be the app editing the owner's policy.
   */
  it('preserves a target naming a category the portfolio does not currently hold', () => {
    const saved = investorProfileService.save(
      draft({
        currencyTargets: [{ key: 'CHF', low: 0, high: 10 }],
        sectorTargets: [{ key: 'Utilities', low: 5, high: 15 }],
      }),
      NOW,
    )

    expect(saved.currencyTargets).toEqual([{ key: 'CHF', low: 0, high: 10 }])
    expect(saved.sectorTargets).toEqual([{ key: 'Utilities', low: 5, high: 15 }])
  })

  it('upper-cases currency keys, so a profile joins with the report that uses them', () => {
    const saved = investorProfileService.save(
      draft({ currencyTargets: [{ key: ' usd ', low: 0, high: 100 }] }),
      NOW,
    )

    expect(saved.currencyTargets[0]!.key).toBe('USD')
  })

  /**
   * Sector and asset-class names are IBKR's prose, so case-folding them would be this module
   * inventing a spelling. Trimming is not the same thing — whitespace is never part of a name.
   */
  it('trims but does not case-fold a sector name', () => {
    const saved = investorProfileService.save(
      draft({ sectorTargets: [{ key: '  Consumer, Cyclical ', low: 0, high: 25 }] }),
      NOW,
    )

    expect(saved.sectorTargets[0]!.key).toBe('Consumer, Cyclical')
  })

  /**
   * Two owners who stated the same policy in different orders store the same bytes, so a re-save
   * that changed nothing does not look like a change.
   */
  it('canonicalises order: tags in declaration order, targets by key', () => {
    const saved = investorProfileService.save(
      draft({
        styleTags: ['high_growth_sectors', 'dividend_income'],
        currencyTargets: [
          { key: 'USD', low: 0, high: 60 },
          { key: 'EUR', low: 0, high: 60 },
        ],
      }),
      NOW,
    )

    expect(saved.styleTags).toEqual(['dividend_income', 'high_growth_sectors'])
    expect(saved.currencyTargets.map((t) => t.key)).toEqual(['EUR', 'USD'])
  })

  it('de-duplicates a style tag rather than storing the same statement twice', () => {
    const saved = investorProfileService.save(
      draft({ styleTags: ['dividend_income', 'dividend_income'] }),
      NOW,
    )

    expect(saved.styleTags).toEqual(['dividend_income'])
  })
})

describe('investorProfileService.clear', () => {
  /**
   * The key is removed rather than overwritten with an empty profile, so "never written" and
   * "written and then cleared" are the same state. Storing a cleared profile would leave an
   * `updatedAt` claiming the owner had said something.
   */
  it('removes the key and reports the empty profile now in force', () => {
    expect(investorProfileService.clear()).toEqual(EMPTY_INVESTOR_PROFILE)
    expect(mockRepo.remove).toHaveBeenCalledWith(INVESTOR_PROFILE_KEY)
    expect(mockRepo.set).not.toHaveBeenCalled()
  })

  it('leaves a subsequent read reporting the empty profile', () => {
    investorProfileService.clear()
    mockRepo.get.mockReturnValue(undefined)

    expect(investorProfileService.get().updatedAt).toBeNull()
  })
})

/**
 * The boundary's half of the contract. These run the *same* schema the IPC handler parses with,
 * which is what makes them evidence that an invalid range is rejected before storage rather than
 * normalised into something storable.
 */
describe('what the boundary rejects, and therefore never reaches this service', () => {
  const parse = (d: InvestorProfileDraft): boolean =>
    validatedInvestorProfileDraftSchema.safeParse(d).success

  it('accepts a range at both extremes of 0–100', () => {
    expect(parse(draft({ sectorTargets: [{ key: 'Energy', low: 0, high: 100 }] }))).toBe(true)
  })

  it('accepts a degenerate range, which is a point the owner chose to state', () => {
    expect(parse(draft({ currencyTargets: [{ key: 'EUR', low: 50, high: 50 }] }))).toBe(true)
  })

  it.each([
    ['a low above its high', { key: 'EUR', low: 60, high: 40 }],
    ['a bound above 100', { key: 'EUR', low: 0, high: 101 }],
    ['a negative bound', { key: 'EUR', low: -1, high: 40 }],
    ['a blank key', { key: '   ', low: 0, high: 40 }],
  ])('rejects %s', (_case, target) => {
    expect(parse(draft({ currencyTargets: [target] }))).toBe(false)
  })

  it('rejects an inverted position band', () => {
    expect(parse(draft({ positionSize: { low: 10, high: 5 } }))).toBe(false)
  })

  /** Two ranges for one exposure are two policies, and choosing between them would be a guess. */
  it('rejects the same key twice in one dimension, however it is cased', () => {
    expect(
      parse(
        draft({
          currencyTargets: [
            { key: 'USD', low: 0, high: 40 },
            { key: 'usd', low: 10, high: 50 },
          ],
        }),
      ),
    ).toBe(false)
  })

  /** The dimensions are separate policies, so the same name in two of them is not a duplicate. */
  it('accepts the same key across two different dimensions', () => {
    expect(
      parse(
        draft({
          currencyTargets: [{ key: 'USD', low: 0, high: 40 }],
          sectorTargets: [{ key: 'USD', low: 0, high: 40 }],
        }),
      ),
    ).toBe(true)
  })

  it('accepts the empty profile, because a partial profile is valid and so is an absent one', () => {
    expect(parse(draft())).toBe(true)
  })
})
