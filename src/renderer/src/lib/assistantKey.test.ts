import { describe, expect, it } from 'vitest'
import {
  isSavableKey,
  keySurface,
  saveKeyLabel,
  KEY_BODY,
  KEY_HEADING,
  KEY_SHADOWED_NOTE,
  KEY_STORAGE_NOTE,
} from './assistantKey'
import type { AssistantStatus } from '@shared/domain/assistant'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'

/**
 * The API key surface's wording (Story #300, DDR-0105; reshaped by Story #309, ADR-0011).
 *
 * Vitest runs Node-only (DDR-0029), so prose inside a component is prose nothing can hold, and this
 * story's criteria *are* prose: that the field appears when there is no working key and not once
 * there is one, that the precedence between the two sources is stated rather than discovered, and
 * that no copy anywhere looks like a key.
 */

const status = (over: Partial<AssistantStatus> = {}): AssistantStatus => ({
  state: 'not_configured',
  keySource: 'none',
  keyStored: false,
  ...over,
})

describe('what the view draws about the key', () => {
  it('offers the field when there is no key anywhere', () => {
    expect(keySurface(status())).toBe('field')
  })

  /**
   * The story's shape: shown when there is no working key, and **not shown once there is one**. No
   * activate, no deactivate, no rotate — so a settled key draws nothing at all rather than a card
   * reporting that the setup is done.
   */
  it.each([
    ['a key saved in the app', status({ state: 'ready', keySource: 'stored', keyStored: true })],
    ['a key from the environment only', status({ state: 'ready', keySource: 'environment' })],
  ])('draws nothing with %s', (_case, given) => {
    expect(keySurface(given)).toBe('none')
  })

  /**
   * The one state that still says something about a key that is present. The owner saved a key
   * *and* the environment supplies one, so theirs is kept and is not the one being spent — the
   * failure a stated order exists to prevent is exactly this being silent (DDR-0105).
   */
  it('reports a saved key the environment is shadowing', () => {
    expect(keySurface(status({ state: 'ready', keySource: 'environment', keyStored: true }))).toBe(
      'shadowed',
    )
  })
})

describe('the copy', () => {
  it('gives the field a heading and a body', () => {
    expect(KEY_HEADING.trim()).not.toBe('')
    expect(KEY_BODY.trim()).not.toBe('')
  })

  /**
   * The precedence, said out loud where it applies. An order the owner cannot see is not stated,
   * and a key silently ignored is what that costs.
   */
  it('names the variable and its precedence on the field', () => {
    expect(KEY_BODY).toContain('OPENAI_API_KEY')
    expect(KEY_BODY).toContain('takes precedence')
  })

  it('tells an owner whose saved key is shadowed that it is kept and not in use', () => {
    expect(KEY_SHADOWED_NOTE).toContain('OPENAI_API_KEY')
    expect(KEY_SHADOWED_NOTE).toContain('is not being used')
    expect(KEY_SHADOWED_NOTE).toContain('kept')
  })

  /**
   * ADR-0011's own sentence, in the app: supplying the key is what authorizes sending, so the field
   * that takes it is the last place the owner is told that questions go to OpenAI. The consent
   * panel used to say it at length; this is what remains, and the record accepts that trade.
   */
  it('says on the field that asking sends the figures to OpenAI', () => {
    expect(KEY_BODY).toContain('OpenAI')
    expect(KEY_BODY).toContain('sent')
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
  it('shows no key material anywhere', () => {
    expect(
      `${KEY_HEADING} ${KEY_BODY} ${KEY_SHADOWED_NOTE} ${KEY_STORAGE_NOTE}`,
    ).not.toMatch(/sk-\w/)
  })

  /**
   * Nothing offers to remove, replace or disable a key (ADR-0011). Held on the copy because the
   * control would have to be labelled before it could exist, and a label is what a Node-only suite
   * can see.
   */
  it('offers no removal, replacement or rotation anywhere in its copy', () => {
    const all = `${KEY_HEADING} ${KEY_BODY} ${KEY_SHADOWED_NOTE} ${KEY_STORAGE_NOTE}`.toLowerCase()
    for (const word of ['remove key', 'replace it', 'rotate', 'delete the key']) {
      expect(all, word).not.toContain(word)
    }
  })
})

describe('the save control', () => {
  /** There is no replacement, so the label never claims to be one. */
  it('labels the action as a first save', () => {
    expect(saveKeyLabel(false)).toBe('Save key')
  })

  it('reports the wait while a save is in flight', () => {
    expect(saveKeyLabel(true)).toBe('Saving…')
    expect(saveKeyLabel(true)).not.toContain('...')
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
