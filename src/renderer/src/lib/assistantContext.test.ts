import { describe, expect, it } from 'vitest'
import {
  MAX_LISTED_POSITIONS,
  buildAssistantContext,
  hasProfile,
  holdingsSection,
  measuredDrift,
  profileSection,
  weightsSection,
  type GroundingInputs,
} from './assistantContext'
import { DISCLOSURE_CATEGORY_IDS } from '@shared/domain/assistantDisclosure'
import { EMPTY_INVESTOR_PROFILE, type InvestorProfile } from '@shared/domain/investorProfileTerms'
import type { AllocationPosition, AllocationReport } from '@shared/domain/allocation'
import type { BalanceDriftReport } from '@shared/domain/balanceDrift'

/**
 * The grounding (Story #284, DDR-0098).
 *
 * **This file is the Epic's largest correctness risk written down as assertions.** ADR-0009 says
 * the model never produces a figure, and that sentence is only true if something else produces
 * every one of them. Here is that something, and the tests below are less about formatting than
 * about four properties the feature is unsafe without:
 *
 * 1. A section carries **no more than its disclosure allows** — no money in `holdings`, `weights`
 *    or `profile`, whatever the reports contain.
 * 2. **Absent is absent, never zero** — a report that could not be read produces no section, and
 *    an unconvertible holding is never given a weight (DDR-0007).
 * 3. Every figure goes through the **app's own formatters**, so prose and dashboard agree.
 * 4. A section **says which store and which clock it came from**, because the composition sections
 *    read imported Flex history and drift reads the live portfolio.
 */

function position(over: Partial<AllocationPosition> = {}): AllocationPosition {
  return {
    conid: 1,
    symbol: 'AAPL',
    description: 'APPLE INC',
    assetCategory: 'STK',
    currency: 'USD',
    issuerCountry: 'US',
    sector: 'Technology',
    industry: 'Computers',
    marketValueBase: 12_345.67,
    costBasisBase: 10_000,
    unrealizedPnlBase: 2_345.67,
    percentOfNav: 24.5,
    ...over,
  }
}

function report(over: Partial<AllocationReport> = {}): AllocationReport {
  return {
    baseCurrency: 'EUR',
    reportDate: Date.UTC(2026, 6, 31),
    totalMarketValueBase: 50_000,
    positions: [position()],
    byAssetClass: [{ key: 'STK', label: 'Stocks', marketValueBase: 40_000, percentOfNav: 80 }],
    byCurrency: [{ key: 'USD', label: 'USD', marketValueBase: 30_000, percentOfNav: 60 }],
    byCountry: [{ key: 'US', label: 'United States', marketValueBase: 30_000, percentOfNav: 60 }],
    bySector: [{ key: 'Technology', label: 'Technology', marketValueBase: 20_000, percentOfNav: 40 }],
    unclassifiedCount: 0,
    ...over,
  }
}

function drift(over: Partial<BalanceDriftReport> = {}): BalanceDriftReport {
  return {
    displayCurrency: 'EUR',
    readAt: Date.UTC(2026, 7, 28, 9, 15),
    placedValue: 50_000,
    dimensions: [
      {
        dimension: 'currency',
        bands: [
          { key: 'USD', label: 'USD', actual: 60, low: 30, high: 50, status: 'above', distance: 10 },
        ],
        residuals: [{ kind: 'cash', label: 'Cash', weight: 5 }],
        untargeted: 35,
      },
    ],
    position: null,
    unplaced: { positions: 0, cashBalances: 0, currencies: [], nativeTotals: [] },
    balanced: false,
    ...over,
  }
}

const PROFILE: InvestorProfile = {
  styleTags: ['dividend_income'],
  currencyTargets: [{ key: 'USD', low: 30, high: 50 }],
  sectorTargets: [],
  assetClassTargets: [],
  positionSize: { low: 0, high: 15 },
  updatedAt: Date.UTC(2026, 7, 1),
}

const inputs = (over: Partial<GroundingInputs> = {}): GroundingInputs => ({
  allocation: { status: 'ok', report: report() },
  profile: PROFILE,
  drift: { status: 'ok', report: drift() },
  ...over,
})

describe('buildAssistantContext', () => {
  it('keys every section by a category the owner actually read', () => {
    const context = buildAssistantContext(inputs())
    for (const key of Object.keys(context)) {
      expect(DISCLOSURE_CATEGORY_IDS).toContain(key)
    }
  })

  it('assembles the three sections this story grounds an answer in', () => {
    expect(Object.keys(buildAssistantContext(inputs())).sort()).toEqual([
      'holdings',
      'profile',
      'weights',
    ])
  })

  /**
   * The `performance` category is disclosed but not assembled here — Stories #285–#287 fill it.
   * The point of the assertion is that the gap is *deliberate*: sending an empty section would
   * tell the model a heading exists with nothing under it, which is an invitation to fill it in.
   */
  it('sends no performance section, rather than an empty one', () => {
    expect(buildAssistantContext(inputs())).not.toHaveProperty('performance')
  })

  /** Absent is absent. A store that has never been imported produces no composition sections. */
  it('omits both composition sections when nothing has been imported', () => {
    const context = buildAssistantContext(inputs({ allocation: { status: 'needs_import' } }))
    expect(context).not.toHaveProperty('holdings')
    expect(context).not.toHaveProperty('weights')
    expect(context).toHaveProperty('profile')
  })

  it('omits the profile section entirely when the owner has stated no policy and nothing measured', () => {
    const context = buildAssistantContext(
      inputs({ profile: EMPTY_INVESTOR_PROFILE, drift: { status: 'no_profile' } }),
    )
    expect(context).not.toHaveProperty('profile')
  })

  /**
   * The disclosure's own promise, enforced. `holdings` is declared as names and `weights` and
   * `profile` as percentages only, so **no amount of money may appear in any of them** — however
   * useful one would be to an answer. A currency symbol or a grouped thousands figure in these
   * sections is the disclosure becoming a lie.
   */
  it('puts no amount of money in a section disclosed as names or percentages', () => {
    const context = buildAssistantContext(inputs())
    for (const key of ['holdings', 'weights', 'profile'] as const) {
      const section = context[key] ?? ''
      expect(section, key).not.toMatch(/[€$£¥]/)
      // The market values in the fixtures — 12,345.67 and 50,000 — must not have survived.
      expect(section, key).not.toContain('12,345')
      expect(section, key).not.toContain('50,000')
    }
  })
})

describe('holdingsSection', () => {
  it('names the store and the date it is as of, so two clocks are never mixed', () => {
    expect(holdingsSection(report())).toContain('From imported Flex history, as of 2026-07-31')
  })

  it('carries the ticker, the name, the currency, the sector and the asset class', () => {
    const text = holdingsSection(report())
    expect(text).toContain('AAPL (Apple)')
    expect(text).toContain('currency USD')
    expect(text).toContain('sector Technology')
    expect(text).toContain('asset class STK')
  })

  /**
   * DDR-0066's trap, which reaches here like it reaches every view: IBKR writes the identifier
   * again where an instrument has no name, so a description that only repeats the symbol is not a
   * name. `instrumentName` is what every view uses, and using it here is what keeps an answer
   * saying `CAD` rather than `Cad`.
   */
  it('drops a description that only repeats the ticker', () => {
    const text = holdingsSection(report({ positions: [position({ symbol: 'CAD', description: 'CAD' })] }))
    expect(text).toContain('- CAD · currency')
    expect(text).not.toContain('Cad')
  })

  it('says a position is unclassified rather than leaving the field blank', () => {
    const text = holdingsSection(report({ positions: [position({ sector: '', assetCategory: '' })] }))
    expect(text).toContain('sector unclassified')
    expect(text).toContain('asset class unknown')
  })

  it('reports how many of the book it is holding, and cuts largest-first', () => {
    const many = Array.from({ length: MAX_LISTED_POSITIONS + 5 }, (_, index) =>
      position({ symbol: `S${index}`, percentOfNav: index }),
    )
    const text = holdingsSection(report({ positions: many }))
    expect(text).toContain(`The ${MAX_LISTED_POSITIONS} of ${many.length} open positions`.replace(' of ', ' largest of '))
    // The five smallest are the ones cut.
    expect(text).toContain('- S44 (Apple) ·')
    expect(text).not.toContain('- S0 (Apple) ·')
  })

  it('says so when the whole book is in front of the model', () => {
    expect(holdingsSection(report())).toContain('All 1 open position(s).')
  })

  it('reports the classification gap rather than leaving it to be inferred', () => {
    expect(holdingsSection(report({ unclassifiedCount: 3 }))).toContain(
      '3 of these have no sector',
    )
  })
})

describe('weightsSection', () => {
  it('quotes every weight in the app’s own percent format', () => {
    const text = weightsSection(report())
    expect(text).toContain('- AAPL: 24.50%')
    expect(text).toContain('- Stocks: 80.00%')
    expect(text).toContain('- USD: 60.00%')
    expect(text).toContain('- Technology: 40.00%')
    expect(text).toContain('- United States: 60.00%')
  })

  /** A breakdown the report does not carry is absent, not a heading with nothing under it. */
  it('omits a breakdown the report has no slices for', () => {
    const text = weightsSection(report({ bySector: [], byCountry: [] }))
    expect(text).not.toContain('By sector:')
    expect(text).not.toContain('By issuer country:')
    expect(text).toContain('By currency:')
  })
})

describe('profileSection', () => {
  it('states the style tags in the words the app shows them in', () => {
    const text = profileSection(PROFILE, { status: 'no_data' }) ?? ''
    expect(text).toContain('Investing style the owner states: Dividend income.')
  })

  it('writes every target as a range, both ends formatted', () => {
    const text = profileSection(PROFILE, { status: 'no_data' }) ?? ''
    expect(text).toContain('- Currency USD: 30.00%–50.00%')
    expect(text).toContain('- Any single position: 0.00%–15.00%')
  })

  /**
   * A gateway that is not running produces no weights at all, and none is invented to fill the
   * gap. The targets still go — the owner's policy is a local fact — but nothing is measured
   * against them (DDR-0022).
   */
  it.each(['no_data', 'not_connected', 'not_responding', 'error'] as const)(
    'measures nothing when drift came back %s',
    (status) => {
      const text = profileSection(PROFILE, { status, message: 'x' } as never) ?? ''
      expect(text).toContain('- Currency USD:')
      expect(text).not.toContain('Measured against the live portfolio')
    },
  )

  it('is absent, not empty, for an owner who has stated nothing and measured nothing', () => {
    expect(profileSection(EMPTY_INVESTOR_PROFILE, { status: 'no_profile' })).toBeNull()
  })

  it('does not open with a blank line when the owner set targets but no style', () => {
    const text = profileSection({ ...PROFILE, styleTags: [] }, { status: 'no_profile' }) ?? ''
    expect(text.startsWith('\n')).toBe(false)
    expect(text.startsWith('Targets the owner set:')).toBe(true)
  })
})

describe('measuredDrift', () => {
  it('names the live reading and the moment it was taken', () => {
    expect(measuredDrift(drift())).toContain(
      'Measured against the live portfolio, read 2026-08-28 09:15 UTC',
    )
  })

  it('states the verdict the service computed, rather than leaving it to be derived', () => {
    expect(measuredDrift(drift())).toContain('At least one target is currently outside its range.')
    expect(measuredDrift(drift({ balanced: true }))).toContain(
      'Every target is currently inside its range.',
    )
  })

  it('writes a band as actual, range, and the signed distance out of it', () => {
    expect(measuredDrift(drift())).toContain(
      '- USD: 60.00% against 30.00%–50.00% — above the range by +10.00%',
    )
  })

  /**
   * Surfaced, never redistributed (DDR-0095). A dimension whose bands sum to 60% has to account
   * for the rest, or the model reads the gap as rounding and explains it away.
   */
  it('reports residuals and untargeted weight as their own lines', () => {
    const text = measuredDrift(drift())
    expect(text).toContain('- Cash (no target applies): 5.00%')
    expect(text).toContain('- Held in categories with no target: 35.00%')
  })

  /**
   * DDR-0007, at its sharpest. An unconvertible holding has **no percentage** — there is no rate
   * with which to compute one — so it is reported as a count and a currency, and the text says
   * outright that no percentage exists for it.
   */
  it('reports unplaced holdings as counts and currencies, never as a weight', () => {
    const text = measuredDrift(
      drift({
        unplaced: {
          positions: 2,
          cashBalances: 1,
          currencies: ['CHF', 'JPY'],
          nativeTotals: [
            { currency: 'CHF', amount: 1_234 },
            { currency: 'JPY', amount: 90_000 },
          ],
        },
      }),
    )
    expect(text).toContain('2 holding(s) and 1 cash balance(s) could not be valued in EUR (CHF, JPY)')
    expect(text).toContain('no percentage exists for them')
    // Never as an amount, either: the native totals are money and this section is percentages.
    expect(text).not.toContain('1,234')
    expect(text).not.toContain('90,000')
  })

  /** The ceiling is a lower bound where something could not be valued, and says so. */
  it('marks a bounded concentration figure as the lower bound it is', () => {
    const text = measuredDrift(
      drift({
        position: {
          symbol: 'AAPL',
          name: 'Apple Inc',
          actual: 24.5,
          low: 0,
          high: 15,
          status: 'above',
          distance: 9.5,
          bounded: true,
        },
      }),
    )
    expect(text).toContain('Largest single position: AAPL (Apple Inc) at 24.50%')
    expect(text).toContain('This is a lower bound')
  })

  it('says nothing about a lower bound when everything could be valued', () => {
    const text = measuredDrift(
      drift({
        position: {
          symbol: 'AAPL',
          name: null,
          actual: 10,
          low: 0,
          high: 15,
          status: 'inside',
          distance: 0,
          bounded: false,
        },
      }),
    )
    expect(text).toContain('AAPL at 10.00%')
    expect(text).toContain('inside the range')
    expect(text).not.toContain('lower bound')
  })
})

describe('hasProfile', () => {
  it('is false for the profile of an owner who never wrote one', () => {
    expect(hasProfile(EMPTY_INVESTOR_PROFILE)).toBe(false)
  })

  it('is true once any policy is stated, targets or style alone', () => {
    expect(hasProfile(PROFILE)).toBe(true)
    expect(hasProfile({ ...EMPTY_INVESTOR_PROFILE, styleTags: ['dividend_income'] })).toBe(true)
  })
})
