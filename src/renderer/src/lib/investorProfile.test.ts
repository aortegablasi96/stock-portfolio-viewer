import { describe, expect, it } from 'vitest'
import {
  draftFromForm,
  duplicateRowIds,
  formFromProfile,
  isFormDirty,
  isFormValid,
  isRowBlank,
  newTargetRow,
  parsePercent,
  percentText,
  positionIssue,
  profileSummary,
  rowIssue,
  rowMessage,
  type ProfileFormState,
  type TargetRowDraft,
} from './investorProfile'
import {
  EMPTY_INVESTOR_PROFILE,
  type InvestorProfile,
  type InvestorProfileDraft,
} from '@shared/domain/investorProfileTerms'

/**
 * The Profile form's rules (Story #280, DDR-0094).
 *
 * The subject is the one form in the app with real validation behind it, and Vitest runs
 * Node-only with no jsdom (DDR-0029) — so the rules are here, out of the component, and this is
 * what asserts them. What matters most is the pair of asymmetries the acceptance criteria turn
 * on: a **blank** is not a zero, and a **blank row** is not a fault.
 */

const form = (overrides: Partial<ProfileFormState> = {}): ProfileFormState => ({
  styleTags: new Set(),
  currency: [],
  sector: [],
  assetClass: [],
  positionSize: null,
  ...overrides,
})

const row = (overrides: Partial<TargetRowDraft> = {}): TargetRowDraft => ({
  ...newTargetRow(),
  ...overrides,
})

describe('parsePercent', () => {
  /**
   * The asymmetry the whole "a partial profile is valid" criterion rests on. A blank that read as
   * 0 would turn "I have no policy on cash" into "I want no cash", which is a different statement
   * and one the owner never made.
   */
  it('reads a blank as no value rather than as zero', () => {
    expect(parsePercent('')).toBeNull()
    expect(parsePercent('   ')).toBeNull()
    expect(parsePercent('0')).toBe(0)
  })

  it('reads a decimal, because a 12.5% ceiling is a policy someone holds', () => {
    expect(parsePercent('12.5')).toBe(12.5)
  })

  /** The owner's locale is not the app's; rejecting a comma would be a fault they cannot see. */
  it('accepts a comma decimal separator', () => {
    expect(parsePercent('12,5')).toBe(12.5)
  })

  it.each(['abc', '1.2.3', '', '%', 'NaN', 'Infinity'])('reads %o as no value', (text) => {
    expect(parsePercent(text)).toBeNull()
  })

  it('round-trips a stored percentage without inventing decimal places', () => {
    expect(percentText(8)).toBe('8')
    expect(parsePercent(percentText(12.5))).toBe(12.5)
  })
})

describe('a row the owner added and has not filled in', () => {
  /** Complaining the moment the row appears would fault the owner for clicking "Add". */
  it('is not a fault', () => {
    const blank = row()
    expect(isRowBlank(blank)).toBe(true)
    expect(rowIssue(blank, 'currency')).toBeNull()
    expect(isFormValid(form({ currency: [blank] }))).toBe(true)
  })

  it('is dropped rather than stored, so changing your mind costs nothing', () => {
    const draft = draftFromForm(form({ currency: [row(), row()] }))
    expect(draft?.currencyTargets).toEqual([])
  })

  /** One filled field makes it a row the owner meant, and then the rest is required. */
  it('becomes a fault as soon as any field is filled', () => {
    expect(rowIssue(row({ high: '40' }), 'currency')).toBe('Choose a currency.')
    expect(rowIssue(row({ key: 'USD' }), 'currency')).toBe('Enter a minimum and a maximum.')
  })
})

describe('rowIssue', () => {
  it('accepts a range at both extremes, and a degenerate one', () => {
    expect(rowIssue(row({ key: 'USD', low: '0', high: '100' }), 'currency')).toBeNull()
    expect(rowIssue(row({ key: 'USD', low: '50', high: '50' }), 'currency')).toBeNull()
  })

  it('rejects an inverted range', () => {
    expect(rowIssue(row({ key: 'USD', low: '60', high: '40' }), 'currency')).toBe(
      'The minimum must not be above the maximum.',
    )
  })

  it.each([
    ['above 100', '0', '101'],
    ['below 0', '-1', '40'],
  ])('rejects a bound %s', (_case, low, high) => {
    expect(rowIssue(row({ key: 'USD', low, high }), 'currency')).toBe(
      'Percentages run from 0 to 100.',
    )
  })

  /** The message names the dimension, so a page with three sections says which one to look at. */
  it('names the dimension a key is missing from', () => {
    expect(rowIssue(row({ low: '0', high: '10' }), 'sector')).toBe('Choose a sector.')
    expect(rowIssue(row({ low: '0', high: '10' }), 'assetClass')).toBe('Choose an asset class.')
  })
})

describe('positionIssue', () => {
  /** `null` is "no policy on position size", which is valid and is the default. */
  it('reports nothing for an absent band', () => {
    expect(positionIssue(null)).toBeNull()
  })

  it('accepts a band whose low is 0, which is the pure ceiling case', () => {
    expect(positionIssue({ low: '0', high: '8' })).toBeNull()
  })

  it('rejects an inverted band and an out-of-range bound', () => {
    expect(positionIssue({ low: '10', high: '5' })).toBe(
      'The minimum must not be above the maximum.',
    )
    expect(positionIssue({ low: '0', high: '120' })).toBe('Percentages run from 0 to 100.')
  })

  /** A band, once added, has to be completed or removed — half a band is not a policy. */
  it('rejects a half-typed band rather than filling the other half', () => {
    expect(positionIssue({ low: '', high: '8' })).toBe('Enter a minimum and a maximum.')
  })
})

describe('duplicates within one dimension', () => {
  it('flags the later row, so the first statement of a policy is never the one faulted', () => {
    const first = row({ id: 'a', key: 'USD', low: '0', high: '40' })
    const second = row({ id: 'b', key: 'USD', low: '10', high: '50' })

    expect([...duplicateRowIds([first, second])]).toEqual(['b'])
  })

  it('matches case-insensitively, because the vocabularies are not case-sensitive', () => {
    const rows = [row({ id: 'a', key: 'USD' }), row({ id: 'b', key: 'usd' })]
    expect([...duplicateRowIds(rows)]).toEqual(['b'])
  })

  /** Two unfilled rows are not two policies for one exposure. */
  it('exempts blank rows', () => {
    expect(duplicateRowIds([row(), row()]).size).toBe(0)
  })

  it('reports the duplicate rather than the row’s own fault', () => {
    const rows = [
      row({ id: 'a', key: 'EUR', low: '0', high: '40' }),
      row({ id: 'b', key: 'EUR', low: '90', high: '10' }),
    ]
    const duplicates = duplicateRowIds(rows)

    expect(rowMessage(rows[1]!, 'currency', duplicates)).toBe(
      'Currency EUR is already listed above.',
    )
  })
})

describe('draftFromForm', () => {
  it('refuses to build a draft while anything is wrong', () => {
    expect(draftFromForm(form({ currency: [row({ key: 'USD', low: '60', high: '40' })] }))).toBeNull()
    expect(draftFromForm(form({ positionSize: { low: '9', high: '2' } }))).toBeNull()
  })

  it('builds the empty draft from an untouched form, because that is a valid profile', () => {
    expect(draftFromForm(form())).toEqual({
      styleTags: [],
      currencyTargets: [],
      sectorTargets: [],
      assetClassTargets: [],
      positionSize: null,
    })
  })

  /** Tags come back in declaration order however the set was built, so the wire shape is stable. */
  it('orders style tags by declaration, not by selection', () => {
    const draft = draftFromForm(
      form({ styleTags: new Set(['high_growth_sectors', 'dividend_income']) }),
    )
    expect(draft?.styleTags).toEqual(['dividend_income', 'high_growth_sectors'])
  })

  it('trims a typed key but leaves its spelling to the service', () => {
    const draft = draftFromForm(form({ sector: [row({ key: '  Financial ', low: '5', high: '25' })] }))
    expect(draft?.sectorTargets).toEqual([{ key: 'Financial', low: 5, high: 25 }])
  })

  it('carries a position band through as numbers', () => {
    const draft = draftFromForm(form({ positionSize: { low: '1', high: '7.5' } }))
    expect(draft?.positionSize).toEqual({ low: 1, high: 7.5 })
  })
})

describe('formFromProfile', () => {
  const stored: InvestorProfile = {
    styleTags: ['dividend_income'],
    currencyTargets: [{ key: 'USD', low: 20, high: 40 }],
    sectorTargets: [],
    assetClassTargets: [],
    positionSize: { low: 0, high: 8 },
    updatedAt: 1_756_000_000_000,
  }

  it('seeds a form that rebuilds the profile it came from', () => {
    const draft = draftFromForm(formFromProfile(stored))
    expect(draft).toEqual({
      styleTags: stored.styleTags,
      currencyTargets: stored.currencyTargets,
      sectorTargets: [],
      assetClassTargets: [],
      positionSize: stored.positionSize,
    })
  })

  it('gives every row a distinct id, so two rows never collide as React keys', () => {
    const seeded = formFromProfile({
      ...EMPTY_INVESTOR_PROFILE,
      currencyTargets: [
        { key: 'EUR', low: 0, high: 60 },
        { key: 'USD', low: 0, high: 60 },
      ],
    })
    const ids = seeded.currency.map((r) => r.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('leaves an absent position band absent rather than adding an empty one', () => {
    expect(formFromProfile(EMPTY_INVESTOR_PROFILE).positionSize).toBeNull()
  })
})

describe('isFormDirty', () => {
  const stored: InvestorProfileDraft = {
    styleTags: ['dividend_income'],
    currencyTargets: [{ key: 'USD', low: 20, high: 40 }],
    sectorTargets: [],
    assetClassTargets: [],
    positionSize: null,
  }

  it('reports a freshly seeded form as unchanged', () => {
    expect(isFormDirty(formFromProfile(stored), stored)).toBe(false)
  })

  /** Row order is not policy: dragging two targets past each other changes nothing. */
  it('ignores the order rows happen to be in', () => {
    const twoTargets: InvestorProfileDraft = {
      ...stored,
      currencyTargets: [
        { key: 'EUR', low: 0, high: 60 },
        { key: 'USD', low: 0, high: 40 },
      ],
    }
    const seeded = formFromProfile(twoTargets)
    const reversed = { ...seeded, currency: [...seeded.currency].reverse() }

    expect(isFormDirty(reversed, twoTargets)).toBe(false)
  })

  it('ignores a retyped number that means the same thing', () => {
    const seeded = formFromProfile(stored)
    const retyped = {
      ...seeded,
      currency: [{ ...seeded.currency[0]!, low: '20.0' }],
    }
    expect(isFormDirty(retyped, stored)).toBe(false)
  })

  it('reports a real edit', () => {
    const seeded = formFromProfile(stored)
    const edited = { ...seeded, currency: [{ ...seeded.currency[0]!, high: '55' }] }
    expect(isFormDirty(edited, stored)).toBe(true)
  })

  /**
   * An invalid form is always dirty. There is nothing to compare it with, and reporting it as
   * saved would be wrong in the one state where the owner most needs to know it is not.
   */
  it('reports an invalid form as changed', () => {
    const seeded = formFromProfile(stored)
    const broken = { ...seeded, currency: [{ ...seeded.currency[0]!, low: '99' }] }
    expect(isFormValid(broken)).toBe(false)
    expect(isFormDirty(broken, stored)).toBe(true)
  })
})

describe('profileSummary', () => {
  /** An owner who has written nothing is told what the page is for, not given a tally of zeros. */
  it('says what an empty profile means rather than counting it', () => {
    expect(profileSummary(EMPTY_INVESTOR_PROFILE)).toBe(
      'No profile set — the assistant has no standard to measure against yet.',
    )
  })

  it('counts tags and targets, with the position band counting as one target', () => {
    expect(
      profileSummary({
        styleTags: ['dividend_income'],
        currencyTargets: [{ key: 'USD', low: 0, high: 40 }],
        sectorTargets: [],
        assetClassTargets: [],
        positionSize: { low: 0, high: 8 },
        updatedAt: 1,
      }),
    ).toBe('1 style tag · 2 targets')
  })

  it('pluralises both nouns independently', () => {
    expect(
      profileSummary({
        ...EMPTY_INVESTOR_PROFILE,
        styleTags: ['dividend_income', 'mature_large_cap'],
        currencyTargets: [{ key: 'USD', low: 0, high: 40 }],
      }),
    ).toBe('2 style tags · 1 target')
  })
})
