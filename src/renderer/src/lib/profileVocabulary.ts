import type { AllocationReport, AllocationSlice } from '@shared/domain/allocation'
import type { TargetDimension } from '@shared/domain/investorProfileTerms'
import type { ProfileFormState, TargetRowDraft } from './investorProfile'
import { FORM_FIELDS } from './investorProfile'

/**
 * Where the Profile form's currency, sector and asset-class terms come from (Story #280).
 *
 * The acceptance criterion has two halves that pull against each other, and the whole of this
 * module is the line between them. **The vocabularies come from the app's own data** — a sector
 * target only means something against the names the classification domain produces (DDR-0009), a
 * currency target against the currencies the holdings carry — so the form offers exactly those
 * rather than a free-text box that invites `Techonolgy`. **And a target naming a category the
 * portfolio does not currently hold is preserved rather than dropped or read as zero** — so what
 * the app knows about is a *suggestion*, never a constraint, and a term that reaches the form
 * from the stored profile is offered beside the held ones and marked as not currently held.
 *
 * The source is the allocation report, which the Profile view reads over the existing
 * `analytics:getAllocation` channel rather than through a channel of its own: the three
 * breakdowns it already returns are precisely the three vocabularies, they are already grouped
 * and labelled, and a second channel computing the same thing would be a second answer that could
 * disagree. It follows that an owner with nothing imported gets no suggestions — `needs_import`
 * is not an error here, it is a portfolio the app has never seen — and the form still works,
 * because a term may always be typed.
 */

/** One offered term: what is stored, how it reads, and whether the portfolio currently holds it. */
export interface VocabularyTerm {
  /** The stored key — a currency code, a sector name, an asset-category code. */
  readonly key: string
  /** How it is written in the control. */
  readonly label: string
  /** `false` for a term that reaches the list only from the profile itself. */
  readonly held: boolean
}

export type ProfileVocabulary = Record<TargetDimension, readonly VocabularyTerm[]>

/**
 * The terms to offer in each dimension: what the portfolio holds, plus what the form already
 * names, sorted by label and never duplicated.
 *
 * The form rather than the stored profile is the second source, so a term the owner typed a
 * moment ago is offered to the row below it without a save in between.
 */
export function vocabularyFrom(
  report: AllocationReport | null,
  form: ProfileFormState,
): ProfileVocabulary {
  return {
    currency: merge(slicesOf(report?.byCurrency), form[FORM_FIELDS.currency]),
    sector: merge(slicesOf(report?.bySector), form[FORM_FIELDS.sector]),
    assetClass: merge(slicesOf(report?.byAssetClass), form[FORM_FIELDS.assetClass]),
  }
}

/**
 * The report's own terms for one dimension. **A slice with a blank key is not a term.**
 *
 * That blank is not a formality, it is how the allocation report spells *absence*: unclassified
 * positions group under the empty sector and are labelled "Unclassified" for the view (the label
 * is the prose, the key is the data). Offering it as something to hold a target for would be
 * offering "I intend 10% of my portfolio to be instruments IBKR has not told me the sector of",
 * which is not a policy. Story #281 measures the same absence as a *surfaced residual* rather
 * than a bucket, for the same reason (DDR-0095).
 *
 * It is filtered from the **suggestions** only: a key already in the profile is listed either
 * way, like any other unheld term.
 */
function slicesOf(slices: readonly AllocationSlice[] | undefined): VocabularyTerm[] {
  return (slices ?? [])
    .filter((slice) => slice.key.trim() !== '')
    .map((slice) => ({ key: slice.key, label: slice.label || slice.key, held: true }))
}

/**
 * Held terms first-class, form terms added where they are new.
 *
 * Matching is case-insensitive, which is what makes `usd` typed into a row resolve to the held
 * `USD` rather than appearing beside it as a second, unheld currency. The held term wins the
 * spelling, because it is the one the report and every later join will use.
 */
function merge(
  held: readonly VocabularyTerm[],
  rows: readonly TargetRowDraft[],
): readonly VocabularyTerm[] {
  const terms = new Map(held.map((term) => [term.key.toUpperCase(), term]))

  for (const row of rows) {
    const key = row.key.trim()
    if (key === '') continue
    const id = key.toUpperCase()
    if (!terms.has(id)) terms.set(id, { key, label: key, held: false })
  }

  return [...terms.values()].sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The terms still suggested to a row: everything in the dimension, minus what other rows claim.
 *
 * A row keeps its own term, so the suggestion list never contradicts the value already in the
 * box. It loses every term another row names, which is how a duplicate becomes hard to reach
 * *through the control* — but never impossible, because the list is a `<datalist>` and a term can
 * always be typed. That is why `rowMessage` still reports duplicates: the control discourages
 * them and the validator refuses them, and only the second is a guarantee.
 */
export function availableTerms(
  terms: readonly VocabularyTerm[],
  rows: readonly TargetRowDraft[],
  rowId: string,
): readonly VocabularyTerm[] {
  const claimed = new Set(
    rows
      .filter((row) => row.id !== rowId)
      .map((row) => row.key.trim().toUpperCase())
      .filter((key) => key !== ''),
  )
  return terms.filter((term) => !claimed.has(term.key.toUpperCase()))
}
