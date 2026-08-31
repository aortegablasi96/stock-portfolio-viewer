/**
 * The investor profile's vocabulary and shape, with **no dependencies** (Story #280, DDR-0094).
 *
 * It is split from `investorProfile.ts` for the reason `shared/ipc/channels.ts` is split from
 * `shared/ipc/contract.ts`: that module imports Zod, and the renderer imports only *types* from
 * `@shared/domain/*` so Zod never lands in its bundle. The Profile form needs the five tags, the
 * three dimensions and their labels as **values** — it renders them — so they live here, where a
 * value import costs nothing.
 *
 * `investorProfile.ts` builds its schemas over these and re-exports them, so there is still one
 * import path for anything in the main process and exactly one source of truth for both.
 *
 * It imports `assetClass.ts`, which is dependency-free for the same reason, so the pair stays
 * bundle-safe.
 */
import { assetClassLabel } from './assetClass'

/**
 * The five style tags, as the owner wrote them in Epic #5.
 *
 * Stored as stable snake_case ids with their prose kept beside them in {@link STYLE_TAG_LABELS},
 * so re-wording a label never rewrites what is in the database.
 */
export const STYLE_TAGS = [
  'dividend_income',
  'small_cap_growth',
  'mature_large_cap',
  'defensive_sectors',
  'high_growth_sectors',
] as const

export type StyleTag = (typeof STYLE_TAGS)[number]

/** How each tag is written on screen. */
export const STYLE_TAG_LABELS: Record<StyleTag, string> = {
  dividend_income: 'Dividend income',
  small_cap_growth: 'Small-cap aggressive growth',
  mature_large_cap: 'Mature large-cap',
  defensive_sectors: 'Defensive sectors',
  high_growth_sectors: 'High-growth sectors',
}

/** A low/high pair in percent. */
export interface TargetRange {
  low: number
  high: number
}

/**
 * A named target: a range attached to one currency, sector or asset class.
 *
 * `key` is the vocabulary term — `'USD'`, `'Financial'`, `'STK'` — and is what the drift story
 * will join on. It is never checked against a list: the vocabularies are *suggested* from the
 * app's own data and never enforced against it, because an owner may state a policy for an
 * exposure they intend to take before they take it.
 */
export interface CategoryTarget extends TargetRange {
  key: string
}

/** The three dimensions that carry a *list* of named targets. */
export const TARGET_DIMENSIONS = ['currency', 'sector', 'assetClass'] as const
export type TargetDimension = (typeof TARGET_DIMENSIONS)[number]

/** How each dimension is written on screen, singular. */
export const TARGET_DIMENSION_LABELS: Record<TargetDimension, string> = {
  currency: 'Currency',
  sector: 'Sector',
  assetClass: 'Asset class',
}

/**
 * The indefinite article each dimension's label takes.
 *
 * A table rather than a rule, because the rule ("an" before a vowel) is wrong as often as it is
 * right in English and there are three entries. It exists so "Choose an asset class." is not
 * "Choose a asset class." — the sort of thing a message assembled from a noun ships with.
 */
export const TARGET_DIMENSION_ARTICLES: Record<TargetDimension, string> = {
  currency: 'a',
  sector: 'a',
  assetClass: 'an',
}

/** The heading each dimension's section carries, and the sentence under it. */
export const TARGET_DIMENSION_HEADINGS: Record<TargetDimension, string> = {
  currency: 'Currency exposure',
  sector: 'Sector weight',
  assetClass: 'Asset-class weight',
}

/**
 * How a stored target's key reads to a person, or to a model.
 *
 * **A target key is not always a label**, and asset class is the dimension where they part company.
 * A currency target is stored as `USD` and a sector target as `Banks` — both are already the words
 * anyone would use. An asset-class target is stored under the key the *allocation report* published
 * (DDR-0094, which is what makes a stored target join at all), and those are IBKR's codes: `STK`,
 * `BOND`, and the `__cash__` sentinel that cannot collide with one.
 *
 * So the raw key must never reach a reader. It shipped in two places and read `Asset class
 * __cash__: 2.00%–10.00%` in the assembled context — a sentinel in front of a model, beside a
 * drift band that called the same thing `Cash`, so one answer could name it both ways.
 */
export function targetLabel(dimension: TargetDimension, key: string): string {
  return dimension === 'assetClass' ? assetClassLabel(key) : key
}

/** Which field on the profile each dimension's list lives in. */
export const TARGET_DIMENSION_FIELDS = {
  currency: 'currencyTargets',
  sector: 'sectorTargets',
  assetClass: 'assetClassTargets',
} as const satisfies Record<TargetDimension, keyof InvestorProfileDraft>

/**
 * What the renderer sends. `updatedAt` is deliberately absent: when the profile was last written
 * is the service's fact, not the caller's, and accepting it from the renderer would let a stale
 * form claim to be newer than it is.
 */
export interface InvestorProfileDraft {
  styleTags: StyleTag[]
  currencyTargets: CategoryTarget[]
  sectorTargets: CategoryTarget[]
  assetClassTargets: CategoryTarget[]
  /**
   * The single-position concentration band, or `null` when the owner has no policy on it.
   *
   * A pair rather than a bare ceiling, so all four targets share one shape, one validator and one
   * control (DDR-0094). `high` is the ceiling Epic #5 asks for; `low` is the smallest position
   * worth holding, which an owner who only cares about the ceiling leaves at 0.
   */
  positionSize: TargetRange | null
}

/** The stored profile: a draft plus when it was written, or `null` if it never has been. */
export interface InvestorProfile extends InvestorProfileDraft {
  updatedAt: number | null
}

/**
 * The profile of an owner who has not written one — and also what "Clear" leaves behind.
 *
 * It is a real, valid profile rather than a `null`, which is what keeps every reader of this
 * module free of a "no profile yet" branch: an empty profile simply has no policy to measure
 * against, exactly like one whose owner filled in only currencies.
 */
export const EMPTY_INVESTOR_PROFILE: InvestorProfile = {
  styleTags: [],
  currencyTargets: [],
  sectorTargets: [],
  assetClassTargets: [],
  positionSize: null,
  updatedAt: null,
}

/** Whether a profile states any policy at all. */
export function isProfileEmpty(profile: InvestorProfileDraft): boolean {
  return (
    profile.styleTags.length === 0 &&
    profile.currencyTargets.length === 0 &&
    profile.sectorTargets.length === 0 &&
    profile.assetClassTargets.length === 0 &&
    profile.positionSize === null
  )
}

/** How many targets a profile carries, across the three dimensions and the position band. */
export function countTargets(profile: InvestorProfileDraft): number {
  return (
    profile.currencyTargets.length +
    profile.sectorTargets.length +
    profile.assetClassTargets.length +
    (profile.positionSize === null ? 0 : 1)
  )
}
