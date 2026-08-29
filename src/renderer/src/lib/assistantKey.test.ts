import { describe, expect, it } from 'vitest'
import {
  canRemoveKey,
  isSavableKey,
  keyPanelKind,
  saveKeyLabel,
  KEY_BODIES,
  KEY_HEADINGS,
  KEY_STORAGE_NOTE,
  type KeyPanelKind,
} from './assistantKey'
import type { AssistantStatus } from '@shared/domain/assistant'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'

/**
 * The API key panel's wording (Story #300, DDR-0105).
 *
 * Same shape as `assistantGate.test.ts`, and for the same reason: Vitest runs Node-only (DDR-0029),
 * so prose inside a component is prose nothing can hold. Two of this story's acceptance criteria
 * *are* prose — that the precedence is stated rather than discovered, and that the store's being
 * unencrypted is written down — and this is what holds them.
 */

const status = (over: Partial<AssistantStatus> = {}): AssistantStatus => ({
  state: 'not_configured',
  consented: true,
  consentedAt: 1,
  consentStale: false,
  configured: false,
  keySource: 'none',
  keyStored: false,
  ...over,
})

const ALL_KINDS: KeyPanelKind[] = ['none', 'stored', 'environment', 'environment_shadowing']

describe('which panel the owner sees', () => {
  it.each([
    ['no key anywhere', status(), 'none'],
    ['a key saved in the app', status({ keySource: 'stored', keyStored: true, configured: true }), 'stored'],
    [
      'a key from the environment only',
      status({ keySource: 'environment', keyStored: false, configured: true }),
      'environment',
    ],
    /**
     * The state the whole precedence rule turns on. The owner has saved a key *and* the
     * environment supplies one: theirs is stored, is not being used, and the panel has to say both
     * rather than reporting the assistant as simply working.
     */
    [
      'a saved key the environment is shadowing',
      status({ keySource: 'environment', keyStored: true, configured: true }),
      'environment_shadowing',
    ],
  ] as const)('draws %s as %s', (_case, given, expected) => {
    expect(keyPanelKind(given)).toBe(expected)
  })
})

describe('the copy behind each state', () => {
  it.each(ALL_KINDS)('gives "%s" a heading and a body', (kind) => {
    expect(KEY_HEADINGS[kind]?.trim()).not.toBe('')
    expect(KEY_BODIES[kind]?.trim()).not.toBe('')
  })

  /**
   * The precedence, said out loud in both states where it applies. A key that is silently ignored
   * is the failure a stated order exists to prevent, and an order the owner cannot see is not
   * stated.
   */
  it.each(['environment', 'environment_shadowing'] as const)(
    '"%s" names the variable and says it takes precedence',
    (kind) => {
      expect(KEY_BODIES[kind]).toContain('OPENAI_API_KEY')
      expect(KEY_BODIES[kind]).toContain('takes precedence')
    },
  )

  /** And the shadowing case additionally says the saved key is kept and unused. */
  it('tells an owner whose saved key is shadowed that it is kept and not in use', () => {
    expect(KEY_BODIES.environment_shadowing).toContain('is not being used')
    expect(KEY_BODIES.environment_shadowing).toContain('kept')
  })

  /**
   * The story asks that where the key lives and the fact that the store is unencrypted be written
   * down. It is in the record *and* on the panel that asks for the key, because "no worse than
   * `.env`" is a fair claim and one the owner is entitled to check.
   */
  it('says on screen that the store is local and unencrypted', () => {
    expect(KEY_STORAGE_NOTE).toContain('unencrypted')
    expect(KEY_STORAGE_NOTE).toContain('this computer')
  })

  /** And that it is never shown again — the criterion the field's own behaviour implements. */
  it('says the key is never displayed again', () => {
    expect(KEY_STORAGE_NOTE).toContain('never shown again')
  })

  /**
   * No copy anywhere may look like a key. This is the cheap guard against the tempting "your key
   * ends in …ab12" affordance, which would be the one place the value came back after
   * `aiGateway.redactKeys` went to the trouble of stripping even a masked fragment.
   */
  it.each(ALL_KINDS)('shows no key material in "%s"', (kind) => {
    expect(`${KEY_HEADINGS[kind]} ${KEY_BODIES[kind]} ${KEY_STORAGE_NOTE}`).not.toMatch(/sk-\w/)
  })
})

describe('the save control', () => {
  /** A replacement is not a first save, and does not claim to be. */
  it.each([
    ['none', 'Save key'],
    ['environment', 'Save key'],
    ['stored', 'Replace key'],
    ['environment_shadowing', 'Replace key'],
  ] as const)('labels "%s" as "%s"', (kind, expected) => {
    expect(saveKeyLabel(kind, false)).toBe(expected)
  })

  it('reports the wait while a save is in flight', () => {
    expect(saveKeyLabel('none', true)).toBe('Saving…')
  })

  it('refuses to send a blank field', () => {
    expect(isSavableKey('')).toBe(false)
    expect(isSavableKey('   ')).toBe(false)
  })

  it('sends anything else, leaving what is wrong with it to the one place that says', () => {
    expect(isSavableKey('sk-a-key')).toBe(true)
    // A space is refused in main, with wording the owner can act on — not silently here.
    expect(isSavableKey('sk-two words')).toBe(true)
  })

  it('stops at the wire ceiling rather than sending a paste of a whole file', () => {
    expect(isSavableKey('s'.repeat(MAX_API_KEY_CHARS))).toBe(true)
    expect(isSavableKey('s'.repeat(MAX_API_KEY_CHARS + 1))).toBe(false)
  })
})

describe('removing', () => {
  it('is offered whenever a key is stored', () => {
    expect(canRemoveKey(status({ keySource: 'stored', keyStored: true }))).toBe(true)
  })

  /** Including while the environment outranks it: it is still there, and still the owner's. */
  it('is offered while the environment is shadowing the stored key', () => {
    expect(canRemoveKey(status({ keySource: 'environment', keyStored: true }))).toBe(true)
  })

  it('is not offered when the only key is the environment’s', () => {
    expect(canRemoveKey(status({ keySource: 'environment', keyStored: false }))).toBe(false)
  })

  it('is not offered when there is no key at all', () => {
    expect(canRemoveKey(status())).toBe(false)
  })
})
