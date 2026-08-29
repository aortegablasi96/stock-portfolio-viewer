import { describe, it, expect, vi, beforeEach } from 'vitest'
import { apiKeyService, describeKeyProblem } from './apiKeyService'
import { aiGateway } from '@repositories/assistant/aiGateway'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'

/**
 * What may be saved as an API key (Story #300, DDR-0105).
 *
 * The gateway is mocked, which is the pattern every service test here follows — and the reason is
 * sharper than usual in this one file: the thing under test decides what reaches an
 * `Authorization` header, so the assertion that matters is that a bad paste **never gets that
 * far**, not that the header came out wrong afterwards.
 *
 * The wording is asserted rather than the shape of the failure. A key with a space in it is a
 * paste accident, and the difference between "invalid" and a sentence saying what to paste is the
 * difference between a state the owner can act on and one they cannot (DDR-0022's register).
 */

vi.mock('@repositories/assistant/aiGateway', () => ({
  aiGateway: { storeKey: vi.fn(), clearStoredKey: vi.fn() },
}))

const mockGateway = vi.mocked(aiGateway)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('describeKeyProblem', () => {
  it('accepts an ordinary key', () => {
    expect(describeKeyProblem('sk-proj-abc123_DEF-456')).toBeNull()
  })

  /**
   * **No format check, deliberately.** `OPENAI_BASE_URL` can point the gateway at a compatible
   * endpoint whose credentials are shaped differently, so requiring `sk-` would reject a working
   * setup to catch a typo the provider already reports better — as `refused`, in its own words.
   */
  it('accepts a key that is not OpenAI-shaped, because a key is opaque', () => {
    expect(describeKeyProblem('a-token-from-a-compatible-endpoint')).toBeNull()
  })

  it('trims before judging, so a pasted key with surrounding whitespace is fine', () => {
    expect(describeKeyProblem('\n  sk-pasted-from-a-web-page  \n')).toBeNull()
  })

  it('names a blank paste as one, rather than storing an empty key', () => {
    expect(describeKeyProblem('')).toBe('Paste a key before saving.')
    expect(describeKeyProblem('   \t \n ')).toBe('Paste a key before saving.')
  })

  /**
   * The rule with a mechanical reason behind it. A control character inside a key would make
   * `node:http` **throw** on `Authorization: Bearer …`, turning a bad paste into an exception in
   * the one module whose whole design is that every outcome is a state (DDR-0096). Refusing it
   * here is what keeps that promise true.
   */
  it.each([
    ['an interior space', 'sk-two words'],
    ['a newline', 'sk-first\nsk-second'],
    ['a tab', 'sk-one\ttwo'],
    ['a smart quote a document viewer substituted', 'sk-“quoted”'],
  ])('refuses %s', (_case, key) => {
    expect(describeKeyProblem(key)).toMatch(/Paste the key on its own/)
  })

  it('refuses something far too long to be a key', () => {
    expect(describeKeyProblem('s'.repeat(MAX_API_KEY_CHARS + 1))).toMatch(/longer than/)
  })

  it('accepts a key exactly at the ceiling, so the bound is not off by one', () => {
    expect(describeKeyProblem('s'.repeat(MAX_API_KEY_CHARS))).toBeNull()
  })
})

describe('apiKeyService.save', () => {
  it('stores the trimmed key', () => {
    expect(apiKeyService.save('  sk-a-key  ')).toEqual({ status: 'saved' })
    expect(mockGateway.storeKey).toHaveBeenCalledWith('sk-a-key')
  })

  /** The assertion the validation exists for: a bad paste never reaches the store. */
  it('stores nothing when the key is refused', () => {
    const result = apiKeyService.save('sk-two words')

    expect(result.status).toBe('invalid')
    expect(mockGateway.storeKey).not.toHaveBeenCalled()
  })

  /** Nothing about the value is echoed back — not the key, not a fragment, not its length. */
  it('reports the problem without quoting what was pasted', () => {
    const result = apiKeyService.save('sk-secret one')

    expect(result.status === 'invalid' && result.message).not.toContain('secret')
  })
})

describe('apiKeyService.clear', () => {
  it('removes the stored key', () => {
    apiKeyService.clear()
    expect(mockGateway.clearStoredKey).toHaveBeenCalled()
  })

  /** Removing a key that was never there is not a failure, so there is nothing to report. */
  it('is silent when there was nothing to remove', () => {
    mockGateway.clearStoredKey.mockReturnValue(false)
    expect(apiKeyService.clear()).toBeUndefined()
  })
})
