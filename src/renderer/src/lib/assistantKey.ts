import type { AssistantStatus } from '@shared/domain/assistant'
import { MAX_API_KEY_CHARS } from '@shared/domain/assistantKey'

/**
 * The wording of the API key panel (Story #300, DDR-0105).
 *
 * Here rather than in the component for the reason `assistantGate.ts` is: Vitest runs Node-only
 * with no jsdom (DDR-0029), so a string inside a component is a string nothing can assert — and
 * the strings *are* the feature here. Two rules the story sets are wording rules and can only be
 * held by a test:
 *
 * **Precedence is said out loud.** The environment wins over a key saved in the app, so an owner
 * who saves one while `OPENAI_API_KEY` is set must be told their key is stored and not in use.
 * A silently ignored key is the one failure a stated order exists to prevent, and the difference
 * between saying it and not saying it is one panel kind.
 *
 * **The store is unencrypted, and the panel says so.** The database has never been encrypted and
 * neither is `.env`, so this is no worse than where the key already lived — but "no worse than
 * before" is a claim the owner is entitled to check rather than one the app gets to make quietly.
 */

/**
 * Which panel to draw.
 *
 * Four kinds over two facts, because the pair *environment supplies the key* and *the app also
 * has one saved* is the state whose copy differs most: it is the only one that has to explain a
 * key being present and unused, and the only one that offers Remove while the assistant is
 * already running on something else.
 */
export type KeyPanelKind = 'none' | 'stored' | 'environment' | 'environment_shadowing'

export function keyPanelKind(status: AssistantStatus): KeyPanelKind {
  if (status.keySource === 'environment') {
    return status.keyStored ? 'environment_shadowing' : 'environment'
  }
  return status.keySource === 'stored' ? 'stored' : 'none'
}

/** The heading each state carries. */
export const KEY_HEADINGS: Record<KeyPanelKind, string> = {
  none: 'No API key',
  stored: 'Using the key you saved here',
  environment: 'Using a key from your environment',
  environment_shadowing: 'Using a key from your environment',
}

/**
 * The body of each state.
 *
 * The two `environment` kinds share a heading and differ in the body, which is the right split:
 * what is in force is the same fact, and what the owner has to *do* about it is not.
 */
export const KEY_BODIES: Record<KeyPanelKind, string> = {
  none: 'Paste an OpenAI key below to use the assistant. It is kept on this computer and is sent to OpenAI only as the credential on the questions you ask.',
  stored:
    'The assistant is using the key you saved in this app. Paste another to replace it, or remove it to switch the assistant back off.',
  environment:
    'OPENAI_API_KEY is set in your environment or your .env file, and that takes precedence over a key saved here. A key you save now is kept and starts being used as soon as the environment stops supplying one.',
  environment_shadowing:
    'OPENAI_API_KEY is set in your environment or your .env file, and that takes precedence over the key you saved here. Your saved key is kept and is not being used. Remove OPENAI_API_KEY and restart the app to use it instead.',
}

/**
 * Where the key is kept, stated on the panel that asks for it.
 *
 * The app's database is not encrypted — no table in it is — and neither is `.env`, so storing a
 * key here is no worse than the two places it could already live. That is a fair claim and a
 * *checkable* one, which is why it is on screen rather than only in the record.
 */
export const KEY_STORAGE_NOTE =
  'Saved in this app’s local database on this computer, unencrypted, like everything else it stores. It is never shown again once saved, and never sent anywhere except to OpenAI as the credential on a question you ask.'

/** The label the save control carries; a replacement is not a first save and does not say it is. */
export function saveKeyLabel(kind: KeyPanelKind, busy: boolean): string {
  if (busy) return 'Saving…'
  return kind === 'stored' || kind === 'environment_shadowing' ? 'Replace key' : 'Save key'
}

/**
 * Whether the typed value is worth sending.
 *
 * Deliberately only "not blank and not absurdly long" — the same shape `isAskable` has. Everything
 * else about a key is `apiKeyService.describeKeyProblem`'s to say, in main, once, with wording the
 * owner can act on; duplicating the character rule here would be two rules for one fact, and the
 * one the owner hit would depend on which check ran first.
 */
export function isSavableKey(value: string): boolean {
  const key = value.trim()
  return key.length > 0 && key.length <= MAX_API_KEY_CHARS
}

/** Whether there is a stored key to remove — true even while the environment is shadowing it. */
export function canRemoveKey(status: AssistantStatus): boolean {
  return status.keyStored
}
