import {
  STYLE_TAGS,
  TARGET_DIMENSIONS,
  TARGET_DIMENSION_ARTICLES,
  TARGET_DIMENSION_LABELS,
  type CategoryTarget,
  type InvestorProfile,
  type InvestorProfileDraft,
  type StyleTag,
  type TargetDimension,
} from '@shared/domain/investorProfileTerms'

/**
 * The Profile view's form logic (Story #280, DDR-0094).
 *
 * Here rather than in the component for the reason everything in `lib/` is here: Vitest runs
 * Node-only with no jsdom (DDR-0029), so nothing inside a component is testable — and this is the
 * one form in the app with real rules behind it, which makes it exactly the thing that must not
 * live where nothing can assert it.
 *
 * **The form holds strings, not numbers.** A percentage input mid-typing is `''`, `'1'`, `'12.'` —
 * none of which is a number, and all of which a `number`-typed state would have to coerce into
 * one, silently rewriting what the owner is typing. So the draft is text and {@link draftFromForm}
 * is the one place it becomes a profile, which is also the one place a fault can be reported.
 *
 * **Nothing here is the boundary.** The IPC handler parses the same rules with Zod and rejects a
 * bad payload before storage (ADR-0002); this module exists so the owner is told which row is
 * wrong *while* they type, rather than by a sentence about the whole document after they save.
 * The two agree by having the same rules written once each — a duplication that is deliberate,
 * because the renderer cannot import Zod (the contract is types-only in this bundle) and the
 * boundary cannot import a message written for one row of a form it never sees.
 */

/** One target row as the form holds it: the key and both bounds as typed. */
export interface TargetRowDraft {
  /** Stable React key. Rows have no natural identity — the owner may blank one out and retype it. */
  readonly id: string
  readonly key: string
  readonly low: string
  readonly high: string
}

/** The whole form. `styleTags` is a set because the control is multi-select. */
export interface ProfileFormState {
  readonly styleTags: ReadonlySet<StyleTag>
  readonly currency: readonly TargetRowDraft[]
  readonly sector: readonly TargetRowDraft[]
  readonly assetClass: readonly TargetRowDraft[]
  /** `null` when the owner states no position policy; the "Add" control creates the pair. */
  readonly positionSize: { readonly low: string; readonly high: string } | null
}

/**
 * Row ids, from a counter rather than from the row's contents.
 *
 * A key would be the obvious id and is the wrong one: it starts blank on every added row, so two
 * new rows would collide, and it changes as the owner types, which would remount the input they
 * are typing into and cost them the caret.
 */
let rowSequence = 0
export function newTargetRow(): TargetRowDraft {
  rowSequence += 1
  return { id: `target-${rowSequence}`, key: '', low: '', high: '' }
}

/** Seed the form from a stored profile. The inverse of {@link draftFromForm} for a valid form. */
export function formFromProfile(profile: InvestorProfileDraft): ProfileFormState {
  return {
    styleTags: new Set(profile.styleTags),
    currency: profile.currencyTargets.map(rowFromTarget),
    sector: profile.sectorTargets.map(rowFromTarget),
    assetClass: profile.assetClassTargets.map(rowFromTarget),
    positionSize:
      profile.positionSize === null
        ? null
        : { low: percentText(profile.positionSize.low), high: percentText(profile.positionSize.high) },
  }
}

function rowFromTarget(target: CategoryTarget): TargetRowDraft {
  return {
    ...newTargetRow(),
    key: target.key,
    low: percentText(target.low),
    high: percentText(target.high),
  }
}

/**
 * A stored percentage as the form shows it.
 *
 * `String(n)` rather than a fixed decimal count: 8 must come back as `'8'`, not `'8.00'`, or
 * seeding the form from a profile would look like an edit the owner did not make.
 */
export function percentText(value: number): string {
  return String(value)
}

/** Which form field each dimension's rows live in. */
export const FORM_FIELDS = {
  currency: 'currency',
  sector: 'sector',
  assetClass: 'assetClass',
} as const satisfies Record<TargetDimension, keyof ProfileFormState>

/**
 * A typed percentage, or `null` when the text is not one.
 *
 * Blank is `null` rather than 0 — the difference between "no policy here" and "a policy of zero"
 * is the whole reason a partial profile is valid, and a blank that read as 0 would erase it. A
 * comma decimal separator is accepted because the owner's locale is not the app's: `'12,5'` is
 * how half of Europe types it, and rejecting it would be a fault the owner cannot see.
 */
export function parsePercent(text: string): number | null {
  const trimmed = text.trim().replace(',', '.')
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** Whether a percentage is inside the only range a weight can occupy. */
export function isPercentInRange(value: number): boolean {
  return value >= 0 && value <= 100
}

/**
 * A row the owner added and has not filled in at all.
 *
 * It is neither saved nor reported as a fault: an empty row is the form's own affordance for
 * "add one", and complaining about it the moment it appears would fault the owner for clicking
 * the button. It simply does not become a target.
 */
export function isRowBlank(row: TargetRowDraft): boolean {
  return row.key.trim() === '' && row.low.trim() === '' && row.high.trim() === ''
}

/**
 * What is wrong with one row, in the owner's words, or `null` when nothing is.
 *
 * One message rather than a list: the row has three inputs and a sentence under it, and the first
 * fault is the one to fix. Order is the reading order of the row.
 */
export function rowIssue(row: TargetRowDraft, dimension: TargetDimension): string | null {
  if (isRowBlank(row)) return null

  const noun = TARGET_DIMENSION_LABELS[dimension].toLowerCase()
  if (row.key.trim() === '') {
    return `Choose ${TARGET_DIMENSION_ARTICLES[dimension]} ${noun}.`
  }

  const low = parsePercent(row.low)
  const high = parsePercent(row.high)
  if (low === null || high === null) return 'Enter a minimum and a maximum.'
  if (!isPercentInRange(low) || !isPercentInRange(high)) return 'Percentages run from 0 to 100.'
  if (low > high) return 'The minimum must not be above the maximum.'
  return null
}

/** The same question for the position band, which has no key to name. */
export function positionIssue(band: ProfileFormState['positionSize']): string | null {
  if (band === null) return null

  const low = parsePercent(band.low)
  const high = parsePercent(band.high)
  if (low === null || high === null) return 'Enter a minimum and a maximum.'
  if (!isPercentInRange(low) || !isPercentInRange(high)) return 'Percentages run from 0 to 100.'
  if (low > high) return 'The minimum must not be above the maximum.'
  return null
}

/**
 * The rows in one dimension that name a key some earlier row already named.
 *
 * Reported per row rather than per dimension so the message lands where the owner can act on it,
 * and on the *later* row so the first statement of a policy is never the one flagged. Blank rows
 * are exempt: two unfilled rows are not two policies for one exposure.
 */
export function duplicateRowIds(
  rows: readonly TargetRowDraft[],
): ReadonlySet<string> {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of rows) {
    const key = row.key.trim().toUpperCase()
    if (key === '') continue
    if (seen.has(key)) duplicates.add(row.id)
    seen.add(key)
  }
  return duplicates
}

/** Everything wrong with a row: its own fault, or that it repeats an earlier one. */
export function rowMessage(
  row: TargetRowDraft,
  dimension: TargetDimension,
  duplicates: ReadonlySet<string>,
): string | null {
  if (duplicates.has(row.id)) {
    return `${TARGET_DIMENSION_LABELS[dimension]} ${row.key.trim()} is already listed above.`
  }
  return rowIssue(row, dimension)
}

/** Whether the form as it stands could be stored. */
export function isFormValid(form: ProfileFormState): boolean {
  if (positionIssue(form.positionSize) !== null) return false
  return TARGET_DIMENSIONS.every((dimension) => {
    const rows = form[FORM_FIELDS[dimension]]
    const duplicates = duplicateRowIds(rows)
    return rows.every((row) => rowMessage(row, dimension, duplicates) === null)
  })
}

/**
 * The form as a draft the IPC channel accepts, or `null` when it does not yet validate.
 *
 * Blank rows are dropped rather than sent, which is what makes "add a row, change your mind"
 * cost nothing. Everything else is sent exactly as typed — the service canonicalises order and
 * case, and it is the only layer that may.
 */
export function draftFromForm(form: ProfileFormState): InvestorProfileDraft | null {
  if (!isFormValid(form)) return null

  const band = form.positionSize
  return {
    styleTags: STYLE_TAGS.filter((tag) => form.styleTags.has(tag)),
    currencyTargets: targetsFrom(form.currency),
    sectorTargets: targetsFrom(form.sector),
    assetClassTargets: targetsFrom(form.assetClass),
    positionSize:
      band === null
        ? null
        : { low: parsePercent(band.low) ?? 0, high: parsePercent(band.high) ?? 0 },
  }
}

function targetsFrom(rows: readonly TargetRowDraft[]): CategoryTarget[] {
  return rows
    .filter((row) => !isRowBlank(row))
    .map((row) => ({
      key: row.key.trim(),
      low: parsePercent(row.low) ?? 0,
      high: parsePercent(row.high) ?? 0,
    }))
}

/**
 * Whether the form states something the stored profile does not.
 *
 * Compared as *drafts* rather than as form state, so re-ordering rows or retyping `08` as `8` is
 * correctly not a change. An invalid form is always "changed": there is nothing to compare, and
 * reporting it as saved would be wrong in the one state where the owner most needs to know it is
 * not.
 */
export function isFormDirty(form: ProfileFormState, stored: InvestorProfileDraft): boolean {
  const draft = draftFromForm(form)
  if (draft === null) return true
  return JSON.stringify(canonical(draft)) !== JSON.stringify(canonical(stored))
}

/** Order-insensitive form of a draft, so two statements of one policy compare equal. */
function canonical(draft: InvestorProfileDraft): unknown {
  const sortTargets = (targets: readonly CategoryTarget[]): CategoryTarget[] =>
    [...targets]
      .map((t) => ({ ...t, key: t.key.trim().toUpperCase() }))
      .sort((a, b) => a.key.localeCompare(b.key))

  return {
    styleTags: [...draft.styleTags].sort(),
    currencyTargets: sortTargets(draft.currencyTargets),
    sectorTargets: sortTargets(draft.sectorTargets),
    assetClassTargets: sortTargets(draft.assetClassTargets),
    positionSize: draft.positionSize,
  }
}

/**
 * What the profile says, in one line, for the header of the page that edits it.
 *
 * It counts rather than lists, because the lists are on screen directly below it. The empty case
 * is a sentence rather than "0 tags · 0 targets": an owner who has written nothing is being told
 * what this page is for, not given a tally of their nothing.
 */
export function profileSummary(profile: InvestorProfile): string {
  const targets =
    profile.currencyTargets.length +
    profile.sectorTargets.length +
    profile.assetClassTargets.length +
    (profile.positionSize === null ? 0 : 1)

  if (profile.styleTags.length === 0 && targets === 0) {
    return 'No profile set — the assistant has no standard to measure against yet.'
  }
  return `${plural(profile.styleTags.length, 'style tag')} · ${plural(targets, 'target')}`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
