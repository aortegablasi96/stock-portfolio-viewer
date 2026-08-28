import { z } from 'zod'
import { metaRepository } from '@repositories/meta/metaRepository'
import { disclosureFingerprint } from '@shared/domain/assistantDisclosure'

/**
 * Whether the owner has agreed that portfolio-derived figures may leave the machine (Story #283,
 * DDR-0097).
 *
 * **Stored the way the investor profile is** — one overwritten `app_meta` value through
 * `metaRepository` — because the story asked the two to answer the same question the same way
 * rather than inventing two mechanisms for two small owner-owned flags (DDR-0094, DDR-0028). It is
 * a *setting*, not history: ADR-0006 governs the append-only stores and a consent decision records
 * nothing that happened to a portfolio.
 *
 * **Consent is to a specific disclosure, not to the idea of one.** What is stored beside the
 * timestamp is the fingerprint of the category list the owner actually read. When a later story
 * sends something new the fingerprint changes, the stored consent stops matching, and the owner is
 * asked again — rather than having silently agreed to more than was on screen. That is what makes
 * the disclosure worth writing carefully.
 *
 * Revocation **removes the key**, so "never asked" and "said no" are the same state: neither is a
 * decision the app should treat as durable, and both mean nothing may be sent.
 */

/** Key under which the JSON blob is stored in `app_meta`. */
export const ASSISTANT_CONSENT_KEY = 'assistant_consent'

export interface ConsentState {
  /** `true` only when consent was granted **against the disclosure now in force**. */
  granted: boolean
  /** When it was granted — epoch ms, UTC; `null` when there is no live consent. */
  grantedAt: number | null
  /**
   * Consent exists but was given against a different disclosure, so it no longer holds.
   *
   * Distinct from never having consented: the owner is being asked to re-read a list that
   * *changed*, not to make a decision for the first time, and telling them the wrong one of those
   * is the same class of mistake as confusing `not_connected` with `not_responding` (DDR-0022).
   */
  stale: boolean
}

const NO_CONSENT: ConsentState = { granted: false, grantedAt: null, stale: false }

/**
 * Stored consent is parsed, never trusted — the rule `sidebarStateService` and
 * `investorProfileService` both follow, for the same two reasons: the value is a hand-editable row
 * in a local database, and it can predate a change to this shape. Anything unreadable is treated
 * as **absent**, which here means *nothing may be sent* — the safe direction for this particular
 * flag, and worth stating because for the other two settings the safe direction was a default.
 */
const storedConsentSchema = z.object({
  grantedAt: z.number().int(),
  fingerprint: z.string(),
})

export const consentService = {
  /** The consent now in force, measured against the disclosure now in force. */
  get(): ConsentState {
    const stored = readStoredConsent()
    if (!stored) return NO_CONSENT
    if (stored.fingerprint !== disclosureFingerprint()) {
      return { granted: false, grantedAt: stored.grantedAt, stale: true }
    }
    return { granted: true, grantedAt: stored.grantedAt, stale: false }
  },

  /** Record consent against the disclosure the owner just read. */
  grant(now: number = Date.now()): ConsentState {
    metaRepository.set(
      ASSISTANT_CONSENT_KEY,
      JSON.stringify({ grantedAt: now, fingerprint: disclosureFingerprint() }),
    )
    return { granted: true, grantedAt: now, stale: false }
  },

  /**
   * Withdraw consent. The key is removed rather than set to `false`, so a withdrawn consent and a
   * never-given one are indistinguishable — which they should be, because the app must behave
   * identically in both: it sends nothing.
   */
  revoke(): ConsentState {
    metaRepository.remove(ASSISTANT_CONSENT_KEY)
    return NO_CONSENT
  },
}

function readStoredConsent(): { grantedAt: number; fingerprint: string } | undefined {
  const raw = metaRepository.get(ASSISTANT_CONSENT_KEY)
  if (!raw) return undefined

  try {
    const parsed = storedConsentSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : undefined
  } catch {
    // Not JSON at all.
    return undefined
  }
}
