import { metaRepository } from '@repositories/meta/metaRepository'
import {
  EMPTY_INVESTOR_PROFILE,
  investorProfileSchema,
  STYLE_TAGS,
  type CategoryTarget,
  type InvestorProfile,
  type InvestorProfileDraft,
  type TargetDimension,
} from '@shared/domain/investorProfile'

/**
 * The investor profile's one home (Milestone M10, Story #280).
 *
 * **It is a single overwritten `app_meta` value, not a table** (DDR-0094). The story called this
 * its hardest question and it has three candidate shapes, of which two are wrong for reasons
 * worth stating rather than inferring.
 *
 * A *mutable table* would claim DDR-0009's exception, and that exception is narrower than
 * "mutable": `instrument_classifications` is a **cache of derived reference data**, upserted by
 * conid, re-derivable from IBKR at any time, and losing it costs a refresh. A profile is neither
 * derived nor a cache — it is the only thing in this database the app cannot reconstruct from
 * any source, because its source is the owner. Filing it beside a cache would say the opposite.
 *
 * *Versioned rows* would satisfy ADR-0006 literally by making the profile append-only, and would
 * be the honest shape if anyone wanted to read a past profile. Nobody does — the Epic puts
 * profile history explicitly out of scope — so it would be an append-only store whose every read
 * discards all but the newest row, i.e. an overwrite with extra steps and a growing table.
 *
 * ADR-0006 is not being argued around, because it does not reach here. Its subject is *history*:
 * the snapshots and `flex_*` tables record things that happened, and a delete rewrites the past.
 * The profile records nothing that happened. It is a **setting** — the same class of fact as the
 * window's own bounds and the sidebar's collapsed state, both of which are single overwritten
 * `app_meta` values for exactly this reason (DDR-0028). It is a bigger value than either, and
 * that is a difference of size, not of kind.
 *
 * Services may not import `electron` or `@db` (ADR-0002/0003), so like `sidebarStateService` this
 * one reaches storage only through `metaRepository`, and the JSON it stores is **parsed, never
 * trusted**: the value is a hand-editable row in a local database and can predate a change to
 * this shape, so anything unreadable is treated as absent. A corrupt value costs the owner their
 * profile, not their launch.
 */

/** Key under which the JSON blob is stored in `app_meta`. */
export const INVESTOR_PROFILE_KEY = 'investor_profile'

export const investorProfileService = {
  /** The stored profile, or the empty one when nothing usable is stored. */
  get(): InvestorProfile {
    return readStoredProfile() ?? EMPTY_INVESTOR_PROFILE
  },

  /**
   * Persist the profile the owner submitted, and return exactly what was stored.
   *
   * The draft arrives already validated by the IPC boundary (ADR-0002), so what happens here is
   * *normalisation*, not a second validation: the parts of "the same policy written differently"
   * that only one layer should have to know about. Style tags are de-duplicated and put in the
   * canonical order, target keys are trimmed and upper-cased for currency, and empty lists stay
   * empty rather than becoming absent.
   *
   * `updatedAt` is stamped here rather than taken from the caller — see the draft schema.
   */
  save(draft: InvestorProfileDraft, now: number = Date.now()): InvestorProfile {
    const profile = normalize(draft, now)
    metaRepository.set(INVESTOR_PROFILE_KEY, JSON.stringify(profile))
    return profile
  },

  /**
   * Un-set the profile, reporting the empty one that is now in force.
   *
   * The key is removed rather than overwritten with an empty profile, so "never written" and
   * "written and then cleared" are the same state — which they are, since an empty profile
   * states no policy either way. Storing a cleared profile would leave an `updatedAt` claiming
   * the owner had said something.
   */
  clear(): InvestorProfile {
    metaRepository.remove(INVESTOR_PROFILE_KEY)
    return EMPTY_INVESTOR_PROFILE
  },
}

/**
 * Canonical form of a submitted draft.
 *
 * Ordering is part of it. Style tags come back in `STYLE_TAGS` order and targets sorted by key,
 * so two owners who stated the same policy in different orders store the same bytes — which is
 * what stops a re-save that changed nothing from looking like a change.
 */
function normalize(draft: InvestorProfileDraft, now: number): InvestorProfile {
  const seenTags = new Set(draft.styleTags)
  return {
    styleTags: STYLE_TAGS.filter((tag) => seenTags.has(tag)),
    currencyTargets: normalizeTargets(draft.currencyTargets, 'currency'),
    sectorTargets: normalizeTargets(draft.sectorTargets, 'sector'),
    assetClassTargets: normalizeTargets(draft.assetClassTargets, 'assetClass'),
    positionSize: draft.positionSize,
    updatedAt: now,
  }
}

/**
 * Trim, canonicalise and sort one dimension's targets.
 *
 * Currency codes are upper-cased because that is how every other layer writes them — the
 * allocation report's `byCurrency` keys, the gateway's FX pairs, the display-currency selector —
 * and a profile keyed `usd` would silently fail to join with any of them. Sector and asset-class
 * names are **left as typed**: their vocabularies are prose from IBKR (`Financial`, `STK`) and
 * case-folding them would be this module inventing a spelling.
 */
function normalizeTargets(
  targets: readonly CategoryTarget[],
  dimension: TargetDimension,
): CategoryTarget[] {
  return targets
    .map((target) => ({
      ...target,
      key: dimension === 'currency' ? target.key.trim().toUpperCase() : target.key.trim(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

function readStoredProfile(): InvestorProfile | undefined {
  const raw = metaRepository.get(INVESTOR_PROFILE_KEY)
  if (!raw) return undefined

  try {
    const parsed = investorProfileSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    // Not JSON at all.
    return undefined
  }
}
