import { describe, it, expect, vi, beforeEach } from 'vitest'
import { consentService, ASSISTANT_CONSENT_KEY } from './consentService'
import { metaRepository } from '@repositories/meta/metaRepository'
import { disclosureFingerprint } from '@shared/domain/assistantDisclosure'

/**
 * Where consent lives, and what invalidates it (Story #283, DDR-0097).
 *
 * The repository is mocked so the service is tested in isolation — the pattern `metaService`
 * established and both `sidebarStateService` and `investorProfileService` follow, which is also
 * the story's own point: consent is stored the way the profile is, rather than by inventing a
 * second mechanism for a second small owner-owned flag.
 *
 * The part worth pinning is that **consent is to a specific disclosure**. Everything else here is
 * a round trip; that one rule is what stops a later story silently widening what the owner agreed
 * to.
 */

vi.mock('@repositories/meta/metaRepository', () => ({
  metaRepository: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
}))

const mockRepo = vi.mocked(metaRepository)
const NOW = 1_756_000_000_000

beforeEach(() => {
  vi.clearAllMocks()
})

describe('consentService.get', () => {
  /** The safe direction for this flag: nothing stored means nothing may be sent. */
  it('reports no consent when nothing is stored', () => {
    mockRepo.get.mockReturnValue(undefined)

    expect(consentService.get()).toEqual({ granted: false, grantedAt: null, stale: false })
    expect(mockRepo.get).toHaveBeenCalledWith(ASSISTANT_CONSENT_KEY)
  })

  it('reports consent granted against the disclosure now in force', () => {
    mockRepo.get.mockReturnValue(
      JSON.stringify({ grantedAt: NOW, fingerprint: disclosureFingerprint() }),
    )

    expect(consentService.get()).toEqual({ granted: true, grantedAt: NOW, stale: false })
  })

  /**
   * The rule the whole mechanism exists for. Consent was given against a list; the list changed;
   * the consent no longer holds. Without this a later story could add a category and inherit an
   * agreement made about something else.
   */
  it('withdraws consent when the disclosure has changed since it was given', () => {
    mockRepo.get.mockReturnValue(
      JSON.stringify({ grantedAt: NOW, fingerprint: 'what the owner read last year' }),
    )

    expect(consentService.get()).toEqual({ granted: false, grantedAt: NOW, stale: true })
  })

  /**
   * Stale is not absent. The owner is being asked to re-read a list that *changed*, not to decide
   * for the first time, and telling them the wrong one of those is the same class of mistake as
   * confusing `not_connected` with `not_responding` (DDR-0022).
   */
  it('keeps stale distinct from never having consented', () => {
    mockRepo.get.mockReturnValue(JSON.stringify({ grantedAt: NOW, fingerprint: 'old' }))
    const stale = consentService.get()

    mockRepo.get.mockReturnValue(undefined)
    const never = consentService.get()

    expect(stale.stale).toBe(true)
    expect(never.stale).toBe(false)
    expect(stale.granted).toBe(false)
    expect(never.granted).toBe(false)
  })

  /**
   * The value is a hand-editable row in a local database and can predate a change to this shape.
   * Anything unreadable is treated as absent — and here "absent" means *nothing may be sent*,
   * which is worth stating because for the app's other two settings the safe direction was a
   * default rather than a refusal.
   */
  it.each([
    ['not JSON at all', 'yes please'],
    ['JSON of the wrong shape', '{"ok":true}'],
    ['a scalar rather than an object', 'true'],
    ['an empty string', ''],
    ['a granted-at that is not a number', '{"grantedAt":"today","fingerprint":"x"}'],
  ])('falls back to no consent when the stored value is %s', (_case, stored) => {
    mockRepo.get.mockReturnValue(stored)

    expect(consentService.get().granted).toBe(false)
  })
})

describe('consentService.grant', () => {
  it('stores the time and the disclosure it was given against', () => {
    consentService.grant(NOW)

    expect(mockRepo.set).toHaveBeenCalledWith(
      ASSISTANT_CONSENT_KEY,
      JSON.stringify({ grantedAt: NOW, fingerprint: disclosureFingerprint() }),
    )
  })

  /** One overwritten `app_meta` value, like the profile and the window's own bounds. */
  it('overwrites rather than appending', () => {
    consentService.grant(NOW)
    consentService.grant(NOW + 1000)

    expect(mockRepo.set).toHaveBeenCalledTimes(2)
    expect(mockRepo.set.mock.calls.map(([key]) => key)).toEqual([
      ASSISTANT_CONSENT_KEY,
      ASSISTANT_CONSENT_KEY,
    ])
  })

  it('round-trips: what it writes is what get reads back as granted', () => {
    consentService.grant(NOW)
    const [, written] = mockRepo.set.mock.calls[0]!
    mockRepo.get.mockReturnValue(written)

    expect(consentService.get()).toEqual({ granted: true, grantedAt: NOW, stale: false })
  })
})

describe('consentService.revoke', () => {
  /**
   * The key is removed rather than set to `false`, so a withdrawn consent and a never-given one
   * are indistinguishable — which they should be, because the app behaves identically in both: it
   * sends nothing.
   */
  it('removes the key rather than storing a refusal', () => {
    expect(consentService.revoke()).toEqual({ granted: false, grantedAt: null, stale: false })
    expect(mockRepo.remove).toHaveBeenCalledWith(ASSISTANT_CONSENT_KEY)
    expect(mockRepo.set).not.toHaveBeenCalled()
  })

  it('leaves a subsequent read reporting no consent', () => {
    consentService.revoke()
    mockRepo.get.mockReturnValue(undefined)

    expect(consentService.get().granted).toBe(false)
  })
})
