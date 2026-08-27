import { describe, expect, it } from 'vitest'
import { availableTerms, vocabularyFrom, type VocabularyTerm } from './profileVocabulary'
import { newTargetRow, type ProfileFormState, type TargetRowDraft } from './investorProfile'
import type { AllocationReport, AllocationSlice } from '@shared/domain/allocation'

/**
 * Where the Profile form's terms come from (Story #280).
 *
 * The acceptance criterion has two halves that pull against each other and this module is the
 * line between them: the vocabularies **come from the app's own data**, and a target naming a
 * category the portfolio does not hold is **preserved rather than dropped or read as zero**. Both
 * halves are asserted here, along with the case that gives the second one its teeth — a report
 * that arrives with nothing imported at all.
 */

const slice = (key: string, label = key): AllocationSlice => ({
  key,
  label,
  marketValueBase: 1000,
  percentOfNav: 10,
})

const report = (overrides: Partial<AllocationReport> = {}): AllocationReport => ({
  baseCurrency: 'EUR',
  reportDate: 1_756_000_000_000,
  totalMarketValueBase: 10_000,
  positions: [],
  byAssetClass: [slice('STK', 'Stocks'), slice('CASH', 'Cash')],
  byCurrency: [slice('EUR'), slice('USD')],
  byCountry: [],
  // The real shape of an unclassified slice: the **key is blank** and 'Unclassified' is only
  // the label. A fixture keyed 'Unclassified' would be a fixture the service never produces —
  // and would have let an exclusion list that matches nothing look like it was working.
  bySector: [slice('Financial'), slice('Technology'), slice('', 'Unclassified')],
  unclassifiedCount: 1,
  ...overrides,
})

const row = (key: string): TargetRowDraft => ({ ...newTargetRow(), key })

const form = (overrides: Partial<ProfileFormState> = {}): ProfileFormState => ({
  styleTags: new Set(),
  currency: [],
  sector: [],
  assetClass: [],
  positionSize: null,
  ...overrides,
})

const keysOf = (terms: readonly VocabularyTerm[]): string[] => terms.map((t) => t.key)

describe('vocabularyFrom', () => {
  it('offers what the portfolio holds, in each of the three dimensions', () => {
    const vocabulary = vocabularyFrom(report(), form())

    expect(keysOf(vocabulary.currency)).toEqual(['EUR', 'USD'])
    expect(keysOf(vocabulary.assetClass)).toEqual(['CASH', 'STK'])
    expect(vocabulary.currency.every((term) => term.held)).toBe(true)
  })

  it('sorts by the label a reader sees, not by the key that is stored', () => {
    // 'CASH' sorts before 'STK' by key; 'Cash' before 'Stocks' by label. They agree here by
    // accident, so the case that distinguishes them is one where they do not.
    const vocabulary = vocabularyFrom(
      report({ byAssetClass: [slice('STK', 'Bonds'), slice('BOND', 'Stocks')] }),
      form(),
    )
    expect(vocabulary.assetClass.map((t) => t.label)).toEqual(['Bonds', 'Stocks'])
  })

  /**
   * "I intend 10% of my portfolio to be instruments IBKR has not told me the sector of" is not a
   * policy. The slice is real and carries a real weight; it is just not something to target — and
   * the allocation report spells that absence as a **blank key** with 'Unclassified' as its
   * label, which is why the blank-key filter is the one doing this work. Story #281 measures the
   * same absence as a surfaced residual rather than a bucket (DDR-0095).
   */
  it('does not offer the unclassified sector as something to hold a target for', () => {
    const vocabulary = vocabularyFrom(report(), form())

    expect(keysOf(vocabulary.sector)).toEqual(['Financial', 'Technology'])
    expect(vocabulary.sector.map((t) => t.label)).not.toContain('Unclassified')
  })

  /**
   * The acceptance criterion the vocabularies exist to *not* enforce. A term reaching the list
   * only from the form is offered beside the held ones and marked, so the control can say so.
   */
  it('keeps a term the portfolio does not hold, and marks it as unheld', () => {
    const vocabulary = vocabularyFrom(report(), form({ currency: [row('CHF')] }))

    expect(keysOf(vocabulary.currency)).toEqual(['CHF', 'EUR', 'USD'])
    expect(vocabulary.currency.find((t) => t.key === 'CHF')?.held).toBe(false)
  })

  /**
   * `needs_import` is not an error here — it is a portfolio the app has never seen. The form must
   * still work, because a term may always be typed.
   */
  it('offers only what the form names when nothing has been imported', () => {
    const vocabulary = vocabularyFrom(null, form({ sector: [row('Utilities')] }))

    expect(keysOf(vocabulary.sector)).toEqual(['Utilities'])
    expect(keysOf(vocabulary.currency)).toEqual([])
  })

  /** The held term wins the spelling: it is what the report and every later join will use. */
  it('resolves a differently-cased typed term onto the held one rather than listing both', () => {
    const vocabulary = vocabularyFrom(report(), form({ currency: [row('usd')] }))

    expect(keysOf(vocabulary.currency)).toEqual(['EUR', 'USD'])
    expect(vocabulary.currency.find((t) => t.key === 'USD')?.held).toBe(true)
  })

  it('ignores a blank row and a keyless slice', () => {
    const vocabulary = vocabularyFrom(
      report({ byCurrency: [slice('EUR'), slice('')] }),
      form({ currency: [newTargetRow()] }),
    )
    expect(keysOf(vocabulary.currency)).toEqual(['EUR'])
  })

  /** A form term added a moment ago is offered to the row below it without a save in between. */
  it('reads the form rather than the stored profile, so a new term is offered immediately', () => {
    const vocabulary = vocabularyFrom(report(), form({ sector: [row('Utilities')] }))
    expect(keysOf(vocabulary.sector)).toContain('Utilities')
  })
})

describe('availableTerms', () => {
  const TERMS: VocabularyTerm[] = [
    { key: 'EUR', label: 'EUR', held: true },
    { key: 'USD', label: 'USD', held: true },
    { key: 'GBP', label: 'GBP', held: true },
  ]

  /**
   * A row's own term is never taken off its own suggestion list: a list that omitted the value
   * already in the box would contradict it, and would offer the owner no way back to it after a
   * stray keystroke.
   */
  it('leaves a row its own term', () => {
    const rows = [{ ...newTargetRow(), id: 'a', key: 'EUR' }]
    expect(keysOf(availableTerms(TERMS, rows, 'a'))).toContain('EUR')
  })

  it('takes away every term another row already claims', () => {
    const rows = [
      { ...newTargetRow(), id: 'a', key: 'EUR' },
      { ...newTargetRow(), id: 'b', key: 'USD' },
    ]
    expect(keysOf(availableTerms(TERMS, rows, 'b'))).toEqual(['USD', 'GBP'])
  })

  it('matches a claim case-insensitively', () => {
    const rows = [{ ...newTargetRow(), id: 'a', key: 'eur' }]
    expect(keysOf(availableTerms(TERMS, rows, 'b'))).toEqual(['USD', 'GBP'])
  })

  it('ignores blank rows, which claim nothing', () => {
    expect(availableTerms(TERMS, [newTargetRow()], 'x')).toHaveLength(3)
  })
})

/**
 * The list is a `<datalist>` rather than a `<select>`, so exhausting it locks nothing: a term can
 * always be typed, which is what lets an owner state a policy for an exposure they intend to take
 * before they take it. Nothing here should ever return "no rows may be added".
 */
describe('an exhausted vocabulary still lets a row be added', () => {
  const TERMS: VocabularyTerm[] = [{ key: 'EUR', label: 'EUR', held: true }]

  it('simply suggests nothing once every term is claimed', () => {
    expect(availableTerms(TERMS, [{ ...newTargetRow(), id: 'a', key: 'EUR' }], 'b')).toEqual([])
  })

  it('suggests nothing at all with nothing imported and nothing typed', () => {
    expect(availableTerms([], [], 'a')).toEqual([])
  })
})
