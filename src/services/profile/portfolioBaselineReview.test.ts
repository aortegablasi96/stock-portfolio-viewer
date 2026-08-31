import { describe, expect, it } from 'vitest'
import { reviewAgainstBaseline, type BaselineInput } from './portfolioBaselineReview'
import {
  BASELINE_CEILINGS,
  BASELINE_CHECKS,
  BASELINE_COVERAGE_CLASSES,
  BASELINE_VERSION,
} from '@shared/domain/portfolioBaseline'
import { CASH_ASSET_KEY } from '@shared/domain/assetClass'
import { EMPTY_INVESTOR_PROFILE } from '@shared/domain/investorProfileTerms'

/**
 * The app's own standard, measured (Story #315, ADR-0012).
 *
 * **This is the arithmetic ADR-0009 forbids the model to do**, so it is tested the way `driftMoves`
 * is: as a pure function, exhaustively, over inputs a service derived. What it must get right is
 * less about the numbers than about *when it speaks*. The record permits the app to fill a silence
 * and forbids it to contradict a statement, and the whole of that distinction is which checks run.
 */

const input = (over: Partial<BaselineInput> = {}): BaselineInput => ({
  profile: EMPTY_INVESTOR_PROFILE,
  positions: [
    { symbol: 'AAPL', name: 'Apple Inc', weight: 18.5 },
    { symbol: 'MSFT', name: null, weight: 9 },
  ],
  sectorWeights: new Map([
    ['Banks', 41.5],
    ['Mining', 20 ],
    ['Food', 10.5],
  ]),
  assetClassWeights: new Map([
    ['STK', 72],
    [CASH_ASSET_KEY, 5],
  ]),
  bounded: false,
  ...over,
})

// ---- the owner's profile wins -------------------------------------------------------------------

describe('a check runs only where the owner has stated nothing', () => {
  /**
   * ADR-0012's central line, as the assertion that would fail if it moved. An owner who has written
   * nothing has left every dimension silent, so the app fills all of them.
   */
  it('applies every check to a profile that states nothing at all', () => {
    const review = reviewAgainstBaseline(input())

    expect(review.applied).toEqual([...BASELINE_CHECKS])
    expect(review.deferred).toEqual([])
  })

  /**
   * The other end, and the one that keeps ADR-0009's surviving half intact: measuring an owner's
   * stated 40% target against a 30% default would be *proposing the policy*, which stays forbidden.
   * A deferred check computes nothing at all - not a figure the caller might render anyway.
   */
  it('defers every check to a profile that targets every dimension', () => {
    const review = reviewAgainstBaseline(
      input({
        profile: {
          ...EMPTY_INVESTOR_PROFILE,
          sectorTargets: [{ key: 'Banks', low: 30, high: 60 }],
          assetClassTargets: [{ key: 'STK', low: 50, high: 90 }],
          positionSize: { low: 0, high: 25 },
        },
      }),
    )

    expect(review.applied).toEqual([])
    expect(review.deferred).toEqual([...BASELINE_CHECKS])
    expect(review.ceilings).toEqual([])
    expect(review.absentAssetClasses).toEqual([])
    expect(review.withinBaseline).toBeNull()
  })

  /**
   * The shape almost every real profile has, and the reason ADR-0012 rejected its Option B: a
   * profile with currency targets and nothing about sectors is not an owner who decided sectors do
   * not matter. Both halves speak, each about what the other is silent on.
   */
  it('fills a partial profile dimension by dimension', () => {
    const review = reviewAgainstBaseline(
      input({ profile: { ...EMPTY_INVESTOR_PROFILE, positionSize: { low: 0, high: 25 } } }),
    )

    expect(review.deferred).toEqual(['position'])
    expect(review.applied).toEqual(['sector', 'cash', 'coverage'])
    expect(review.ceilings.map((c) => c.check)).toEqual(['sector', 'cash'])
  })

  /**
   * `cash` and `coverage` are both asset-class checks, so one asset-class target silences both. An
   * owner who has said what weight of each class they want has already said what weight of cash.
   */
  it('silences both asset-class checks on a single asset-class target', () => {
    const review = reviewAgainstBaseline(
      input({
        profile: { ...EMPTY_INVESTOR_PROFILE, assetClassTargets: [{ key: 'BOND', low: 5, high: 20 }] },
      }),
    )

    expect(review.deferred).toEqual(['cash', 'coverage'])
    expect(review.absentAssetClasses).toEqual([])
    expect(review.ceilings.map((c) => c.check)).toEqual(['position', 'sector'])
  })

  /** A style tag is a description of an intent. There is nothing in one to measure a weight against. */
  it('treats style tags as no statement at all', () => {
    const review = reviewAgainstBaseline(
      input({ profile: { ...EMPTY_INVESTOR_PROFILE, styleTags: ['dividend_income'] } }),
    )

    expect(review.applied).toEqual([...BASELINE_CHECKS])
  })
})

// ---- the ceilings --------------------------------------------------------------------------------

describe('a ceiling reports the largest of its kind against the app’s default', () => {
  it('names the largest position, not the first', () => {
    const review = reviewAgainstBaseline(
      input({
        positions: [
          { symbol: 'MSFT', name: null, weight: 9 },
          { symbol: 'AAPL', name: 'Apple Inc', weight: 18.5 },
        ],
      }),
    )
    const position = review.ceilings.find((c) => c.check === 'position')

    expect(position).toMatchObject({
      key: 'AAPL',
      name: 'Apple Inc',
      actual: 18.5,
      limit: BASELINE_CEILINGS.position,
      status: 'above',
      distance: 8.5,
    })
  })

  /**
   * `verdict`'s convention in `balanceDriftService`, kept identical: a range is closed, so sitting
   * exactly on the ceiling is inside it. A baseline that faulted a portfolio at exactly 10% would
   * disagree with an owner's own 10% ceiling about the same portfolio, which is the one way two
   * verdicts in one answer can contradict each other.
   */
  it('counts exactly on the ceiling as inside it, with no distance', () => {
    const review = reviewAgainstBaseline(
      input({ positions: [{ symbol: 'AAPL', name: null, weight: BASELINE_CEILINGS.position }] }),
    )
    const position = review.ceilings.find((c) => c.check === 'position')

    expect(position).toMatchObject({ status: 'inside', distance: 0 })
  })

  /**
   * Reported even at zero. "No idle cash" is a fact about the portfolio's shape, and an absent cash
   * line reads as a cash weight nobody looked at - the same reason DDR-0095 surfaces a residual
   * rather than absorbing it.
   */
  it('reports cash even when the portfolio holds none', () => {
    const review = reviewAgainstBaseline(input({ assetClassWeights: new Map([['STK', 100]]) }))

    expect(review.ceilings.find((c) => c.check === 'cash')).toMatchObject({
      actual: 0,
      status: 'inside',
    })
  })

  /**
   * With no positions there is no largest position and no largest sector, so neither ceiling is
   * invented at zero - the difference between *not applicable* and *nothing there*, which the drift
   * report draws the same way by omitting a dimension rather than reporting it empty.
   *
   * Cash stays, because zero cash is a real answer to "how much idle cash". `balanceDriftService`
   * never reaches here with an empty portfolio anyway: `placedValue <= 0` returns `no_data` above.
   */
  it('invents no ceiling for a kind the portfolio holds none of', () => {
    const review = reviewAgainstBaseline(
      input({ positions: [], sectorWeights: new Map(), assetClassWeights: new Map() }),
    )

    expect(review.ceilings.map((c) => c.check)).toEqual(['cash'])
    expect(review.sectorsHeld).toBe(0)
  })

  /** And with no check able to run at all, there is no verdict rather than a reassuring one. */
  it('offers no verdict when every check was deferred', () => {
    const review = reviewAgainstBaseline(
      input({
        profile: {
          ...EMPTY_INVESTOR_PROFILE,
          sectorTargets: [{ key: 'Banks', low: 30, high: 60 }],
          assetClassTargets: [{ key: 'STK', low: 50, high: 90 }],
          positionSize: { low: 0, high: 25 },
        },
      }),
    )

    expect(review.withinBaseline).toBeNull()
  })

  it('is within the baseline only when every applied ceiling is', () => {
    expect(reviewAgainstBaseline(input()).withinBaseline).toBe(false)
    expect(
      reviewAgainstBaseline(
        input({
          positions: [{ symbol: 'AAPL', name: null, weight: 4 }],
          sectorWeights: new Map([['Banks', 12]]),
        }),
      ).withinBaseline,
    ).toBe(true)
  })

  /**
   * DDR-0007's qualification, carried through. A holding that could not be valued is in no
   * denominator, so every weight here is "at least" - and a larger position may be hiding among the
   * unplaced. Reporting a bare figure there is the quiet kind of wrong this Epic exists to avoid.
   */
  it('marks every figure a lower bound when something could not be valued', () => {
    const review = reviewAgainstBaseline(input({ bounded: true }))

    expect(review.ceilings.every((c) => c.bounded)).toBe(true)
  })
})

// ---- coverage, and the sector universe that does not exist ---------------------------------------

describe('coverage names an absent asset class, and never an absent sector', () => {
  /**
   * The one place the app says a portfolio is *missing* something, and it can only do it here
   * because the asset-class vocabulary is fixed and the app owns it. ADR-0012 rejected the sector
   * equivalent on evidence: IBKR's `industry` field is an open vocabulary with no closed set.
   */
  it('names a coverage class the portfolio holds no weight in', () => {
    const review = reviewAgainstBaseline(input())

    expect(review.absentAssetClasses).toEqual([{ key: 'BOND', label: 'Bonds' }])
  })

  it('names none once every coverage class carries a weight', () => {
    const review = reviewAgainstBaseline(
      input({ assetClassWeights: new Map([['BOND', 20], [CASH_ASSET_KEY, 5]]) }),
    )

    expect(review.absentAssetClasses).toEqual([])
  })

  /** Every class checked is one the app's own vocabulary names; nothing is invented into the list. */
  it('checks only the classes the baseline declares', () => {
    const review = reviewAgainstBaseline(input({ assetClassWeights: new Map() }))

    expect(review.absentAssetClasses.map((c) => c.key)).toEqual([...BASELINE_COVERAGE_CLASSES])
  })

  /**
   * A count, never a list of what is absent. The context states beside this figure that the app
   * holds no sector universe, which is the fact the prompt rule needs to be obeyable (DDR-0104).
   */
  it('counts the sector names held and offers no list of missing ones', () => {
    const review = reviewAgainstBaseline(input())

    expect(review.sectorsHeld).toBe(3)
    expect(review).not.toHaveProperty('absentSectors')
  })
})

// ---- the standard itself -------------------------------------------------------------------------

describe('the standard travels with the judgement', () => {
  /** So an answer the owner kept says which standard produced it, a year later. */
  it('stamps the baseline version it measured against', () => {
    expect(reviewAgainstBaseline(input()).version).toBe(BASELINE_VERSION)
  })

  /**
   * The risk ADR-0012 names as this module's own: **accretion**, a check per story until the app is
   * a robo-advisor by increments. The list is counted for the reason `SYSTEM_PROMPT_RULES` is - a
   * length nobody asserts is one a story can grow without saying so.
   */
  it('runs four checks, and a fifth is a decision rather than an addition', () => {
    expect(BASELINE_CHECKS).toHaveLength(4)
    expect(reviewAgainstBaseline(input()).applied).toHaveLength(4)
  })

  /**
   * Currency's absence is a decision, not an omission (ADR-0012). The app knows where a position is
   * priced and not where its business earns, so a default ceiling there would assert an exposure it
   * cannot see - the distinction the prompt already carries as a rule of its own.
   */
  it('holds no currency ceiling at all', () => {
    expect(BASELINE_CHECKS).not.toContain('currency')
    expect(Object.keys(BASELINE_CEILINGS)).toEqual(['position', 'sector', 'cash'])
  })

  /**
   * There is no `move`. `driftMoves` sizes a move that closes a gap against a target the *owner*
   * wrote; sizing one against the app's own default would be proposing the policy in an arithmetic
   * disguise. What is stated is the gap.
   */
  it('sizes no move to close a baseline gap', () => {
    for (const ceiling of reviewAgainstBaseline(input()).ceilings) {
      expect(ceiling).not.toHaveProperty('move')
    }
  })
})
